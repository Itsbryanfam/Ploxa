import "server-only";
import {
  IGDB_GAME_MODES,
  IGDB_PLAYER_PERSPECTIVES,
  IGDB_THEMES,
  IGDB_MECHANICS,
} from "./vocabulary";

export type RawIgdbFacets = {
  game_modes: string[];
  player_perspectives: string[];
  themes: string[];
  keywords: string[];
};

export type NormalizedFacets = {
  gameModes: string[];
  playerPerspectives: string[];
  /** IGDB themes facet ONLY — caller merges with existing games.themes via set-union. */
  themes: string[];
  /** IGDB keywords filtered through hand-curated allow-list. */
  mechanics: string[];
};

const MAX_PER_FACET = 20;

/**
 * Filter an IGDB facet array through its allow-list, dedup case-insensitively
 * (keeping the canonical IGDB casing for display), cap at MAX_PER_FACET.
 */
function filterAndDedup(
  raw: string[],
  allowList: ReadonlySet<string>,
): string[] {
  // Build a lowercased-key version of the allow-list for fast lookup, with
  // the canonical-case original as the value. This lets us match input
  // case-insensitively but emit canonical case.
  const canonicalByLower = new Map<string, string>();
  // Trim both key AND canonical value so accidental whitespace in the hand-
  // curated vocabulary.ts doesn't silently drop matches and doesn't surface
  // padding into the normalized output.
  for (const v of allowList) {
    const trimmed = v.trim();
    canonicalByLower.set(trimmed.toLowerCase(), trimmed);
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of raw) {
    const key = candidate.trim().toLowerCase();
    if (!key) continue;
    const canonical = canonicalByLower.get(key);
    if (!canonical) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(canonical);
    if (out.length >= MAX_PER_FACET) break;
  }
  return out;
}

export function normalizeFacets(raw: RawIgdbFacets): NormalizedFacets {
  return {
    gameModes: filterAndDedup(raw.game_modes, IGDB_GAME_MODES),
    playerPerspectives: filterAndDedup(raw.player_perspectives, IGDB_PLAYER_PERSPECTIVES),
    themes: filterAndDedup(raw.themes, IGDB_THEMES),
    mechanics: filterAndDedup(raw.keywords, IGDB_MECHANICS),
  };
}
