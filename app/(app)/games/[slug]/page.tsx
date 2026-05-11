import { notFound } from "next/navigation";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { getGameDetailBySlug, getScreenshots } from "@/lib/games/server-actions";
import { getUserLogForGame } from "@/lib/logs/server-actions";
import { GameDetail } from "@/components/game/game-detail";

export default async function GamePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let game;
  try {
    game = await getGameDetailBySlug(slug);
  } catch {
    notFound();
  }

  const user = await getCachedUser();
  const [screenshots, log, ownReviewRow] = await Promise.all([
    getScreenshots(game.id),
    getUserLogForGame(game.id, game),
    user
      ? db.query.reviews.findFirst({
          // Published reviews only — unpublished drafts shouldn't render the
          // "Your review" excerpt on the game detail page.
          where: and(
            eq(schema.reviews.userId, user.id),
            eq(schema.reviews.gameId, game.id),
            isNotNull(schema.reviews.publishedAt),
          ),
          columns: { id: true, body: true, rating: true },
        })
      : Promise.resolve(null),
  ]);

  const ownReview = ownReviewRow
    ? {
        id: ownReviewRow.id,
        body: ownReviewRow.body,
        rating: ownReviewRow.rating != null ? Number(ownReviewRow.rating) : null,
      }
    : null;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <GameDetail
        game={{
          id: game.id,
          slug: game.slug,
          title: game.title,
          coverUrl: game.coverUrl,
          released: game.released,
          description: game.description,
          genres: game.genres,
          platforms: game.platforms,
          metacriticScore: game.metacriticScore,
          rawgRating: game.rawgRating,
        }}
        screenshots={screenshots}
        log={log}
        ownReview={ownReview}
      />
    </div>
  );
}
