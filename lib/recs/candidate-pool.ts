import "server-only";

import { arrayOverlaps, desc, eq, or } from "drizzle-orm";

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

// How many top-keys per axis we push into the Postgres `&&` (array overlap)
// prefilter. 8 is a balance: small enough that the GIN index lookup stays
// cheap, big enough to still catch the user's real preferences. The dot-
// product scoring in JS afterward considers ALL vector keys — top-N is
// only used to bound the candidate set Postgres ships back to us.
const TOP_KEYS_PER_AXIS = 8;

// Hard cap on rows pulled from Postgres per call. Even a "loves
// everything" user with overlap on every game can't drag us into a
// pathological 50k-row dump. The dot-product loop is cheap per row but
// the network transit is not.
const PREFILTER_LIMIT = 1000;

/**
 * Pick the highest-scoring positive keys from a sparse vector. Negative
 * weights (anti-signal — "I dropped Sekiro after 2hrs") are intentionally
 * ignored: the `&&` prefilter is asking "what should we even consider?"
 * Including anti-signal keys would inflate the candidate pool with the
 * exact tags the user hates, just so the JS scorer can throw them away
 * after paying network cost. Top-N positive keys is the right shape.
 */
function topPositiveKeys(vec: Record<string, number>, n: number): string[] {
  const positive = Object.entries(vec).filter(([, v]) => v > 0);
  positive.sort((a, b) => b[1] - a[1]);
  return positive.slice(0, n).map(([k]) => k);
}

/**
 * Metadata-similarity prefilter. Pre-filters the catalog in Postgres via
 * array overlap on the user's top genre/theme/mechanic keys, then dot-
 * product-scores the survivors against the full vectors and returns the
 * top N.
 *
 * **Two-stage filter rationale.** The `&&` overlap is index-served (GIN
 * on each array column, see migration 0014). It bounds the row count
 * Postgres ships to Node — without it, every cache miss on /play-next
 * full-scans the games table (~10k today, growing) and JS does ~30k array
 * scans. With the prefilter the index narrows to whatever overlaps the
 * user's top-8 keys per axis, then JS scoring picks the best. Top-8 is
 * for the prefilter only; the dot product still considers every vector
 * key the user has, so weak-but-present signals still influence the
 * final ordering.
 *
 * **Cold-start fallback.** Empty-vector users (just signed up, no logs
 * yet, or a cohort whose persisted fingerprint hasn't been written) go
 * down a popularity branch (`ORDER BY rawg_rating DESC NULLS LAST LIMIT
 * N`) so they still get *something* back. Without this, the `s <= 0`
 * gate in the JS scorer would silently strip every row and the user
 * would see "no candidates" — bad first-experience regression that the
 * 2026-05-14 audit specifically called out.
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
 * Vector typing: the jsonb columns are typed as `unknown` by Drizzle;
 * we assert `Record<string, number>` because the refresh-fingerprint
 * Edge function and the `aggregate.ts` pipeline both produce numeric
 * maps. No runtime validation here.
 */
export async function candidatePool(
  userId: string,
  opts: {
    limit?: number;
    vectors?: VectorBundle;
    seed?: number; // reserved: Task 12 passes this for reproducible tie-ordering; unused here
  } = {},
): Promise<CandidateGame[]> {
  // Defense-in-depth: every caller derives userId from getCachedUser(),
  // but a stray empty string would still cost a full catalog scan
  // that returns []. Short-circuit before any DB work.
  if (!userId) return [];

  // Pool size expanded 50 → 100 for /play-next v2: the new scoring +
  // MMR-diversity + bucketing stages (Tasks 6-9) need more material to
  // work with. Spec: docs/superpowers/specs/2026-05-15-play-next-redesign-design.md
  const limit = opts.limit ?? 100;

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

  // Pick the top-N positive keys per axis to drive the prefilter. Negative
  // (anti-signal) keys are dropped — they shouldn't *expand* the pool.
  const topGenres = topPositiveKeys(genreVec, TOP_KEYS_PER_AXIS);
  const topThemes = topPositiveKeys(themeVec, TOP_KEYS_PER_AXIS);
  const topMechanics = topPositiveKeys(mechanicVec, TOP_KEYS_PER_AXIS);

  const sameSelect = {
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
  };

  // Cold-start fallback: zero positive signal across all three axes →
  // popularity query so the user still gets candidates. Don't dot-product-
  // score these (every score is 0 against empty vectors); just hand them
  // back with similarityScore=0 so downstream filters (time, platform) can
  // do their thing. The audit explicitly flagged silently returning []
  // here as a launch-blocker for tier-0 cold-start users.
  if (topGenres.length === 0 && topThemes.length === 0 && topMechanics.length === 0) {
    const popular = await db
      .select(sameSelect)
      .from(games)
      .orderBy(desc(games.rawgRating))
      .limit(PREFILTER_LIMIT);
    const out: CandidateGame[] = [];
    for (const g of popular) {
      if (loggedIds.has(g.id)) continue;
      out.push({
        ...g,
        playtimeAvgHours: g.playtimeAvgHours != null ? Number(g.playtimeAvgHours) : null,
        // No taste signal yet — score is 0 across the board. The slice at
        // the end honors the caller's `limit` opt so we still cap output.
        similarityScore: 0,
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  // Build the array-overlap prefilter. We OR across axes so a game needs to
  // hit only one of (top-genres ∩ row.genres), (top-themes ∩ row.themes),
  // (top-mechanics ∩ row.mechanics). Each axis with no top keys is omitted
  // (passing an empty array to `&&` would never overlap). At least one is
  // present here because the cold-start branch above handled the zero case.
  const predicates: ReturnType<typeof arrayOverlaps>[] = [];
  if (topGenres.length > 0) predicates.push(arrayOverlaps(games.genres, topGenres));
  if (topThemes.length > 0) predicates.push(arrayOverlaps(games.themes, topThemes));
  if (topMechanics.length > 0) {
    predicates.push(arrayOverlaps(games.mechanics, topMechanics));
  }
  // `or(...)` returns SQL | undefined when given a single arg, but with N≥1
  // SQLWrappers it's always SQL. We've just pushed at least one predicate.
  const prefilter = or(...predicates)!;

  const allGames = await db
    .select(sameSelect)
    .from(games)
    .where(prefilter)
    .limit(PREFILTER_LIMIT);

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
