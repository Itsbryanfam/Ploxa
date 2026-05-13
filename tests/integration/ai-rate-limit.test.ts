import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MockRedis } from "../helpers/mock-redis";

// Replace the live Upstash client with an in-memory mock. The async
// factory lets us dynamically import the helper without hitting
// vi.hoisted's "factory runs before imports" trap. Tests reach the
// same instance via `import { redis }` below.
vi.mock("@/lib/cache/redis", async () => {
  const { createMockRedis } = await import("../helpers/mock-redis");
  return { redis: createMockRedis() };
});

// Imports — must come AFTER vi.mock at the top of the file. The
// `redis` cast gives us back the test-helper surface (clear, inspect)
// even though the production type is the @upstash/redis client.
const { redis } = await import("@/lib/cache/redis");
const mockRedis = redis as unknown as MockRedis;

const {
  reserveProviderDaily,
  reserveProviderMinute,
  releaseProviderDaily,
  releaseProviderMinute,
  incrementUserDailyReviews,
  DAILY_REVIEW_CAP,
} = await import("@/lib/ai/rate-limit");
const { RateLimitExceededError } = await import("@/lib/ai/errors");

// Caps live in lib/ai/rate-limit.ts. Mirroring them here so a future bump
// trips this test if the test author forgets to update both — keeps the
// caps from silently drifting away from what production enforces.
const EXPECTED_CAPS = {
  daily: { cerebras: 500, groq: 13_000, cloudflare: 3_000, deepseek: null },
  minute: { cerebras: 30, groq: 30, cloudflare: 30, deepseek: 60 },
} as const;

beforeEach(() => {
  mockRedis.clear();
});

describe("reserveProviderDaily — atomic INCR-then-conditional-DECR (audit #14)", () => {
  it("admits requests up to the cap", async () => {
    const cap = EXPECTED_CAPS.daily.cerebras;
    for (let i = 0; i < cap; i++) {
      expect(await reserveProviderDaily("cerebras")).toBe(true);
    }
  });

  it("rejects the (cap + 1)th reservation", async () => {
    const cap = EXPECTED_CAPS.daily.cerebras;
    for (let i = 0; i < cap; i++) {
      await reserveProviderDaily("cerebras");
    }
    expect(await reserveProviderDaily("cerebras")).toBe(false);
  });

  it("rolls back the overflow increment so the counter reflects reservations", async () => {
    const cap = EXPECTED_CAPS.daily.cerebras;
    for (let i = 0; i < cap; i++) {
      await reserveProviderDaily("cerebras");
    }
    // First over-cap attempt: rejected; compensating DECR fires.
    await reserveProviderDaily("cerebras");
    // Counter is back at `cap`, so the next attempt also rejects (rather
    // than at cap+1 admitting via post-decrement headroom).
    expect(await reserveProviderDaily("cerebras")).toBe(false);
  });

  it("returns true for providers with no daily cap (deepseek)", async () => {
    // DeepSeek is paid overflow — cap=null means always admit.
    for (let i = 0; i < 1000; i++) {
      expect(await reserveProviderDaily("deepseek")).toBe(true);
    }
  });

  it("survives concurrent bursts without admitting more than the cap", async () => {
    // The original bug (audit #14) was: check + increment as separate
    // calls. Under Promise.all, every call saw "headroom" and incremented,
    // overshooting the cap. The fix uses INCR's atomic return value.
    const cap = EXPECTED_CAPS.daily.cerebras;
    const requests = Array.from({ length: cap + 50 }, () =>
      reserveProviderDaily("cerebras"),
    );
    const results = await Promise.all(requests);
    const admitted = results.filter(Boolean).length;
    expect(admitted).toBe(cap);
  });
});

describe("releaseProviderDaily — failed-call rollback", () => {
  it("frees a slot for a subsequent reservation", async () => {
    const cap = EXPECTED_CAPS.daily.cerebras;
    for (let i = 0; i < cap; i++) {
      await reserveProviderDaily("cerebras");
    }
    expect(await reserveProviderDaily("cerebras")).toBe(false);
    await releaseProviderDaily("cerebras");
    expect(await reserveProviderDaily("cerebras")).toBe(true);
  });

  it("is a no-op for providers with no daily cap (deepseek)", async () => {
    // releaseProviderDaily early-returns when cap is null, so the underlying
    // counter never gets a stray DECR.
    await releaseProviderDaily("deepseek");
    // Issuing a fresh reservation should still admit normally.
    expect(await reserveProviderDaily("deepseek")).toBe(true);
  });
});

describe("reserveProviderMinute — same atomic shape, different cap", () => {
  it("caps at the minute limit", async () => {
    const cap = EXPECTED_CAPS.minute.cerebras;
    for (let i = 0; i < cap; i++) {
      expect(await reserveProviderMinute("cerebras")).toBe(true);
    }
    expect(await reserveProviderMinute("cerebras")).toBe(false);
  });

  it("releaseProviderMinute frees a slot", async () => {
    const cap = EXPECTED_CAPS.minute.cerebras;
    for (let i = 0; i < cap; i++) {
      await reserveProviderMinute("cerebras");
    }
    await releaseProviderMinute("cerebras");
    expect(await reserveProviderMinute("cerebras")).toBe(true);
  });
});

describe("incrementUserDailyReviews — user-facing cap", () => {
  const USER = "user-123";

  it("admits the first DAILY_REVIEW_CAP increments without throwing", async () => {
    for (let i = 0; i < DAILY_REVIEW_CAP; i++) {
      await expect(incrementUserDailyReviews(USER)).resolves.toBeUndefined();
    }
  });

  it("throws RateLimitExceededError on the (cap + 1)th increment", async () => {
    for (let i = 0; i < DAILY_REVIEW_CAP; i++) {
      await incrementUserDailyReviews(USER);
    }
    await expect(incrementUserDailyReviews(USER)).rejects.toBeInstanceOf(
      RateLimitExceededError,
    );
  });

  it("isolates counts per user", async () => {
    for (let i = 0; i < DAILY_REVIEW_CAP; i++) {
      await incrementUserDailyReviews("user-a");
    }
    // user-b should be completely unaffected.
    await expect(incrementUserDailyReviews("user-b")).resolves.toBeUndefined();
  });

  it("rolls back the overflow so a same-day retry sees the cap (no compounding overflow)", async () => {
    for (let i = 0; i < DAILY_REVIEW_CAP; i++) {
      await incrementUserDailyReviews(USER);
    }
    // Two consecutive over-cap attempts should both surface as the cap
    // error, not e.g. "DAILY_REVIEW_CAP + 1" then "DAILY_REVIEW_CAP + 2".
    await expect(incrementUserDailyReviews(USER)).rejects.toBeInstanceOf(
      RateLimitExceededError,
    );
    await expect(incrementUserDailyReviews(USER)).rejects.toBeInstanceOf(
      RateLimitExceededError,
    );
  });
});
