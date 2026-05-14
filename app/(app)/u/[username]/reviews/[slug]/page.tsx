import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { ReviewCard } from "@/components/reviews/review-card";
import { CommentThread, type ThreadComment } from "@/components/comments/comment-thread";
import { withBlockedFilter } from "@/lib/social/_shared/visibility";

async function resolveOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

interface Props {
  params: Promise<{ username: string; slug: string }>;
}

/**
 * Shared (profile, game, viewer, review, isOwner) fetch wrapped in React's
 * cache() so generateMetadata and the page body collapse to ONE set of
 * queries per request instead of two parallel-but-duplicated chains.
 *
 * Stage 1 parallelizes profile + game + viewer (all keyed on URL params),
 * then Stage 2 fetches the review (depends on Stage 1's profile.userId +
 * game.id). The visibility gate matches the page-body 404 rules:
 *   - profile must exist and not be soft-deleted
 *   - private profiles only render for their owner
 *   - non-public reviews only render for their owner
 * Both metadata and page-body callers see `null` and 404 / fall back to
 * "Review not found" identically.
 */
const getReviewPageData = cache(async (username: string, slug: string) => {
  const [profile, game, viewer] = await Promise.all([
    db.query.profiles.findFirst({
      where: and(eq(schema.profiles.username, username), isNull(schema.profiles.deletedAt)),
      // isPublic mirrors the page-body gate; without this, share unfurlers
      // would receive the review's hook + OG image URL for a private profile
      // even though the page itself 404s.
      columns: { userId: true, username: true, isPublic: true },
    }),
    db.query.games.findFirst({
      where: eq(schema.games.slug, slug),
      // Page body needs cover + poster + title; metadata only needs title.
      // One shape covers both so cache() can dedupe.
      columns: { id: true, slug: true, title: true, coverUrl: true, posterUrl: true },
    }),
    // Owner-on-own-URL exception: a logged-in private user looking at their own
    // canonical review page still sees real metadata in the browser tab.
    // Unfurlers send no cookies, so getCachedUser() returns null for them and
    // the !isPublic branch fires correctly.
    getCachedUser(),
  ]);

  if (!profile || !game) return null;
  const isOwner = viewer?.id === profile.userId;
  if (!profile.isPublic && !isOwner) return null;

  const review = await db.query.reviews.findFirst({
    where: and(
      eq(schema.reviews.userId, profile.userId),
      eq(schema.reviews.gameId, game.id),
      isNotNull(schema.reviews.publishedAt),
      // Owners can see their own unpublished/private review metadata.
      isOwner ? undefined : eq(schema.reviews.isPublic, true),
    ),
    columns: { id: true, body: true, rating: true, publishedAt: true },
  });
  if (!review) return null;

  return { profile, game, viewer, review, isOwner };
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username, slug } = await params;
  const data = await getReviewPageData(username, slug);
  if (!data) return { title: "Review not found" };
  const { profile, game, review } = data;

  const hook = (review.body ?? "").split("\n\n")[0] ?? "";
  const description = hook.length > 180 ? `${hook.slice(0, 180).trimEnd()}…` : hook;
  const title = `@${profile.username} on ${game.title}`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [`/og/review/${review.id}`],
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`/og/review/${review.id}`],
    },
  };
}

export default async function CanonicalReviewPage({ params }: Props) {
  const { username, slug } = await params;

  // Shared data fetch — generateMetadata already ran getReviewPageData() for
  // this same (username, slug), so cache() returns the memoized result.
  const data = await getReviewPageData(username, slug);
  if (!data) notFound();
  const { profile, game, viewer, review, isOwner } = data;

  // Stage 3: like count + viewer-liked + comments — all depend on review.id, run in parallel.
  // Comment visibility predicate: flagged comments only visible to their author. We have
  // no admin role yet (T24 will add it); for now: own + non-hidden.
  //
  // Block filter: wrap the comments query in withBlockedFilter so viewers
  // don't see comments authored by users they've blocked (or who've blocked
  // them). Goes through the visibility chokepoint to stay aligned with
  // every other social read path (feed, profile, discovery).
  const baseCommentsQuery = db
    .select({
      id: schema.comments.id,
      body: schema.comments.body,
      userId: schema.comments.userId,
      parentId: schema.comments.parentId,
      createdAt: schema.comments.createdAt,
      editedAt: schema.comments.editedAt,
      isHidden: schema.comments.isHidden,
      authorUsername: schema.profiles.username,
      authorDisplayName: schema.profiles.displayName,
      authorProfilePictureUrl: schema.profiles.profilePictureUrl,
      authorDeletedAt: schema.profiles.deletedAt,
    })
    .from(schema.comments)
    // leftJoin so comments from soft-deleted authors still appear (body stays
    // visible); the authorDeletedAt field drives the "[deleted user]" mask below.
    .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.comments.userId))
    .where(
      and(
        eq(schema.comments.reviewId, review.id),
        viewer
          ? or(eq(schema.comments.isHidden, false), eq(schema.comments.userId, viewer.id))
          : eq(schema.comments.isHidden, false),
      ),
    )
    .$dynamic();

  // LIMIT 100: a viral review can attract thousands of comments and
  // unbounded reads drag the canonical page into multi-second renders
  // (audit T12). 100 covers virtually all real threads we've seen; the
  // CommentThread UI doesn't paginate yet, so the cap is effectively a
  // safety bound rather than a UX boundary. Promote to cursor-paged
  // when we ship comment infinite scroll.
  const commentsQuery = withBlockedFilter(
    viewer?.id ?? null,
    baseCommentsQuery,
    schema.comments.userId,
  )
    .orderBy(schema.comments.createdAt)
    .limit(100);

  const [countResult, viewerLikedRow, commentRows, origin] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.likes)
      .where(eq(schema.likes.reviewId, review.id)),
    viewer
      ? db.query.likes.findFirst({
          where: and(eq(schema.likes.reviewId, review.id), eq(schema.likes.userId, viewer.id)),
          columns: { reviewId: true },
        })
      : Promise.resolve(undefined),
    commentsQuery,
    resolveOrigin(),
  ]);
  const count = countResult[0]?.count ?? 0;
  const viewerLiked = Boolean(viewerLikedRow);
  const shareUrl = `${origin}/u/${profile.username}/reviews/${slug}`;

  const threadComments: ThreadComment[] = commentRows.map((r) => {
    // Mask author info for both soft-deleted users (deletedAt set) AND orphans
    // (cascade-deleted profile row, leftJoin returned null username). Both
    // cases mean the author is gone — the comment body stays visible so
    // threads remain readable, but the author identity is anonymised.
    const authorMissing = r.authorDeletedAt !== null || r.authorUsername === null;
    return {
      id: r.id,
      body: r.body,
      userId: r.userId,
      parentId: r.parentId,
      createdAt: r.createdAt,
      editedAt: r.editedAt,
      isHidden: r.isHidden,
      author: authorMissing
        ? {
            username: "[deleted user]",
            displayName: null,
            profilePictureUrl: null,
          }
        : {
            // Non-null: gated by authorMissing above (covers null username).
            username: r.authorUsername!,
            displayName: r.authorDisplayName,
            profilePictureUrl: r.authorProfilePictureUrl,
          },
    };
  });

  return (
    <>
      <ReviewCard
        review={{
          id: review.id,
          body: review.body,
          rating: review.rating != null ? Number(review.rating) : null,
          publishedAt: review.publishedAt!,
        }}
        game={game}
        author={{ username: profile.username }}
        isOwner={isOwner}
        loggedOut={!viewer}
        initialLiked={viewerLiked}
        initialLikeCount={count}
        shareUrl={shareUrl}
      />
      <div className="mx-auto max-w-3xl px-6 pb-12">
        <CommentThread
          reviewId={review.id}
          comments={threadComments}
          viewerId={viewer?.id ?? null}
        />
      </div>
    </>
  );
}
