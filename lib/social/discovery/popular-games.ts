import "server-only";
import { sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";

import { db } from "@/lib/db";

const CACHE_TTL_SECONDS = 1800; // 30 minutes

export type PopularGame = {
  id: number;
  slug: string;
  title: string;
  coverUrl: string | null;
  logCount: number;
};

/**
 * Returns the top games by log count in the last 7 days, excluding private
 * logs, ordered descending by log count.
 *
 * Invariants:
 * - Private logs (`is_private = true`) are excluded so a user's private
 *   activity does not influence the public discovery surface.
 * - Logs from soft-deleted users (`p.deleted_at IS NOT NULL`) are excluded
 *   so their in-grace activity stops influencing the public ranking.
 * - The result is deduplicated at the game level; multiple users logging the
 *   same game in the window count toward a single aggregated `logCount`.
 * - Result is cached via `unstable_cache` with a 30-minute TTL so every
 *   visitor within the window receives the same ranked list without re-hitting
 *   the database. The cache is tagged "discovery" so it can be surgically
 *   revalidated if needed (e.g., during tests or moderation actions).
 */
async function _getPopularGamesUncached(limit: number): Promise<PopularGame[]> {
  const rawRows = await db.execute<{
    id: number;
    slug: string;
    title: string;
    cover_url: string | null;
    log_count: number | string;
  }>(sql`
    SELECT g.id, g.slug, g.title, g.cover_url, count(l.id)::int AS log_count
    FROM logs l
    JOIN games g ON g.id = l.game_id
    JOIN profiles p ON p.user_id = l.user_id
    WHERE l.created_at > now() - interval '7 days'
      AND l.is_private = false
      AND p.deleted_at IS NULL
    GROUP BY g.id, g.slug, g.title, g.cover_url
    ORDER BY log_count DESC
    LIMIT ${limit}
  `);
  // postgres-js RowList is array-like; cast through unknown to access rows directly.
  const rows = rawRows as unknown as Array<{
    id: number;
    slug: string;
    title: string;
    cover_url: string | null;
    log_count: number | string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    coverUrl: r.cover_url,
    logCount: Number(r.log_count),
  }));
}

/**
 * Cached entry point for popular games discovery.
 *
 * Cache key: unstable_cache automatically appends serialized runtime
 * arguments to the keyParts array, so callers requesting distinct
 * limits receive isolated cache entries. The "discovery" tag lets a
 * single revalidateTag call bust this AND trending-reviews together.
 * The default limit of 24 is sized for a 4-column × 6-row discovery grid.
 *
 * @param limit - Maximum number of games to return (default 24).
 * @returns Ranked list of `PopularGame` objects, highest log count first.
 */
export const getPopularGames = unstable_cache(
  async (limit = 24) => _getPopularGamesUncached(limit),
  ["discovery-popular-games"],
  { revalidate: CACHE_TTL_SECONDS, tags: ["discovery"] },
);
