import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { games } from "@/lib/db/schema";

export type GameCoverMeta = {
  id: number;
  slug: string;
  title: string;
  coverUrl: string | null;
};

export async function loadGamesForSummary(gameIds: number[]): Promise<GameCoverMeta[]> {
  if (gameIds.length === 0) return [];
  return db
    .select({ id: games.id, slug: games.slug, title: games.title, coverUrl: games.coverUrl })
    .from(games)
    .where(inArray(games.id, gameIds));
}
