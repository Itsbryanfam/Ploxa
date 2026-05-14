// Deno mirror of lib/igdb/{client,twitch-oauth,resolver,normalize,vocabulary}.ts
// Keep semantics byte-identical-by-policy with the Node-side library.
// When this file diverges from the Node code, taste-engine + import-engine
// produce inconsistent fingerprints. See lib/igdb/* for canonical impls.
//
// AUTO-GENERATED vocabulary (IGDB_GAME_MODES / IGDB_PLAYER_PERSPECTIVES /
// IGDB_THEMES / IGDB_MECHANICS) vendored verbatim from lib/igdb/vocabulary.ts
// on 2026-05-14. If vocabulary.ts changes, update this file in sync.
import postgres from "npm:postgres@3.4.9";

type Sql = ReturnType<typeof postgres>;

// ─────────────────────────────────────────────────────────────
// Vocabulary (vendored from lib/igdb/vocabulary.ts — 2026-05-14)
// ─────────────────────────────────────────────────────────────

const IGDB_GAME_MODES: ReadonlySet<string> = new Set([
  "Single player",
  "Multiplayer",
  "Co-operative",
  "Split screen",
  "Massively Multiplayer Online (MMO)",
  "Battle Royale",
]);

const IGDB_PLAYER_PERSPECTIVES: ReadonlySet<string> = new Set([
  "First person",
  "Third person",
  "Bird view / Isometric",
  "Side view",
  "Text",
  "Auditory",
  "Virtual Reality",
]);

const IGDB_THEMES: ReadonlySet<string> = new Set([
  "Drama",
  "Non-fiction",
  "Sandbox",
  "Educational",
  "Kids",
  "Open world",
  "Warfare",
  "Party",
  "4X (explore, expand, exploit, and exterminate)",
  "Erotic",
  "Mystery",
  "Action",
  "Fantasy",
  "Science fiction",
  "Horror",
  "Thriller",
  "Survival",
  "Historical",
  "Stealth",
  "Comedy",
  "Business",
  "Romance",
]);

// Hand-curated subset of IGDB /keywords. Generated draft is the oldest
// 500 keywords (sort id asc) filtered to length <= 25 chars.
// Hand-edit to drop platform/engine names (Linux, Unity), pure genres (FPS),
// themes that overlap with IGDB_THEMES (Horror), subjective adjectives,
// and single-game proper nouns.
// Curated 2026-05-14: 498 → 151 entries.
const IGDB_MECHANICS: ReadonlySet<string> = new Set([
  // --- Simulation sub-genres ---
  "space simulation",
  "life simulation",
  "simulated reality",
  "vehicle simulation",
  "flight simulator",
  "combat flight simulator",
  "train simulator",
  "tank simulator",
  "ship simulator",
  "racing simulator",
  "truck simulator",
  "mmorts",
  "simulation",

  // --- Combat / action sub-genres ---
  "rail shooter",
  "shoot 'em up",
  "shmup",
  "first person shooter",
  "run and gun",
  "bullet hell",
  "brawler",
  "street fighting",
  "action-adventure",
  "vehicular combat",
  "space combat",
  "space shooter",
  "naval",

  // --- Strategy / tactics ---
  "grand strategy",
  "real time tactics",
  "space strategy",
  "tower defense",
  "tycoon",
  "management",
  "micromanagement",
  "diplomacy",
  "god game",

  // --- Progression / RPG systems ---
  "roguelike",
  "permadeath",
  "procedural generation",
  "leveling",
  "grinding",
  "character customization",
  "upgradable weapons",
  "turn-based",
  "real-time",
  "jrpg",
  "crpg",
  "diablo-like",
  "metroidvania",
  "role playing",

  // --- Movement mechanics ---
  "parkour",
  "side-scrolling",
  "backtracking",

  // --- Narrative / structure ---
  "story driven",
  "choose your own adventure",
  "interactive fiction",
  "graphic adventure",
  "multiple endings",
  "multiple protagonists",
  "mission based",
  "episodic",
  "level editor",

  // --- Gameplay verbs / loop ---
  "crafting",
  "farming",
  "fishing",
  "hunting",
  "cooking",
  "gardening",
  "breeding",
  "collecting",
  "trading",
  "construction",
  "resource management",
  "exploration",
  "space exploration",
  "space mining",
  "investigation",
  "heist",
  "crime solving",
  "espionage",
  "photography",
  "minigames",
  "quick-time events",

  // --- Player count / online modes ---
  "pvp",
  "competitive",
  "online co-op",
  "asymmetric gameplay",

  // --- Combat modifiers ---
  "martial arts",
  "hand-to-hand combat",
  "swordplay",
  "archery",
  "summoning support",
  "bullet time",
  "squad based",
  "party-based combat",

  // --- Physics / world systems ---
  "physics",
  "gravity",
  "destruction",
  "time manipulation",
  "time travel",
  "psychic abilities",
  "magic",
  "occult",

  // --- Tone / setting flavors ---
  "post-apocalyptic",
  "dystopian",
  "cyberpunk",
  "steampunk",
  "futuristic",
  "dark fantasy",
  "gothic",
  "neo noir",
  "noir",
  "paranormal",
  "supernatural",
  "lovecraftian",
  "psychological horror",
  "psychological thriller",
  "psychological exploration",
  "wild west",
  "medieval",
  "alternate history",
  "parallel worlds",

  // --- Technology / creature types (gameplay elements) ---
  "mech",
  "robots",
  "androids",
  "cyborg",
  "kaiju",
  "giant monsters",
  "spaceship",

  // --- Card / board game adaptations ---
  "collectible card game",
  "boardgame adaptation",
  "chess",
  "shogi",
  "poker",
  "mahjong",
  "blackjack",

  // --- Protagonist / perspective types ---
  "female protagonist",
  "animal protagonist",
  "child protagonist",

  // --- Misc structural / meta mechanics ---
  "maze",
  "labyrinth",
  "hidden object",
  "match 3",
  "street racing",
  "time limit",
  "evolution",
  "pet raising",
  "virtual pet",
  "extreme sports",
  "treasure hunt",
  "underwater",
  "guitar playing",
]);

// ─────────────────────────────────────────────────────────────
// Twitch OAuth (vendored from lib/igdb/twitch-oauth.ts)
// ─────────────────────────────────────────────────────────────
const TOKEN_KEY = "igdb_app_token";
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

class TwitchTokenUnavailableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "TwitchTokenUnavailableError";
  }
}

async function getAppAccessToken(sql: Sql): Promise<string> {
  // Cache check (postgres-js syntax instead of Drizzle).
  const rows = await sql<Array<{ value: string; expires_at: Date }>>`
    SELECT value, expires_at FROM app_secrets WHERE key = ${TOKEN_KEY} LIMIT 1
  `;
  if (rows.length > 0) {
    const expiresInMs = new Date(rows[0].expires_at).getTime() - Date.now();
    if (expiresInMs > REFRESH_MARGIN_MS) return rows[0].value;
  }

  const clientId = Deno.env.get("IGDB_CLIENT_ID");
  const clientSecret = Deno.env.get("IGDB_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new TwitchTokenUnavailableError("IGDB_CLIENT_ID / IGDB_CLIENT_SECRET not set");
  }

  const fetchToken = async (): Promise<{ access_token: string; expires_in: number }> => {
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    });
    const res = await fetch(
      `https://id.twitch.tv/oauth2/token?${params.toString()}`,
      { method: "POST" },
    );
    if (!res.ok) throw new Error(`Twitch HTTP ${res.status}`);
    return (await res.json()) as { access_token: string; expires_in: number };
  };

  let payload: { access_token: string; expires_in: number };
  try {
    payload = await fetchToken();
  } catch (firstErr) {
    // One retry — Twitch 5xx is transient.
    try {
      await new Promise((r) => setTimeout(r, 1000));
      payload = await fetchToken();
    } catch (secondErr) {
      throw new TwitchTokenUnavailableError(
        `Twitch token endpoint failed after retry: ${(secondErr as Error).message}`,
        secondErr,
      );
    }
  }

  // Bake in the safety margin: store expires_at as (now + expires_in - 300s).
  const expiresAt = new Date(Date.now() + (payload!.expires_in - 300) * 1000);
  // Concurrent refreshes are benign: Twitch issues multiple valid tokens
  // simultaneously; whichever upsert lands last wins.
  await sql`
    INSERT INTO app_secrets (key, value, expires_at, updated_at)
    VALUES (${TOKEN_KEY}, ${payload!.access_token}, ${expiresAt}, NOW())
    ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at, updated_at = NOW()
  `;
  return payload!.access_token;
}

// ─────────────────────────────────────────────────────────────
// IGDB client (vendored from lib/igdb/client.ts)
// ─────────────────────────────────────────────────────────────
const IGDB_BASE = "https://api.igdb.com/v4";
const MAX_ERROR_BODY_PREVIEW = 300;

class IgdbApiError extends Error {
  status: number;
  body_text: string;
  constructor(status: number, body_text: string) {
    super(`IGDB HTTP ${status}: ${body_text.slice(0, MAX_ERROR_BODY_PREVIEW)}`);
    this.name = "IgdbApiError";
    this.status = status;
    this.body_text = body_text;
  }
}

async function igdbQuery<T>(sql: Sql, endpoint: string, body: string): Promise<T> {
  const clientId = Deno.env.get("IGDB_CLIENT_ID");
  if (!clientId) throw new IgdbApiError(0, "IGDB_CLIENT_ID env var not set");
  const token = await getAppAccessToken(sql);
  const res = await fetch(`${IGDB_BASE}/${endpoint}`, {
    method: "POST",
    headers: {
      "Client-ID": clientId,
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/plain",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "<unreadable>");
    throw new IgdbApiError(res.status, text);
  }
  return (await res.json()) as T;
}

// ─────────────────────────────────────────────────────────────
// Resolver (single-game variant for the import hook)
// ─────────────────────────────────────────────────────────────

/**
 * Resolve a single Steam appid to an IGDB game id.
 * Returns null if no match found in IGDB external_games.
 */
async function resolveOneIgdbId(sql: Sql, steamAppid: number): Promise<number | null> {
  const rows = await igdbQuery<Array<{ game: number }>>(
    sql,
    "external_games",
    `fields game; where uid = "${steamAppid}" & category = 1; limit 1;`,
  );
  return rows[0]?.game ?? null;
}

// ─────────────────────────────────────────────────────────────
// Normalize (vendored from lib/igdb/normalize.ts)
// ─────────────────────────────────────────────────────────────
const MAX_PER_FACET = 20;

/**
 * Filter an IGDB facet array through its allow-list, dedup case-insensitively
 * (keeping the canonical IGDB casing for display), cap at MAX_PER_FACET.
 */
function filterAndDedup(raw: string[], allowList: ReadonlySet<string>): string[] {
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

type RawIgdbFacets = {
  game_modes: string[];
  player_perspectives: string[];
  themes: string[];
  keywords: string[];
};

type NormalizedFacets = {
  game_modes: string[];
  player_perspectives: string[];
  /** IGDB themes facet ONLY — caller merges with existing games.themes via set-union. */
  themes: string[];
  /** IGDB keywords filtered through hand-curated allow-list. */
  mechanics: string[];
};

function normalizeFacets(raw: RawIgdbFacets): NormalizedFacets {
  return {
    game_modes: filterAndDedup(raw.game_modes, IGDB_GAME_MODES),
    player_perspectives: filterAndDedup(raw.player_perspectives, IGDB_PLAYER_PERSPECTIVES),
    themes: filterAndDedup(raw.themes, IGDB_THEMES),
    mechanics: filterAndDedup(raw.keywords, IGDB_MECHANICS),
  };
}

// ─────────────────────────────────────────────────────────────
// Public API for the import hook
// ─────────────────────────────────────────────────────────────
type IgdbFacetsRow = {
  id: number;
  game_modes?: Array<{ name: string }>;
  player_perspectives?: Array<{ name: string }>;
  themes?: Array<{ name: string }>;
  keywords?: Array<{ name: string }>;
};

/**
 * Per-import IGDB enrichment. Best-effort: failures are swallowed so the
 * import still completes. Backfill (scripts/backfill-igdb.ts) catches any
 * games this misses.
 *
 * Adds ~600ms per Steam game during import (resolution + facets + UPDATE).
 * Only called for Steam imports — Xbox titleIds are not Steam appids.
 */
export async function enrichWithIgdb(
  sql: Sql,
  gameId: number,
  steamAppid: number,
): Promise<void> {
  try {
    const igdbId = await resolveOneIgdbId(sql, steamAppid);
    if (!igdbId) {
      // Mark resolved-but-empty so AI fallback picks it up later.
      await sql`
        UPDATE games SET steam_appid = ${steamAppid}, igdb_resolved_at = NOW(), igdb_id = NULL
        WHERE id = ${gameId}
      `;
      return;
    }

    const facetRows = await igdbQuery<IgdbFacetsRow[]>(
      sql,
      "games",
      `fields id, game_modes.name, player_perspectives.name, themes.name, keywords.name; where id = ${igdbId}; limit 1;`,
    );

    if (facetRows.length === 0) {
      // Resolved to a stale id — still mark for AI fallback.
      await sql`
        UPDATE games SET steam_appid = ${steamAppid}, igdb_id = ${igdbId}, igdb_resolved_at = NOW()
        WHERE id = ${gameId}
      `;
      return;
    }

    const f = facetRows[0];
    const normalized = normalizeFacets({
      game_modes: f.game_modes?.map((m) => m.name) ?? [],
      player_perspectives: f.player_perspectives?.map((p) => p.name) ?? [],
      themes: f.themes?.map((t) => t.name) ?? [],
      keywords: f.keywords?.map((k) => k.name) ?? [],
    });

    // Set-union merge of existing themes column with normalized.themes
    const existing = await sql<Array<{ themes: string[] | null }>>`
      SELECT themes FROM games WHERE id = ${gameId} LIMIT 1
    `;
    const existingThemes = existing[0]?.themes ?? [];
    const themesLower = new Set(existingThemes.map((t) => t.toLowerCase()));
    const mergedThemes = [...existingThemes];
    for (const t of normalized.themes) {
      if (!themesLower.has(t.toLowerCase())) {
        mergedThemes.push(t);
        themesLower.add(t.toLowerCase());
      }
    }

    await sql`
      UPDATE games SET
        steam_appid = ${steamAppid},
        igdb_id = ${igdbId},
        igdb_resolved_at = NOW(),
        game_modes = ${normalized.game_modes},
        player_perspectives = ${normalized.player_perspectives},
        themes = ${mergedThemes},
        mechanics = ${normalized.mechanics}
      WHERE id = ${gameId}
    `;
  } catch (err) {
    // Failures swallowed — game still lands in catalog; backfill catches it.
    console.error(
      `enrichWithIgdb failed for gameId=${gameId} steamAppid=${steamAppid}:`,
      (err as Error).message,
    );
  }
}
