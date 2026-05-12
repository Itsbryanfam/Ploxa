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
 * Moods + platforms are sorted before hashing so {moods: ["chill","multi"]}
 * and {moods: ["multi","chill"]} produce the same key (set semantics).
 *
 * Hash is sha256 truncated to 24 hex chars (96 bits) — collision-safe at
 * any realistic cardinality and short enough for storage.
 */
export function cacheKey(input: CacheKeyInput): string {
  const sortedMoods = [...input.moods].sort();
  const sortedPlatforms = [...input.platforms].sort();
  const canonical = JSON.stringify({
    u: input.userId,
    m: sortedMoods,
    t: input.time,
    p: sortedPlatforms,
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 24);
}
