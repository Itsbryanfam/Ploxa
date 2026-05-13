import "server-only";
import { redis } from "@/lib/cache/redis";
import { RateLimitExceededError } from "./errors";
import type { ProviderName } from "./cost";

/** Hard cap: review-starts per user per UTC day. */
export const DAILY_REVIEW_CAP = 10;

/**
 * Per-provider daily call ceilings. Set ~10% under each provider's published
 * free-tier limit so we fall through cleanly before they 429 us. DeepSeek is
 * paid overflow — no daily cap.
 */
const PROVIDER_DAILY_CAP: Record<ProviderName, number | null> = {
  cerebras: 500,     // 1M tok/day ÷ ~1.6K tok/call ≈ 600 calls; cap at 500
  groq: 13_000,      // 14,400 RPD published; cap at 13K
  cloudflare: 3_000, // 10K Neurons/day; each call ~3 neurons; cap conservative
  deepseek: null,
};

/** Per-provider per-minute soft cap to absorb bursts. */
const PROVIDER_MINUTE_CAP: Record<ProviderName, number> = {
  cerebras: 30,
  groq: 30,
  cloudflare: 30,
  deepseek: 60,
};

const FORTY_EIGHT_HOURS_SECONDS = 60 * 60 * 48;
const TWO_MINUTES_SECONDS = 60 * 2;

function ymd(date = new Date()): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function ymdhm(date = new Date()): string {
  const iso = date.toISOString();
  return iso.slice(0, 16).replace(/[-:T]/g, "");
}

/**
 * Atomically reserve one daily slot. Returns true on success, false if cap
 * reached. Replaces the older check→later-increment pattern, which had a
 * window where concurrent bursts could each see "headroom" and overshoot
 * the cap. INCR-then-conditional-DECR is the standard Redis reservation
 * pattern; same shape as incrementUserDailyReviews below.
 */
export async function reserveProviderDaily(provider: ProviderName): Promise<boolean> {
  const cap = PROVIDER_DAILY_CAP[provider];
  if (cap === null) return true;
  const key = `ai:tier:${provider}:${ymd()}`;
  const newCount = await redis.incr(key);
  if (newCount === 1) {
    await redis.expire(key, FORTY_EIGHT_HOURS_SECONDS);
  }
  if (newCount > cap) {
    // Roll back the overflow so the counter reflects actual reservations.
    await redis.decr(key);
    return false;
  }
  return true;
}

/** Release a previously-reserved daily slot (call on provider failure). */
export async function releaseProviderDaily(provider: ProviderName): Promise<void> {
  if (PROVIDER_DAILY_CAP[provider] === null) return;
  const key = `ai:tier:${provider}:${ymd()}`;
  await redis.decr(key);
}

export async function reserveProviderMinute(provider: ProviderName): Promise<boolean> {
  const cap = PROVIDER_MINUTE_CAP[provider];
  const key = `ai:tier:${provider}:rpm:${ymdhm()}`;
  const newCount = await redis.incr(key);
  if (newCount === 1) {
    await redis.expire(key, TWO_MINUTES_SECONDS);
  }
  if (newCount > cap) {
    await redis.decr(key);
    return false;
  }
  return true;
}

export async function releaseProviderMinute(provider: ProviderName): Promise<void> {
  const key = `ai:tier:${provider}:rpm:${ymdhm()}`;
  await redis.decr(key);
}

export async function getUserDailyReviewCount(userId: string): Promise<number> {
  const key = `ai:user:${userId}:reviews:${ymd()}`;
  return (await redis.get<number>(key)) ?? 0;
}

/**
 * Increment + check the user's daily counter atomically. Throws
 * RateLimitExceededError when cap reached so server actions can surface
 * a friendly mascot message.
 */
export async function incrementUserDailyReviews(userId: string): Promise<void> {
  const key = `ai:user:${userId}:reviews:${ymd()}`;
  const newCount = await redis.incr(key);
  if (newCount === 1) {
    await redis.expire(key, FORTY_EIGHT_HOURS_SECONDS);
  }
  if (newCount > DAILY_REVIEW_CAP) {
    // Roll back the overflow increment so a retry the next day starts at 0.
    await redis.decr(key);
    throw new RateLimitExceededError("user-daily");
  }
}
