import "server-only";
import { headers } from "next/headers";
import { redis } from "@/lib/cache/redis";

/**
 * Thrown when a request exceeds the configured rate. Callers that surface
 * to users should catch and translate to a user-friendly message —
 * server actions can return `{ error: 'Too many requests' }`; route
 * handlers can return a 429 with `Retry-After`.
 */
export class RateLimitedError extends Error {
  constructor(public scope: string, public retryAfterSeconds: number) {
    super(`Rate limit exceeded for ${scope}; retry in ${retryAfterSeconds}s`);
    this.name = "RateLimitedError";
  }
}

interface EnforceOpts {
  /** Logical bucket name (e.g. "auth:login"). Joins with the identifier into the Redis key. */
  scope: string;
  /** Per-bucket identifier (user id, ip, email hash, etc.). */
  identifier: string;
  /** Max successful calls per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

/**
 * Fixed-window counter via Upstash `INCR` + `EXPIRE`. Same pattern used by
 * `lib/ai/rate-limit.ts` for the AI provider counters. Cheap, atomic
 * enough for the per-action throttles we need (auth signup/login, import
 * triggers, avatar upload, etc.) — not a sliding-window or token bucket.
 *
 * Throws `RateLimitedError` once the counter exceeds `limit`. The
 * overflow increment is rolled back so a steady-state at-cap caller
 * doesn't keep growing the counter forever.
 */
export async function enforceRateLimit(opts: EnforceOpts): Promise<void> {
  const key = `rl:${opts.scope}:${opts.identifier}`;
  const newCount = await redis.incr(key);
  if (newCount === 1) {
    await redis.expire(key, opts.windowSeconds);
  }
  if (newCount > opts.limit) {
    await redis.decr(key);
    const ttl = await redis.ttl(key);
    throw new RateLimitedError(opts.scope, ttl > 0 ? ttl : opts.windowSeconds);
  }
}

/**
 * Best-effort client IP, used for IP-bucketed rate limits on unauthenticated
 * endpoints. Reads Vercel/Cloudflare-style forwarded headers; falls back to
 * a constant when none is present so the limit at least caps the entire
 * unknown-IP pool (rather than letting it bypass).
 */
export async function clientIpForRateLimit(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = h.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}
