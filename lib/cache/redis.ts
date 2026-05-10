import { Redis } from "@upstash/redis";

import { requireEnv } from "@/lib/env";

/**
 * Upstash Redis client — our app's cache layer.
 *
 * Phase 1: caches RAWG search responses (~24h TTL) + game details (~7d TTL).
 * Postgres `games` table remains the permanent record; Redis is a speed layer.
 *
 * Singleton across Next.js HMR in dev (matches the lib/db/index.ts pattern)
 * so we don't spin up a new client on every server-component render.
 */
declare global {
  var __redisClient: Redis | undefined;
}

function createClient(): Redis {
  return new Redis({
    url: requireEnv("UPSTASH_REDIS_REST_URL"),
    token: requireEnv("UPSTASH_REDIS_REST_TOKEN"),
  });
}

export const redis: Redis = global.__redisClient ?? createClient();

if (process.env.NODE_ENV !== "production") {
  global.__redisClient = redis;
}
