import { notFound } from "next/navigation";
import { getGameDetailBySlug, getScreenshots } from "@/lib/games/server-actions";
import { getGameDetailUserState } from "@/lib/logs/server-actions";
import { GameDetail } from "@/components/game/game-detail";

export default async function GamePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let game;
  try {
    game = await getGameDetailBySlug(slug);
  } catch {
    notFound();
  }

  // Two round-trips total: (1) Redis-backed RAWG screenshots, (2) one combined
  // SQL query for log + published review. Previously this was three (separate
  // log query + separate review query) running in parallel on Promise.all.
  const [screenshots, { log, ownReview }] = await Promise.all([
    getScreenshots(game.id),
    getGameDetailUserState(game.id, game),
  ]);

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
