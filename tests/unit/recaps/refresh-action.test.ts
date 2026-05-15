/**
 * refresh-action.test.ts — Phase 6 T20.
 *
 * Unit tests for `lib/recaps/refresh-action.ts` (refreshYearly server action).
 *
 * Mock surface:
 *   - @/lib/supabase/auth-cache  — getCachedUser
 *   - @/lib/security/rate-limit — enforceRateLimit + RateLimitedError
 *   - @/lib/recaps/cache-or-build — cacheOrBuildYearly
 *   - next/cache                — revalidatePath
 *   - @/lib/db                  — db.select chain (for locked_at check)
 *
 * Mocking style matches recap-email-worker.test.ts (vi.mock hoisting,
 * dynamic import after mocks are declared).
 *
 * Time: pinned to mid-2026 so `currentYear === 2026` throughout.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────
// Module mocks — must be hoisted (vi.mock calls are hoisted by Vitest)
// ─────────────────────────────────────────────────────────────

const mockGetCachedUser = vi.fn();

vi.mock("@/lib/supabase/auth-cache", () => ({
  getCachedUser: mockGetCachedUser,
}));

// RateLimitedError must be a real Error subclass so `instanceof` works.
class MockRateLimitedError extends Error {
  constructor(
    public scope: string,
    public retryAfterSeconds: number,
  ) {
    super(`Rate limit exceeded for ${scope}`);
    this.name = "RateLimitedError";
  }
}

const mockEnforceRateLimit = vi.fn();

vi.mock("@/lib/security/rate-limit", () => ({
  enforceRateLimit: mockEnforceRateLimit,
  RateLimitedError: MockRateLimitedError,
}));

const mockCacheOrBuildYearly = vi.fn();

vi.mock("@/lib/recaps/cache-or-build", () => ({
  cacheOrBuildYearly: mockCacheOrBuildYearly,
}));

const mockRevalidatePath = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: mockRevalidatePath,
}));

// db.select().from().where().limit() chain mock
const mockLimit = vi.fn();
const mockWhere = vi.fn(() => ({ limit: mockLimit }));
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

vi.mock("@/lib/db", () => ({
  db: { select: mockSelect },
  schema: {
    yearInReviews: {
      userId: "userId_col",
      year: "year_col",
      lockedAt: "locked_at_col",
    },
  },
}));

// eq and and are used for building the where clause — mock as pass-throughs
vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
  and: (...args: unknown[]) => args,
}));

// ─────────────────────────────────────────────────────────────
// Dynamic import AFTER mocks
// ─────────────────────────────────────────────────────────────

const { refreshYearly } = await import("@/lib/recaps/refresh-action");

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

const CURRENT_YEAR = 2026; // matches vi.setSystemTime below

function makeUser(id = "user-abc") {
  return { id };
}

function makeOkPayload() {
  return {
    tier: "ok",
    mode: "yearly",
    windowStart: "2026-01-01T00:00:00.000Z",
    windowEnd: "2027-01-01T00:00:00.000Z",
    scenes: ["opening"],
    totals: { totalGames: 10, totalHoursPlayed: 50, completedCount: 5, droppedCount: 0, replayingCount: 0, reviewCount: 1 },
    topGames: [],
    captions: {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Pin "now" to mid-2026 UTC so currentYear === 2026.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));

  // Default: not locked (lockedAt = null)
  mockLimit.mockResolvedValue([{ lockedAt: null }]);
  // Default: rate limit passes
  mockEnforceRateLimit.mockResolvedValue(undefined);
  // Default: cacheOrBuildYearly succeeds
  mockCacheOrBuildYearly.mockResolvedValue({ payload: makeOkPayload(), lockedAt: null });
});

// ─────────────────────────────────────────────────────────────
// Auth guard
// ─────────────────────────────────────────────────────────────

describe("auth guard", () => {
  it("returns {ok:false} when user is not signed in", async () => {
    mockGetCachedUser.mockResolvedValue(null);

    const res = await refreshYearly({ year: CURRENT_YEAR });

    expect(res).toEqual({ ok: false, error: "Not signed in" });
    expect(mockCacheOrBuildYearly).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// Year guard
// ─────────────────────────────────────────────────────────────

describe("year guard", () => {
  it("returns {ok:false} when year is not the current year (past year)", async () => {
    mockGetCachedUser.mockResolvedValue(makeUser());

    const res = await refreshYearly({ year: 2025 });

    expect(res).toEqual({ ok: false, error: "Only the current year can be refreshed" });
    expect(mockCacheOrBuildYearly).not.toHaveBeenCalled();
  });

  it("returns {ok:false} when year is a future year", async () => {
    mockGetCachedUser.mockResolvedValue(makeUser());

    const res = await refreshYearly({ year: 2027 });

    expect(res).toEqual({ ok: false, error: "Only the current year can be refreshed" });
    expect(mockCacheOrBuildYearly).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// Locked guard
// ─────────────────────────────────────────────────────────────

describe("locked guard", () => {
  it("returns {ok:false} when the recap row is locked", async () => {
    mockGetCachedUser.mockResolvedValue(makeUser());
    // lockedAt is set → refuse
    mockLimit.mockResolvedValue([{ lockedAt: new Date("2026-01-05T00:00:00.000Z") }]);

    const res = await refreshYearly({ year: CURRENT_YEAR });

    expect(res).toEqual({
      ok: false,
      error: "This year has been finalized and cannot be refreshed",
    });
    // Rate-limit must NOT have been called (locked check is before it)
    expect(mockEnforceRateLimit).not.toHaveBeenCalled();
    expect(mockCacheOrBuildYearly).not.toHaveBeenCalled();
  });

  it("proceeds normally when no row exists (empty select result)", async () => {
    mockGetCachedUser.mockResolvedValue(makeUser());
    // No row in DB → lockedAt check resolves to [] → existing is undefined
    mockLimit.mockResolvedValue([]);

    const res = await refreshYearly({ year: CURRENT_YEAR });

    expect(res).toEqual({ ok: true });
    expect(mockCacheOrBuildYearly).toHaveBeenCalledWith(
      expect.objectContaining({ forceBuild: true }),
    );
  });
});

// ─────────────────────────────────────────────────────────────
// Rate-limit handling
// ─────────────────────────────────────────────────────────────

describe("rate-limit handling", () => {
  it("returns {ok:false} with tomorrow message when rate-limited", async () => {
    mockGetCachedUser.mockResolvedValue(makeUser());
    mockEnforceRateLimit.mockRejectedValue(new MockRateLimitedError("recap_refresh", 86000));

    const res = await refreshYearly({ year: CURRENT_YEAR });

    expect(res).toEqual({
      ok: false,
      error: "You've already refreshed today. Try again tomorrow.",
    });
    expect(mockCacheOrBuildYearly).not.toHaveBeenCalled();
  });

  it("re-throws non-RateLimitedError exceptions from enforceRateLimit", async () => {
    mockGetCachedUser.mockResolvedValue(makeUser());
    const boom = new Error("Redis connection lost");
    mockEnforceRateLimit.mockRejectedValue(boom);

    await expect(refreshYearly({ year: CURRENT_YEAR })).rejects.toThrow("Redis connection lost");
    expect(mockCacheOrBuildYearly).not.toHaveBeenCalled();
  });

  it("uses scope 'recap_refresh' for the rate-limit check", async () => {
    mockGetCachedUser.mockResolvedValue(makeUser("user-xyz"));

    await refreshYearly({ year: CURRENT_YEAR });

    expect(mockEnforceRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "recap_refresh",
        identifier: "user-xyz",
        limit: 1,
        windowSeconds: 86400,
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────
// Happy path
// ─────────────────────────────────────────────────────────────

describe("happy path", () => {
  it("calls cacheOrBuildYearly with forceBuild:true and returns {ok:true}", async () => {
    const user = makeUser("user-happy");
    mockGetCachedUser.mockResolvedValue(user);

    const res = await refreshYearly({ year: CURRENT_YEAR });

    expect(res).toEqual({ ok: true });
    expect(mockCacheOrBuildYearly).toHaveBeenCalledTimes(1);
    expect(mockCacheOrBuildYearly).toHaveBeenCalledWith({
      userId: "user-happy",
      year: CURRENT_YEAR,
      forceBuild: true,
    });
  });

  it("calls revalidatePath after successful build", async () => {
    mockGetCachedUser.mockResolvedValue(makeUser());

    await refreshYearly({ year: CURRENT_YEAR });

    expect(mockRevalidatePath).toHaveBeenCalledTimes(1);
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      "/u/[username]/year/[year]",
      "page",
    );
  });
});
