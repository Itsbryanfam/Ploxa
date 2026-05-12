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

  return null;
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
    const json = (await res.json()) as {
      titles?: Array<{ titleId: string; name: string }>;
    };
    return (json.titles ?? []).map((t) => ({
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
    const conflicts: unknown[] = [];
    const unmatched: unknown[] = [];
    let imported = 0;

    for (let i = 0; i < games.length; i += CHUNK) {
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
      await sql`
        UPDATE imports
        SET imported_count = ${imported},
            conflicts_jsonb = ${JSON.stringify(conflicts)}::jsonb,
            unmatched_jsonb = ${JSON.stringify(unmatched)}::jsonb
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
