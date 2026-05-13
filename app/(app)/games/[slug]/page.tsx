import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";

import { getGameDetailBySlug, getScreenshots } from "@/lib/games/server-actions";
import { getGameDetailUserState } from "@/lib/logs/server-actions";
import { GameDetail } from "@/components/game/game-detail";
import { AddToListModal } from "@/components/lists/add-to-list-modal";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { db, schema } from "@/lib/db";

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
  const [screenshots, { log, ownReview }, viewer] = await Promise.all([
    getScreenshots(game.id),
    getGameDetailUserState(game.id, game),
    getCachedUser(),
  ]);

  // Load the viewer's lists for the AddToListModal (owner lists, up to 50).
  let userLists: Array<{ id: string; title: string; slug: string; publishedAt: Date | null }> = [];
  if (viewer) {
    userLists = await db
      .select({
        id: schema.lists.id,
        title: schema.lists.title,
        slug: schema.lists.slug,
        publishedAt: schema.lists.publishedAt,
      })
      .from(schema.lists)
      .where(eq(schema.lists.userId, viewer.id))
      .orderBy(desc(schema.lists.updatedAt))
      .limit(50);
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
        ownReview={ownReview}
      />

      {/* Add to list — shown only to authenticated users */}
      {viewer && (
        <div className="mt-4">
          <AddToListModal
            gameId={game.id}
            gameTitle={game.title}
            userLists={userLists}
          />
        </div>
      )}
    </div>
  );
}
