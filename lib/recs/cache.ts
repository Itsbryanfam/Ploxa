import "server-only";

import { createHash } from "node:crypto";

export type CacheKeyInput = {
  userId: string;
  moods: string[];
  time: string;
  platforms: string[];
};

/**
 * Stable hash for the (user, filter) tuple.
 *
 * Moods + platforms are deduped and sorted before hashing so the key
 * has true set semantics: ["chill","multi"], ["multi","chill"], and
 * ["chill","chill","multi"] all produce the same hash. The zod
 * filterSchema caps `moods.max(2)` but doesn't dedupe, so the dedupe
 * happens here to defend the cache against a future caller that
 * bypasses validation.
 *
 * Hash is sha256 truncated to 24 hex chars (96 bits) — collision-safe at
 * any realistic cardinality and short enough for storage.
 */
export function cacheKey(input: CacheKeyInput): string {
  const sortedMoods = [...new Set(input.moods)].sort();
  const sortedPlatforms = [...new Set(input.platforms)].sort();
  const canonical = JSON.stringify({
    u: input.userId,
    m: sortedMoods,
    t: input.time,
    p: sortedPlatforms,
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 24);
}
