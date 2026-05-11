import { notFound } from "next/navigation";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { ReviewCard } from "@/components/reviews/review-card";

interface Props {
  params: Promise<{ username: string; slug: string }>;
}

export default async function CanonicalReviewPage({ params }: Props) {
  const { username, slug } = await params;

  const profile = await db.query.profiles.findFirst({
    where: eq(schema.profiles.username, username),
    columns: { userId: true, username: true, isPublic: true },
  });
  if (!profile) notFound();

  const game = await db.query.games.findFirst({
    where: eq(schema.games.slug, slug),
    columns: { id: true, slug: true, title: true, coverUrl: true },
  });
  if (!game) notFound();

  const viewer = await getCachedUser();
  const isOwner = viewer?.id === profile.userId;
  if (!profile.isPublic && !isOwner) notFound();

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

  // Like context — count + did-viewer-like
  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.likes)
    .where(eq(schema.likes.reviewId, review.id));
  const count = countResult[0]?.count ?? 0;

  let viewerLiked = false;
  if (viewer) {
    const liked = await db.query.likes.findFirst({
      where: and(eq(schema.likes.reviewId, review.id), eq(schema.likes.userId, viewer.id)),
      columns: { reviewId: true },
    });
    viewerLiked = Boolean(liked);
  }

  return (
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
  );
}
