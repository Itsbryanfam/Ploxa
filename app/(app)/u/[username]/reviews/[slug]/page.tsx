import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { ReviewCard } from "@/components/reviews/review-card";
import { CommentThread, type ThreadComment } from "@/components/comments/comment-thread";
import { withBlockedFilter } from "@/lib/social/_shared/visibility";

interface Props {
  params: Promise<{ username: string; slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username, slug } = await params;
  const profile = await db.query.profiles.findFirst({
    where: and(eq(schema.profiles.username, username), isNull(schema.profiles.deletedAt)),
    // isPublic mirrors the page-body gate below; without this, share unfurlers
    // would receive the review's hook + OG image URL for a private profile
    // even though the page itself 404s.
    columns: { userId: true, username: true, isPublic: true },
  });
  if (!profile) return { title: "Review not found" };
  // Owner-on-own-URL exception: a logged-in private user looking at their own
  // canonical review page should still see real metadata in the browser tab.
  // Unfurlers send no cookies, so getCachedUser() returns null for them and
  // the !isPublic branch fires correctly.
  const viewer = await getCachedUser();
  const isOwner = viewer?.id === profile.userId;
  if (!profile.isPublic && !isOwner) return { title: "Review not found" };
  const game = await db.query.games.findFirst({
    where: eq(schema.games.slug, slug),
    columns: { id: true, title: true },
  });
  if (!game) return { title: "Review not found" };
  const review = await db.query.reviews.findFirst({
    where: and(
      eq(schema.reviews.userId, profile.userId),
      eq(schema.reviews.gameId, game.id),
      isNotNull(schema.reviews.publishedAt),
      // Owners can see their own unpublished/private review metadata.
      isOwner ? undefined : eq(schema.reviews.isPublic, true),
    ),
    columns: { id: true, body: true },
  });
  if (!review) return { title: "Review not found" };

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

  // Stage 1: profile, game, viewer — all independent, fire in parallel.
  // (Previously serialized into 3 sequential round-trips on the share-link
  // load path; this page is the canonical OG/unfurl destination.)
  const [profile, game, viewer] = await Promise.all([
    db.query.profiles.findFirst({
      where: and(eq(schema.profiles.username, username), isNull(schema.profiles.deletedAt)),
      columns: { userId: true, username: true, isPublic: true },
    }),
    db.query.games.findFirst({
      where: eq(schema.games.slug, slug),
      columns: { id: true, slug: true, title: true, coverUrl: true, posterUrl: true },
    }),
    getCachedUser(),
  ]);
  if (!profile) notFound();
  if (!game) notFound();

  const isOwner = viewer?.id === profile.userId;
  if (!profile.isPublic && !isOwner) notFound();

  // Stage 2: review row depends on profile.userId + game.id.
  const review = await db.query.reviews.findFirst({
    where: and(
      eq(schema.reviews.userId, profile.userId),
      eq(schema.reviews.gameId, game.id),
      isNotNull(schema.reviews.publishedAt),
      isOwner ? undefined : eq(schema.reviews.isPublic, true),
    ),
    columns: { id: true, body: true, rating: true, publishedAt: true },
  });
  if (!review) notFound();

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
      authorAvatarUrl: schema.profiles.avatarUrl,
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

  const commentsQuery = withBlockedFilter(
    viewer?.id ?? null,
    baseCommentsQuery,
    schema.comments.userId,
  ).orderBy(schema.comments.createdAt);

  const [countResult, viewerLikedRow, commentRows] = await Promise.all([
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
  ]);
  const count = countResult[0]?.count ?? 0;
  const viewerLiked = Boolean(viewerLikedRow);

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
        ? { username: "[deleted user]", displayName: null, avatarUrl: null }
        : {
            // Non-null: gated by authorMissing above (covers null username).
            username: r.authorUsername!,
            displayName: r.authorDisplayName,
            avatarUrl: r.authorAvatarUrl,
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
