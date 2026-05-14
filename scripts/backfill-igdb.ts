/**
 * One-shot backfill: resolve IGDB ids for every games row missing IGDB
 * data, fetch all four facets in one batched call, normalize through the
 * vocabulary allow-list, write to {game_modes, player_perspectives,
 * mechanics} columns + merge themes via set-union with existing values.
 *
 * Side-effect: writes games.steam_appid from IGDB external_games entries
 * (category=1) when discovered. New post-v11 imports populate it directly
 * from the import externalId, so this side-effect path covers the
 * legacy 5K games.
 *
 * Idempotent: candidate query selects rows where igdb_resolved_at IS NULL.
 * Resume-safe: re-queries on restart, picks up where it left off.
 *
 * Run:
 *   pnpm tsx --conditions react-server --env-file=.env scripts/backfill-igdb.ts
 *
 * Flags via env:
 *   BACKFILL_LIMIT       — max games to process this run (default: all)
 *   BACKFILL_DRY_RUN=1   — don't write, just log what would happen
 *
 * Note: --conditions react-server is required so that `import "server-only"`
 * in lib/igdb/* resolves to the empty stub instead of throwing. tsx passes
 * the flag through to Node's module resolver.
 */
import { eq, isNull, sql } from "drizzle-orm";

import { db } from "../lib/db";
import { games } from "../lib/db/schema";
import { igdbQuery } from "../lib/igdb/client";
import { resolveIgdbIds, type GameToResolve } from "../lib/igdb/resolver";
import { normalizeFacets } from "../lib/igdb/normalize";

const BATCH_SIZE = 500;
const PROGRESS_INTERVAL = 100;
// Pause between batches so the IGDB rate-limit budget recovers between the
// last facets call of batch N and the first resolution call of batch N+1.
// At 4 RPS sustained, 1.5s buys 6 calls of recovery — comfortable headroom.
const INTER_BATCH_DELAY_MS = 1500;
// Single retry with backoff if the facets fetch trips IGDB's rate limit.
// Without this, a 429 on the facets call wipes an entire batch's mechanics.
const FACETS_RETRY_DELAY_MS = 2500;

type IgdbFacetsRow = {
  id: number;
  game_modes?: Array<{ name: string }>;
  player_perspectives?: Array<{ name: string }>;
  themes?: Array<{ name: string }>;
  keywords?: Array<{ name: string }>;
  external_games?: Array<{ uid: string; category: number }>;
};

async function fetchFacets(igdbIds: number[]): Promise<Map<number, IgdbFacetsRow>> {
  if (igdbIds.length === 0) return new Map();
  const rows = await igdbQuery<IgdbFacetsRow[]>(
    "games",
    `fields id, game_modes.name, player_perspectives.name, themes.name, keywords.name, external_games.uid, external_games.category;
     where id = (${igdbIds.join(",")}); limit ${igdbIds.length};`,
  );
  return new Map(rows.map((r) => [r.id, r]));
}

async function main() {
  const limit = process.env.BACKFILL_LIMIT
    ? Number.parseInt(process.env.BACKFILL_LIMIT, 10)
    : Number.POSITIVE_INFINITY;
  const dryRun = process.env.BACKFILL_DRY_RUN === "1";

  console.log("IGDB backfill");
  console.log(`  limit:   ${Number.isFinite(limit) ? limit : "no limit"}`);
  console.log(`  dry-run: ${dryRun ? "yes" : "no"}`);

  const startedAt = Date.now();

  // OPTIMIZATION NOTE vs plan: ALSO select games.themes here so we can
  // merge in-memory instead of doing one extra SELECT per game inside the
  // loop. Plan version does ~5K extra round-trips; this version does 0.
  const candidates = (await db
    .select({
      id: games.id,
      title: games.title,
      released: games.released,
      steamAppid: games.steamAppid,
      themes: games.themes,
    })
    .from(games)
    .where(isNull(games.igdbResolvedAt))
    .orderBy(sql`${games.id} DESC`)) as Array<{
    id: number;
    title: string;
    released: Date | null;
    steamAppid: number | null;
    themes: string[] | null;
  }>;

  const work = Number.isFinite(limit) ? candidates.slice(0, limit) : candidates;
  console.log(`  candidates: ${work.length}/${candidates.length}\n`);

  let processed = 0;
  let resolved = 0;
  let unresolved = 0;
  let errors = 0;
  let nextLog = PROGRESS_INTERVAL;

  for (let i = 0; i < work.length; i += BATCH_SIZE) {
    const batch = work.slice(i, i + BATCH_SIZE);
    const toResolve: GameToResolve[] = batch.map((g) => ({
      id: g.id,
      title: g.title,
      releaseYear: g.released ? g.released.getUTCFullYear() : null,
      steamAppid: g.steamAppid,
    }));

    let resolvedMap: Awaited<ReturnType<typeof resolveIgdbIds>>;
    try {
      resolvedMap = await resolveIgdbIds(toResolve);
    } catch (err) {
      console.error(`  resolution failed for batch starting at ${i}:`, (err as Error).message);
      errors += batch.length;
      processed += batch.length;
      continue;
    }

    // Fetch facets for the resolved-non-null subset.
    const igdbIds = [...resolvedMap.values()]
      .map((r) => r.igdbId)
      .filter((id): id is number => id != null);
    let facets: Map<number, IgdbFacetsRow>;
    try {
      facets = await fetchFacets(igdbIds);
    } catch (firstErr) {
      // 429s here would otherwise wipe ~500 games' mechanics in one go —
      // wait long enough for the RPS counter to clear, then try once more.
      const msg = (firstErr as Error).message;
      console.warn(`  facets fetch failed for batch ${i} (${msg}); retrying after ${FACETS_RETRY_DELAY_MS}ms`);
      await new Promise((resolve) => setTimeout(resolve, FACETS_RETRY_DELAY_MS));
      try {
        facets = await fetchFacets(igdbIds);
        console.log(`  facets retry succeeded for batch ${i}`);
      } catch (secondErr) {
        console.error(`  facets fetch failed AGAIN for batch ${i}: ${(secondErr as Error).message}`);
        facets = new Map();
      }
    }

    // Update each row.
    for (const g of batch) {
      processed++;
      const r = resolvedMap.get(g.id);
      if (!r) {
        unresolved++;
        continue;
      }
      const facetRow = r.igdbId != null ? facets.get(r.igdbId) : null;

      // Side-effect: discover steam_appid from external_games where category=1.
      // Compute once; use for both branches.
      const steamExt = facetRow?.external_games?.find((eg) => eg.category === 1);
      const discoveredAppid = r.steamAppid ?? (steamExt ? Number(steamExt.uid) : null);

      if (!facetRow) {
        // Resolution returned null OR facets fetch failed — mark resolved-but-empty so AI fallback picks up.
        if (!dryRun) {
          await db
            .update(games)
            .set({
              igdbId: r.igdbId,
              igdbResolvedAt: new Date(),
              steamAppid: discoveredAppid,
            })
            .where(eq(games.id, g.id));
        }
        unresolved++;
        continue;
      }

      const normalized = normalizeFacets({
        game_modes: facetRow.game_modes?.map((m) => m.name) ?? [],
        player_perspectives: facetRow.player_perspectives?.map((p) => p.name) ?? [],
        themes: facetRow.themes?.map((t) => t.name) ?? [],
        keywords: facetRow.keywords?.map((k) => k.name) ?? [],
      });

      // Set-union merge of existing themes column with normalized.themes
      // (case-insensitive dedup). Read from in-memory candidates row, NOT
      // a fresh SELECT — that's the optimization vs plan.
      const existingThemes = g.themes ?? [];
      const themesLower = new Set(existingThemes.map((t) => t.toLowerCase()));
      const mergedThemes = [...existingThemes];
      for (const t of normalized.themes) {
        if (!themesLower.has(t.toLowerCase())) {
          mergedThemes.push(t);
          themesLower.add(t.toLowerCase());
        }
      }

      if (!dryRun) {
        await db
          .update(games)
          .set({
            igdbId: r.igdbId,
            igdbResolvedAt: new Date(),
            steamAppid: discoveredAppid,
            gameModes: normalized.gameModes,
            playerPerspectives: normalized.playerPerspectives,
            themes: mergedThemes,
            mechanics: normalized.mechanics,
          })
          .where(eq(games.id, g.id));
      }
      resolved++;
    }

    if (processed >= nextLog) {
      const elapsed = (Date.now() - startedAt) / 1000;
      const rate = processed / elapsed;
      const remaining = work.length - processed;
      const eta = remaining / rate;
      console.log(
        `  [${processed}/${work.length}] resolved=${resolved} unresolved=${unresolved} errors=${errors} | ${rate.toFixed(1)}/s | ETA ${eta.toFixed(0)}s`,
      );
      nextLog += PROGRESS_INTERVAL;
    }

    // Pace inter-batch — let the IGDB RPS budget recover before the next
    // batch's resolution + facets calls hit the API.
    if (i + BATCH_SIZE < work.length) {
      await new Promise((resolve) => setTimeout(resolve, INTER_BATCH_DELAY_MS));
    }
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsedSec}s`);
  console.log(`  processed:  ${processed}`);
  console.log(`  resolved:   ${resolved}`);
  console.log(`  unresolved: ${unresolved}`);
  console.log(`  errors:     ${errors}`);

  process.exit(0);
}

void main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
