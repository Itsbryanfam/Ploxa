import "server-only";

import { env } from "@/lib/env";

/**
 * Portrait (2:3) box-art resolver. Chain:
 *
 *   1. Steam Storefront search (`/api/storesearch`) → top-ranked appid
 *      whose name is similar enough to the query, then HEAD-check the
 *      Steam CDN library art at `library_600x900_2x.jpg`. Free, no key,
 *      no documented rate limit.
 *   2. SteamGridDB autocomplete → grids/game (portrait, static only) if
 *      `SGDB_API_KEY` is set. Free key, ~1k requests/day on the free tier.
 *   3. Null. Caller falls back to RAWG `coverUrl` (landscape hero) so the
 *      poster slot is never empty.
 *
 * Pure-ish: no DB writes. Caller is responsible for persisting the result.
 * Errors at any tier fall through to the next tier rather than throw,
 * because a flaky external is not worth crashing a backfill batch over.
 */

type PosterSource = "steam" | "sgdb";

interface PosterResult {
  url: string;
  source: PosterSource;
  steamAppId?: number;
}

const STEAM_CDN = "https://cdn.cloudflare.steamstatic.com/steam/apps";
const SGDB_BASE = "https://www.steamgriddb.com/api/v2";

// 95% of mismatches go away once you strip edition tags and punctuation.
// We keep this conservative — overaggressive normalization causes false
// positives ("Halo" matching "Halo Wars" on the storesearch top result).
function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\b(game of the year|goty|definitive|complete|deluxe|gold|legendary|enhanced|remastered|anniversary|director's cut)\s*(edition)?\b/g, "")
    .replace(/[:\-–—−!?.,'"&()\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Token-set similarity 0..1. Good for handling subtitle reordering and
 * punctuation differences ("Doom Eternal" vs "DOOM: Eternal").
 */
function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeTitle(a).split(" ").filter(Boolean));
  const tb = new Set(normalizeTitle(b).split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.max(ta.size, tb.size);
}

// ─────────────────────────────────────────────────────────────
// Steam path
// ─────────────────────────────────────────────────────────────

interface StoreSearchResponse {
  total: number;
  items: Array<{ id: number; name: string; type: string }>;
}

async function steamSearchOnce(query: string, originalTitle: string): Promise<number | null> {
  const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=english&cc=us`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as StoreSearchResponse;
    // storesearch returns DLC, soundtracks, demos in the same list. Take
    // the first item that is type "app" AND whose name is similar enough
    // to the *original* title (not the possibly-stripped query).
    for (const item of data.items ?? []) {
      if (item.type !== "app") continue;
      const sim = tokenSimilarity(item.name, originalTitle);
      // 0.7 caught false positives like "Star Wars" matching "LEGO Star
      // Wars: TFA" on smoke. 0.8 keeps real matches (subtitle/punctuation
      // variants) while rejecting "Halo Wars" for "Halo".
      if (sim >= 0.8) return item.id;
    }
    return null;
  } catch {
    return null;
  }
}

async function steamSearch(title: string): Promise<number | null> {
  // First pass: raw title. Works for clean inputs.
  const direct = await steamSearchOnce(title, title);
  if (direct) return direct;

  // Second pass: normalized title. storesearch returns 0 results for noisy
  // edition suffixes like "...- Game of the Year Edition". Stripping those
  // before the search recovers them.
  const normalized = normalizeTitle(title);
  if (normalized && normalized !== title.toLowerCase().trim()) {
    return await steamSearchOnce(normalized, title);
  }
  return null;
}

async function steamCdnHasLibraryArt(appId: number): Promise<boolean> {
  const url = `${STEAM_CDN}/${appId}/library_600x900_2x.jpg`;
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

function steamLibraryUrl(appId: number): string {
  return `${STEAM_CDN}/${appId}/library_600x900_2x.jpg`;
}

// ─────────────────────────────────────────────────────────────
// SGDB path
// ─────────────────────────────────────────────────────────────

interface SgdbAutocomplete {
  success: boolean;
  data: Array<{ id: number; name: string }>;
}

interface SgdbGrids {
  success: boolean;
  data: Array<{ id: number; url: string; width: number; height: number }>;
}

async function sgdbResolve(title: string): Promise<string | null> {
  const key = env.SGDB_API_KEY;
  if (!key) return null;

  try {
    const searchRes = await fetch(
      `${SGDB_BASE}/search/autocomplete/${encodeURIComponent(title)}`,
      { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" },
    );
    if (!searchRes.ok) return null;
    const search = (await searchRes.json()) as SgdbAutocomplete;
    if (!search.success || !search.data?.length) return null;

    // Top match similar enough? SGDB's own ranking is usually good but
    // protect against junk results.
    const best = search.data.find((g) => tokenSimilarity(g.name, title) >= 0.7);
    if (!best) return null;

    // Filter: portrait (600x900) only, static (no animated). nsfw=false +
    // humor=false hide community jokes that aren't actual cover art.
    const gridsRes = await fetch(
      `${SGDB_BASE}/grids/game/${best.id}?dimensions=600x900&types=static&nsfw=false&humor=false&limit=5`,
      { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" },
    );
    if (!gridsRes.ok) return null;
    const grids = (await gridsRes.json()) as SgdbGrids;
    if (!grids.success || !grids.data?.length) return null;
    return grids.data[0].url;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

export async function resolvePoster(input: {
  title: string;
  knownSteamAppId?: number;
}): Promise<PosterResult | null> {
  // Fast path: we already know the appid (e.g., from a Steam library import).
  if (input.knownSteamAppId) {
    if (await steamCdnHasLibraryArt(input.knownSteamAppId)) {
      return {
        url: steamLibraryUrl(input.knownSteamAppId),
        source: "steam",
        steamAppId: input.knownSteamAppId,
      };
    }
  }

  // Steam path: search by title.
  const appId = await steamSearch(input.title);
  if (appId && (await steamCdnHasLibraryArt(appId))) {
    return { url: steamLibraryUrl(appId), source: "steam", steamAppId: appId };
  }

  // SGDB fallback (long tail / non-Steam titles).
  const sgdbUrl = await sgdbResolve(input.title);
  if (sgdbUrl) {
    return { url: sgdbUrl, source: "sgdb" };
  }

  return null;
}

// Exported for testing / smoke scripts only.
export const __internal = {
  normalizeTitle,
  tokenSimilarity,
  steamSearch,
  steamCdnHasLibraryArt,
  sgdbResolve,
};
