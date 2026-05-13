import { describe, expect, it } from "vitest";
import { cacheKey, type CacheKeyInput } from "@/lib/recs/cache";

const BASE: CacheKeyInput = {
  userId: "u-1",
  moods: ["chill"],
  time: "1h",
  platforms: ["steam"],
};

/**
 * The (user, filter) hash drives recommendation cache hits. If the hash
 * silently changes shape — sort drift, dedupe regression, undefined
 * handling — the AI re-rank Edge function runs again on what should be a
 * cache hit. That's quietly expensive (paid model calls) and invisible
 * unless someone watches the ai_calls dashboard.
 *
 * The test pins the SET SEMANTICS the function comment promises: order
 * doesn't matter, duplicates don't matter, everything else does.
 */

describe("cacheKey — set semantics on moods + platforms", () => {
  it("returns the same hash regardless of moods order", () => {
    const a = cacheKey({ ...BASE, moods: ["chill", "multi"] });
    const b = cacheKey({ ...BASE, moods: ["multi", "chill"] });
    expect(a).toBe(b);
  });

  it("returns the same hash regardless of platforms order", () => {
    const a = cacheKey({ ...BASE, platforms: ["steam", "xbox"] });
    const b = cacheKey({ ...BASE, platforms: ["xbox", "steam"] });
    expect(a).toBe(b);
  });

  it("dedupes repeated mood entries (defends against future un-validated callers)", () => {
    // The current zod filterSchema doesn't dedupe; cacheKey is the last
    // line of defense. If this regresses, `["chill","chill"]` would hash
    // differently from `["chill"]` and miss the cache.
    const a = cacheKey({ ...BASE, moods: ["chill"] });
    const b = cacheKey({ ...BASE, moods: ["chill", "chill"] });
    expect(a).toBe(b);
  });

  it("dedupes repeated platform entries", () => {
    const a = cacheKey({ ...BASE, platforms: ["steam"] });
    const b = cacheKey({ ...BASE, platforms: ["steam", "steam"] });
    expect(a).toBe(b);
  });
});

describe("cacheKey — distinct inputs produce distinct hashes", () => {
  it("differentiates by userId", () => {
    const a = cacheKey({ ...BASE, userId: "u-1" });
    const b = cacheKey({ ...BASE, userId: "u-2" });
    expect(a).not.toBe(b);
  });

  it("differentiates by time", () => {
    const a = cacheKey({ ...BASE, time: "1h" });
    const b = cacheKey({ ...BASE, time: "3h" });
    expect(a).not.toBe(b);
  });

  it("differentiates by mood content", () => {
    const a = cacheKey({ ...BASE, moods: ["chill"] });
    const b = cacheKey({ ...BASE, moods: ["intense"] });
    expect(a).not.toBe(b);
  });

  it("differentiates by platform content", () => {
    const a = cacheKey({ ...BASE, platforms: ["steam"] });
    const b = cacheKey({ ...BASE, platforms: ["xbox"] });
    expect(a).not.toBe(b);
  });
});

describe("cacheKey — shape guarantees", () => {
  it("is a 24-char hex string (96 bits sha256 prefix)", () => {
    const hash = cacheKey(BASE);
    expect(hash).toMatch(/^[0-9a-f]{24}$/);
  });

  it("handles empty mood + platform arrays without crashing", () => {
    expect(() =>
      cacheKey({ userId: "u-1", time: "1h", moods: [], platforms: [] }),
    ).not.toThrow();
  });
});
