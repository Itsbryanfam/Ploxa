import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { games, logs, tasteFingerprints } from "@/lib/db/schema";
import type { VectorBundle } from "@/lib/taste/vectors";

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
 * Metadata-similarity prefilter. Scores every game in the catalog by
 * dot-product against the user's vector preferences, excludes games
 * they've already logged, returns the top N.
 *
 * Naive O(catalog × user-vectors) — fine for Phase 4 scale (RAWG seed is
 * ~10k games, user vectors are ~30 keys). When catalog grows, we'd push
 * scoring into Postgres via array overlap operators; not yet.
 *
 * **Vectors source.** Callers should pass `opts.vectors` from the live
 * `getFingerprint()` snapshot (lib/taste/server-actions.ts) so the recs
 * stay correct even when the persisted `taste_fingerprints` row is
 * missing or stale. The persisted row is only written when milestone
 * triggers (10/25/50/100/250 logs) or the daily drift cron fire and
 * actually succeed — both depend on the refresh-fingerprint Edge
 * Function not erroring, which has historically been brittle (AI
 * provider keys, network). Live vectors decouple us from that.
 *
 * When `opts.vectors` is omitted (legacy callers, tests), we fall back
 * to the persisted row. Treat that as a slow path; new code should
 * always pass live vectors.
 *
 * Empty vectors (no row + no live aggregation, or genuinely zero
 * signal) → empty candidates: every dot-product is 0 and the `s <= 0`
 * gate skips them. The T10 popularity fallback in `metadataOnlyRecs`
 * picks up sparse-tier users with thin vectors.
 *
 * Vector typing: the jsonb columns are typed as `unknown` by Drizzle;
 * we assert `Record<string, number>` because the refresh-fingerprint
 * Edge function and the `aggregate.ts` pipeline both produce numeric
 * maps. No runtime validation here.
 */
export async function candidatePool(
  userId: string,
  opts: { limit?: number; vectors?: VectorBundle } = {},
): Promise<CandidateGame[]> {
  // Defense-in-depth: every caller derives userId from getCachedUser(),
  // but a stray empty string would still cost a full catalog scan
  // that returns []. Short-circuit before any DB work.
  if (!userId) return [];

  const limit = opts.limit ?? 50;

  let genreVec: Record<string, number>;
  let themeVec: Record<string, number>;
  let mechanicVec: Record<string, number>;
  if (opts.vectors) {
    // Fast path: caller already aggregated vectors live (getFingerprint).
    genreVec = opts.vectors.genre;
    themeVec = opts.vectors.theme;
    mechanicVec = opts.vectors.mechanic;
  } else {
    // Legacy path: read from the persisted row. Returns empty maps if no
    // refresh has succeeded yet, in which case every game scores 0.
    const [fpRow] = await db
      .select({
        genreVector: tasteFingerprints.genreVector,
        themeVector: tasteFingerprints.themeVector,
        mechanicVector: tasteFingerprints.mechanicVector,
      })
      .from(tasteFingerprints)
      .where(eq(tasteFingerprints.userId, userId))
      .limit(1);
    genreVec = (fpRow?.genreVector as Record<string, number> | undefined) ?? {};
    themeVec = (fpRow?.themeVector as Record<string, number> | undefined) ?? {};
    mechanicVec = (fpRow?.mechanicVector as Record<string, number> | undefined) ?? {};
  }

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
