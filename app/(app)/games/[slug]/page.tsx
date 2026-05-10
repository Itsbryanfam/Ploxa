import { notFound } from "next/navigation";
import { getGameDetailBySlug, getScreenshots } from "@/lib/games/server-actions";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { GameDetail } from "@/components/game/game-detail";
import { mapRowToLibraryItem, type LibraryItem } from "@/lib/logs/library-item";

export default async function GamePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let game;
  try {
    game = await getGameDetailBySlug(slug);
  } catch {
    notFound();
  }

  const screenshots = await getScreenshots(game.id);

  // Fetch the user's log if any
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let log: LibraryItem | null = null;
  if (user) {
    const row = await db.query.logs.findFirst({
      where: and(eq(schema.logs.userId, user.id), eq(schema.logs.gameId, game.id)),
    });
    if (row) {
      log = mapRowToLibraryItem(row, game);
    }
  }

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
