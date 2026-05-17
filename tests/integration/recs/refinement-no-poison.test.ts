import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FilterParams } from "@/lib/recs/moods";

/**
 * Refinement cache-poisoning contract (Task 2 — Codex remediation).
 *
 * Bug: a /play-next "refinement" run (free-text nudge like "less grindy")
 * sent the SAME bare base cache key to the rerank Edge function as a plain
 * unrefined run. The Edge unconditionally DELETEs + INSERTs rows under the
 * passed `cacheKey` regardless of `mode`, so a refinement run overwrote the
 * user's unrefined cached recommendation set for that filter tuple. The
 * next plain /play-next with identical filters then cache-hit on
 * refinement-shaped rows until taste vectors re-aggregated.
 *
 * Spec (docs/.../2026-05-15-play-next-redesign-design.md:317):
 *   "Refined results session-only, not persisted" AND
 *   "Save/dismiss/play actions on a refined pick still write that one rec
 *    row."
 *
 * Fix (design decision): refinement runs use a DISTINCT, deterministic
 * session cache key derived from the base key + a hash of the (sorted)
 * refinements. Per-row actions still work because the rec row exists (just
 * under the session key). The no-refinement path is BYTE-UNCHANGED — it
 * keeps using the bare base key for both the Edge payload and the cache
 * read.
 *
 * This suite uses the SAME mock harness as get-recs.test.ts (chainable
 * Drizzle query queue + mocked Edge fetch; no live DB). It asserts:
 *
 *   (a) a refinement run's Edge payload `cacheKey` is DISTINCT from the
 *       bare base `key`, and DETERMINISTIC for identical refinements (and
 *       still varies per refinement set);
 *   (b) the no-refinement run sends the bare base `key` (byte-unchanged)
 *       and its cache READ queries under that bare base key;
 *   (c) on the refinement branch the post-Edge DB re-read uses the SAME
 *       distinct session key (so refined hydration can neither read nor
 *       clobber base-key rows).
 */

// `@/lib/recs/server-actions` transitively imports `ensureLog`
// (@/lib/logs/server-actions) which pulls in @/lib/cache/redis — that
// module throws at load if UPSTASH_REDIS_* env is absent. Swap in the
// in-memory mock (same pattern as get-recs.test.ts).
vi.mock("@/lib/cache/redis", async () => {
  const { createMockRedis } = await import("../../helpers/mock-redis");
  return { redis: createMockRedis() };
});

// ── DB chainable mock ────────────────────────────────────────────────
// Drizzle chains look like:
//   db.select(cols).from(t).where(...).orderBy(...).limit(...)
//   db.update(t).set(v).where(...)
// Each method returns `this`; the chain is thenable and resolves to the
// queued `final` rows. We additionally retain every consumed chain so a
// test can inspect the recorded `.where()` args (to recover the bound
// cache_key string on the post-Edge re-read SELECT — contract (c)).
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

type Chain = ReturnType<typeof createChain>;
const chainQueue: Chain[] = [];
// Every chain a `db.select()` consumed, in consumption order — lets a test
// reach back into a specific SELECT's recorded `.where()` argument.
const consumedSelects: Chain[] = [];
// Every row batch a `db.insert(...).values(rows)` recorded, in call order.
// metadataOnlyRecs is the ONLY db.insert in server-actions.ts; it binds
// `cacheKey: <the key arg>` on every row. The sparse early-return + the
// AI-failure fallback both reach it, so the bound cacheKey here is exactly
// the key getRecs handed metadataOnlyRecs — the observable under test for
// the sparse-poison contract (mirrors how consumedSelects exposes the bound
// cache_key on the Edge re-read SELECT for contract (c)).
const consumedInsertRows: Array<Array<{ cacheKey?: unknown }>> = [];
function queue(final: unknown[]) {
  const c = createChain(final);
  chainQueue.push(c);
  return c;
}

/** Typed view of a consumed chain's recorded method calls. */
function chainCalls(c: Chain): ChainCall[] {
  return (c as { _calls: ChainCall[] })._calls;
}

/**
 * Recover every string param value bound into a composed Drizzle SQL tree
 * (e.g. the `and(eq(userId,…), eq(cacheKey,…), eq(dismissed,…))` passed to
 * `.where()`). Mirrors get-recs.test.ts's numeric `extractGameIds` walker
 * but collects STRING `.value`s — the bound `cache_key` is a string param,
 * so the key the re-read actually queried under is observable here.
 */
function extractStringParams(whereArg: unknown): string[] {
  const out: string[] = [];
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
    if (typeof v === "string") out.push(v);
    for (const k of Object.keys(o as Record<string, unknown>)) {
      walk((o as Record<string, unknown>)[k]);
    }
  };
  walk(whereArg);
  return out;
}

vi.mock("@/lib/db", async () => {
  const schema = await vi.importActual<typeof import("@/lib/db/schema")>(
    "@/lib/db/schema",
  );
  return {
    schema,
    db: {
      select: vi.fn(() => {
        const next = chainQueue.shift();
        if (!next) throw new Error("test setup bug: chainQueue empty (select)");
        (next.select as (...a: unknown[]) => unknown)();
        consumedSelects.push(next);
        return next;
      }),
      // UPDATE returns an independent no-op chain (the post-rerank slot
      // UPDATE fires ≤4 times and is only awaited, never inspected) so it
      // does NOT disturb the select queue — identical to get-recs.test.ts.
      update: vi.fn(() => {
        const c = createChain([]);
        (c.update as (...a: unknown[]) => unknown)();
        return c;
      }),
      // INSERT returns an independent no-op chain (it does NOT touch the
      // select queue — the full v2 success path never inserts via `db`; the
      // Edge writes server-side. ONLY metadataOnlyRecs (sparse + AI-failure
      // fallback) calls db.insert). `.values(rows)` records the row batch so
      // a test can recover the bound `cacheKey` — the sparse-poison
      // observable. Resolves like the real awaited insert.
      insert: vi.fn(() => {
        const chain: Record<string, unknown> = {};
        chain.values = vi.fn((rows: unknown) => {
          consumedInsertRows.push(
            rows as Array<{ cacheKey?: unknown }>,
          );
          return Promise.resolve(undefined);
        });
        return chain;
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

// Task 11: getFingerprint now also surfaces loggedGameIds / exploredGenres /
// genreFrequency from its single aggregation. EMPTY here — byte-equivalent
// to the pre-T11 fixture (the removed standalone `loggedGenreRows` SELECT
// was queued as `[]`); the cache-key contracts don't depend on lane/genre
// content. candidatePool is mocked so `loggedGameIds` is inert here.
const EMPTY_LOG_FACTS = {
  loggedGameIds: new Set<number>(),
  exploredGenres: new Set<string>(),
  genreFrequency: new Map<string, number>(),
};
// `tier` typed as the production tier union (not the `"full"` literal) so a
// per-test `.mockImplementation` can return a `"sparse"` snapshot (the
// sparse-poison contract below) without a literal-type mismatch. The DEFAULT
// runtime value is still `"full"` — no existing test's behavior changes; this
// is a type-only widening to the exact domain production's `fpReady` narrows
// to (`"sparse" | "sharpening" | "full"`).
type FpTier = "sparse" | "sharpening" | "full";
const getFingerprintMock = vi.fn(
  async (): Promise<
    { tier: FpTier; vectors: typeof VECTORS } & typeof EMPTY_LOG_FACTS
  > => ({
    tier: "full",
    vectors: VECTORS,
    ...EMPTY_LOG_FACTS,
  }),
);
vi.mock("@/lib/taste/server-actions", () => ({
  getFingerprint: getFingerprintMock,
}));

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
    playtimeAvgHours: 2 + (i % 5),
    similarityScore: 5 - i * 0.3,
  }));
}

const candidatePoolMock = vi.fn(async () => makeCandidates() as Cand[]);
// Backlog lane (play-next Backlog-bucket revival 2026-05-16). Empty by
// default so the cache-key contracts (which don't depend on lane content)
// are unaffected; mocked → consumes no db chain (the pre-fix `libRows`
// SELECT it replaced was removed from getRecs).
const backlogPoolMock = vi.fn(async () => [] as Cand[]);
vi.mock("@/lib/recs/candidate-pool", () => ({
  candidatePool: candidatePoolMock,
  backlogPool: backlogPoolMock,
}));

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

/**
 * Typed read of the captured Edge request body. Going through a function
 * (rather than touching `lastFetchBody` directly) sidesteps TS control-flow
 * narrowing: after a `lastFetchBody = null` reset followed by a
 * `getRecs(...)` call, TS can't see that `fetchMock` re-populated the
 * module-level binding and would narrow it to `null`/`never` at the read
 * site. The accessor re-widens to the real captured shape.
 */
function fetchBody(): Record<string, unknown> {
  if (lastFetchBody == null) {
    throw new Error("no Edge fetch was captured");
  }
  return lastFetchBody;
}

beforeEach(() => {
  chainQueue.length = 0;
  consumedSelects.length = 0;
  consumedInsertRows.length = 0;
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
 * → rerankOk → slot UPDATE → re-read → hydrate). Mirrors queueFullRun in
 * get-recs.test.ts exactly so this suite uses the same harness contract.
 */
function queueFullRun(opts: { refinements: boolean }) {
  if (!opts.refinements) {
    queue([]); // 1. cache SELECT (recommendations) — miss
    queue([{ vectorsGeneratedAt: new Date(2000, 0, 1) }]); // 2. vectors SELECT
  }
  queue([]); // 3. negRows SELECT (recommendations)
  // (libRows SELECT REMOVED — `libraryIds` ← mocked backlog lane, no chain.
  //  loggedGenreRows SELECT REMOVED (Task 11) — exploredGenres now from the
  //  mocked getFingerprint snapshot, no chain. The v2 chain lost two
  //  entries vs the original pre-Backlog-revival shape.)
  queue(recRows([1, 2, 3, 4, 5])); // 4. post-Edge re-read SELECT
  queue(gameRows([1, 2, 3, 4, 5])); // 5. hydrateRecs games SELECT
}

/**
 * Recompute the bare base cache key the production code derives from the
 * filter tuple. Imported from the REAL @/lib/recs/cache module (unmocked)
 * so the test pins the exact production key, not a re-derived guess.
 */
async function baseKey(filters: FilterParams): Promise<string> {
  const { cacheKey } = await import("@/lib/recs/cache");
  return cacheKey({
    userId: "u1",
    moods: filters.moods,
    time: filters.time,
    platforms: filters.platforms,
  });
}

/**
 * Recompute the production session cache key for a refinement set, using the
 * SAME real (unmocked) `cacheKey` + `sha256Hex` primitives and the EXACT
 * formula in getRecs (`${base}:r:${sha256Hex(JSON.stringify(sorted)).slice(
 * 0,8)}`). Pins the precise production session key — not a guessed shape — so
 * the sparse-poison assertion below fails pre-fix for the BEHAVIORAL reason
 * (insert bound the bare base key, expected this session key).
 */
async function sessionKey(
  filters: FilterParams,
  refinements: string[],
): Promise<string> {
  const { sha256Hex } = await import("@/lib/recs/cache");
  const base = await baseKey(filters);
  return `${base}:r:${sha256Hex(JSON.stringify([...refinements].sort())).slice(0, 8)}`;
}

/** The `cacheKey` bound on the single metadataOnlyRecs insert batch. */
function insertedCacheKey(): unknown {
  if (consumedInsertRows.length !== 1) {
    throw new Error(
      `expected exactly ONE metadataOnlyRecs insert batch, got ${consumedInsertRows.length}`,
    );
  }
  const rows = consumedInsertRows[0];
  expect(rows.length).toBeGreaterThanOrEqual(1);
  // metadataOnlyRecs binds the SAME cacheKey on every row in the batch.
  const keys = new Set(rows.map((r) => r.cacheKey));
  expect(keys.size).toBe(1);
  return rows[0].cacheKey;
}

describe("getRecs — refinement runs must not poison the unrefined base cache", () => {
  it("(b) no-refinement run sends the bare base key to the Edge AND reads the cache under it", async () => {
    queueFullRun({ refinements: false });
    const key = await baseKey(FILTERS);
    const { getRecs } = await import("@/lib/recs/server-actions");

    const result = await getRecs(FILTERS);

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Edge payload uses the bare base key — byte-unchanged contract.
    expect(fetchBody().cacheKey).toBe(key);
    expect(fetchBody().mode).toBe("full");

    // The cache READ (first consumed SELECT on the no-refinement path)
    // queried under the bare base key.
    const cacheReadWhere = chainCalls(consumedSelects[0]).find(
      (c) => c.method === "where",
    );
    expect(cacheReadWhere).toBeDefined();
    expect(extractStringParams(cacheReadWhere!.args[0])).toContain(key);
  });

  it("(a) refinement run sends a session cacheKey DISTINCT from the bare base key", async () => {
    queueFullRun({ refinements: true });
    const key = await baseKey(FILTERS);
    const { getRecs } = await import("@/lib/recs/server-actions");

    const result = await getRecs(FILTERS, { refinements: ["less grindy"] });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(typeof fetchBody().cacheKey).toBe("string");
    // The whole point: the refinement run must NOT reuse the base key.
    expect(fetchBody().cacheKey).not.toBe(key);
    // It must still be derived from the base key (session-scoped suffix),
    // so per-row actions resolve to the right user/filter family.
    expect(fetchBody().cacheKey as string).toContain(key);
    expect(fetchBody().mode).toBe("rerank-only");
  });

  it("(a) the session cacheKey is DETERMINISTIC for identical refinements and order-insensitive", async () => {
    const key = await baseKey(FILTERS);

    queueFullRun({ refinements: true });
    let mod = await import("@/lib/recs/server-actions");
    await mod.getRecs(FILTERS, { refinements: ["less grindy", "more story"] });
    const keyA = fetchBody().cacheKey as string;

    // Re-run with the SAME refinements in a DIFFERENT order — the session
    // key must be identical (sorted before hashing).
    vi.resetModules();
    lastFetchBody = null;
    queueFullRun({ refinements: true });
    mod = await import("@/lib/recs/server-actions");
    await mod.getRecs(FILTERS, { refinements: ["more story", "less grindy"] });
    const keyB = fetchBody().cacheKey as string;

    expect(keyA).toBe(keyB);
    expect(keyA).not.toBe(key);

    // A DIFFERENT refinement set must produce a DIFFERENT session key
    // (otherwise distinct refinements would collide on one cache slot).
    vi.resetModules();
    lastFetchBody = null;
    queueFullRun({ refinements: true });
    mod = await import("@/lib/recs/server-actions");
    await mod.getRecs(FILTERS, { refinements: ["harder difficulty"] });
    const keyC = fetchBody().cacheKey as string;

    expect(keyC).not.toBe(keyA);
    expect(keyC).not.toBe(key);
  });

  it("(c) refinement branch re-reads/hydrates under the SAME distinct session key (not the base key)", async () => {
    queueFullRun({ refinements: true });
    const key = await baseKey(FILTERS);
    const { getRecs } = await import("@/lib/recs/server-actions");

    const result = await getRecs(FILTERS, { refinements: ["less grindy"] });
    expect(result.ok).toBe(true);

    const sessionKey = fetchBody().cacheKey as string;
    expect(sessionKey).not.toBe(key);

    // On the refinement path the consumed SELECT order is (post Backlog-
    // bucket revival — `libRows` SELECT removed; backlog lane mocked, no
    // chain — AND post Task 11 — `loggedGenreRows` SELECT removed,
    // exploredGenres now from the mocked getFingerprint snapshot, no chain):
    //   [0] negRows,
    //   [1] post-Edge re-read (recommendations), [2] hydrateRecs games.
    // The post-Edge re-read is the LAST recommendations SELECT before the
    // games hydration SELECT. It MUST query under the session key, never
    // the bare base key — otherwise refined hydration reads/clobbers
    // base-key rows. (Index shifted 2→1 with the loggedGenreRows removal;
    // the contract — re-read binds the session key, not the base key — is
    // unchanged.)
    const reReadSelect = consumedSelects[1];
    const reReadWhere = chainCalls(reReadSelect).find(
      (c) => c.method === "where",
    );
    expect(reReadWhere).toBeDefined();
    const boundKeys = extractStringParams(reReadWhere!.args[0]);
    expect(boundKeys).toContain(sessionKey);
    expect(boundKeys).not.toContain(key);
  });

  /**
   * (d) SPARSE-TIER early-return write isolation — closes the T2 gap.
   *
   * `RefinementInput` is rendered for ALL tiers (never tier-gated in
   * `_client.tsx`), so a sparse-tier user CAN apply a refinement. The sparse
   * branch (`if (fpReady.tier === "sparse")`) returns early via
   * `metadataOnlyRecs(...)` WITHOUT any refinement-aware re-rank — it never
   * hits the Edge, but it DOES `db.insert(recommendations).values([{ ...,
   * cacheKey }])`. Pre-fix it passed the BARE BASE `key`, so a sparse +
   * refinement run wrote "similarity" rows under the unrefined base cache
   * key: the next plain same-filter /play-next would cache-hit those
   * refinement-run rows — the exact B1 poisoning mechanism Task 2 exists to
   * eliminate, reachable via the sparse path and previously untested.
   *
   * Contract (Task 2 invariant, sparse path): after a sparse + refinement
   * run, nothing is written under the bare base `key`; the write goes to the
   * session `writeKey` (= `${base}:r:<hash>`), exactly like every other
   * post-T2 refinement path. A subsequent NO-refinement sparse run still
   * writes under the bare base `key` (writeKey === key — byte-unchanged).
   *
   * On the sparse + refinement path the cache-check block (gated by
   * `refinements.length === 0`) is SKIPPED and the sparse branch returns
   * before negRows / pool selects; candidatePool is mocked and the
   * vectorMass of VECTORS (3.4) keeps `useFallback` false — so NO db.select
   * is consumed; metadataOnlyRecs performs exactly ONE db.insert.
   */
  it("(d) SPARSE tier + refinement: write goes to the session key, NEVER the bare base key (T2 gap)", async () => {
    getFingerprintMock.mockImplementation(async () => ({
      tier: "sparse" as const,
      vectors: VECTORS,
      ...EMPTY_LOG_FACTS,
    }));
    const key = await baseKey(FILTERS);
    const wKey = await sessionKey(FILTERS, ["less grindy"]);
    const { getRecs } = await import("@/lib/recs/server-actions");

    const result = await getRecs(FILTERS, { refinements: ["less grindy"] });

    expect(result.ok).toBe(true);
    // Sparse path returns BEFORE the Edge rerank — no fetch at all.
    expect(fetchMock).not.toHaveBeenCalled();

    // THE behavioral assertion: the metadataOnlyRecs insert bound the
    // session writeKey, NOT the bare base key. Pre-fix (bare `key` passed to
    // metadataOnlyRecs) this is exactly `key` → fails here for the
    // BEHAVIORAL reason (got base key, expected session key), not a symbol
    // error. `wKey` is the exact production session key (real cacheKey +
    // sha256Hex), so this also pins the precise key, not just "not base".
    const bound = insertedCacheKey();
    expect(bound).toBe(wKey);
    // Task 2's invariant, two complementary framings: (i) the write did NOT
    // land under the bare base key (no base-cache poisoning), and (ii) it
    // landed under a session-scoped key derived from the base key.
    expect(bound).not.toBe(key);
    expect(typeof bound).toBe("string");
    expect(bound as string).toMatch(new RegExp(`^${key}:r:[0-9a-f]{8}$`));
  });

  it("(d) plain SPARSE run (no refinements) still writes under the bare base key — byte-unchanged", async () => {
    getFingerprintMock.mockImplementation(async () => ({
      tier: "sparse" as const,
      vectors: VECTORS,
      ...EMPTY_LOG_FACTS,
    }));
    // No refinements ⇒ the cache-check block runs: cache SELECT (miss) +
    // vectors SELECT. Cache miss → falls through to the sparse branch →
    // metadataOnlyRecs with `writeKey === key` (bare base key).
    queue([]); // cache SELECT (recommendations) — miss
    queue([{ vectorsGeneratedAt: new Date(2000, 0, 1) }]); // vectors SELECT
    const key = await baseKey(FILTERS);
    const { getRecs } = await import("@/lib/recs/server-actions");

    const result = await getRecs(FILTERS);

    expect(result.ok).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    // The plain sparse path is byte-unchanged: still the bare base key.
    expect(insertedCacheKey()).toBe(key);
  });

  it("per-row actions stay addressable: refined picks still hydrate to rows with ids", async () => {
    // Spec: "Save/dismiss/play actions on a refined pick still write that
    // one rec row." The session-key isolation must NOT drop the rec rows —
    // hydration still returns rows whose `id` the dismiss/save/play actions
    // resolve by primary key (cache_key-independent lookups).
    queueFullRun({ refinements: true });
    const { getRecs } = await import("@/lib/recs/server-actions");

    const result = await getRecs(FILTERS, { refinements: ["less grindy"] });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.recs.length).toBeGreaterThanOrEqual(4);
    for (const r of result.recs) {
      expect(typeof r.id).toBe("string");
      expect(r.id.length).toBeGreaterThan(0);
    }
  });
});
