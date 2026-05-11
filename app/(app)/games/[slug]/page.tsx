import { notFound } from "next/navigation";
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

  const [screenshots, log] = await Promise.all([
    getScreenshots(game.id),
    getUserLogForGame(game.id, game),
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
      />
    </div>
  );
}
