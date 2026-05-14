// Deno runtime (Supabase Edge Functions). Imports use npm: specifiers.
// ──────────────────────────────────────────────────────────────────────────────
// VENDORED MERGE LOGIC — must stay byte-identical to lib/imports/merge.ts.
// If you change one, change both. (Edge runtime cannot import from lib/.)
// ──────────────────────────────────────────────────────────────────────────────
import postgres from "npm:postgres@3.4.9";
import { enrichWithIgdb } from "./igdb-engine.ts";

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

  // Exact and alias are independent point lookups — run in parallel.
  // Mirrors the parallelization in lib/imports/rawg-match.ts. On a 200-
  // game Steam import that's bounded-time DB load savings.
  const [exact, alias] = await Promise.all([
    sql`SELECT id FROM games WHERE lower(title) = ${normalized} LIMIT 1`,
    sql`SELECT game_id AS id FROM game_aliases WHERE lower(alias) = ${normalized} LIMIT 1`,
  ]);
  if (exact.length) return exact[0].id;
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
 *  Fetches the top search hit, then a follow-up /games/{id} detail call,
 *  and upserts the enriched row into the local `games` table.
 *
 *  Why two calls: RAWG /games?search returns only id/slug/name/released/
 *  background_image/rating/metacritic/genres — no themes (tags), no
 *  playtime, no description. Fingerprint vectors, AI rerank prompts, and
 *  the session-length card all depend on those fields, so importing a
 *  bare row leaves /u/{name}/taste with washed-out themes and an empty
 *  mechanics card. The extra ~300ms per game is amortized across the
 *  import's per-game RAWG-search step that already runs.
 *
 *  Returns the new games.id, or null if RAWG has no match. The detail
 *  fetch is best-effort: if it fails we still INSERT the basic row so
 *  the import doesn't lose the game entirely.
 *
 *  ON CONFLICT switched from DO NOTHING → DO UPDATE: this function only
 *  fires when matchToRawg's local lookups missed, so the row is normally
 *  new. Conflicts indicate either (a) a race between concurrent imports
 *  finding the same new game, or (b) a backfill job re-running on an
 *  existing row. In both cases our just-fetched data is at least as
 *  fresh as what's there, so updating is safe.
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

  // Best-effort detail fetch for themes/playtime/description/platforms.
  // Mirrors the RawgGameDetailSchema in lib/rawg/types.ts. If this errors
  // or the response shape is unexpected, fall back to the search-only
  // payload so the game still lands in the catalog.
  type RawgGameDetail = {
    description_raw?: string;
    playtime?: number; // hours
    tags?: Array<{ name: string }>;
    platforms?: Array<{ platform: { name: string } }>;
  };
  let detail: RawgGameDetail = {};
  try {
    const detailRes = await fetch(
      `https://api.rawg.io/api/games/${pick.id}?key=${encodeURIComponent(rawgApiKey)}`,
    );
    if (detailRes.ok) {
      detail = (await detailRes.json()) as RawgGameDetail;
    }
  } catch {
    // Swallow — fall back to bare insert.
  }

  const genres = (pick.genres ?? []).map((g) => g.name);
  // Cap themes at 20 to bound DB array size — matches lib/games/server-actions.ts.
  const themes = (detail.tags ?? []).slice(0, 20).map((t) => t.name);
  const platforms = (detail.platforms ?? []).map((p) => p.platform.name);
  // RAWG occasionally returns "" for description_raw; coerce to null.
  const description = detail.description_raw?.trim() || null;
  // RAWG `playtime` is hours; numeric(5,1) on disk → string for postgres-js.
  const playtimeAvgHours = detail.playtime ? String(detail.playtime) : null;

  await sql`
    INSERT INTO games (
      id, slug, title, released, cover_url, rawg_rating, metacritic_score,
      genres, themes, mechanics, platforms, playtime_avg_hours, description
    )
    VALUES (
      ${pick.id},
      ${pick.slug},
      ${pick.name},
      ${pick.released ?? null},
      ${pick.background_image ?? null},
      ${pick.rating ?? null},
      ${pick.metacritic ?? null},
      ${genres},
      ${themes},
      ${[] as string[]},
      ${platforms},
      ${playtimeAvgHours},
      ${description}
    )
    ON CONFLICT (id) DO UPDATE SET
      themes = EXCLUDED.themes,
      platforms = EXCLUDED.platforms,
      playtime_avg_hours = EXCLUDED.playtime_avg_hours,
      description = EXCLUDED.description,
      cached_at = NOW()
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
// PER-GAME PROCESSING — atomic UPSERT with merge semantics.
//
// Replaces the previous 2-step "SELECT existing then INSERT or UPDATE" pattern
// with a single round-trip ON CONFLICT DO UPDATE. Three benefits:
//   1. One DB roundtrip per game instead of two → ~50ms saved per game.
//   2. Atomic — no race between SELECT and write under parallel execution.
//   3. RETURNING (xmax = 0) tells us insert-vs-update so we can still
//      classify each game into "new" or "merged" buckets.
//
// Merge semantics preserved from lib/imports/merge.ts:
//   - status/rating/notes/started_at/finished_at NEVER touched on update
//   - platforms = union of (existing legacy or array) ∪ {platform}
//   - hours_played = greatest of (existing, imported)
//   - status defaults to 'backlog' on insert
// ──────────────────────────────────────────────────────────────────────────────

type ProcessGameResult =
  | { kind: "inserted"; logId: string; gameId: number }
  | { kind: "merged"; logId: string; gameId: number }
  | {
      kind: "unmatched";
      item: { externalId: string; title: string; platform: string };
    };

async function processGame(
  sql: ReturnType<typeof postgres>,
  importRow: ImportRow,
  g: ImportedGame,
): Promise<ProcessGameResult> {
  const gameId = await matchToRawg(sql, g);
  if (gameId == null) {
    return {
      kind: "unmatched",
      item: {
        externalId: g.externalId,
        title: g.title,
        platform: importRow.platform,
      },
    };
  }

  // Single atomic UPSERT. Merge rules encoded in the ON CONFLICT clause:
  //   platforms: union (treating COALESCE for legacy platform_played_on)
  //   hours_played: greatest-of
  // status / rating / notes / etc are NEVER referenced in SET → untouched.
  const rows = await sql<Array<{ id: string; inserted: boolean }>>`
    INSERT INTO logs (user_id, game_id, status, platforms, platform_played_on, hours_played)
    VALUES (
      ${importRow.user_id},
      ${gameId},
      'backlog',
      ${[importRow.platform]},
      ${importRow.platform},
      ${g.hoursPlayed}
    )
    ON CONFLICT (user_id, game_id, is_replay) DO UPDATE
    SET
      platforms = (
        SELECT array_agg(DISTINCT p ORDER BY p)
        FROM unnest(
          COALESCE(
            logs.platforms,
            CASE WHEN logs.platform_played_on IS NOT NULL
                 THEN ARRAY[logs.platform_played_on]
                 ELSE ARRAY[]::text[] END
          ) || excluded.platforms
        ) p
      ),
      hours_played = GREATEST(logs.hours_played, excluded.hours_played)
    RETURNING id, (xmax = 0) AS inserted
  `;

  if (!rows.length) {
    // Shouldn't happen — UPSERT always returns the affected row
    return {
      kind: "unmatched",
      item: { externalId: g.externalId, title: g.title, platform: importRow.platform },
    };
  }

  const row = rows[0];

  // Trigger IGDB enrichment for new Steam games. Only fires on Steam (Xbox
  // titleId isn't a Steam appid). Best-effort: enrichWithIgdb swallows
  // failures; if IGDB is down, the game still lands and the next backfill
  // run picks it up.
  if (importRow.platform === "steam") {
    const steamAppid = Number(g.externalId);
    if (Number.isInteger(steamAppid) && steamAppid > 0) {
      await enrichWithIgdb(sql, gameId, steamAppid);
    }
  }

  return row.inserted
    ? { kind: "inserted", logId: row.id, gameId }
    : { kind: "merged", logId: row.id, gameId };
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

  // Atomic claim: queued → running. If another invocation already claimed
  // this row (status != 'queued') we exit cleanly rather than racing on
  // chunked imports_count / conflicts_jsonb updates with the other worker.
  // The resume-from-timeout path described in the Phase 3 design doc isn't
  // wired to any auto-retry, so the simple guard is correct: only the very
  // first invocation per importId actually runs. A failed import → "Retry now"
  // creates a NEW imports row (different id), so it doesn't hit this path.
  const claimed = await sql<Array<{ id: string }>>`
    UPDATE imports SET status = 'running', started_at = NOW()
    WHERE id = ${importRow.id} AND status = 'queued'
    RETURNING id
  `;
  if (claimed.length === 0) {
    // No-op: another worker holds the claim. Return "completed" so the HTTP
    // caller gets a 200 — we are not poisoning the imports row state.
    return { status: "completed" };
  }

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

    // CONCURRENCY: per-game work is parallelizable. The slow step is the
    // optional RAWG fetch (~300ms); DB queries are ~50ms each. Running games
    // in parallel turns a 50-game chunk from ~30s serial into ~3s parallel.
    // Cap = 10 to stay friendly with the pooler's per-session connection limit
    // and avoid hammering the RAWG free tier.
    const CONCURRENCY = 10;

    for (let i = startIdx; i < games.length; i += CHUNK) {
      const chunk = games.slice(i, i + CHUNK);
      // Process each chunk in waves of CONCURRENCY parallel game-processings.
      for (let waveStart = 0; waveStart < chunk.length; waveStart += CONCURRENCY) {
        const wave = chunk.slice(waveStart, waveStart + CONCURRENCY);
        const waveResults = await Promise.all(
          wave.map((g) => processGame(sql, importRow, g)),
        );
        for (const r of waveResults) {
          if (r.kind === "unmatched") unmatched.push(r.item);
          else if (r.kind === "merged") {
            conflicts.push({
              logId: r.logId,
              gameId: r.gameId,
              rule: "platform_merge",
            });
          }
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
