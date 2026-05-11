import { redirect, notFound } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { startInterview } from "@/lib/reviews/server-actions";
import { ReviewInterview } from "@/components/reviews/review-interview";
import { ReviewEditor } from "@/components/reviews/review-editor";
import { GameDetailPanel } from "@/components/game/game-detail-panel";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ reviewId?: string; manual?: string }>;
}

export default async function InterceptedReviewRoute({ params, searchParams }: Props) {
  const [{ slug }, { reviewId, manual }] = await Promise.all([params, searchParams]);
  const user = await getCachedUser();
  if (!user) redirect(`/login?next=/games/${slug}/review`);

  const game = await db.query.games.findFirst({
    where: eq(schema.games.slug, slug),
    columns: { id: true, slug: true, title: true },
  });
  if (!game) notFound();

  if (reviewId) {
    const review = await db.query.reviews.findFirst({
      where: and(eq(schema.reviews.id, reviewId), eq(schema.reviews.userId, user.id)),
      columns: { id: true, body: true, rating: true, isPublic: true, isAiAssisted: true },
    });
    if (!review) notFound();
    return (
      <GameDetailPanel>
        <ReviewEditor
          reviewId={review.id}
          gameSlug={game.slug}
          initialBody={review.body ?? ""}
          initialRating={review.rating != null ? Number(review.rating) : null}
          initialIsPublic={review.isPublic}
          canRegenerate={review.isAiAssisted}
        />
      </GameDetailPanel>
    );
  }

  const log = await db.query.logs.findFirst({
    where: and(eq(schema.logs.userId, user.id), eq(schema.logs.gameId, game.id)),
    columns: { id: true },
  });
  if (!log) redirect(`/games/${slug}`);

  // Manual branch — skip the interview, open the editor with an empty draft.
  if (manual === "1") {
    const existing = await db.query.reviews.findFirst({
      where: and(eq(schema.reviews.userId, user.id), eq(schema.reviews.gameId, game.id)),
      columns: { id: true, publishedAt: true },
    });
    if (existing && existing.publishedAt != null) {
      redirect(`/games/${slug}/review?reviewId=${existing.id}`);
    }
    if (existing) {
      await db.delete(schema.reviews).where(eq(schema.reviews.id, existing.id));
    }
    const [inserted] = await db
      .insert(schema.reviews)
      .values({
        userId: user.id,
        gameId: game.id,
        logId: log.id,
        body: "",
        isAiAssisted: false,
        isPublic: true,
      })
      .returning({ id: schema.reviews.id });
    if (!inserted) {
      return (
        <GameDetailPanel>
          <div className="p-8 text-sm text-[var(--text-dim)]">Could not start a review.</div>
        </GameDetailPanel>
      );
    }
    redirect(`/games/${slug}/review?reviewId=${inserted.id}`);
  }

  const started = await startInterview({ logId: log.id });
  if (!started.ok) {
    return (
      <GameDetailPanel>
        <div className="p-8 text-sm text-[var(--text-dim)]">{started.error}</div>
      </GameDetailPanel>
    );
  }
  return (
    <GameDetailPanel>
      <ReviewInterview
        interviewId={started.interviewId}
        gameSlug={game.slug}
        initialQ1={started.q1}
      />
    </GameDetailPanel>
  );
}
