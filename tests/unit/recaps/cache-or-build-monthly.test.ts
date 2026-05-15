import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * cache-or-build-monthly.test.ts — Phase 6 T16 unit tests.
 *
 * Exercises the branches of `cacheOrBuildMonthly`, mirroring the structure of
 * cache-or-build.test.ts (which covers `cacheOrBuildYearly`):
 *
 *   1. Row exists + locked_at set                       → return cached, no build/captions
 *   2. Row exists + current month + fresh (≤7d)         → return cached, no build/captions
 *   3. Row exists + past month (prior month same year)  → return cached, no build/captions
 *   4. Row exists + past month (prior year)             → return cached, no build/captions
 *   5. Row exists + current month + stale (>7d)         → rebuild + UPSERT
 *   6. No row + buildRecap returns ok                   → build + captions + INSERT
 *   7. No row + buildRecap returns too_sparse           → return as-is, NO insert
 *   8. Boundary: generated_at exactly 7d ago            → treated as stale (> check, not >=)
 *
 * Mocks:
 *   - `@/lib/db`               — db.execute is the only DB surface used
 *   - `@/lib/recaps/aggregate` — buildRecap
 *   - `@/lib/recaps/captions`  — generateAllCaptions
 *
 * monthWindow is NOT mocked — it is a pure function with no side effects.
 *
 * Date semantics: `cacheOrBuildMonthly` uses `new Date()` + `getUTCFullYear()`
 * + `getUTCMonth()` for "now". We use `vi.useFakeTimers` to pin "now" to a
 * known UTC instant: 2026-06-15 → currentYear=2026, currentMonth=6 (June).
 * This makes May 2026 (monthIndex=5, same year) a past month, and June 2026
 * (monthIndex=6) the current month.
 */

vi.mock("@/lib/db", () => {
  const execute = vi.fn();
  return {
    db: { execute },
    schema: {},
  };
});

vi.mock("@/lib/recaps/aggregate", () => ({
  buildRecap: vi.fn(),
}));

vi.mock("@/lib/recaps/captions", () => ({
  generateAllCaptions: vi.fn(),
}));

import { db } from "@/lib/db";
import { buildRecap } from "@/lib/recaps/aggregate";
import { generateAllCaptions } from "@/lib/recaps/captions";
import { cacheOrBuildMonthly } from "@/lib/recaps/cache-or-build";
import type { RecapPayload } from "@/lib/recaps/types";

const mockExecute = vi.mocked(db.execute);
const mockBuild = vi.mocked(buildRecap);
const mockCaptions = vi.mocked(generateAllCaptions);

function makeOkPayload(overrides?: Partial<RecapPayload>): RecapPayload {
  return {
    tier: "ok",
    mode: "monthly",
    windowStart: "2026-06-01T00:00:00.000Z",
    windowEnd: "2026-07-01T00:00:00.000Z",
    scenes: ["opening", "stats_total"],
    totals: {
      totalGames: 10,
      totalHoursPlayed: 40,
      completedCount: 5,
      droppedCount: 1,
      replayingCount: 0,
      reviewCount: 2,
    },
    topGames: [],
    captions: {},
    ...overrides,
  };
}

function makeSparsePayload(): RecapPayload {
  return {
    tier: "too_sparse",
    mode: "monthly",
    windowStart: "2026-06-01T00:00:00.000Z",
    windowEnd: "2026-07-01T00:00:00.000Z",
    scenes: [],
    totals: {
      totalGames: 1,
      totalHoursPlayed: null,
      completedCount: 0,
      droppedCount: 0,
      replayingCount: 0,
      reviewCount: 0,
    },
    topGames: [],
    captions: {},
  };
}

beforeEach(() => {
  mockExecute.mockReset();
  mockBuild.mockReset();
  mockCaptions.mockReset();
  // Pin "now" to mid-June 2026: currentYear=2026, currentMonth=6.
  // May 2026 (monthIndex=5) is therefore a past month.
  // June 2026 (monthIndex=6) is the current month.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));
});

describe("cacheOrBuildMonthly — cache branches (no aggregator run)", () => {
  it("returns cached payload when locked_at is set (lock takes precedence)", async () => {
    const cached = makeOkPayload({ captions: { opening: "locked caption" } });
    // Stale (generated long ago) but locked → lock wins.
    mockExecute.mockResolvedValueOnce([
      {
        payload: cached,
        locked_at: "2026-01-01T00:00:00.000Z",
        generated_at: "2026-01-01T00:00:00.000Z",
      },
    ] as never);

    const out = await cacheOrBuildMonthly({
      userId: "u-1",
      year: 2026,
      monthIndex: 6,
    });

    expect(out.payload).toBe(cached);
    expect(out.lockedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(mockExecute).toHaveBeenCalledTimes(1); // SELECT only
    expect(mockBuild).not.toHaveBeenCalled();
    expect(mockCaptions).not.toHaveBeenCalled();
  });

  it("returns cached payload when current-month row was generated within the last 7 days", async () => {
    const cached = makeOkPayload({ captions: { opening: "fresh caption" } });
    // generated_at = 1 day ago → fresh for current month
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    mockExecute.mockResolvedValueOnce([
      { payload: cached, locked_at: null, generated_at: oneDayAgo },
    ] as never);

    const out = await cacheOrBuildMonthly({
      userId: "u-1",
      year: 2026,
      monthIndex: 6,
    });

    expect(out.payload).toBe(cached);
    expect(out.lockedAt).toBeNull();
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockBuild).not.toHaveBeenCalled();
    expect(mockCaptions).not.toHaveBeenCalled();
  });

  it("returns cached payload for a past month in the same year (May 2026 is past in mid-June 2026)", async () => {
    const cached = makeOkPayload({
      windowStart: "2026-05-01T00:00:00.000Z",
      windowEnd: "2026-06-01T00:00:00.000Z",
      captions: { opening: "past month caption" },
    });
    mockExecute.mockResolvedValueOnce([
      {
        payload: cached,
        locked_at: null,
        generated_at: "2026-05-15T00:00:00.000Z",
      },
    ] as never);

    // May 2026 = past month (same year, monthIndex < currentMonth)
    const out = await cacheOrBuildMonthly({
      userId: "u-1",
      year: 2026,
      monthIndex: 5,
    });

    expect(out.payload).toBe(cached);
    expect(out.lockedAt).toBeNull();
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockBuild).not.toHaveBeenCalled();
    expect(mockCaptions).not.toHaveBeenCalled();
  });

  it("returns cached payload for a past month in a prior year (any month in 2025 is past in 2026)", async () => {
    const cached = makeOkPayload({
      windowStart: "2025-12-01T00:00:00.000Z",
      windowEnd: "2026-01-01T00:00:00.000Z",
      captions: { opening: "prior year caption" },
    });
    mockExecute.mockResolvedValueOnce([
      {
        payload: cached,
        locked_at: null,
        generated_at: "2025-12-20T00:00:00.000Z",
      },
    ] as never);

    const out = await cacheOrBuildMonthly({
      userId: "u-1",
      year: 2025,
      monthIndex: 12,
    });

    expect(out.payload).toBe(cached);
    expect(out.lockedAt).toBeNull();
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockBuild).not.toHaveBeenCalled();
    expect(mockCaptions).not.toHaveBeenCalled();
  });
});

describe("cacheOrBuildMonthly — rebuild branches", () => {
  it("rebuilds when current-month row is older than 7 days (stale): runs aggregator + captions + UPSERT", async () => {
    const staleRow = makeOkPayload({ captions: { opening: "stale" } });
    const tenDaysAgo = new Date(
      Date.now() - 10 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const fresh = makeOkPayload({ captions: {} });
    const captions = { opening: "fresh caption" } as const;

    mockExecute
      .mockResolvedValueOnce([
        { payload: staleRow, locked_at: null, generated_at: tenDaysAgo },
      ] as never) // SELECT
      .mockResolvedValueOnce([] as never); // UPSERT
    mockBuild.mockResolvedValueOnce(fresh);
    mockCaptions.mockResolvedValueOnce(captions);

    const out = await cacheOrBuildMonthly({
      userId: "u-1",
      year: 2026,
      monthIndex: 6,
    });

    expect(mockBuild).toHaveBeenCalledTimes(1);
    expect(mockBuild.mock.calls[0]![0]).toMatchObject({
      userId: "u-1",
      mode: "monthly",
    });
    expect(mockCaptions).toHaveBeenCalledTimes(1);
    expect(mockCaptions.mock.calls[0]![0]).toBe(fresh);
    expect(mockCaptions.mock.calls[0]![1]).toBe("u-1");
    // SELECT + UPSERT
    expect(mockExecute).toHaveBeenCalledTimes(2);
    expect(out.payload.captions).toEqual(captions);
    expect(out.payload.tier).toBe("ok");
    expect(out.lockedAt).toBeNull();
  });

  it("builds when no row exists and buildRecap returns ok: runs aggregator + captions + INSERT", async () => {
    mockExecute
      .mockResolvedValueOnce([] as never) // SELECT (no row)
      .mockResolvedValueOnce([] as never); // INSERT
    const fresh = makeOkPayload();
    const captions = { opening: "first run caption" } as const;
    mockBuild.mockResolvedValueOnce(fresh);
    mockCaptions.mockResolvedValueOnce(captions);

    const out = await cacheOrBuildMonthly({
      userId: "u-1",
      year: 2026,
      monthIndex: 6,
    });

    expect(mockBuild).toHaveBeenCalledTimes(1);
    expect(mockCaptions).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledTimes(2); // SELECT + INSERT
    expect(out.payload.captions).toEqual(captions);
    expect(out.payload.tier).toBe("ok");
    expect(out.lockedAt).toBeNull();
  });

  it("builds a past month when no row exists (cache short-circuit only applies when a row is present)", async () => {
    mockExecute
      .mockResolvedValueOnce([] as never) // SELECT (no row)
      .mockResolvedValueOnce([] as never); // INSERT
    const fresh = makeOkPayload({
      windowStart: "2026-05-01T00:00:00.000Z",
      windowEnd: "2026-06-01T00:00:00.000Z",
    });
    mockBuild.mockResolvedValueOnce(fresh);
    mockCaptions.mockResolvedValueOnce({ opening: "past month first run" });

    const out = await cacheOrBuildMonthly({
      userId: "u-1",
      year: 2026,
      monthIndex: 5,
    });

    expect(mockBuild).toHaveBeenCalledTimes(1);
    expect(mockCaptions).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledTimes(2);
    expect(out.payload.tier).toBe("ok");
    expect(out.lockedAt).toBeNull();
  });

  it("passes correct windowStart/windowEnd to buildRecap for June 2026 (monthIndex=6, 1-based)", async () => {
    mockExecute
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);
    const fresh = makeOkPayload();
    mockBuild.mockResolvedValueOnce(fresh);
    mockCaptions.mockResolvedValueOnce({});

    await cacheOrBuildMonthly({ userId: "u-1", year: 2026, monthIndex: 6 });

    const buildCall = mockBuild.mock.calls[0]![0];
    // June 2026 UTC: start = 2026-06-01, end = 2026-07-01
    expect((buildCall.windowStart as Date).toISOString()).toBe(
      "2026-06-01T00:00:00.000Z",
    );
    expect((buildCall.windowEnd as Date).toISOString()).toBe(
      "2026-07-01T00:00:00.000Z",
    );
    expect(buildCall.mode).toBe("monthly");
  });
});

describe("cacheOrBuildMonthly — too_sparse short-circuit", () => {
  it("returns too_sparse payload from buildRecap WITHOUT writing a row OR running captions", async () => {
    mockExecute.mockResolvedValueOnce([] as never); // SELECT only
    mockBuild.mockResolvedValueOnce(makeSparsePayload());

    const out = await cacheOrBuildMonthly({
      userId: "u-1",
      year: 2026,
      monthIndex: 6,
    });

    expect(out.payload.tier).toBe("too_sparse");
    expect(out.lockedAt).toBeNull();
    expect(mockBuild).toHaveBeenCalledTimes(1);
    expect(mockCaptions).not.toHaveBeenCalled();
    // Only the SELECT — no INSERT was issued.
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });
});

describe("cacheOrBuildMonthly — boundary semantics", () => {
  it("treats a current-month row generated EXACTLY 7 days ago as stale (strictly > sevenDaysAgo is fresh)", async () => {
    // generated_at = now - exactly 7 days. The implementation uses `>` so this
    // is NOT fresh and we should rebuild.
    const exactlySevenDaysAgo = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000,
    ).toISOString();
    mockExecute
      .mockResolvedValueOnce([
        {
          payload: makeOkPayload({ captions: { opening: "exactly 7d" } }),
          locked_at: null,
          generated_at: exactlySevenDaysAgo,
        },
      ] as never)
      .mockResolvedValueOnce([] as never);
    mockBuild.mockResolvedValueOnce(makeOkPayload());
    mockCaptions.mockResolvedValueOnce({ opening: "rebuilt" });

    const out = await cacheOrBuildMonthly({
      userId: "u-1",
      year: 2026,
      monthIndex: 6,
    });

    expect(mockBuild).toHaveBeenCalledTimes(1);
    expect(out.payload.captions).toEqual({ opening: "rebuilt" });
    expect(out.lockedAt).toBeNull();
  });

  it("treats January 2026 as a past month when current month is June 2026", async () => {
    const cached = makeOkPayload({
      windowStart: "2026-01-01T00:00:00.000Z",
      windowEnd: "2026-02-01T00:00:00.000Z",
      captions: { opening: "jan caption" },
    });
    mockExecute.mockResolvedValueOnce([
      {
        payload: cached,
        locked_at: null,
        // Ancient generated_at but past month → still cached
        generated_at: "2026-01-31T00:00:00.000Z",
      },
    ] as never);

    const out = await cacheOrBuildMonthly({
      userId: "u-1",
      year: 2026,
      monthIndex: 1,
    });

    expect(out.payload).toBe(cached);
    expect(out.lockedAt).toBeNull();
    expect(mockBuild).not.toHaveBeenCalled();
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });
});
