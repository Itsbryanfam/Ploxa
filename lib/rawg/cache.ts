import "server-only";
import { redis } from "@/lib/cache/redis";
import { rawgFetch } from "./client";
import {
  RawgSearchResponseSchema,
  RawgGameDetailSchema,
  RawgScreenshotsSchema,
  type RawgSearchResponse,
  type RawgGameDetail,
  type RawgScreenshots,
} from "./types";

const SEARCH_TTL_SECONDS = 60 * 60 * 24; // 24 hours
const DETAIL_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const SCREENSHOTS_TTL_SECONDS = 60 * 60 * 24 * 7;

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "-");

export async function cachedSearch(query: string): Promise<RawgSearchResponse> {
  const key = `rawg:search:${norm(query)}`;
  const cached = await redis.get<RawgSearchResponse>(key);
  if (cached) return cached;

  const fresh = await rawgFetch<RawgSearchResponse>({
    path: "/games",
    params: { search: query, page_size: 12 },
    schema: RawgSearchResponseSchema,
  });
  await redis.set(key, fresh, { ex: SEARCH_TTL_SECONDS });
  return fresh;
}

export async function cachedGameDetail(rawgId: number): Promise<RawgGameDetail> {
  const key = `rawg:game:${rawgId}`;
  const cached = await redis.get<RawgGameDetail>(key);
  if (cached) return cached;

  const fresh = await rawgFetch<RawgGameDetail>({
    path: `/games/${rawgId}`,
    schema: RawgGameDetailSchema,
  });
  await redis.set(key, fresh, { ex: DETAIL_TTL_SECONDS });
  return fresh;
}

export async function cachedScreenshots(rawgId: number): Promise<RawgScreenshots> {
  const key = `rawg:screenshots:${rawgId}`;
  const cached = await redis.get<RawgScreenshots>(key);
  if (cached) return cached;

  const fresh = await rawgFetch<RawgScreenshots>({
    path: `/games/${rawgId}/screenshots`,
    schema: RawgScreenshotsSchema,
  });
  await redis.set(key, fresh, { ex: SCREENSHOTS_TTL_SECONDS });
  return fresh;
}

/** Bypass + refresh helpers — for admin use or tests. */
export async function invalidateGame(rawgId: number) {
  await redis.del(`rawg:game:${rawgId}`, `rawg:screenshots:${rawgId}`);
}
