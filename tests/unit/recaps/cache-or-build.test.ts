import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * cache-or-build.test.ts — Phase 6 T11 unit tests.
 *
 * Exercises the 6 branches of `cacheOrBuildYearly`:
 *
 *   1. Row exists + locked_at set            → return cached, no build/captions
 *   2. Row exists + current year + fresh     → return cached, no build/captions
 *   3. Row exists + past year                → return cached, no build/captions
 *   4. Row exists + current year + stale     → run buildRecap + captions, upsert
 *   5. No row + buildRecap returns ok        → run captions, INSERT row
 *   6. No row + buildRecap returns too_sparse → return as-is, NO insert
 *
 * Mocks:
 *   - `@/lib/db`            — db.execute is the only DB surface used
 *   - `@/lib/recaps/aggregate` — buildRecap
 *   - `@/lib/recaps/captions`  — generateAllCaptions
 *
 * Date semantics: `cacheOrBuildYearly` uses `new Date()` for "now" and
 * `getUTCFullYear()` for current-year detection. We use `vi.useFakeTimers`
 * to pin "now" to a known UTC instant per scenario so the `currentYear`
 * branch logic is deterministic across CI environments.
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
import { cacheOrBuildYearly } from "@/lib/recaps/cache-or-build";
import type { RecapPayload } from "@/lib/recaps/types";

const mockExecute = vi.mocked(db.execute);
const mockBuild = vi.mocked(buildRecap);
const mockCaptions = vi.mocked(generateAllCaptions);

function makeOkPayload(overrides?: Partial<RecapPayload>): RecapPayload {
  return {
    tier: "ok",
    mode: "yearly",
    windowStart: "2026-01-01T00:00:00.000Z",
    windowEnd: "2027-01-01T00:00:00.000Z",
    scenes: ["opening", "stats_total"],
    totals: {
      totalGames: 25,
      totalHoursPlayed: 200,
      completedCount: 15,
      droppedCount: 2,
      replayingCount: 1,
      reviewCount: 3,
    },
    topGames: [],
    captions: {},
    ...overrides,
  };
}

function makeSparsePayload(): RecapPayload {
  return {
    tier: "too_sparse",
    mode: "yearly",
    windowStart: "2026-01-01T00:00:00.000Z",
    windowEnd: "2027-01-01T00:00:00.000Z",
    scenes: [],
    totals: {
      totalGames: 4,
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
  // Pin "now" to mid-2026 so currentYear=2026, year=2025 is past, year=2027
  // is future (unused; pages cap year ≤ 2100 but our scope is just 2026).
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));
});

describe("cacheOrBuildYearly — cache branches (no aggregator run)", () => {
  it("returns cached payload when locked_at is set (lock takes precedence)", async () => {
    const cached = makeOkPayload({ captions: { opening: "locked caption" } });
    mockExecute.mockResolvedValueOnce([
      {
        payload: cached,
        // Stale (generated long ago) but locked → lock wins.
        locked_at: "2026-01-01T00:00:00.000Z",
        generated_at: "2026-01-01T00:00:00.000Z",
      },
    ] as never);

    const out = await cacheOrBuildYearly({ userId: "u-1", year: 2026 });

    expect(out.payload).toBe(cached);
    expect(out.lockedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(mockExecute).toHaveBeenCalledTimes(1); // SELECT only
    expect(mockBuild).not.toHaveBeenCalled();
    expect(mockCaptions).not.toHaveBeenCalled();
  });

  it("returns cached payload when current-year row was generated within the last 7 days", async () => {
    const cached = makeOkPayload({ captions: { opening: "fresh caption" } });
    // generated_at = now - 1 day → fresh
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    mockExecute.mockResolvedValueOnce([
      { payload: cached, locked_at: null, generated_at: oneDayAgo },
    ] as never);

    const out = await cacheOrBuildYearly({ userId: "u-1", year: 2026 });

    expect(out.payload).toBe(cached);
    expect(out.lockedAt).toBeNull();
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockBuild).not.toHaveBeenCalled();
    expect(mockCaptions).not.toHaveBeenCalled();
  });

  it("returns cached payload for a past year even when generated_at is ancient (past years are immutable)", async () => {
    const cached = makeOkPayload({
      windowStart: "2025-01-01T00:00:00.000Z",
      windowEnd: "2026-01-01T00:00:00.000Z",
      captions: { opening: "past year caption" },
    });
    mockExecute.mockResolvedValueOnce([
      {
        payload: cached,
        locked_at: null,
        generated_at: "2025-01-15T00:00:00.000Z",
      },
    ] as never);

    const out = await cacheOrBuildYearly({ userId: "u-1", year: 2025 });

    expect(out.payload).toBe(cached);
    expect(out.lockedAt).toBeNull();
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockBuild).not.toHaveBeenCalled();
    expect(mockCaptions).not.toHaveBeenCalled();
  });
});

describe("cacheOrBuildYearly — rebuild branches", () => {
  it("rebuilds when current-year row is older than 7 days (stale): runs aggregator + captions + UPSERT", async () => {
    const staleRow = makeOkPayload({ captions: { opening: "stale" } });
    // generated_at = 10 days ago → stale for current year
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

    const fresh = makeOkPayload({ captions: {} });
    const captions = { opening: "fresh caption" } as const;

    mockExecute
      .mockResolvedValueOnce([
        { payload: staleRow, locked_at: null, generated_at: tenDaysAgo },
      ] as never) // SELECT
      .mockResolvedValueOnce([] as never); // INSERT … ON CONFLICT … UPDATE
    mockBuild.mockResolvedValueOnce(fresh);
    mockCaptions.mockResolvedValueOnce(captions);

    const out = await cacheOrBuildYearly({ userId: "u-1", year: 2026 });

    expect(mockBuild).toHaveBeenCalledTimes(1);
    expect(mockBuild.mock.calls[0]![0]).toMatchObject({
      userId: "u-1",
      mode: "yearly",
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

  it("builds when no row exists and returns ok: runs aggregator + captions + INSERT", async () => {
    mockExecute
      .mockResolvedValueOnce([] as never) // SELECT (no row)
      .mockResolvedValueOnce([] as never); // INSERT
    const fresh = makeOkPayload();
    const captions = { opening: "first run caption" } as const;
    mockBuild.mockResolvedValueOnce(fresh);
    mockCaptions.mockResolvedValueOnce(captions);

    const out = await cacheOrBuildYearly({ userId: "u-1", year: 2026 });

    expect(mockBuild).toHaveBeenCalledTimes(1);
    expect(mockCaptions).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledTimes(2); // SELECT + INSERT
    expect(out.payload.captions).toEqual(captions);
    expect(out.lockedAt).toBeNull();
  });

  it("builds a past year when no row exists (the cache short-circuit only applies when a row is present)", async () => {
    mockExecute
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);
    const fresh = makeOkPayload({
      windowStart: "2025-01-01T00:00:00.000Z",
      windowEnd: "2026-01-01T00:00:00.000Z",
    });
    mockBuild.mockResolvedValueOnce(fresh);
    mockCaptions.mockResolvedValueOnce({ opening: "past year first run" });

    const out = await cacheOrBuildYearly({ userId: "u-1", year: 2025 });

    expect(mockBuild).toHaveBeenCalledTimes(1);
    expect(mockCaptions).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledTimes(2);
    expect(out.payload.tier).toBe("ok");
    expect(out.lockedAt).toBeNull();
  });
});

describe("cacheOrBuildYearly — too_sparse short-circuit", () => {
  it("returns too_sparse payload from buildRecap WITHOUT writing a row OR running captions", async () => {
    mockExecute.mockResolvedValueOnce([] as never); // SELECT only
    mockBuild.mockResolvedValueOnce(makeSparsePayload());

    const out = await cacheOrBuildYearly({ userId: "u-1", year: 2026 });

    expect(out.payload.tier).toBe("too_sparse");
    expect(out.lockedAt).toBeNull();
    expect(mockBuild).toHaveBeenCalledTimes(1);
    expect(mockCaptions).not.toHaveBeenCalled();
    // Only the SELECT — no INSERT was issued.
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });
});

describe("cacheOrBuildYearly — boundary semantics", () => {
  it("treats a current-year row generated EXACTLY 7 days ago as stale (strictly > sevenDaysAgo is fresh)", async () => {
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

    const out = await cacheOrBuildYearly({ userId: "u-1", year: 2026 });

    expect(mockBuild).toHaveBeenCalledTimes(1);
    expect(out.payload.captions).toEqual({ opening: "rebuilt" });
    expect(out.lockedAt).toBeNull();
  });
});
