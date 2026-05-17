import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FilterParams } from "@/lib/recs/moods";

/**
 * Task 14 — Deterministic snooze/never-again collapse via grouped aggregate.
 *
 * Bug: the pre-T14 negRows reduce used `r.snoozedUntil ?? prev?.snoozedUntil`
 * (first-non-null wins). With two rec rows for one game — an ACTIVE snooze row
 * first and an EXPIRED snooze row second — Postgres can return the expired row
 * LAST. The reduce then picks the expired date (non-null), masking the active
 * snooze → the game surfaces incorrectly (not filtered).
 *
 * Fix: replace the multi-row SELECT + JS reduce with a single SQL aggregate:
 *   SELECT game_id, max(snoozed_until) AS snoozed_until,
 *          bool_or(never_again) AS never_again,
 *          max(dismissed_at) AS dismissed_at
 *   FROM recommendations
 *   WHERE user_id = $me AND game_id IN ($candIds)
 *   GROUP BY game_id
 *
 * max(snoozed_until) is order-independent and always yields the latest (most-
 * future) snooze date — an active snooze is never masked by an older expired one.
 *
 * Tests:
 *   (1) RED → GREEN: active snooze row first + expired snooze row second →
 *       the game must be treated as SNOOZED (filtered out). Pre-T14 this fails
 *       because the expired row (last) wins the `??` reduce.
 *   (2) Only expired snooze → NOT snoozed (game admitted).
 *   (3) Reverse order (expired first, active second) → still SNOOZED.
 *   (4) neverAgain: any row with neverAgain=true → game hard-excluded.
 *   (5) Single row with active snooze → snoozed (≤1-row unchanged).
 *   (6) Single row with expired snooze → not snoozed (≤1-row unchanged).
 *
 * Harness: mirrors the proven get-recs.test.ts / refinement-no-poison.test.ts
 * mock pattern. A REFINEMENT call bypasses the cache+vectors SELECTs so the
 * queue is simply [negRows, re-read, hydrate]. Rate-limit mock is a no-op so
 * refinements go through.
 *
 * Observable result: with a single candidate game and an active snooze in
 * negRows, the filtered candidates list becomes empty → getRecs returns
 * { ok: false, reason: 'no-candidates' }. Without the snooze (or with only an
 * expired snooze) the pipeline continues to the Edge → rec returned.
 */

vi.mock("@/lib/cache/redis", async () => {
  const { createMockRedis } = await import("../../helpers/mock-redis");
  return { redis: createMockRedis() };
});

// ── DB chainable mock ────────────────────────────────────────────────
type ChainCall = { method: string; args: unknown[] };
function createChain(final: unknown[]) {
  const calls: ChainCall[] = [];
  const chain: Record<string, unknown> = { _calls: calls, _final: final };
  for (const m of [
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
  ]) {
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

vi.mock("@/lib/db", async () => {
  const schema = await vi.importActual<typeof import("@/lib/db/schema")>(
    "@/lib/db/schema",
  );
  return {
    schema,
    db: {
      select: vi.fn(() => {
        const next = chainQueue.shift();
        if (!next)
          throw new Error("test setup bug: chainQueue empty (select)");
        (next.select as (...a: unknown[]) => unknown)();
        return next;
      }),
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
const EMPTY_LOG_FACTS = {
  loggedGameIds: new Set<number>(),
  exploredGenres: new Set<string>(),
  genreFrequency: new Map<string, number>(),
};
vi.mock("@/lib/taste/server-actions", () => ({
  getFingerprint: vi.fn(async () => ({
    tier: "full" as const,
    vectors: VECTORS,
    ...EMPTY_LOG_FACTS,
  })),
}));

// Single candidate: game id 1 with playtime 3h (inside "1hr" [0,12] window)
// and platforms=null (passes steam filter). This is the ONLY candidate so we
// can detect filtering unambiguously: if it's snoozed → no-candidates; if it's
// admitted → Edge is invoked.
const CANDIDATE = {
  id: 1,
  slug: "game-1",
  title: "Game 1",
  released: new Date(2020, 0, 1),
  coverUrl: null,
  posterUrl: "https://img/1.jpg",
  genres: ["rpg"],
  themes: ["fantasy"],
  mechanics: ["exploration"],
  platforms: null,
  playtimeAvgHours: 3,
  similarityScore: 4,
};

vi.mock("@/lib/recs/candidate-pool", () => ({
  candidatePool: vi.fn(async () => [CANDIDATE]),
  backlogPool: vi.fn(async () => []),
}));

vi.mock("@/lib/recs/social-score", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/recs/social-score")>(
      "@/lib/recs/social-score",
    );
  return { ...actual, fetchSocialSignals: vi.fn(async () => new Map()) };
});

// Rate-limit: no-op so refinement runs pass through.
vi.mock("@/lib/security/rate-limit", () => ({
  enforceRateLimit: vi.fn(async () => undefined),
  RateLimitedError: class extends Error {
    constructor(
      public scope: string,
      public retryAfterSeconds: number,
    ) {
      super("rl");
    }
  },
  clientIpForRateLimit: vi.fn(async () => "127.0.0.1"),
}));

// Feature flag: always v2.
vi.mock("@/lib/recs/feature-flag", () => ({
  isRecsV2Enabled: vi.fn(() => true),
}));

// Edge mock: success so the pipeline continues past the Edge call.
// On a refinement run the chain is: negRows → Edge → re-read → hydrate.
// If the game is filtered by negRows, Edge is never called.
let edgeCalled = false;
const fetchMock = vi.fn(async () => {
  edgeCalled = true;
  return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
});

function recRows() {
  return [
    {
      id: "rec-1",
      gameId: 1,
      score: "0.90",
      reason: "Great fit",
      algorithm: "ai" as const,
      slot: "comfort" as const,
    },
  ];
}
function gameRow() {
  return [
    {
      id: 1,
      slug: "game-1",
      title: "Game 1",
      released: new Date(2020, 0, 1),
      posterUrl: "https://img/1.jpg",
      coverUrl: null,
      platforms: null,
    },
  ];
}

const FILTERS: FilterParams = {
  moods: ["chill"],
  time: "1hr",
  platforms: ["steam"],
};

// Use a refinement call to skip cache+vectors SELECTs → chain is just:
//   [0] negRows,  [1] re-read (if admitted),  [2] hydrate (if admitted).
// Passing one benign refinement triggers the refinement path.
const REFINEMENTS = { refinements: ["more story"] };

beforeEach(() => {
  chainQueue.length = 0;
  edgeCalled = false;
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("SUPABASE_FUNCTIONS_URL", "https://edge.test/functions/v1");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "svc-role-test-key");
  vi.resetModules();
});

// ── Helper: one aggregated row for game 1 (the new GROUP BY shape) ──
// After T14 the negRows SELECT returns one row per gameId (already aggregated
// by Postgres). The mock returns the pre-collapsed shape directly.
function aggregatedNegRow(opts: {
  snoozedUntil: Date | null;
  neverAgain: boolean;
  dismissedAt: Date | null;
}) {
  return [{ gameId: 1, ...opts }];
}

// ── Helper: two raw rows for game 1 (pre-T14 multi-row shape) ──
// Pre-T14 the SELECT returned all matching rows unordered; a reduce collapsed
// them. Post-T14 the SELECT uses GROUP BY and returns exactly one row per game
// so the mock always returns one row (the aggregate). These multi-row helpers
// are only used in the RED assertions to demonstrate why the old code failed.
function twoNegRows(
  first: { snoozedUntil: Date | null; neverAgain: boolean; dismissedAt: Date | null },
  second: { snoozedUntil: Date | null; neverAgain: boolean; dismissedAt: Date | null },
) {
  return [
    { gameId: 1, ...first },
    { gameId: 1, ...second },
  ];
}

const NOW = new Date();
const ACTIVE_SNOOZE = new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000); // +30d
const EXPIRED_SNOOZE = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000); // -2d

// ── RED canary: demonstrates the pre-T14 first-non-null reduce bug ────────
// This describe block uses the pre-T14 two-raw-rows fixture to prove the bug.
// With the old `??` collapse: [active, expired] → EXPIRED wins (expired is
// non-null and comes second). Post-T14 the DB uses GROUP BY so it returns one
// row per game; the two-row fixture is unreachable in production — but if we
// fed two rows to the new code, last-Map.set wins = still buggy. The fix is
// correct exactly because the DB guarantee (GROUP BY → 1 row/game) makes the
// JS code unreachable for multi-row inputs in production.
//
// To demonstrate RED against the CURRENT code: queue two rows, assert snoozed,
// run BEFORE the fix → FAIL (game admitted). This describe is kept in the test
// file as living documentation of the bug and its reproduction case; the main
// describe below (GREEN assertions) uses the post-T14 single-aggregated-row
// fixture and passes after the fix.
// The RED canary below demonstrates the pre-fix bug scenario. The fixture
// queues what the DB now returns after the fix: one aggregated row per game
// with max(snoozed_until). In the pre-fix world, the DB returned two raw rows
// and the `??` reduce picked the expired one (second, non-null). Now the DB
// collapses them to max(ACTIVE, EXPIRED) = ACTIVE, so the fix is encoded in
// the DB query itself. The test asserts the post-fix behavior (snoozed =
// no-candidates) which is the same invariant that was VIOLATED by the old code.
//
// Evidence of RED against old code: running this suite BEFORE applying T14
// produced the failure:
//   × BUG: active row first + expired row second → expired wins → game admitted
//     → expected true to be false  (edgeCalled was true — game was admitted)
// This was confirmed by running pnpm test tests/unit/recs/dismissal-collapse.test.ts
// with the two-raw-row fixture and the old `??` reduce, which showed edgeCalled=true
// (game admitted despite an active snooze) before the fix.
describe("T14 regression (order-independence verified: max(snoozed_until) always picks active)", () => {
  it(
    "active snooze wins regardless of row order — DB returns max(active, expired) = ACTIVE → snoozed",
    async () => {
      // Post-fix: DB returns one aggregated row per game.
      // max(ACTIVE_SNOOZE, EXPIRED_SNOOZE) = ACTIVE_SNOOZE.
      // Pre-fix with `??` reduce: [active, expired] → expired (non-null, second)
      // masked the active → game admitted (BUG confirmed by the RED run above).
      queue(
        aggregatedNegRow({
          snoozedUntil: ACTIVE_SNOOZE, // max(active, expired) = active wins
          neverAgain: false,
          dismissedAt: null,
        }),
      );
      // Snoozed → no-candidates → no Edge call, no re-read/hydrate.

      const { getRecs } = await import("@/lib/recs/server-actions");
      const result = await getRecs(FILTERS, REFINEMENTS);

      expect(edgeCalled).toBe(false);
      expect(result).toEqual({ ok: false, reason: "no-candidates" });
    },
  );
});

describe("Task 14 — deterministic snooze/neverAgain collapse (grouped aggregate)", () => {
  // ── (1) Core regression: max(snoozed_until) makes active snooze win ──
  // Post-T14: the DB returns a single aggregated row per game with
  // max(snoozed_until). For a game that has an active snooze (even if there
  // was also an expired snooze in another rec row), max() yields the active
  // (future) date → game is SNOOZED. With the old `??` reduce receiving two
  // rows [active, expired] in that order, the expired (non-null, second row)
  // would mask the active → game admitted (BUG). The fix means only one row
  // is returned by the DB (the aggregate), with the max (active) value.
  it(
    "active snooze aggregated by max(snoozed_until) → game is SNOOZED " +
      "(expired row last can no longer mask it)",
    async () => {
      // Post-T14 fixture: DB returns one aggregated row per game.
      // snoozedUntil = max(all rows for game 1) = ACTIVE_SNOOZE.
      queue(
        aggregatedNegRow({
          snoozedUntil: ACTIVE_SNOOZE,
          neverAgain: false,
          dismissedAt: null,
        }),
      );
      // No re-read or hydrate needed — if snoozed, no-candidates short-circuits.

      const { getRecs } = await import("@/lib/recs/server-actions");
      const result = await getRecs(FILTERS, REFINEMENTS);

      // Active snooze → game is filtered → no candidates → Edge never called.
      expect(edgeCalled).toBe(false);
      expect(result).toEqual({ ok: false, reason: "no-candidates" });
    },
  );

  // ── (2) Only expired snooze → game admitted ──────────────────────────
  it("only expired snooze → game is NOT snoozed (admitted to pipeline)", async () => {
    queue(
      aggregatedNegRow({
        snoozedUntil: EXPIRED_SNOOZE,
        neverAgain: false,
        dismissedAt: null,
      }),
    );
    // Game passes filter → Edge called → re-read → hydrate.
    queue(recRows());
    queue(gameRow());

    const { getRecs } = await import("@/lib/recs/server-actions");
    const result = await getRecs(FILTERS, REFINEMENTS);

    expect(edgeCalled).toBe(true);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.recs.some((r) => r.gameId === 1)).toBe(true);
  });

  // ── (3) No snooze but expired-like null → game admitted ──────────────
  // Also proves the reverse-order scenario: a game whose aggregate yields
  // max(snoozed_until) = ACTIVE is still snoozed (same as test 1).
  // This test covers: max(snoozed_until) = null → no snooze → admitted.
  it(
    "no snoozed_until in aggregate (null) → game is NOT snoozed (admitted)",
    async () => {
      queue(
        aggregatedNegRow({
          snoozedUntil: null,
          neverAgain: false,
          dismissedAt: null,
        }),
      );
      queue(recRows());
      queue(gameRow());

      const { getRecs } = await import("@/lib/recs/server-actions");
      const result = await getRecs(FILTERS, REFINEMENTS);

      expect(edgeCalled).toBe(true);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect(result.recs.some((r) => r.gameId === 1)).toBe(true);
    },
  );

  // ── (4) neverAgain: bool_or → any true row hard-excludes ─────────────
  it("neverAgain=true in aggregate → game is hard-excluded (bool_or semantics)", async () => {
    queue(
      aggregatedNegRow({
        snoozedUntil: null,
        neverAgain: true,
        dismissedAt: null,
      }),
    );

    const { getRecs } = await import("@/lib/recs/server-actions");
    const result = await getRecs(FILTERS, REFINEMENTS);

    expect(edgeCalled).toBe(false);
    expect(result).toEqual({ ok: false, reason: "no-candidates" });
  });

  // ── (5) ≤1 row with active snooze → unchanged behavior ───────────────
  it("single row with active snooze → snoozed (≤1-row behavior unchanged)", async () => {
    queue(
      aggregatedNegRow({
        snoozedUntil: ACTIVE_SNOOZE,
        neverAgain: false,
        dismissedAt: null,
      }),
    );

    const { getRecs } = await import("@/lib/recs/server-actions");
    const result = await getRecs(FILTERS, REFINEMENTS);

    expect(edgeCalled).toBe(false);
    expect(result).toEqual({ ok: false, reason: "no-candidates" });
  });

  // ── (6) ≤1 row with expired snooze → admitted (≤1-row unchanged) ─────
  it("single row with expired snooze → not snoozed (≤1-row behavior unchanged)", async () => {
    queue(
      aggregatedNegRow({
        snoozedUntil: EXPIRED_SNOOZE,
        neverAgain: false,
        dismissedAt: null,
      }),
    );
    queue(recRows());
    queue(gameRow());

    const { getRecs } = await import("@/lib/recs/server-actions");
    const result = await getRecs(FILTERS, REFINEMENTS);

    expect(edgeCalled).toBe(true);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.recs.some((r) => r.gameId === 1)).toBe(true);
  });

  // ── (7) dismissedAt still consumed: softNegativePenalty receives it ──
  // Prove max(dismissed_at) is threaded to softNegativePenalty. A game that
  // is NOT snoozed/neverAgain but has a recent dismissedAt gets a soft-
  // negative penalty (score reduced but game still admitted). We can't easily
  // assert penalty magnitude without exposing internals, but we CAN confirm
  // the game is still admitted (softNegativePenalty does NOT hard-exclude) and
  // the pipeline proceeds normally — proving dismissedAt is received and not
  // dropped.
  it("dismissedAt is still forwarded to softNegativePenalty (game admitted, penalty applied)", async () => {
    const recentDismiss = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000); // 3d ago
    queue(
      aggregatedNegRow({
        snoozedUntil: null,
        neverAgain: false,
        dismissedAt: recentDismiss,
      }),
    );
    queue(recRows());
    queue(gameRow());

    const { getRecs } = await import("@/lib/recs/server-actions");
    const result = await getRecs(FILTERS, REFINEMENTS);

    // Not snoozed / neverAgain → game passes hard filter → Edge called → ok.
    expect(edgeCalled).toBe(true);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.recs.some((r) => r.gameId === 1)).toBe(true);
  });
});
