/**
 * One-time backfill: populate games.poster_url + games.poster_source for
 * every game in the catalog that doesn't already have portrait art.
 *
 * Resolution chain (per lib/games/poster-source.ts):
 *   Steam Storefront search → Steam CDN library_600x900_2x.jpg →
 *   SteamGridDB (if SGDB_API_KEY is set) → null.
 *
 * Idempotent: re-runs skip rows where poster_url is already populated.
 * Resume-safe: kill -INT mid-run is fine; restart picks up where it left off.
 *
 * Run:
 *   pnpm tsx --conditions react-server --env-file=.env scripts/backfill-posters.ts
 *
 * Flags via env:
 *   BACKFILL_LIMIT       — max games to process this run (default: all)
 *   BACKFILL_CONCURRENCY — parallel resolves (default: 8)
 *   BACKFILL_DRY_RUN=1   — don't write, just log what would happen
 */
import { eq, isNull, sql } from "drizzle-orm";

import { db } from "../lib/db";
import { games } from "../lib/db/schema";
import { resolvePoster } from "../lib/games/poster-source";

const DEFAULT_CONCURRENCY = 8;
const PROGRESS_INTERVAL = 100;

interface Row {
  id: number;
  title: string;
}

async function main() {
  const limit = process.env.BACKFILL_LIMIT
    ? Number.parseInt(process.env.BACKFILL_LIMIT, 10)
    : Number.POSITIVE_INFINITY;
  const concurrency = process.env.BACKFILL_CONCURRENCY
    ? Number.parseInt(process.env.BACKFILL_CONCURRENCY, 10)
    : DEFAULT_CONCURRENCY;
  const dryRun = process.env.BACKFILL_DRY_RUN === "1";

  if (!Number.isFinite(limit) && process.env.BACKFILL_LIMIT) {
    throw new Error(`BACKFILL_LIMIT must be a positive integer, got "${process.env.BACKFILL_LIMIT}"`);
  }
  if (!Number.isFinite(concurrency) || concurrency <= 0) {
    throw new Error(`BACKFILL_CONCURRENCY must be a positive integer, got "${process.env.BACKFILL_CONCURRENCY}"`);
  }

  console.log("Poster art backfill");
  console.log(`  SGDB_API_KEY: ${process.env.SGDB_API_KEY ? "set" : "absent — Steam-CDN-only coverage"}`);
  console.log(`  concurrency: ${concurrency}`);
  console.log(`  limit: ${Number.isFinite(limit) ? limit : "no limit"}`);
  console.log(`  dry-run: ${dryRun ? "yes" : "no"}`);

  const startedAt = Date.now();

  // Pull all candidate rows up front. ~5K rows × (id + title) is well
  // under a megabyte, easier than streaming.
  // Order: newest cachedAt first, so freshly-seeded games light up first.
  const rows = (await db
    .select({ id: games.id, title: games.title })
    .from(games)
    .where(isNull(games.posterUrl))
    .orderBy(sql`${games.cachedAt} DESC`)) as Row[];

  const candidates = Number.isFinite(limit) ? rows.slice(0, limit) : rows;

  console.log(`  candidates: ${candidates.length}/${rows.length}`);
  console.log("");

  let processed = 0;
  const bySource = { steam: 0, sgdb: 0, null: 0 };
  let errors = 0;
  let nextLog = PROGRESS_INTERVAL;

  for (let i = 0; i < candidates.length; i += concurrency) {
    const wave = candidates.slice(i, i + concurrency);

    const results = await Promise.all(
      wave.map(async (row) => {
        try {
          const r = await resolvePoster({ title: row.title });
          return { row, result: r, err: null as Error | null };
        } catch (err) {
          return { row, result: null, err: err as Error };
        }
      }),
    );

    for (const r of results) {
      processed++;
      if (r.err) {
        errors++;
        continue;
      }
      if (r.result == null) {
        bySource.null++;
        continue;
      }
      bySource[r.result.source]++;

      if (!dryRun) {
        try {
          await db
            .update(games)
            .set({
              posterUrl: r.result.url,
              posterSource: r.result.source,
            })
            .where(eq(games.id, r.row.id));
        } catch (err) {
          errors++;
          console.error(`  UPDATE failed for game ${r.row.id} (${r.row.title}): ${(err as Error).message}`);
        }
      }
    }

    if (processed >= nextLog) {
      const elapsed = (Date.now() - startedAt) / 1000;
      const rate = processed / elapsed;
      const remaining = candidates.length - processed;
      const eta = remaining / rate;
      console.log(
        `  [${processed}/${candidates.length}] steam=${bySource.steam} sgdb=${bySource.sgdb} null=${bySource.null} errors=${errors} | ${rate.toFixed(1)}/s | ETA ${eta.toFixed(0)}s`,
      );
      nextLog += PROGRESS_INTERVAL;
    }
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log("");
  console.log(`Done in ${elapsedSec}s`);
  console.log(`  processed:   ${processed}`);
  console.log(`  steam:       ${bySource.steam}`);
  console.log(`  sgdb:        ${bySource.sgdb}`);
  console.log(`  null:        ${bySource.null}`);
  console.log(`  errors:      ${errors}`);

  process.exit(0);
}

void main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
