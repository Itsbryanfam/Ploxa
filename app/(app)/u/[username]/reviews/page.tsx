import { notFound } from "next/navigation";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { ReviewListCard } from "@/components/reviews/review-list-card";

interface Props {
  params: Promise<{ username: string }>;
}

export default async function ReviewsListPage({ params }: Props) {
  const { username } = await params;
  const profile = await db.query.profiles.findFirst({
    where: eq(schema.profiles.username, username),
    columns: { userId: true, username: true, isPublic: true },
  });
  if (!profile) notFound();

  const viewer = await getCachedUser();
  const isOwner = viewer?.id === profile.userId;
  if (!profile.isPublic && !isOwner) notFound();

  const rows = await db
    .select({
      reviewId: schema.reviews.id,
      body: schema.reviews.body,
      rating: schema.reviews.rating,
      publishedAt: schema.reviews.publishedAt,
      gameSlug: schema.games.slug,
      gameTitle: schema.games.title,
      gameCoverUrl: schema.games.coverUrl,
    })
    .from(schema.reviews)
    .innerJoin(schema.games, eq(schema.games.id, schema.reviews.gameId))
    .where(
      and(
        eq(schema.reviews.userId, profile.userId),
        isNotNull(schema.reviews.publishedAt),
        isOwner ? undefined : eq(schema.reviews.isPublic, true),
      ),
    )
    .orderBy(desc(schema.reviews.publishedAt));

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 space-y-5">
      <h1 className="text-xl font-semibold text-[var(--text)]">
        @{profile.username}&apos;s reviews
      </h1>
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--text-dim)]">No reviews yet.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <ReviewListCard
              key={r.reviewId}
              review={{
                body: r.body,
                rating: r.rating != null ? Number(r.rating) : null,
                publishedAt: r.publishedAt!,
              }}
              game={{ slug: r.gameSlug, title: r.gameTitle, coverUrl: r.gameCoverUrl }}
              username={profile.username}
            />
          ))}
        </div>
      )}
    </div>
  );
}
