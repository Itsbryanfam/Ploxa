import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getGameDetailBySlug, getScreenshots } from "@/lib/games/server-actions";
import { db, schema } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { GameDetail } from "@/components/game/game-detail";
import { GameDetailPanel } from "@/components/game/game-detail-panel";
import type { LibraryItem } from "@/lib/logs/server-actions";

export default async function InterceptedGamePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  let game;
  try {
    game = await getGameDetailBySlug(slug);
  } catch {
    notFound();
  }

  const screenshots = await getScreenshots(game.id);

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
      log = {
        logId: row.id, status: row.status,
        rating: row.rating ? Number(row.rating) : null,
        startedAt: row.startedAt, finishedAt: row.finishedAt,
        hoursPlayed: row.hoursPlayed ? Number(row.hoursPlayed) : null,
        notes: row.notes, createdAt: row.createdAt, updatedAt: row.updatedAt,
        game: {
          id: game.id, slug: game.slug, title: game.title,
          coverUrl: game.coverUrl, released: game.released,
          genres: game.genres ?? [], platforms: game.platforms ?? [],
        },
      };
    }
  }

  return (
    <GameDetailPanel>
      <GameDetail
        game={{
          id: game.id, slug: game.slug, title: game.title,
          coverUrl: game.coverUrl, released: game.released,
          description: game.description, genres: game.genres,
          platforms: game.platforms, metacriticScore: game.metacriticScore,
          rawgRating: game.rawgRating,
        }}
        screenshots={screenshots}
        log={log}
      />
    </GameDetailPanel>
  );
}
