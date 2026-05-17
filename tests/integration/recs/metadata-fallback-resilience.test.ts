import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FilterParams } from "@/lib/recs/moods";

/**
 * Production incident 2026-05-15 — /play-next pinned forever on the
 * "Plotting a…" pending mascot.
 *
 * Root cause (server half): `metadataOnlyRecs` (the sparse-tier AND the
 * AI/Edge-failure FALLBACK path) ends with an UNGUARDED cache-write
 * `await db.insert(recommendations)...`. The write is a pure optimization
 * (so a later same-filter call can cache-hit). If it throws — a transient
 * DB error, a concurrent-cache-miss unique-constraint race, an FK race
 * under load — the throw propagates out of `getRecs`, and the client's
 * `loadRecs` transition has no catch, so `recsState` never updates and the
 * page hangs on the pending mascot indefinitely.
 *
 * Contract: a cache-WRITE failure must NOT deny the user recommendations
 * we already computed. `getRecs` must still resolve `{ ok: true, recs }`
 * (served uncached); the next call simply recomputes.
 *
 * Harness mirrors the proven `get-recs.test.ts` boundary mocks, trimmed to
 * the AI-failure→metadataOnlyRecs path, with `db.insert().values()`
 * rejecting to simulate the cache-write failure.
 */

vi.mock("@/lib/cache/redis", async () => {
  const { createMockRedis } = await import("../../helpers/mock-redis");
  return { redis: createMockRedis() };
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
vi.mock("@/lib/taste/server-actions", () => ({
  getFingerprint: vi.fn(async () => ({ tier: "full" as const, vectors: VECTORS })),
}));

function makeCandidates() {
  const genrePool = [
    ["rpg", "fantasy"],
    ["action", "shooter"],
    ["adventure", "exploration"],
    ["strategy", "rpg"],
    ["roguelike"],
    ["rpg", "action"],
  ];
  return genrePool.map((genres, i) => ({
    id: i + 1,
    slug: `game-${i + 1}`,
    title: `Game ${i + 1}`,
    released: new Date(2020, 0, 1),
    coverUrl: null,
    posterUrl: `https://img/${i + 1}.jpg`,
    genres,
    themes: ["fantasy"],
    mechanics: ["exploration"],
    platforms: null,
    playtimeAvgHours: 3 + i,
    similarityScore: 5 - i * 0.3,
  }));
}
vi.mock("@/lib/recs/candidate-pool", () => ({
  candidatePool: vi.fn(async () => makeCandidates()),
  // Backlog lane (play-next Backlog-bucket revival 2026-05-16): empty here —
  // this suite exercises the AI-failure → metadataOnlyRecs cache-write
  // resilience path, which doesn't depend on backlog content. Mocked → no
  // db chain (the pre-fix `libRows` SELECT it replaced was removed).
  backlogPool: vi.fn(async () => []),
}));

vi.mock("@/lib/recs/social-score", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/recs/social-score")>(
      "@/lib/recs/social-score",
    );
  return {
    ...actual,
    fetchSocialSignals: vi.fn(async () => new Map()),
  };
});

// ── DB mock: SELECT consumes a queued-rows chain; INSERT().values() rejects
//    (simulates the cache-write failure that triggered the incident). ──────
const selectQueue: unknown[][] = [];
function selectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "orderBy", "limit", "innerJoin"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (ok: (r: unknown[]) => unknown) => Promise.resolve(ok(rows));
  return chain;
}
const insertSpy = vi.fn();
vi.mock("@/lib/db", async () => {
  const schema = await vi.importActual<typeof import("@/lib/db/schema")>(
    "@/lib/db/schema",
  );
  return {
    schema,
    db: {
      select: vi.fn(() => selectChain(selectQueue.shift() ?? [])),
      update: vi.fn(() => selectChain([])),
      insert: vi.fn(() => {
        insertSpy();
        return {
          values: vi.fn(() =>
            Promise.reject(new Error("simulated cache-write failure")),
          ),
        };
      }),
    },
  };
});

const fetchMock = vi.fn(async () => ({
  ok: false,
  json: async () => ({ ok: false }),
}) as unknown as Response);

beforeEach(() => {
  selectQueue.length = 0;
  insertSpy.mockClear();
  fetchMock.mockClear();
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

describe("metadataOnlyRecs cache-write resilience (incident 2026-05-15)", () => {
  it("still returns ok+recs when the Edge fails AND the fallback cache-write throws", async () => {
    // getRecs v2 (no refinements) SELECT order before the fallback insert
    // (post Backlog-bucket revival — `libRows` removed; backlog lane mocked,
    // consumes no chain):
    //   1 cache  2 vectors  3 negRows  4 loggedGenreRows
    selectQueue.push(
      [], // cache miss
      [{ vectorsGeneratedAt: new Date(2000, 0, 1) }],
      [], // negRows
      [], // loggedGenreRows (logs ⋈ games)
    );

    const { getRecs } = await import("@/lib/recs/server-actions");

    // Must NOT reject even though db.insert(...).values() rejects.
    const result = await getRecs(FILTERS);

    expect(insertSpy).toHaveBeenCalled(); // the cache-write WAS attempted
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.algorithm).toBe("similarity");
    expect(result.recs.length).toBeGreaterThanOrEqual(1);
    // AI failed → the metadata fallback banner is surfaced.
    expect(result.banner).toMatch(/AI ranking unavailable/i);
  });
});
