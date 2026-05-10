"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { cachedSearch, cachedGameDetail, cachedScreenshots } from "@/lib/rawg/cache";
import type { RawgGameDetail, RawgSearchItem } from "@/lib/rawg/types";

export interface SearchResult {
  rawgId: number;
  slug: string;
  title: string;
  year: number | null;
  coverUrl: string | null;
  platforms: string[];
}

const searchInput = z.object({ query: z.string().min(2).max(100) });

export async function searchGames(query: string): Promise<SearchResult[]> {
  const parsed = searchInput.safeParse({ query });
  if (!parsed.success) return [];

  const response = await cachedSearch(parsed.data.query);
  return response.results.map(toSearchResult);
}

function toSearchResult(item: RawgSearchItem): SearchResult {
  const year = item.released ? Number(item.released.slice(0, 4)) || null : null;
  const platforms = (item.parent_platforms ?? []).map((p) => p.platform.name);
  return {
    rawgId: item.id,
    slug: item.slug,
    title: item.name,
    year,
    coverUrl: item.background_image ?? null,
    platforms,
  };
}

/**
 * Fetch + cache full game detail. Returns the row from our `games` table
 * (write-through populated from RAWG if missing or stale).
 */
export async function getGameDetail(rawgId: number) {
  // Already in our DB?
  const existing = await db.query.games.findFirst({ where: eq(schema.games.id, rawgId) });
  if (existing) {
    const ageMs = Date.now() - new Date(existing.cachedAt).getTime();
    const FRESH_MS = 30 * 24 * 60 * 60 * 1000; // 30d
    if (ageMs < FRESH_MS) return existing;
  }

  // Fetch fresh from RAWG (cache layer)
  const rawg = await cachedGameDetail(rawgId);
  return await upsertGameFromRawg(rawg);
}

export async function getGameDetailBySlug(slug: string) {
  const existing = await db.query.games.findFirst({ where: eq(schema.games.slug, slug) });
  if (existing) return getGameDetail(existing.id);
  // Not in DB — search RAWG by slug
  const search = await cachedSearch(slug);
  const match = search.results.find((r) => r.slug === slug);
  if (!match) throw new Error(`Game not found: ${slug}`);
  return getGameDetail(match.id);
}

export async function getScreenshots(rawgId: number): Promise<string[]> {
  const data = await cachedScreenshots(rawgId);
  return data.results.map((r) => r.image);
}

/**
 * Insert or update the games row from a RAWG payload.
 *
 * Intentionally NOT exported. In a file with `"use server"` at the top, every
 * exported function becomes a callable server-action endpoint. Without an
 * auth/role gate, exposing `upsertGameFromRawg` would let any authenticated
 * client overwrite catalog rows by id. Public callers should use
 * `getGameDetail` instead — it owns the freshness check + upsert flow.
 */
async function upsertGameFromRawg(rawg: RawgGameDetail) {
  const row = {
    id: rawg.id,
    slug: rawg.slug,
    title: rawg.name,
    released: rawg.released ? new Date(rawg.released) : null,
    coverUrl: rawg.background_image ?? null,
    // RAWG occasionally returns "" for description_raw; coerce empty to null.
    description: rawg.description_raw || null,
    genres: rawg.genres?.map((g) => g.name) ?? [],
    // RAWG tags double as themes; cap at 20 to keep DB array sizes bounded.
    themes: rawg.tags?.slice(0, 20).map((t) => t.name) ?? [],
    mechanics: [],
    platforms: rawg.platforms?.map((p) => p.platform.name) ?? [],
    playtimeAvgHours: rawg.playtime ? String(rawg.playtime) : null,
    metacriticScore: rawg.metacritic ?? null,
    rawgRating: rawg.rating != null ? String(rawg.rating) : null,
    cachedAt: new Date(),
  };

  await db
    .insert(schema.games)
    .values(row)
    .onConflictDoUpdate({
      target: schema.games.id,
      set: {
        title: row.title,
        released: row.released,
        coverUrl: row.coverUrl,
        description: row.description,
        genres: row.genres,
        themes: row.themes,
        platforms: row.platforms,
        playtimeAvgHours: row.playtimeAvgHours,
        metacriticScore: row.metacriticScore,
        rawgRating: row.rawgRating,
        cachedAt: row.cachedAt,
      },
    });

  return (await db.query.games.findFirst({ where: eq(schema.games.id, rawg.id) }))!;
}
