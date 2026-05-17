import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FilterParams } from "@/lib/recs/moods";

// `@/lib/recs/server-actions` transitively imports `ensureLog`
// (@/lib/logs/server-actions) which pulls in @/lib/cache/redis — that
// module throws at load if UPSTASH_REDIS_* env is absent. Swap in the
// in-memory mock (same pattern as tests/integration/ai-rate-limit.test.ts).
// The v2 getRecs path under test never calls redis; this is purely to
// keep the transitive import graph loadable.
vi.mock("@/lib/cache/redis", async () => {
  const { createMockRedis } = await import("../../helpers/mock-redis");
  return { redis: createMockRedis() };
});

/**
 * getRecs v2 orchestration integration test (play-next redesign Task 12).
 *
 * Repo convention (vitest.config.ts): integration = server-side helpers
 * against in-memory mocks, no real Supabase/Upstash. We mock ONLY the I/O
 * boundary and the two heavy upstream helpers, and let the pure pipeline
 * modules run for real:
 *
 *   MOCKED:
 *     - `@/lib/db` — chainable query-builder queue (select/update/...).
 *       Each `db.select()` / `db.update()` pops the next queued chain.
 *     - `@/lib/supabase/auth-cache` — getCachedUser → { id: "u1" }.
 *     - `@/lib/taste/server-actions` — getFingerprint → full tier + vectors.
 *     - `@/lib/recs/candidate-pool` — candidatePool → fixture CandidateGames.
 *     - `@/lib/recs/social-score` — fetchSocialSignals → small Map; the
 *       REAL computeSocialScore is preserved (re-exported from the actual
 *       module) so the social axis math is exercised end-to-end.
 *     - global `fetch` — the rerank-recs Edge call → { ok: true }.
 *
 *   REAL (not mocked): @/lib/db/schema, @/lib/recs/moods (filterSchema),
 *     @/lib/recs/cache (cacheKey), @/lib/recs/platform-match,
 *     @/lib/recs/scoring, @/lib/recs/buckets, @/lib/recs/diversity-mmr,
 *     @/lib/recs/mood-affinity, @/lib/recs/time-fit, @/lib/recs/soft-negative.
 *
 * Mock-covered paths:
 *   - full sharpening/tier path: candidatePool → neg/lib/social/genre SELECTs
 *     → scoring → MMR → buckets → Edge → post-rerank slot UPDATE → re-read →
 *     hydrate → enrich. Asserts the RecCard contract (slot/fitChips/confidence)
 *     and the Edge request body.
 *   - no-candidates short-circuit (empty pool AND all-filtered-out).
 *   - refinements path → cache bypass + Edge body mode/userRefinements.
 *
 * Deferred to manual / Playwright (T20): the freshness-gate cache-HIT
 * return (requires a populated recommendations cache that also out-dates
 * vectorsGeneratedAt — exercised by the dedicated cache unit coverage and
 * E2E), and the metadataOnlyRecs sparse/AI-failure branch (its own unit
 * tests + the candidate-pool-prefilter suite already pin that path).
 */

// ── DB chainable mock ────────────────────────────────────────────────
// Drizzle chains look like:
//   db.select(cols).from(t).where(...).orderBy(...).limit(...)
//   db.select(cols).from(t).innerJoin(t2, on).where(...)
//   db.update(t).set(v).where(...)
// Each method returns `this`; the chain is thenable and resolves to the
// queued `final` rows (for UPDATE the resolved value is irrelevant — the
// orchestration only awaits it).
type ChainCall = { method: string; args: unknown[] };

function createChain(final: unknown[]) {
  const calls: ChainCall[] = [];
  const chain: Record<string, unknown> = { _calls: calls, _final: final };
  const methods = [
    "select",
    "from",
    "where",
    "orderBy",
    "limit",
    "innerJoin",
    "update",
    "set",
    "delete",
    "insert",
    "values",
    "groupBy",
  ];
  for (const m of methods) {
    chain[m] = vi.fn((...args: unknown[]) => {
      calls.push({ method: m, args });
      return chain;
    });
  }
  chain.then = (
    onfulfilled: (rows: unknown[]) => unknown,
    onrejected?: (err: unknown) => unknown,
  ) => {
    try {
      return Promise.resolve(onfulfilled(final));
    } catch (e) {
      return onrejected ? Promise.resolve(onrejected(e)) : Promise.reject(e);
    }
  };
  return chain;
}

const chainQueue: ReturnType<typeof createChain>[] = [];
// Every chain a `db.select()` actually consumed, in order (Task 11
// scan-count + shape assertion). A `logs⋈games` scan is identifiable by an
// `innerJoin` call recorded on its chain; getRecs' plain selects
// (cache/vectors/negRows/re-read/hydrate) never call `.innerJoin()`, and
// getFingerprint/candidatePool/backlogPool are mocked (their internal joins
// don't reach this db mock) — so any consumed chain with an `innerJoin` is
// exactly the standalone explored-genres `logs⋈games` scan this task
// eliminates.
const consumedSelects: ReturnType<typeof createChain>[] = [];
function chainMethods(c: ReturnType<typeof createChain>): string[] {
  return (c as unknown as { _calls: ChainCall[] })._calls.map((x) => x.method);
}
function queue(final: unknown[]) {
  const c = createChain(final);
  chainQueue.push(c);
  return c;
}

// ── post-rerank slot-UPDATE recorder ─────────────────────────────────
// The v2 getRecs post-rerank stage fires one
//   db.update(recommendations).set({ slot }).where(and(eq…, inArray(gameId, gids)))
// per distinct bucket slot. We record { slot, gameIds } per call so the
// happy-path test can assert the partition contract: every slot ∈ the 4
// rails, no duplicate slots, and the per-call gameId sets are pairwise
// DISJOINT with a union equal to the bucketed set.
//
// `.set({ slot })` is captured directly. The gameId list is recovered by
// walking the composed Drizzle `and(...)` SQL object passed to `.where()`
// and collecting every `Param` whose `.value` is a number — that is
// exactly the `inArray(recommendations.gameId, gids)` payload, because the
// sibling `eq()` clauses bind string/boolean params (userId / cacheKey /
// dismissed), never numbers. Verified against drizzle-orm's SQL chunk tree
// for this exact `and()` composition.
type RecordedUpdate = { slot: unknown; gameIds: number[] };
const recordedUpdates: RecordedUpdate[] = [];

function extractGameIds(whereArg: unknown): number[] {
  const nums: number[] = [];
  const seen = new Set<object>();
  const walk = (o: unknown): void => {
    if (o == null || typeof o !== "object") return;
    if (seen.has(o as object)) return;
    seen.add(o as object);
    if (Array.isArray(o)) {
      for (const x of o) walk(x);
      return;
    }
    const v = (o as { value?: unknown }).value;
    if (typeof v === "number") nums.push(v);
    for (const k of Object.keys(o as Record<string, unknown>)) {
      walk((o as Record<string, unknown>)[k]);
    }
  };
  walk(whereArg);
  return nums;
}

// Re-export the REAL schema (pure Drizzle table descriptors, no side
// effects) so transitive consumers (lib/logs/select.ts → `schema.logs`)
// still resolve. We replace ONLY `db` with the chainable queue mock;
// `importOriginal` is unusable here because @/lib/db eagerly instantiates
// a postgres client at module load (requireEnv("DATABASE_URL")).
vi.mock("@/lib/db", async () => {
  const schema = await vi.importActual<typeof import("@/lib/db/schema")>(
    "@/lib/db/schema",
  );
  return {
    schema,
    db: {
      // SELECT consumes the queued chain (its resolved rows matter). Also
      // recorded into `consumedSelects` for the Task 11 scan-count/shape
      // assertion.
      select: vi.fn(() => {
        const next = chainQueue.shift();
        if (!next) throw new Error("test setup bug: chainQueue empty (select)");
        (next.select as (...a: unknown[]) => unknown)();
        consumedSelects.push(next);
        return next;
      }),
      // UPDATE returns a fresh standalone chain resolving to [] — it does
      // NOT consume the select queue. The v2 post-rerank slot UPDATE fires
      // a *variable* number of times (one per distinct bucket slot, ≤4),
      // and the orchestration only `await Promise.all(...)`s the result
      // without inspecting it, so an independent no-op chain is correct
      // and keeps the select queue aligned regardless of slot cardinality.
      //
      // The chain stays a functional no-op; we additionally RECORD each
      // call's `.set({ slot })` and the `inArray` gameId list from
      // `.where()` so the partition contract can be asserted.
      update: vi.fn(() => {
        const c = createChain([]);
        (c.update as (...a: unknown[]) => unknown)();
        const rec: RecordedUpdate = { slot: undefined, gameIds: [] };
        let recorded = false;
        const origSet = c.set as (...a: unknown[]) => unknown;
        c.set = vi.fn((...args: unknown[]) => {
          const payload = args[0] as { slot?: unknown } | undefined;
          rec.slot = payload?.slot;
          return origSet(...args);
        });
        const origWhere = c.where as (...a: unknown[]) => unknown;
        c.where = vi.fn((...args: unknown[]) => {
          rec.gameIds = extractGameIds(args[0]);
          if (!recorded) {
            recordedUpdates.push(rec);
            recorded = true;
          }
          return origWhere(...args);
        });
        return c;
      }),
    },
  };
});

vi.mock("@/lib/supabase/auth-cache", () => ({
  getCachedUser: vi.fn(async () => ({ id: "u1" })),
}));

const VECTORS = {
  genre: { rpg: 1, action: 0.6 },
  theme: { fantasy: 1 },
  mechanic: { exploration: 0.8 },
  gameMode: {},
  playerPerspective: {},
};

// Task 11: getFingerprint now also surfaces the cheap log-derived facts the
// pipeline used to re-scan `logs` for (loggedGameIds / exploredGenres /
// genreFrequency), computed from the SAME aggregation. The mock returns them
// EMPTY by default — byte-equivalent to the pre-T11 fixture, where the
// removed standalone `loggedGenreRows` SELECT was queued as `[]` (→ empty
// Set/Map) and `candidatePool` (mocked) ignored its own logged-id scan. An
// empty exploredGenres makes pickWildcard treat every candidate genre as
// unexplored — identical to the old empty-scan behavior, so rec output is
// unchanged. `loggedGameIds` is consumed only by the (mocked) candidatePool
// here, so its value is inert in these tests but kept shape-correct.
const EMPTY_LOG_FACTS = {
  loggedGameIds: new Set<number>(),
  exploredGenres: new Set<string>(),
  genreFrequency: new Map<string, number>(),
};
const getFingerprintMock = vi.fn(async () => ({
  tier: "full" as const,
  vectors: VECTORS,
  ...EMPTY_LOG_FACTS,
}));
vi.mock("@/lib/taste/server-actions", () => ({
  getFingerprint: getFingerprintMock,
}));

// ~12 fixture candidates spanning genres/playtimes so MMR + buckets have
// real material. All `platforms: null` so the (real) platform filter keeps
// every row; playtimes chosen to sit inside the "1hr" window ([0,12]).
type Cand = {
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

function makeCandidates(): Cand[] {
  const genrePool = [
    ["rpg", "fantasy"],
    ["action", "shooter"],
    ["puzzle"],
    ["strategy", "rpg"],
    ["adventure", "exploration"],
    ["roguelike"],
    ["platformer"],
    ["simulation"],
    ["rpg", "action"],
    ["racing"],
    ["fighting"],
    ["metroidvania", "exploration"],
  ];
  return genrePool.map((genres, i) => ({
    id: i + 1,
    slug: `game-${i + 1}`,
    title: `Game ${i + 1}`,
    released: new Date(2020, 0, 1),
    coverUrl: null,
    posterUrl: `https://img/${i + 1}.jpg`,
    genres,
    themes: i % 2 === 0 ? ["fantasy"] : ["sci-fi"],
    mechanics: i % 3 === 0 ? ["exploration"] : ["combat"],
    platforms: null,
    playtimeAvgHours: 2 + (i % 5), // 2..6h — inside the 1hr window [0,12]
    similarityScore: 5 - i * 0.3, // descending unbounded taste sum
  }));
}

const candidatePoolMock = vi.fn(async () => makeCandidates() as Cand[]);
// Backlog lane (play-next Backlog-bucket revival 2026-05-16). Defaults to an
// empty lane so the pre-existing pipeline assertions (which model a
// no-backlog user) are byte-unchanged; the backlog-specific test overrides
// it. Mocked → no DB chain consumed (the real libRows SELECT it replaced was
// removed from getRecs, so the chain queues drop that entry).
const backlogPoolMock = vi.fn(async () => [] as Cand[]);
vi.mock("@/lib/recs/candidate-pool", () => ({
  candidatePool: candidatePoolMock,
  backlogPool: backlogPoolMock,
}));

// Keep the REAL computeSocialScore; only stub the DB-backed bulk fetch.
const fetchSocialSignalsMock = vi.fn(
  async () =>
    new Map<number, { friendsPlayed: number; friendsLiked: number }>([
      [2, { friendsPlayed: 3, friendsLiked: 2 }],
      [5, { friendsPlayed: 1, friendsLiked: 4 }],
    ]),
);
vi.mock("@/lib/recs/social-score", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/recs/social-score")>(
      "@/lib/recs/social-score",
    );
  return { ...actual, fetchSocialSignals: fetchSocialSignalsMock };
});

// ── security/rate-limit mock (F-005) ─────────────────────────────────
// Default: no-op resolve so the existing pipeline tests are unaffected.
// The refinement-rate-limit test makes it reject once.
const enforceRateLimitMock = vi.fn(async () => undefined);
class RateLimitedError extends Error {
  constructor(
    public scope: string,
    public retryAfterSeconds: number,
  ) {
    super("rl");
    this.name = "RateLimitedError";
  }
}
vi.mock("@/lib/security/rate-limit", () => ({
  enforceRateLimit: enforceRateLimitMock,
  RateLimitedError,
  clientIpForRateLimit: vi.fn(async () => "127.0.0.1"),
}));

// ── fetch (Edge) mock ────────────────────────────────────────────────
let lastFetchBody: Record<string, unknown> | null = null;
const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
  lastFetchBody = init?.body
    ? (JSON.parse(init.body as string) as Record<string, unknown>)
    : null;
  return {
    ok: true,
    json: async () => ({ ok: true }),
  } as unknown as Response;
});

beforeEach(() => {
  chainQueue.length = 0;
  consumedSelects.length = 0;
  recordedUpdates.length = 0;
  lastFetchBody = null;
  fetchMock.mockClear();
  candidatePoolMock.mockClear();
  candidatePoolMock.mockImplementation(async () => makeCandidates());
  backlogPoolMock.mockClear();
  backlogPoolMock.mockImplementation(async () => []);
  getFingerprintMock.mockClear();
  getFingerprintMock.mockImplementation(async () => ({
    tier: "full" as const,
    vectors: VECTORS,
    ...EMPTY_LOG_FACTS,
  }));
  fetchSocialSignalsMock.mockClear();
  enforceRateLimitMock.mockClear();
  enforceRateLimitMock.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("SUPABASE_FUNCTIONS_URL", "https://edge.test/functions/v1");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "svc-role-test-key");
  vi.resetModules();
});

const FILTERS: FilterParams = {
  moods: ["chill"],
  time: "1hr",
  platforms: ["steam"],
};

// Hydrated games-table rows the post-rerank re-read joins against. The
// re-read SELECT returns rec rows; hydrateRecs then SELECTs games by id.
function recRows(ids: number[]) {
  return ids.map((id) => ({
    id: `rec-${id}`,
    gameId: id,
    score: (0.9 - id * 0.05).toFixed(4),
    reason: `Pick ${id}`,
    algorithm: "ai" as const,
    slot: "comfort" as const,
  }));
}
function gameRows(ids: number[]) {
  return ids.map((id) => ({
    id,
    slug: `game-${id}`,
    title: `Game ${id}`,
    released: new Date(2020, 0, 1),
    posterUrl: `https://img/${id}.jpg`,
    coverUrl: null,
    platforms: null,
  }));
}

/**
 * Queue the DB chains for ONE successful full v2 run (cache miss → pipeline
 * → rerankOk → slot UPDATE → re-read → hydrate). Call order mirrors the
 * implementation exactly.
 */
function queueFullRun(opts: { refinements: boolean }) {
  if (!opts.refinements) {
    // 1. cache SELECT (recommendations) — empty → miss
    queue([]);
    // 2. vectors SELECT (tasteFingerprints) — old vector ⇒ irrelevant on miss
    queue([{ vectorsGeneratedAt: new Date(2000, 0, 1) }]);
  }
  // 3. negRows SELECT (recommendations) — no dismissals
  queue([]);
  // NOTE — Task 11: the standalone `loggedGenreRows` SELECT (logs ⋈ games,
  // explored-genres) was REMOVED from getRecs — `exploredGenres` /
  // `genreFrequency` now come from the live `getFingerprint` snapshot
  // (mocked, EMPTY_LOG_FACTS), which consumes NO db chain. The pre-T11
  // `libRows` SELECT was already removed in the Backlog-bucket revival
  // (`libraryIds` ← mocked backlog lane). So the v2 no-refinement chain
  // is now: cache, vectors, negRows, [Edge], re-read, hydrate.
  // (fetchSocialSignals + backlogPool + getFingerprint are mocked — no db chain)
  // (post-rerank slot UPDATEs use independent no-op chains — not queued)
  // 4. fresh re-read SELECT (recommendations)
  queue(recRows([1, 2, 3, 4, 5]));
  // 5. hydrateRecs games SELECT
  queue(gameRows([1, 2, 3, 4, 5]));
}

const SLOTS = new Set(["comfort", "backlog", "friends", "wildcard"]);

describe("getRecs v2 — full sharpening/tier orchestration", () => {
  it("returns ok with 4-6 recs, each carrying slot + fitChips + confidence", async () => {
    queueFullRun({ refinements: false });
    const { getRecs } = await import("@/lib/recs/server-actions");

    const result = await getRecs(FILTERS);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.algorithm).toBe("ai");
    expect(result.tier).toBe("full");
    expect(result.recs.length).toBeGreaterThanOrEqual(4);
    expect(result.recs.length).toBeLessThanOrEqual(6);
    for (const r of result.recs) {
      expect(SLOTS.has(r.slot)).toBe(true);
      expect(r.fitChips).toBeDefined();
      expect(["perfect", "close", "loose"]).toContain(r.fitChips.timeFit);
      expect(Array.isArray(r.fitChips.moodMatches)).toBe(true);
      expect(typeof r.fitChips.inLibrary).toBe("boolean");
      expect(typeof r.fitChips.friendsCount).toBe("number");
      expect(["strong", "good", "worth-a-try"]).toContain(r.confidence);
    }

    // The Edge was invoked once, in "full" mode, with a pre-scored
    // shortlist of candidate ids (post-MMR/bucket).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastFetchBody).not.toBeNull();
    expect(lastFetchBody?.mode).toBe("full");
    expect(lastFetchBody?.userRefinements).toEqual([]);
    expect(Array.isArray(lastFetchBody?.candidateIds)).toBe(true);
    expect((lastFetchBody?.candidateIds as number[]).length).toBeGreaterThan(0);

    // ── post-rerank slot-UPDATE partition contract ───────────────────
    // The bySlot grouping fires one UPDATE per distinct bucket slot. Pin:
    //   (a) it actually fired,
    //   (b) every recorded slot ∈ the 4 rails,
    //   (c) no slot is updated twice (≤4 calls, one per distinct slot),
    //   (d) the per-call gameId sets are pairwise DISJOINT, and
    //   (e) their union == the bucketed gameId universe.
    //
    // The universe is taken from the Edge request body's `candidateIds`
    // (production sets it to `bucketed.map(b => b.gameId)`), which is the
    // EXACT set the post-rerank UPDATE iterates (`slotByGameId` is built
    // from the same `bucketed` array). Asserting against the live bucketed
    // set — not the static re-read fixture (`recRows([1..5])`, which models
    // the independent re-read SELECT and is unrelated to which ids the real
    // MMR/bucket stage selected) — makes (d)+(e) pin the genuine disjoint-
    // set safety + full-coverage claim, robust to the wall-clock-seeded
    // MMR/bucket output rather than a fixture coincidence.
    expect(recordedUpdates.length).toBeGreaterThan(0);
    expect(recordedUpdates.length).toBeLessThanOrEqual(4);

    const slots = recordedUpdates.map((u) => u.slot);
    for (const s of slots) {
      expect(SLOTS.has(s as string)).toBe(true);
    }
    expect(new Set(slots).size).toBe(slots.length); // no duplicate slots

    // Pairwise-disjoint: every gameId appears in exactly one UPDATE call.
    const allIds = recordedUpdates.flatMap((u) => u.gameIds);
    expect(allIds.length).toBeGreaterThan(0); // gameIds were observable
    expect(new Set(allIds).size).toBe(allIds.length);

    // Full-coverage: union of UPDATEd ids == the bucketed universe the
    // Edge received (and that the post-rerank UPDATE partitions).
    const bucketedUniverse = new Set(
      lastFetchBody?.candidateIds as number[],
    );
    expect(new Set(allIds)).toEqual(bucketedUniverse);
  });

  it("surfaces a real owned-but-unplayed game in slot:'backlog' (Backlog rail revived)", async () => {
    // Acceptance criterion: a user with a backlog/wishlist log scoring above
    // the bucket floor gets a REAL game in the Backlog slot — instead of the
    // pre-fix silent demotion to a 4th Comfort card.
    //
    // Deterministic construction (no randomness):
    //  - Discovery override: 8 uniform STRONG candidates (taste 1.0 +
    //    timeFit≈1.0 + chill mood 1.0, released 2020) → composite ≈ 0.80.
    //    They occupy the 3 Comfort + Friends + Wildcard slots.
    //  - Backlog lane: ONE owned game (id 999), taste 0 but chill mood 1.0
    //    + timeFit≈1.0 + libraryBonus → composite ≈ 0.57: clears the 0.5
    //    floor yet is strictly below the 0.80 discovery leaders, so it is
    //    NOT consumed by the top-3 Comfort tier. It is the ONLY inLibrary
    //    candidate, so `buckets.ts`'s Backlog `find` (inLibrary &&
    //    composite>=floor) resolves to it.
    // playtime 1 == the "1hr" budget peak ⇒ timeFitScore≈1.0; genres
    // ["puzzle"] + mechanics ["exploration"] are both chill-boosted ⇒
    // moodMatchScore("chill")=1.0. These make the floor-clear/not-top-3
    // arithmetic robust rather than coincidental.
    const strongDiscovery = Array.from({ length: 8 }, (_, i) => ({
      id: i + 1,
      slug: `disc-${i + 1}`,
      title: `Disc ${i + 1}`,
      released: new Date(2020, 0, 1),
      coverUrl: null,
      posterUrl: `https://img/${i + 1}.jpg`,
      genres: ["puzzle"],
      themes: ["fantasy"],
      mechanics: ["exploration"],
      platforms: null,
      playtimeAvgHours: 1,
      similarityScore: 5,
    }));
    candidatePoolMock.mockImplementationOnce(async () => strongDiscovery);
    const backlogGame = {
      id: 999,
      slug: "owned-game",
      title: "Owned Game",
      released: new Date(2021, 0, 1),
      coverUrl: null,
      posterUrl: "https://img/999.jpg",
      genres: ["puzzle"],
      themes: ["fantasy"],
      mechanics: ["exploration"],
      platforms: null,
      playtimeAvgHours: 1,
      similarityScore: 0, // taste 0 — only library/mood/time carry it
    };
    backlogPoolMock.mockImplementationOnce(async () => [backlogGame]);
    queueFullRun({ refinements: false });

    const { getRecs } = await import("@/lib/recs/server-actions");
    const result = await getRecs(FILTERS);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");

    // The post-rerank slot UPDATE partitions the bucketed grid by slot. A
    // `backlog` slot UPDATE must have fired, and its gameId set must be
    // exactly the backlog-lane game — proving the rail is reachable and the
    // owned game (not a discovery card) filled it.
    const backlogUpdate = recordedUpdates.find((u) => u.slot === "backlog");
    expect(backlogUpdate).toBeDefined();
    expect(backlogUpdate?.gameIds).toEqual([999]);

    // And it was sent to the Edge as part of the candidate set.
    expect(lastFetchBody?.candidateIds as number[]).toContain(999);
  });

  it("returns { ok:false, reason:'no-candidates' } when the pool is empty", async () => {
    // BOTH lanes empty (discovery pool + backlog lane) → merged set empty.
    queue([]);
    queue([{ vectorsGeneratedAt: new Date(2000, 0, 1) }]);
    candidatePoolMock.mockImplementationOnce(async () => []);
    backlogPoolMock.mockImplementationOnce(async () => []);

    const { getRecs } = await import("@/lib/recs/server-actions");
    const result = await getRecs(FILTERS);

    expect(result).toEqual({ ok: false, reason: "no-candidates" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns { ok:false, reason:'no-candidates' } when every candidate is filtered out", async () => {
    // cache miss + vectors + negRows (the time filter runs AFTER the
    // negRows SELECT), then a pool whose playtimes all violate the 15min
    // window (upper bound 3h) — the real time filter drops them all.
    queue([]);
    queue([{ vectorsGeneratedAt: new Date(2000, 0, 1) }]);
    queue([]); // negRows
    candidatePoolMock.mockImplementationOnce(async () =>
      makeCandidates().map((c) => ({ ...c, playtimeAvgHours: 80 })),
    );

    const { getRecs } = await import("@/lib/recs/server-actions");
    const result = await getRecs({ ...FILTERS, time: "15min" });

    expect(result).toEqual({ ok: false, reason: "no-candidates" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes the LIVE fingerprint vectors + narrative in the Edge request body", async () => {
    // Task 5 (Codex remediation): the deterministic pipeline already
    // computed a LIVE fingerprint (getFingerprint → fp.vectors / fp.narrative).
    // The rerank Edge must order + explain picks from that SAME live signal,
    // not the stale/missing persisted taste_fingerprints row it independently
    // re-SELECTs. Pin the contract: the Edge payload carries the live
    // `vectors` (deep-equal to fp.vectors) and `narrative` (=== fp.narrative).
    const liveNarrative =
      "Drawn to systemic RPGs with deep exploration and a fantasy bent.";
    getFingerprintMock.mockImplementationOnce(async () => ({
      tier: "full" as const,
      vectors: VECTORS,
      narrative: liveNarrative,
      ...EMPTY_LOG_FACTS,
    }));
    queueFullRun({ refinements: false });
    const { getRecs } = await import("@/lib/recs/server-actions");

    const result = await getRecs(FILTERS);

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastFetchBody).not.toBeNull();
    // Live vectors are forwarded verbatim (deep equality, non-empty).
    expect(lastFetchBody?.vectors).toEqual(VECTORS);
    expect(
      Object.keys(lastFetchBody?.vectors as Record<string, unknown>).length,
    ).toBeGreaterThan(0);
    // Live narrative is forwarded verbatim (not null when present on fp).
    expect(lastFetchBody?.narrative).toBe(liveNarrative);
  });

  it("forwards narrative as null (not undefined/missing) when the live fingerprint has none", async () => {
    // sparse/never-refreshed users have fp.narrative == null. The body must
    // still carry an explicit `narrative: null` so the Edge's "prefer body
    // when present" selection treats it as a genuine absent-narrative signal
    // and falls back to its SQL read — rather than the key being undefined.
    // (Default getFingerprintMock returns no narrative field → undefined →
    // must be normalized to null by getRecs.)
    queueFullRun({ refinements: false });
    const { getRecs } = await import("@/lib/recs/server-actions");

    const result = await getRecs(FILTERS);

    expect(result.ok).toBe(true);
    expect(lastFetchBody).not.toBeNull();
    expect("narrative" in (lastFetchBody as object)).toBe(true);
    expect(lastFetchBody?.narrative).toBeNull();
    // vectors still forwarded from the live fingerprint.
    expect(lastFetchBody?.vectors).toEqual(VECTORS);
  });

  // ── Task 11: collapse redundant per-load `logs` scans ────────────────
  // A single /play-next load (full tier, no refinements) must NOT issue the
  // standalone explored-genres `logs⋈games` scan nor the standalone
  // `SELECT logs.gameId` exclusion scan. Both are now sourced from the
  // single `getFingerprint` aggregation. The `candidatePool` /
  // `backlogPool` / `getFingerprint` self-scans are mocked away, so the
  // ONLY way a `logs⋈games` join chain reaches the db mock is the
  // standalone explored-genres scan this task eliminates.
  it("does NOT issue a logs⋈games scan from getRecs (explored-genres scan eliminated, Task 11)", async () => {
    queueFullRun({ refinements: false });
    const { getRecs } = await import("@/lib/recs/server-actions");

    const result = await getRecs(FILTERS);
    expect(result.ok).toBe(true);

    // No consumed select chain performed an innerJoin → the standalone
    // `logs⋈games` explored-genres scan is gone (it was the only joined
    // select getRecs itself ever issued).
    const joinedSelects = consumedSelects.filter((c) =>
      chainMethods(c).includes("innerJoin"),
    );
    expect(joinedSelects.length).toBe(0);

    // Exact consumed-select inventory for the no-refinement full run:
    //   cache, vectors, negRows, post-Edge re-read, hydrate games  → 5.
    // Pre-T11 this was 6 (the extra standalone `loggedGenreRows`
    // `logs⋈games` scan). The `queueFullRun` queue length is the contract;
    // an off-count would have thrown "chainQueue empty" or left a chain
    // unconsumed. Pin the number explicitly so a reintroduced scan fails
    // here loudly rather than silently desyncing the positional queue.
    expect(consumedSelects.length).toBe(5);
  });

  it("output-equivalence: rec ids + slots are the deterministic fixture set (Task 11 is a pure data-sourcing dedupe)", async () => {
    // The dedupe must not change WHICH games are recommended or their
    // slots. The post-Edge re-read + hydrate fixtures pin ids 1..5 with the
    // persisted slot 'comfort' (hydrateRecs uses the DB slot on the
    // no-refinement path; this anchor is independent of the wall-clock-
    // seeded bucket stage). Identical before vs after this task.
    queueFullRun({ refinements: false });
    const { getRecs } = await import("@/lib/recs/server-actions");

    const result = await getRecs(FILTERS);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.algorithm).toBe("ai");
    expect(result.recs.map((r) => r.gameId)).toEqual([1, 2, 3, 4, 5]);
    // Slots come from the re-read fixture (all 'comfort'); the dedupe does
    // not perturb the returned slot.
    expect(result.recs.map((r) => r.slot)).toEqual([
      "comfort",
      "comfort",
      "comfort",
      "comfort",
      "comfort",
    ]);
  });
});

/**
 * Queue the DB chains for ONE successful legacy run (getRecsLegacy — the
 * flag-OFF kill-switch path). Chain order mirrors the legacy implementation:
 *
 *   1. cache SELECT (recommendations) — empty → miss
 *   2. vectors SELECT (tasteFingerprints) — old → stale
 *   [candidatePool is mocked — no chain consumed]
 *   [fetch (Edge) is mocked — no chain consumed]
 *   3. fresh re-read SELECT (recommendations) — after Edge
 *   4. hydrateRecs games SELECT
 *
 * This is deliberately SHORTER than queueFullRun (no negRows / libRows /
 * loggedGenreRows — those are v2-only selects in getRecs, absent in
 * getRecsLegacy which is a verbatim copy of the pre-v2 body).
 */
function queueLegacyRun() {
  // 1. cache SELECT — empty → miss
  queue([]);
  // 2. vectors SELECT — old ⇒ stale
  queue([{ vectorsGeneratedAt: new Date(2000, 0, 1) }]);
  // 3. fresh re-read SELECT (after Edge function)
  queue(recRows([1, 2, 3, 4, 5]));
  // 4. hydrateRecs games SELECT
  queue(gameRows([1, 2, 3, 4, 5]));
}

describe("getRecs — flag-off kill-switch (legacy path)", () => {
  afterEach(() => {
    // Unstub RECS_V2_ENABLED so subsequent describe blocks see the default
    // (flag-on) behavior. vi.stubEnv is additive — without an explicit
    // unstub the value leaks across describe boundaries even though
    // beforeEach calls vi.resetModules().
    vi.unstubAllEnvs();
  });

  it("returns ok with recs from the legacy algorithm when RECS_V2_ENABLED=false, every rec has a defined slot", async () => {
    // Must stub the flag BEFORE importing server-actions (vi.resetModules() in
    // beforeEach ensures the module is re-evaluated fresh after this stub).
    vi.stubEnv("RECS_V2_ENABLED", "false");

    // The legacy path (getRecsLegacy) has a shorter DB chain than v2: it omits
    // the negRows / libRows / loggedGenreRows SELECTs that are v2-only.
    // queueLegacyRun() matches the exact chain order of getRecsLegacy.
    queueLegacyRun();
    const { getRecs } = await import("@/lib/recs/server-actions");

    const result = await getRecs(FILTERS);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`expected ok result, got: ${JSON.stringify(result)}`);
    // Legacy path invokes the Edge and returns algorithm "ai" (same as v2 for
    // sharpening/full tier with a successful rerank).
    expect(result.algorithm).toBe("ai");
    expect(result.recs.length).toBeGreaterThanOrEqual(1);
    for (const r of result.recs) {
      // hydrateRecs defaults slot to "comfort" for any row that lacks it.
      // The slot must always be defined.
      expect(r.slot).toBeDefined();
      expect(SLOTS.has(r.slot)).toBe(true);
    }
  });
});

describe("getRecs v2 — refinements", () => {
  it("bypasses the cache and sends mode='rerank-only' + userRefinements", async () => {
    // refinements path: NO cache SELECT / NO vectors SELECT queued —
    // queueFullRun(refinements:true) starts at negRows.
    queueFullRun({ refinements: true });
    const { getRecs } = await import("@/lib/recs/server-actions");

    const result = await getRecs(FILTERS, { refinements: ["less grindy"] });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.algorithm).toBe("ai");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastFetchBody?.mode).toBe("rerank-only");
    expect(lastFetchBody?.userRefinements).toEqual(["less grindy"]);
  });

  it("sends a candidate pool WIDER than the 6-card grid so refinements can move the picks", async () => {
    // Incident 2026-05-15: multiple active refinements → same games. The
    // pre-fix code sent `bucketed` (≤ GRID_SIZE = 6) as candidateIds, so the
    // Edge picked 5-of-6 and the refinement text was nearly inert. With
    // refinements active the Edge must receive a substantially wider (still
    // MMR-diversified) pool. The no-refinement path keeps the stratified
    // 6-card grid (pinned by the partition contract test above).
    queueFullRun({ refinements: true });
    const { getRecs } = await import("@/lib/recs/server-actions");

    const result = await getRecs(FILTERS, {
      refinements: ["less grindy", "more story"],
    });

    expect(result.ok).toBe(true);
    const ids = lastFetchBody?.candidateIds as number[];
    expect(Array.isArray(ids)).toBe(true);
    // All 12 fixtures clear the 1hr/platform/neg filters; the grid caps at
    // 6. A refinement-aware pool must exceed that (here: all 12 diversified).
    expect(ids.length).toBeGreaterThan(6);
  });

  it("keeps slot semantics on the wide-pool path: a refined pick OUTSIDE the base 6 gets its real slot (not defaulted comfort)", async () => {
    // Task 6 (Codex remediation). Pre-fix, the post-rerank slot UPDATE
    // iterated only the base-6 `slotByGameId`. On a refinement run the Edge
    // gets a WIDE MMR pool (~40 ids) and can pick games OUTSIDE that base 6;
    // those were absent from the map so their `recommendations.slot` kept
    // the schema DEFAULT 'comfort' — refined grids collapsed toward
    // all-Comfort, destroying the Backlog/Friends/Wildcard rails.
    //
    // Deterministic construction (no reliance on MMR tie luck):
    //   - 20 discovery candidates (ids 1..20). id 1 carries the chill-boost
    //     genre ["puzzle"] so it is the unique highest-composite seed; ids
    //     2..20 carry distinct non-chill genres ["g2".."g20"] (mood 0.5)
    //     but are still well above both the bucket floor and id 999.
    //     All share themes ["fantasy"] + mechanics ["exploration"].
    //   - ONE owned backlog game id 999, genres ["puzzle"] (chill 1.0 →
    //     clears the 0.5 floor at composite ≈ 0.57) but taste 0, and its
    //     genre/theme/mechanic vector is IDENTICAL to discovery id 1, so
    //     MMR's diversity term gives it the largest similarity penalty.
    //     Its MMR value is the lowest of all 21 candidates, so it is the
    //     LAST item MMR selects: OUTSIDE the base-6 bucket input
    //     (`applyMMR topN:15`) but INSIDE the wide Edge pool
    //     (`applyMMR topN:40`, only 21 items → all returned).
    // The Edge then "picks" id 999 (the re-read fixture includes it). Since
    // 999 is the only inLibrary final pick clearing the floor, the
    // canonical assigner must put it in slot 'backlog'.
    const discovery = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      slug: `disc-${i + 1}`,
      title: `Disc ${i + 1}`,
      released: new Date(2020, 0, 1),
      coverUrl: null,
      posterUrl: `https://img/${i + 1}.jpg`,
      genres: i === 0 ? ["puzzle"] : [`g${i + 1}`],
      themes: ["fantasy"],
      mechanics: ["exploration"],
      platforms: null,
      playtimeAvgHours: 1,
      similarityScore: 5,
    }));
    candidatePoolMock.mockImplementationOnce(async () => discovery);
    const backlogGame = {
      id: 999,
      slug: "owned-game",
      title: "Owned Game",
      released: new Date(2021, 0, 1),
      coverUrl: null,
      posterUrl: "https://img/999.jpg",
      genres: ["puzzle"], // chill 1.0 → composite clears the 0.5 floor
      themes: ["fantasy"],
      mechanics: ["exploration"], // identical vector to discovery id 1
      platforms: null,
      playtimeAvgHours: 1,
      similarityScore: 0, // taste 0 — only library/mood/time carry it
    };
    backlogPoolMock.mockImplementationOnce(async () => [backlogGame]);

    // Refinement-path chain order (Task 11 — `loggedGenreRows` SELECT
    // removed; exploredGenres now from the mocked getFingerprint snapshot):
    // negRows, post-Edge re-read (recommendations), hydrateRecs games. The
    // Edge "picked" ids 1..4 + 999, so the re-read AND the games hydration
    // both carry 999.
    queue([]); // negRows
    queue(recRows([1, 2, 3, 4, 999])); // post-Edge re-read (Edge's final picks)
    queue(gameRows([1, 2, 3, 4, 999])); // hydrateRecs games

    const { getRecs } = await import("@/lib/recs/server-actions");
    const result = await getRecs(FILTERS, { refinements: ["less grindy"] });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");

    // 999 must have been in the WIDE Edge pool (outside the base 6).
    expect(lastFetchBody?.candidateIds as number[]).toContain(999);

    // ── core Task-6 assertion ────────────────────────────────────────
    // A `backlog` slot UPDATE must have fired keyed by 999 — i.e. the slot
    // was assigned over the FINAL picks, not the base-6 grid (pre-fix there
    // was no backlog UPDATE for 999 at all → it defaulted to comfort).
    const backlogUpdate = recordedUpdates.find((u) => u.slot === "backlog");
    expect(backlogUpdate).toBeDefined();
    expect(backlogUpdate?.gameIds).toContain(999);

    // And the returned card for 999 carries slot 'backlog' (not 'comfort').
    const card999 = result.recs.find((r) => r.gameId === 999);
    expect(card999).toBeDefined();
    expect(card999?.slot).toBe("backlog");
  });

  it("truncates each refinement to 120 chars before the Edge call (F-005)", async () => {
    queueFullRun({ refinements: true });
    const { getRecs } = await import("@/lib/recs/server-actions");

    const result = await getRecs(FILTERS, {
      refinements: ["x".repeat(500)],
    });

    expect(result.ok).toBe(true);
    const refs = lastFetchBody?.userRefinements as string[];
    expect(refs).toHaveLength(1);
    expect(refs[0].length).toBe(120);
  });

  it("rate-limits the refinement path → { ok:false, reason:'rate-limited' }, no Edge call (F-005)", async () => {
    queueFullRun({ refinements: true });
    enforceRateLimitMock.mockRejectedValueOnce(
      new RateLimitedError("recs:refine", 30),
    );
    const { getRecs } = await import("@/lib/recs/server-actions");

    const result = await getRecs(FILTERS, { refinements: ["less grindy"] });

    expect(result).toEqual({ ok: false, reason: "rate-limited" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(enforceRateLimitMock).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "recs:refine", identifier: "u1" }),
    );
  });

  it("enforces recs:refine at limit=10/windowSeconds=60 (spec §318: 10 refinement runs/min/user)", async () => {
    // Task 9 (Codex remediation): pin the exact enforceRateLimit args so any
    // future drift from the spec rate is caught. The non-refinement path must
    // NOT call enforceRateLimit at all (asserted separately via call count).
    queueFullRun({ refinements: true });
    const { getRecs } = await import("@/lib/recs/server-actions");

    await getRecs(FILTERS, { refinements: ["less grindy"] });

    expect(enforceRateLimitMock).toHaveBeenCalledTimes(1);
    expect(enforceRateLimitMock).toHaveBeenCalledWith({
      scope: "recs:refine",
      identifier: "u1",
      limit: 10,
      windowSeconds: 60,
    });
  });

  it("does NOT call enforceRateLimit on the non-refinement path (F-005)", async () => {
    // The no-refinement (cache/pipeline) path must never be rate-limited —
    // it is cached and host-cost is negligible. Pin this so a future refactor
    // cannot accidentally gate the free path.
    queueFullRun({ refinements: false });
    const { getRecs } = await import("@/lib/recs/server-actions");

    await getRecs(FILTERS);

    expect(enforceRateLimitMock).not.toHaveBeenCalled();
  });
});

describe("getRecs v2 — rerank wall-clock budget (Task 12)", () => {
  // Task 12 (Codex remediation): the rerank Edge `fetch` had NO overall
  // wall-clock budget. ai-router.ts loops 4 providers at 30s each, so a
  // slow-but-not-failed AI plumbing path made getRecs hang ~90s and the
  // /play-next page sat on the pending mascot. Spec
  // docs/superpowers/specs/2026-05-15-play-next-redesign-design.md :416:
  // an Edge wall-clock budget breach (>8s) must fall back to the already-
  // computed deterministic picks for the filter combo + a "took too long —
  // showing your last set" banner — NOT keep blocking on AI plumbing, and
  // NOT route through the metadataOnlyRecs hard-failure path (that path
  // re-pulls a candidate pool & re-templates; the deterministic bucketed
  // grid was already computed pre-Edge and is the correct, free fallback).
  //
  // Deterministic + non-vacuous: fake timers fire `AbortSignal.timeout`
  // EXACTLY at the budget; the fetch mock is abort-aware (rejects with a
  // DOMException named "TimeoutError" the instant its `signal` aborts —
  // byte-identical to what a real `fetch()` does under `AbortSignal.timeout`).
  // We assert getRecs resolves with the bucketed grid + the slow banner and
  // that it did NOT consume the post-Edge re-read/hydrate DB chains (the
  // Edge never wrote rows — there is nothing to re-read).
  it("slow Edge (>8s budget) → deterministic bucketed picks + 'took too long' banner, ~within budget (NOT ~90s, NOT metadataOnlyRecs)", async () => {
    vi.useFakeTimers();
    try {
      // An abort-aware fetch: never resolves on its own; rejects the moment
      // its AbortSignal fires. The signal comes from an AbortController whose
      // setTimeout is triggered by the fake clock advancing past the budget —
      // NOT AbortSignal.timeout (which is invisible to Vitest fake timers and
      // would make this test untestable; see the WHY comment in server-actions.ts).
      const slowFetch = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const sig = init?.signal;
            if (sig) {
              if (sig.aborted) {
                reject(
                  new DOMException("The operation timed out.", "TimeoutError"),
                );
                return;
              }
              sig.addEventListener(
                "abort",
                () =>
                  reject(
                    new DOMException(
                      "The operation timed out.",
                      "TimeoutError",
                    ),
                  ),
                { once: true },
              );
            }
            // Intentionally no resolve path: only the budget abort ends this.
          }),
      );
      vi.stubGlobal("fetch", slowFetch);

      // ONLY the pre-Edge DB chains are consumed on the timeout path:
      // cache (miss), vectors, negRows. The post-Edge re-read + hydrate
      // SELECTs (queueFullRun's chains 4 & 5) MUST NOT run — the Edge never
      // wrote rows. We queue exactly the pre-Edge three; if the timeout path
      // wrongly fell through to the re-read/hydrate (or to metadataOnlyRecs,
      // which issues its OWN extra SELECTs), the chainQueue would underflow
      // and throw "chainQueue empty" — making this assertion non-vacuous.
      queue([]); // 1. cache SELECT — miss
      queue([{ vectorsGeneratedAt: new Date(2000, 0, 1) }]); // 2. vectors
      queue([]); // 3. negRows

      const { getRecs } = await import("@/lib/recs/server-actions");

      const resultPromise = getRecs(FILTERS);

      // Drive the whole pipeline (all resolved-promise awaits flush as the
      // fake clock advances). At 8000ms the AbortController's setTimeout fires,
      // calling controller.abort() which triggers the fetch signal listener.
      // 7999ms: still pending (budget not yet breached).
      await vi.advanceTimersByTimeAsync(7999);
      await vi.advanceTimersByTimeAsync(2); // cross the 8000ms budget

      const result = await resultPromise;

      // Resolved with the DETERMINISTIC bucketed grid (not a hang, not the
      // hard-failure metadata path). algorithm is the deterministic
      // similarity/composite path — NOT "ai" (no AI rerank ran).
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok result");
      expect(result.algorithm).not.toBe("ai");
      expect(result.tier).toBe("full");

      // The spec's slow banner (NOT the "AI ranking unavailable" hard-
      // failure banner — that path was not taken).
      expect(result.banner).toBeDefined();
      expect(result.banner).toMatch(/took too long/i);
      expect(result.banner).not.toMatch(/AI ranking unavailable/i);

      // It's the freshly-computed stratified grid: 4..6 cards, each with the
      // full RecCard contract (slot + fitChips + confidence) — same shape
      // contract as the happy path, just sourced from `bucketed`.
      expect(result.recs.length).toBeGreaterThanOrEqual(4);
      expect(result.recs.length).toBeLessThanOrEqual(6);
      for (const r of result.recs) {
        expect(SLOTS.has(r.slot)).toBe(true);
        expect(r.fitChips).toBeDefined();
        expect(["perfect", "close", "loose"]).toContain(r.fitChips.timeFit);
        expect(Array.isArray(r.fitChips.moodMatches)).toBe(true);
        expect(typeof r.fitChips.inLibrary).toBe("boolean");
        expect(typeof r.fitChips.friendsCount).toBe("number");
        expect(["strong", "good", "worth-a-try"]).toContain(r.confidence);
        expect(typeof r.id).toBe("string");
        expect(r.id.length).toBeGreaterThan(0);
      }

      // The Edge was actually attempted (the budget wraps a REAL invocation,
      // not a short-circuit) and aborted.
      expect(slowFetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
