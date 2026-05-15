import { beforeEach, describe, expect, it, vi } from "vitest";

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
function queue(final: unknown[]) {
  const c = createChain(final);
  chainQueue.push(c);
  return c;
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
      // SELECT consumes the queued chain (its resolved rows matter).
      select: vi.fn(() => {
        const next = chainQueue.shift();
        if (!next) throw new Error("test setup bug: chainQueue empty (select)");
        (next.select as (...a: unknown[]) => unknown)();
        return next;
      }),
      // UPDATE returns a fresh standalone chain resolving to [] — it does
      // NOT consume the select queue. The v2 post-rerank slot UPDATE fires
      // a *variable* number of times (one per distinct bucket slot, ≤4),
      // and the orchestration only `await Promise.all(...)`s the result
      // without inspecting it, so an independent no-op chain is correct
      // and keeps the select queue aligned regardless of slot cardinality.
      update: vi.fn(() => {
        const c = createChain([]);
        (c.update as (...a: unknown[]) => unknown)();
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

const getFingerprintMock = vi.fn(async () => ({
  tier: "full" as const,
  vectors: VECTORS,
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
vi.mock("@/lib/recs/candidate-pool", () => ({
  candidatePool: candidatePoolMock,
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
  lastFetchBody = null;
  fetchMock.mockClear();
  candidatePoolMock.mockClear();
  candidatePoolMock.mockImplementation(async () => makeCandidates());
  getFingerprintMock.mockClear();
  getFingerprintMock.mockImplementation(async () => ({
    tier: "full" as const,
    vectors: VECTORS,
  }));
  fetchSocialSignalsMock.mockClear();
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
  // 4. libRows SELECT (logs) — empty library
  queue([]);
  // 5. loggedGenreRows SELECT (logs ⋈ games) — no explored genres
  queue([]);
  // (fetchSocialSignals is mocked separately — no db chain consumed)
  // (post-rerank slot UPDATEs use independent no-op chains — not queued)
  // 6. fresh re-read SELECT (recommendations)
  queue(recRows([1, 2, 3, 4, 5]));
  // 7. hydrateRecs games SELECT
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
  });

  it("returns { ok:false, reason:'no-candidates' } when the pool is empty", async () => {
    // cache miss + vectors, then candidatePool → []
    queue([]);
    queue([{ vectorsGeneratedAt: new Date(2000, 0, 1) }]);
    candidatePoolMock.mockImplementationOnce(async () => []);

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
});
