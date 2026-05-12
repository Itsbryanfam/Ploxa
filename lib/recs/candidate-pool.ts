import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { games, logs, tasteFingerprints } from "@/lib/db/schema";

export type CandidateGame = {
  id: number;
  slug: string;
  title: string;
  released: Date | null;
  coverUrl: string | null;
  posterUrl: string | null;
  genres: string[] | null;
  themes: string[] | null;
  mechanics: string[] | null;
  platforms: string[] | null;
  playtimeAvgHours: number | null;
  similarityScore: number;
};

/**
 * Metadata-similarity prefilter. Pulls the user's vectors, scores every
 * game in the catalog by dot-product against the user's preferences,
 * excludes games they've already logged, returns the top N.
 *
 * Naive O(catalog × user-vectors) — fine for Phase 4 scale (RAWG seed is
 * ~10k games, user vectors are ~30 keys). When catalog grows, we'd push
 * scoring into Postgres via array overlap operators; not yet.
 *
 * Empty fingerprint (no taste_fingerprints row, or all-zero vectors) →
 * empty candidates: every dot-product is 0, and the `s <= 0` gate skips
 * them. T10 wires the popularity fallback for the sparse tier so brand-new
 * users still get something to look at.
 */
export async function candidatePool(
  userId: string,
  opts: { limit?: number } = {},
): Promise<CandidateGame[]> {
  const limit = opts.limit ?? 50;

  const [fpRow] = await db
    .select({
      genreVector: tasteFingerprints.genreVector,
      themeVector: tasteFingerprints.themeVector,
      mechanicVector: tasteFingerprints.mechanicVector,
    })
    .from(tasteFingerprints)
    .where(eq(tasteFingerprints.userId, userId))
    .limit(1);

  const genreVec = (fpRow?.genreVector as Record<string, number> | undefined) ?? {};
  const themeVec = (fpRow?.themeVector as Record<string, number> | undefined) ?? {};
  const mechanicVec = (fpRow?.mechanicVector as Record<string, number> | undefined) ?? {};

  // Pull every game the user has already logged — exclude these from candidates.
  const loggedRows = await db
    .select({ gameId: logs.gameId })
    .from(logs)
    .where(eq(logs.userId, userId));
  const loggedIds = new Set(loggedRows.map((r) => r.gameId));

  // Stream candidates from the catalog. For Phase 4 scale (~10k games) we
  // can pull the whole table; for larger catalog we'd add an index-friendly
  // pre-filter (e.g. genre overlap against top-3 user genres).
  const allGames = await db
    .select({
      id: games.id,
      slug: games.slug,
      title: games.title,
      released: games.released,
      coverUrl: games.coverUrl,
      posterUrl: games.posterUrl,
      genres: games.genres,
      themes: games.themes,
      mechanics: games.mechanics,
      platforms: games.platforms,
      playtimeAvgHours: games.playtimeAvgHours,
    })
    .from(games);

  const scored: CandidateGame[] = [];
  for (const g of allGames) {
    if (loggedIds.has(g.id)) continue;
    let s = 0;
    for (const k of g.genres ?? []) s += genreVec[k] ?? 0;
    for (const k of g.themes ?? []) s += themeVec[k] ?? 0;
    for (const k of g.mechanics ?? []) s += mechanicVec[k] ?? 0;
    if (s <= 0) continue; // skip games that the user's signal actively rejects or matches nothing
    scored.push({
      ...g,
      playtimeAvgHours: g.playtimeAvgHours != null ? Number(g.playtimeAvgHours) : null,
      similarityScore: s,
    });
  }
  scored.sort((a, b) => b.similarityScore - a.similarityScore);
  return scored.slice(0, limit);
}
