import "server-only";

import { and, arrayOverlaps, desc, eq, inArray, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { games, logs, tasteFingerprints } from "@/lib/db/schema";
import type { LogStatus } from "@/lib/db/schema-types";
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
  // RAWG rating 0..5 (null for older catalog rows). Threaded for the v2
  // recencyQuality scoring axis (2026-05-15).
  rawgRating: number | null;
  similarityScore: number;
};

/**
 * Log-status partition for the two-lane candidate sourcing (play-next
 * Backlog-bucket revival, 2026-05-16).
 *
 * `log_status` enum = backlog | playing | completed | dropped | on_hold |
 * wishlist. Every value falls into exactly ONE of the two sets below — the
 * union is the full enum, so no logged game leaks into the discovery lane.
 *
 *  - DISCOVERY_EXCLUDED_STATUSES — "done with it / currently on it". A
 *    discovery recommendation for one of these is wrong: the user finished
 *    it (`completed`), quit it (`dropped` — this catalog has no separate
 *    `abandoned`; `dropped` is its semantic equivalent), or is mid-play
 *    (`playing`). These never enter ANY slot.
 *
 *  - BACKLOG_LANE_STATUSES — owned/intended-but-not-active. `backlog` ("own
 *    it, not started"), `wishlist` ("want it"), and `on_hold` (started, paused,
 *    intend to return). `on_hold` is a deliberate judgment call: it is NOT
 *    "done with it" (that's completed/dropped) and NOT "currently on it"
 *    (that's playing) — it's exactly the Backlog-rail spirit ("you said you'd
 *    come back to this"). Surfacing it in the backlog lane is better product
 *    behavior than dropping it entirely, which is what excluding it
 *    everywhere would do. These are STILL excluded from discovery (we don't
 *    re-pitch an owned game as a fresh discovery) but DO feed the backlog
 *    lane with `inLibrary: true`.
 *
 * Exhaustiveness is asserted at module load so a future enum addition fails
 * `next build` here instead of silently leaking the new status into
 * discovery.
 */
const DISCOVERY_EXCLUDED_STATUSES = [
  "completed",
  "dropped",
  "playing",
] as const satisfies readonly LogStatus[];

const BACKLOG_LANE_STATUSES = [
  "backlog",
  "wishlist",
  "on_hold",
] as const satisfies readonly LogStatus[];

// Compile-time partition guard: every LogStatus must be in exactly one set.
// If a new enum value is added without classifying it, this errors at module
// load (next build) rather than silently letting the status leak into the
// discovery pool.
{
  type Partitioned =
    | (typeof DISCOVERY_EXCLUDED_STATUSES)[number]
    | (typeof BACKLOG_LANE_STATUSES)[number];
  type _AllClassified = LogStatus extends Partitioned ? true : never;
  type _NoOverlap = (typeof DISCOVERY_EXCLUDED_STATUSES)[number] &
    (typeof BACKLOG_LANE_STATUSES)[number] extends never
    ? true
    : never;
  // These bindings exist only to surface the conditional-type errors above
  // (a `never` type makes the assignment fail to compile).
  const _allClassified: _AllClassified = true;
  const _noOverlap: _NoOverlap = true;
  void _allClassified;
  void _noOverlap;
  // `DISCOVERY_EXCLUDED_STATUSES` is referenced ONLY in the `typeof` type
  // positions above (the partition guard is purely compile-time; unlike
  // `BACKLOG_LANE_STATUSES` it has no runtime `inArray(...)` use), so
  // no-unused-vars flags it as "only used as a type". Discharge it with the
  // SAME `void <symbol>;` idiom used for the guard bindings just above —
  // semantics unchanged, the status arrays are untouched.
  void DISCOVERY_EXCLUDED_STATUSES;
}

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

// Columns both lanes pull from `games`. Declared once so the discovery
// prefilter SELECT and the backlog-lane join SELECT stay byte-identical in
// shape (and so `CandidateGame` mapping is uniform across lanes).
const GAME_SELECT = {
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
  rawgRating: games.rawgRating,
} as const;

type GameRow = {
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
  playtimeAvgHours: string | number | null;
  rawgRating: string | number | null;
};

/**
 * The dot-product taste score used for `similarityScore`. Identical math to
 * the discovery overlap branch, extracted so the backlog lane scores its
 * candidates EXACTLY the same way (the design's "score the backlog lane with
 * the same composite scoring used for discovery"). Returns the unbounded sum
 * of vector weights over the row's genre/theme/mechanic tags; downstream
 * (`server-actions.ts`) clamps it to the [0,1] `taste` axis via `/5`.
 */
function similarityFor(
  g: Pick<GameRow, "genres" | "themes" | "mechanics">,
  genreVec: Record<string, number>,
  themeVec: Record<string, number>,
  mechanicVec: Record<string, number>,
): number {
  let s = 0;
  for (const k of g.genres ?? []) s += genreVec[k] ?? 0;
  for (const k of g.themes ?? []) s += themeVec[k] ?? 0;
  for (const k of g.mechanics ?? []) s += mechanicVec[k] ?? 0;
  return s;
}

function toCandidate(g: GameRow, similarityScore: number): CandidateGame {
  return {
    id: g.id,
    slug: g.slug,
    title: g.title,
    released: g.released,
    coverUrl: g.coverUrl,
    posterUrl: g.posterUrl,
    genres: g.genres,
    themes: g.themes,
    mechanics: g.mechanics,
    platforms: g.platforms,
    playtimeAvgHours: g.playtimeAvgHours != null ? Number(g.playtimeAvgHours) : null,
    rawgRating: g.rawgRating != null ? Number(g.rawgRating) : null,
    similarityScore,
  };
}

/**
 * Resolve the live or persisted taste vectors for a user. Shared by
 * `candidatePool` (discovery lane) and `backlogPool` so both lanes score
 * against the SAME vector source — passing `opts.vectors` (the live
 * `getFingerprint()` snapshot) is the fast path; the persisted
 * `taste_fingerprints` row is the legacy fallback.
 */
async function resolveVectors(
  userId: string,
  vectors?: VectorBundle,
): Promise<{
  genreVec: Record<string, number>;
  themeVec: Record<string, number>;
  mechanicVec: Record<string, number>;
}> {
  if (vectors) {
    return {
      genreVec: vectors.genre,
      themeVec: vectors.theme,
      mechanicVec: vectors.mechanic,
    };
  }
  const [fpRow] = await db
    .select({
      genreVector: tasteFingerprints.genreVector,
      themeVector: tasteFingerprints.themeVector,
      mechanicVector: tasteFingerprints.mechanicVector,
    })
    .from(tasteFingerprints)
    .where(eq(tasteFingerprints.userId, userId))
    .limit(1);
  return {
    genreVec: (fpRow?.genreVector as Record<string, number> | undefined) ?? {},
    themeVec: (fpRow?.themeVector as Record<string, number> | undefined) ?? {},
    mechanicVec:
      (fpRow?.mechanicVector as Record<string, number> | undefined) ?? {},
  };
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
    /**
     * The user's logged game-id set, supplied by the caller from the live
     * `getFingerprint()` snapshot (Task 11). When present, the standalone
     * `SELECT logs.gameId` exclusion scan below is SKIPPED — a single
     * /play-next load already paid for that read inside the `getFingerprint`
     * `logs⋈games` aggregation, so re-scanning the same user's logs here is
     * pure waste for a power user with 1000+ logs.
     *
     * Output-equivalent to the self-query: the snapshot's ids come from the
     * join-based aggregation (orphaned logs whose game row was deleted are
     * absent), but every candidate here originates from the `games` table,
     * so an orphaned (game-less) logged id can never match a candidate —
     * excluding it or not is a no-op. When OMITTED (standalone callers, the
     * candidate-pool unit suites) we still self-query: this function must
     * stand alone, not assume a fingerprint snapshot exists.
     */
    loggedGameIds?: Set<number>;
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

  // Fast path: caller already aggregated vectors live (getFingerprint).
  // Legacy path: read from the persisted row (empty maps if no refresh has
  // succeeded yet, in which case every game scores 0). Shared with
  // backlogPool so both lanes score against the same vector source.
  const { genreVec, themeVec, mechanicVec } = await resolveVectors(
    userId,
    opts.vectors,
  );

  // Status-aware exclusion (play-next Backlog-bucket revival 2026-05-16).
  //
  // DISCOVERY is the catalog scan, so it excludes EVERY logged game
  // (`loggedIds`) regardless of status, for two distinct reasons:
  //   - completed/dropped/playing ("done with it / currently on it"): must
  //     never appear in ANY slot.
  //   - backlog/wishlist/on_hold (owned-but-unplayed): must not appear as a
  //     *discovery* card (an `inLibrary:false` leak into Comfort/Wildcard).
  //     They re-enter the candidate set via the SEPARATE backlog lane
  //     (`backlogPool`, below) tagged `inLibrary:true`, which is their only
  //     path back.
  //
  // The status partition that makes this status-aware lives in the lane
  // SPLIT (this exclude-all-logged discovery scan + `backlogPool`'s
  // status-filtered re-add), not in a partial discovery filter — a partial
  // filter here would duplicate owned games (once as a leaked discovery
  // `inLibrary:false` card, once as a backlog-lane `inLibrary:true` card).
  //
  // Task 11: reuse the caller-supplied logged-id set (from the live
  // `getFingerprint` aggregation that the /play-next load already ran)
  // instead of re-scanning `logs` here. Fall back to the self-query only
  // when no set was supplied (standalone callers / unit suites) — see the
  // `loggedGameIds` opt doc for the output-equivalence argument.
  let loggedIds: Set<number>;
  if (opts.loggedGameIds) {
    // Aliased read-only (NOT cloned): caller owns this Set (the shared
    // FingerprintSnapshot). candidatePool must only call .has() — never
    // mutate, or it silently corrupts the caller's snapshot. The O(n) copy
    // is intentionally skipped (hot path, 1 000+ ids).
    loggedIds = opts.loggedGameIds;
  } else {
    const loggedRows = await db
      .select({ gameId: logs.gameId })
      .from(logs)
      .where(eq(logs.userId, userId));
    loggedIds = new Set(loggedRows.map((r) => r.gameId));
  }

  // Pick the top-N positive keys per axis to drive the prefilter. Negative
  // (anti-signal) keys are dropped — they shouldn't *expand* the pool.
  const topGenres = topPositiveKeys(genreVec, TOP_KEYS_PER_AXIS);
  const topThemes = topPositiveKeys(themeVec, TOP_KEYS_PER_AXIS);
  const topMechanics = topPositiveKeys(mechanicVec, TOP_KEYS_PER_AXIS);

  // Cold-start fallback: zero positive signal across all three axes →
  // popularity query so the user still gets candidates. Don't dot-product-
  // score these (every score is 0 against empty vectors); just hand them
  // back with similarityScore=0 so downstream filters (time, platform) can
  // do their thing. The audit explicitly flagged silently returning []
  // here as a launch-blocker for tier-0 cold-start users.
  if (topGenres.length === 0 && topThemes.length === 0 && topMechanics.length === 0) {
    const popular = await db
      .select(GAME_SELECT)
      .from(games)
      .orderBy(desc(games.rawgRating))
      .limit(PREFILTER_LIMIT);
    const out: CandidateGame[] = [];
    for (const g of popular) {
      if (loggedIds.has(g.id)) continue;
      // No taste signal yet — score is 0 across the board. The slice at
      // the end honors the caller's `limit` opt so we still cap output.
      out.push(toCandidate(g, 0));
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

  // Task 13: order the prefilter result by overlap STRENGTH before the
  // PREFILTER_LIMIT cap. The `&&` predicate in `prefilter` is a boolean
  // "touches at least one top key" filter — it does NOT rank by how
  // strongly a row matches. With no ORDER BY, Postgres returns an
  // arbitrary `LIMIT 1000` in plan/scan order, so a broad-tag power user
  // (RPG/Action, thousands of overlapping games) can have their genuinely
  // best matches fall entirely outside the 1000 that reach the JS scorer.
  //
  // Proxy = breadth: how many of the (genre/theme/mechanic) axes' top-key
  // sets this row overlaps (0..3). We reuse the SAME `arrayOverlaps`
  // predicates already in `prefilter` — i.e. the exact `"col" && $n`
  // operator + array-literal parameter binding that has run in production
  // since migration 0014. Each is wrapped in `CASE WHEN <pred> THEN 1 ELSE
  // 0 END` (integer) and summed (integer); a higher sum = matches more of
  // the user's taste axes = more relevant. This is a coarse-but-correct
  // strength signal: precise intersection-cardinality would need an
  // `ARRAY[...]::text[]` + `unnest`/`INTERSECT` construction, and Drizzle
  // interpolates a JS array as a `($1, $2)` row-tuple (NOT a `text[]`),
  // which casts invalidly — the mocked-Drizzle tests cannot catch that, so
  // the safe choice is the already-proven `&&` binding.
  //
  // Tiebreak (makes the retained 1000 fully DETERMINISTIC across runs):
  // `rawg_rating DESC NULLS LAST` (quality-within-breadth, same column +
  // NULLS-LAST convention the cold-start branch and `games_rawg_rating_desc`
  // index already use) then `games.id ASC` (unique PK → total order, no
  // ties possible past id).
  //
  // Behavior contract: for users whose overlap set is <= PREFILTER_LIMIT,
  // EVERY overlapping row still survives regardless of order and the JS
  // scorer re-scores + re-sorts all of them, so the final recs are
  // byte-unchanged. The ordering only changes WHICH 1000 survive when the
  // overlap set EXCEEDS the limit (the intended improvement). Perf: this
  // sorts the bounded prefilter result by a non-indexed scalar expression
  // (the `&&` terms are GIN-served for the WHERE; the CASE sum + numeric/
  // id sort run over only the WHERE-matched rows, then `LIMIT 1000`) —
  // acceptable for a bounded prefilter, called out here as a tradeoff.
  // Sum the per-axis 0/1 CASE terms. Built by left-folding the predicate
  // list into one `sql` fragment (no `sql.join` — keep the emitted shape
  // trivially `(c1) + (c2) + …` and avoid depending on helpers the unit
  // mocks don't stub). `predicates` is non-empty here (cold-start handled
  // the zero case above), so the seed is always the first CASE term.
  let breadthSum = sql`(case when ${predicates[0]} then 1 else 0 end)`;
  for (let i = 1; i < predicates.length; i++) {
    breadthSum = sql`${breadthSum} + (case when ${predicates[i]} then 1 else 0 end)`;
  }
  const overlapStrengthOrder = sql`(${breadthSum}) desc, ${games.rawgRating} desc nulls last, ${games.id} asc`;

  const allGames = await db
    .select(GAME_SELECT)
    .from(games)
    .where(prefilter)
    .orderBy(overlapStrengthOrder)
    .limit(PREFILTER_LIMIT);

  const scored: CandidateGame[] = [];
  for (const g of allGames) {
    if (loggedIds.has(g.id)) continue;
    const s = similarityFor(g, genreVec, themeVec, mechanicVec);
    if (s <= 0) continue; // skip games that the user's signal actively rejects or matches nothing
    scored.push(toCandidate(g, s));
  }
  scored.sort((a, b) => b.similarityScore - a.similarityScore);
  return scored.slice(0, limit);
}

/**
 * Backlog lane (play-next Backlog-bucket revival 2026-05-16).
 *
 * The discovery `candidatePool` is the catalog scan with EVERY logged game
 * excluded, so the Backlog rail (`buckets.ts` requires `inLibrary` members)
 * had nothing to select and silently demoted to a 4th Comfort card for all
 * users. This is the second lane: the user's OWNED-BUT-UNPLAYED logs
 * (`backlog`/`wishlist`/`on_hold` — see `BACKLOG_LANE_STATUSES`; done/active
 * statuses are deliberately omitted so a finished/dropped/in-progress game
 * never resurfaces), joined to `games`, scored with the EXACT same
 * dot-product (`similarityFor`) the discovery overlap branch uses so the
 * downstream composite (`server-actions.ts`) treats both lanes uniformly.
 *
 * Callers tag these `inLibrary: true` after merging into the candidate array
 * (only the backlog lane is `inLibrary`, and only the Backlog slot consumes
 * `inLibrary` — no leak into Comfort/Wildcard). Returned candidates are NOT
 * `s <= 0`-filtered (unlike discovery): the rail's job is to surface owned
 * games even when taste-neutral; the bucket floor + composite (with the now-
 * live `libraryBonus`) decide whether one actually fills the slot.
 *
 * Deterministic: ordered by similarityScore desc then id asc so a tie can't
 * fall to arbitrary DB scan order. No randomness.
 */
export async function backlogPool(
  userId: string,
  opts: { vectors?: VectorBundle } = {},
): Promise<CandidateGame[]> {
  if (!userId) return [];

  const { genreVec, themeVec, mechanicVec } = await resolveVectors(
    userId,
    opts.vectors,
  );

  const rows = await db
    .select(GAME_SELECT)
    .from(logs)
    .innerJoin(games, eq(games.id, logs.gameId))
    .where(
      and(
        eq(logs.userId, userId),
        inArray(logs.status, [...BACKLOG_LANE_STATUSES]),
      ),
    )
    .limit(PREFILTER_LIMIT);

  // A game can be logged more than once (e.g. re-logged); de-dupe by id so a
  // single backlog game can't occupy multiple grid candidates. First row for
  // an id wins — order is normalized below regardless.
  const seen = new Set<number>();
  const out: CandidateGame[] = [];
  for (const g of rows) {
    if (seen.has(g.id)) continue;
    seen.add(g.id);
    out.push(toCandidate(g, similarityFor(g, genreVec, themeVec, mechanicVec)));
  }
  out.sort((a, b) =>
    b.similarityScore !== a.similarityScore
      ? b.similarityScore - a.similarityScore
      : a.id - b.id,
  );
  return out;
}
