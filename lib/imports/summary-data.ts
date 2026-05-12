import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { games } from "@/lib/db/schema";

export type GameCoverMeta = {
  id: number;
  slug: string;
  title: string;
  /** Landscape RAWG hero art. Fallback only — callers should prefer posterUrl. */
  coverUrl: string | null;
  /** Portrait (2:3) box art from Steam CDN / SGDB. May be null on long-tail titles. */
  posterUrl: string | null;
};

export async function loadGamesForSummary(gameIds: number[]): Promise<GameCoverMeta[]> {
  if (gameIds.length === 0) return [];
  return db
    .select({
      id: games.id,
      slug: games.slug,
      title: games.title,
      coverUrl: games.coverUrl,
      posterUrl: games.posterUrl,
    })
    .from(games)
    .where(inArray(games.id, gameIds));
}
