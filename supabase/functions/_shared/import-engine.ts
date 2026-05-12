// Deno runtime (Supabase Edge Functions). Imports use npm: specifiers.
// ──────────────────────────────────────────────────────────────────────────────
// VENDORED MERGE LOGIC — must stay byte-identical to lib/imports/merge.ts.
// If you change one, change both. (Edge runtime cannot import from lib/.)
// ──────────────────────────────────────────────────────────────────────────────
import postgres from "npm:postgres@3.4.9";

export interface ImportRow {
  id: string;
  user_id: string;
  platform: "steam" | "xbox" | "psn";
  status: string;
  imported_count: number;
  total_count: number;
  conflicts_jsonb: unknown[];
  unmatched_jsonb: unknown[];
  surfaced: boolean;
}

export interface ConnectionRow {
  id: string;
  user_id: string;
  platform: "steam" | "xbox" | "psn";
  external_id: string;
  access_token_encrypted: string | null;
  last_synced_at: string | null;
}

export interface ImportedGame {
  externalId: string;
  title: string;
  hoursPlayed: number | null;
  lastPlayedAt: Date | null;
  releaseYear: number | null;
}

/** Vendored merge logic. Must stay byte-identical to lib/imports/merge.ts.
 * If you change one, change both. */
export function mergeImportedGame(
  imported: ImportedGame & { gameId: number },
  existing: {
    id: string;
    platforms: string[] | null;
    platformPlayedOn: string | null;
    hoursPlayed: number | null;
  } | null,
  platform: string,
) {
  if (!existing) {
    return {
      action: "insert" as const,
      row: {
        gameId: imported.gameId,
        status: "backlog",
        platforms: [platform],
        platformPlayedOn: platform,
        hoursPlayed: imported.hoursPlayed,
      },
    };
  }

  const existingPlatforms =
    existing.platforms ??
    (existing.platformPlayedOn ? [existing.platformPlayedOn] : []);
  const mergedPlatforms = Array.from(new Set([...existingPlatforms, platform]));

  const bothNull = existing.hoursPlayed == null && imported.hoursPlayed == null;
  const mergedHours = bothNull
    ? null
    : Math.max(existing.hoursPlayed ?? 0, imported.hoursPlayed ?? 0);

  return {
    action: "update" as const,
    logId: existing.id,
    set: { platforms: mergedPlatforms, hoursPlayed: mergedHours },
    rule: "platform_merge",
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// VENDORED NORMALIZE + MATCH — mirrors lib/imports/rawg-match.ts.
// If you change one, change both.
// ──────────────────────────────────────────────────────────────────────────────
const EDITION_PATTERNS = [
  /\s*[-–:]\s*(definitive|complete|deluxe|game of the year|goty|gold|remastered|enhanced|director'?s cut|special|premium|legendary|ultimate)\s+edition$/i,
  /\s+(definitive|complete|deluxe|game of the year|goty|gold|remastered|enhanced|director'?s cut|special|premium|legendary|ultimate)\s+edition$/i,
  /\s*\(remastered\)$/i,
  /\s*\(goty\)$/i,
];

export function normalizeTitle(raw: string): string {
  let t = raw.toLowerCase().trim();
  for (const p of EDITION_PATTERNS) t = t.replace(p, "");
  return t.replace(/[\p{P}\p{S}]/gu, " ").replace(/\s+/g, " ").trim();
}

/** Looks up an existing games.id for an ImportedGame using the same algorithm
 * as lib/imports/rawg-match.ts. Implementation reads directly from Postgres. */
export async function matchToRawg(
  sql: ReturnType<typeof postgres>,
  imported: ImportedGame,
): Promise<number | null> {
  const normalized = normalizeTitle(imported.title);
  if (!normalized) return null;

  const exact =
    await sql`SELECT id FROM games WHERE lower(title) = ${normalized} LIMIT 1`;
  if (exact.length) return exact[0].id;

  const alias =
    await sql`SELECT game_id AS id FROM game_aliases WHERE lower(alias) = ${normalized} LIMIT 1`;
  if (alias.length) return alias[0].id;

  const prefix =
    await sql`SELECT id, title, released FROM games WHERE title ILIKE ${normalized + "%"} LIMIT 5`;
  if (prefix.length === 1) return prefix[0].id;

  if (imported.releaseYear && prefix.length > 1) {
    const byYear = prefix.find(
      (r) =>
        r.released &&
        new Date(r.released).getUTCFullYear() === imported.releaseYear,
    );
    if (byYear) return byYear.id;
  }

  // RAWG-on-miss fallback: local games table didn't have it; query RAWG API
  // and cache the result for next time. Pulls part of Phase 4's catalog-fill
  // work forward so first-import users see actual logs land rather than every
  // game going to unmatched_jsonb.
  const rawgApiKey = Deno.env.get("RAWG_API_KEY");
  if (!rawgApiKey || !imported.title) return null;
  return await searchRawgAndUpsert(sql, imported, rawgApiKey);
}

/** RAWG API client (vendored inline; mirrors lib/rawg/client.ts).
 *  Fetches the top search hit and upserts into the local `games` table.
 *  Returns the new games.id or null if RAWG has no match. */
async function searchRawgAndUpsert(
  sql: ReturnType<typeof postgres>,
  imported: ImportedGame,
  rawgApiKey: string,
): Promise<number | null> {
  const q = new URLSearchParams({
    key: rawgApiKey,
    search: imported.title,
    search_precise: "true",
    page_size: "5",
  });
  if (imported.releaseYear) {
    q.set(
      "dates",
      `${imported.releaseYear}-01-01,${imported.releaseYear}-12-31`,
    );
  }
  let res: Response;
  try {
    res = await fetch(`https://api.rawg.io/api/games?${q.toString()}`);
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const json = (await res.json()) as {
    results?: Array<{
      id: number;
      slug: string;
      name: string;
      released: string | null;
      background_image: string | null;
      rating: number | null;
      metacritic: number | null;
      genres?: Array<{ name: string }>;
    }>;
  };
  const candidates = json.results ?? [];
  if (!candidates.length) return null;

  // Prefer exact-year match when releaseYear known; otherwise take the top result.
  let pick = candidates[0];
  if (imported.releaseYear) {
    const yearMatch = candidates.find(
      (r) =>
        r.released &&
        new Date(r.released).getUTCFullYear() === imported.releaseYear,
    );
    if (yearMatch) pick = yearMatch;
  }

  const genres = (pick.genres ?? []).map((g) => g.name);
  await sql`
    INSERT INTO games (id, slug, title, released, cover_url, rawg_rating, metacritic_score, genres)
    VALUES (
      ${pick.id},
      ${pick.slug},
      ${pick.name},
      ${pick.released ?? null},
      ${pick.background_image ?? null},
      ${pick.rating ?? null},
      ${pick.metacritic ?? null},
      ${genres}
    )
    ON CONFLICT (id) DO NOTHING
  `;
  return pick.id;
}

// ──────────────────────────────────────────────────────────────────────────────
// AES-GCM DECRYPT — Web Crypto port of lib/imports/encryption.ts.
// Node's `createDecipheriv` API is not available in Deno; Web Crypto is.
// Storage format: base64(iv):base64(ciphertext):base64(authTag)
// Web Crypto AES-GCM expects authTag APPENDED to ciphertext (combined buffer).
// ──────────────────────────────────────────────────────────────────────────────
export async function decryptSecret(
  stored: string,
  masterKeyB64: string,
): Promise<string> {
  const [ivB64, ctB64, tagB64] = stored.split(":");
  const keyBytes = Uint8Array.from(atob(masterKeyB64), (c) => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
  const ct = Uint8Array.from(atob(ctB64), (c) => c.charCodeAt(0));
  const tag = Uint8Array.from(atob(tagB64), (c) => c.charCodeAt(0));
  // Web Crypto expects ciphertext || authTag as a single buffer
  const combined = new Uint8Array(ct.length + tag.length);
  combined.set(ct);
  combined.set(tag, ct.length);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, combined);
  return new TextDecoder().decode(pt);
}

// ──────────────────────────────────────────────────────────────────────────────
// FETCH LIBRARY — inline-vendored adapter logic for Deno.
// See lib/imports/adapters/{steam,xbox}.ts for the Node-side source of truth.
// ──────────────────────────────────────────────────────────────────────────────
export async function fetchLibrary(
  platform: "steam" | "xbox",
  connection: ConnectionRow,
  steamApiKey: string | null,
  decryptedXboxKey: string | null,
  since: Date | null,
): Promise<ImportedGame[]> {
  if (platform === "steam") {
    if (!steamApiKey) throw new Error("STEAM_API_KEY not set");
    const url =
      `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${steamApiKey}` +
      `&steamid=${connection.external_id}&include_appinfo=1&include_played_free_games=1`;
    const res = await fetch(url);
    if (res.status === 429) throw new Error("STEAM_RATE_LIMIT");
    if (!res.ok) throw new Error(`STEAM_API_${res.status}`);
    const json = (await res.json()) as {
      response: {
        games?: Array<{
          appid: number;
          name: string;
          playtime_forever: number;
          playtime_2weeks?: number;
          rtime_last_played?: number;
        }>;
      };
    };
    const raw = json.response.games ?? [];
    const filtered = since ? raw.filter((g) => (g.playtime_2weeks ?? 0) > 0) : raw;
    return filtered.map((g) => ({
      externalId: String(g.appid),
      title: g.name,
      hoursPlayed:
        g.playtime_forever > 0 ? +(g.playtime_forever / 60).toFixed(1) : null,
      lastPlayedAt: g.rtime_last_played
        ? new Date(g.rtime_last_played * 1000)
        : null,
      releaseYear: null,
    }));
  } else {
    // xbox
    if (!decryptedXboxKey) throw new Error("XBOX_KEY_MISSING");
    const res = await fetch(
      `https://xbl.io/api/v2/achievements/player/${connection.external_id}`,
      { headers: { "X-Authorization": decryptedXboxKey } },
    );
    if (res.status === 401) throw new Error("XBOX_KEY_INVALID");
    if (res.status === 429) throw new Error("XBOX_RATE_LIMIT");
    if (!res.ok) throw new Error(`XBOX_API_${res.status}`);
    // OpenXBL wraps responses under `content` — keep fallback to non-wrapped
    // for forward-compat. Live shape verified 2026-05-11.
    const json = (await res.json()) as {
      content?: { titles?: Array<{ titleId: string; name: string }> };
      titles?: Array<{ titleId: string; name: string }>;
    };
    const titles = json.content?.titles ?? json.titles ?? [];
    return titles.map((t) => ({
      externalId: String(t.titleId),
      title: t.name,
      hoursPlayed: null,
      lastPlayedAt: null,
      releaseYear: null,
    }));
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE
// ──────────────────────────────────────────────────────────────────────────────

/** The main engine — runs the import to completion (or failure). */
export async function runImport(opts: {
  sql: ReturnType<typeof postgres>;
  importRow: ImportRow;
  connection: ConnectionRow;
  steamApiKey: string | null;
  encryptionKey: string;
}): Promise<{ status: "completed" | "failed"; errorMessage?: string }> {
  const { sql, importRow, connection, steamApiKey, encryptionKey } = opts;

  // Mark running
  await sql`UPDATE imports SET status = 'running', started_at = NOW() WHERE id = ${importRow.id}`;

  try {
    const decryptedXboxKey =
      importRow.platform === "xbox" && connection.access_token_encrypted
        ? await decryptSecret(connection.access_token_encrypted, encryptionKey)
        : null;
    const since = connection.last_synced_at
      ? new Date(connection.last_synced_at)
      : null;

    const games = await fetchLibrary(
      importRow.platform as "steam" | "xbox",
      connection,
      steamApiKey,
      decryptedXboxKey,
      since,
    );
    await sql`UPDATE imports SET total_count = ${games.length} WHERE id = ${importRow.id}`;

    const CHUNK = 50;
    // Resume support: pick up where a prior invocation left off. The Supabase
    // Free-tier Edge Function wall-clock cap is ~150s; libraries larger than
    // ~50 games per pass need re-invocation. imported_count is the chunk
    // boundary the previous pass committed; conflicts/unmatched are already
    // accumulated in the row. Starting empty here would overwrite them.
    const startIdx = Math.min(importRow.imported_count ?? 0, games.length);
    const conflicts: unknown[] = Array.isArray(importRow.conflicts_jsonb)
      ? [...importRow.conflicts_jsonb]
      : [];
    const unmatched: unknown[] = Array.isArray(importRow.unmatched_jsonb)
      ? [...importRow.unmatched_jsonb]
      : [];
    let imported = startIdx;

    for (let i = startIdx; i < games.length; i += CHUNK) {
      const chunk = games.slice(i, i + CHUNK);
      for (const g of chunk) {
        const gameId = await matchToRawg(sql, g);
        if (gameId == null) {
          unmatched.push({
            externalId: g.externalId,
            title: g.title,
            platform: importRow.platform,
          });
          continue;
        }
        const existing = await sql`
          SELECT id, platforms, platform_played_on, hours_played
          FROM logs
          WHERE user_id = ${importRow.user_id}
            AND game_id = ${gameId}
            AND is_replay = false
          LIMIT 1
        `;
        const merge = mergeImportedGame(
          { ...g, gameId },
          existing.length
            ? {
                id: existing[0].id,
                platforms: existing[0].platforms,
                platformPlayedOn: existing[0].platform_played_on,
                hoursPlayed: existing[0].hours_played
                  ? Number(existing[0].hours_played)
                  : null,
              }
            : null,
          importRow.platform,
        );
        if (merge.action === "insert") {
          await sql`
            INSERT INTO logs (user_id, game_id, status, platforms, platform_played_on, hours_played)
            VALUES (
              ${importRow.user_id},
              ${merge.row.gameId},
              ${merge.row.status},
              ${merge.row.platforms},
              ${merge.row.platformPlayedOn},
              ${merge.row.hoursPlayed}
            )
            ON CONFLICT (user_id, game_id, is_replay) DO NOTHING
          `;
        } else {
          await sql`
            UPDATE logs
            SET platforms = ${merge.set.platforms},
                hours_played = ${merge.set.hoursPlayed}
            WHERE id = ${merge.logId}
          `;
          conflicts.push({ logId: merge.logId, gameId, rule: merge.rule });
        }
      }
      imported += chunk.length;
      // NOTE: pass the JS arrays directly — postgres.js auto-serializes them
      // for jsonb columns. The previous code used `${JSON.stringify(arr)}::jsonb`
      // which double-encoded: postgres.js stringified the already-stringified
      // text and stored a jsonb STRING instead of a jsonb ARRAY.
      // Verified 2026-05-12 via jsonb_typeof() on a completed import row.
      await sql`
        UPDATE imports
        SET imported_count = ${imported},
            conflicts_jsonb = ${conflicts as unknown as object},
            unmatched_jsonb = ${unmatched as unknown as object}
        WHERE id = ${importRow.id}
      `;
    }

    await sql`UPDATE imports SET status = 'completed', completed_at = NOW() WHERE id = ${importRow.id}`;
    await sql`UPDATE platform_connections SET last_synced_at = NOW() WHERE id = ${connection.id}`;
    return { status: "completed" };
  } catch (err) {
    const msg = (err as Error).message.slice(0, 200);
    await sql`
      UPDATE imports
      SET status = 'failed', error_message = ${msg}, completed_at = NOW()
      WHERE id = ${importRow.id}
    `;
    return { status: "failed", errorMessage: msg };
  }
}
