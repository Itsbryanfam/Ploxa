"use server";

import { z } from "zod";
import { eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { cachedSearch, cachedGameDetail, cachedScreenshots } from "@/lib/rawg/cache";
import type { RawgGameDetail, RawgSearchItem } from "@/lib/rawg/types";
import { resolvePoster } from "@/lib/games/poster-source";

export interface SearchResult {
  rawgId: number;
  slug: string;
  title: string;
  year: number | null;
  coverUrl: string | null;
  posterUrl: string | null;
  platforms: string[];
}

const searchInput = z.object({ query: z.string().min(2).max(100) });

export async function searchGames(query: string): Promise<SearchResult[]> {
  const parsed = searchInput.safeParse({ query });
  if (!parsed.success) return [];

  const response = await cachedSearch(parsed.data.query);
  const results = response.results.map(toSearchResult);

  // Enrich with posterUrl from our local catalog where present. RAWG search
  // results don't carry portrait art; we backfilled the 5,053 most-added
  // games and resolve fresh on miss, so most palette searches will hit
  // posters here. One batched IN-list query.
  const ids = results.map((r) => r.rawgId);
  if (ids.length > 0) {
    const cached = await db
      .select({ id: schema.games.id, posterUrl: schema.games.posterUrl })
      .from(schema.games)
      .where(inArray(schema.games.id, ids));
    const map = new Map(cached.map((c) => [c.id, c.posterUrl]));
    for (const r of results) {
      r.posterUrl = map.get(r.rawgId) ?? null;
    }
  }
  return results;
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
    posterUrl: null, // filled in by searchGames() via the catalog join
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

/**
 * Backfill posterUrl for games without portrait art. Called fire-and-forget
 * from the post-import summary page so any games inserted via RAWG-on-miss
 * during the import get portrait box art shortly after, without the user
 * waiting on it during the import itself.
 *
 * Bounded to keep server-action latency reasonable. The full 5,053-game
 * catalog is covered by scripts/backfill-posters.ts (one-time); this
 * handles the long tail added by user imports.
 */
const MAX_ENRICH_PER_CALL = 200;
const ENRICH_CONCURRENCY = 8;

export async function enrichPostersForImport(): Promise<{ enriched: number; skipped: number }> {
  // Newest cachedAt first — fresh RAWG-on-miss insertions float to the top.
  const rows = (await db
    .select({ id: schema.games.id, title: schema.games.title })
    .from(schema.games)
    .where(isNull(schema.games.posterUrl))
    .orderBy(sql`${schema.games.cachedAt} DESC`)
    .limit(MAX_ENRICH_PER_CALL)) as Array<{ id: number; title: string }>;

  if (rows.length === 0) return { enriched: 0, skipped: 0 };

  let enriched = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i += ENRICH_CONCURRENCY) {
    const wave = rows.slice(i, i + ENRICH_CONCURRENCY);
    const results = await Promise.all(
      wave.map(async (row) => {
        try {
          const r = await resolvePoster({ title: row.title });
          return { row, result: r };
        } catch {
          return { row, result: null };
        }
      }),
    );
    for (const r of results) {
      if (r.result == null) {
        skipped++;
        continue;
      }
      try {
        await db
          .update(schema.games)
          .set({ posterUrl: r.result.url, posterSource: r.result.source })
          .where(eq(schema.games.id, r.row.id));
        enriched++;
      } catch {
        skipped++;
      }
    }
  }

  return { enriched, skipped };
}
