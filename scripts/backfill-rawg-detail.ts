/**
 * One-time backfill: enrich every games row missing detail-only fields by
 * fetching RAWG `/games/{id}` and writing themes / playtime_avg_hours /
 * description / platforms.
 *
 * Why this exists: the Edge import path used to upsert bare rows from the
 * RAWG search response (id/slug/title/released/cover/rating/metacritic/
 * genres only). Themes / playtime / description only filled when a user
 * opened the game-detail page. As of import-platform v10 every NEW import
 * hit fills those fields synchronously; this script fills the existing
 * 5K-row catalog so /u/{name}/taste shows real bars instead of washed-out
 * ones for users who imported under the older code.
 *
 * Idempotent: candidate query selects rows where themes is null or empty
 * AND description is null AND playtime_avg_hours is null, so re-runs skip
 * already-enriched rows.
 *
 * Resume-safe: kill -INT mid-run is fine; restart re-queries the candidate
 * set so any games already updated are excluded.
 *
 * Run:
 *   pnpm tsx --env-file=.env scripts/backfill-rawg-detail.ts
 *
 * Flags via env:
 *   BACKFILL_LIMIT       — max games to process this run (default: all)
 *   BACKFILL_CONCURRENCY — parallel RAWG detail fetches (default: 10)
 *   BACKFILL_DRY_RUN=1   — don't write, just log what would happen
 */
import { eq, isNull, or, sql } from "drizzle-orm";

import { db } from "../lib/db";
import { games } from "../lib/db/schema";

const DEFAULT_CONCURRENCY = 10;
const PROGRESS_INTERVAL = 100;

interface Row {
  id: number;
  title: string;
}

type RawgGameDetail = {
  description_raw?: string;
  playtime?: number; // hours
  tags?: Array<{ name: string }>;
  platforms?: Array<{ platform: { name: string } }>;
};

async function fetchDetail(id: number, apiKey: string): Promise<RawgGameDetail | null> {
  try {
    const res = await fetch(
      `https://api.rawg.io/api/games/${id}?key=${encodeURIComponent(apiKey)}`,
    );
    if (!res.ok) return null;
    return (await res.json()) as RawgGameDetail;
  } catch {
    return null;
  }
}

async function main() {
  const apiKey = process.env.RAWG_API_KEY;
  if (!apiKey) {
    throw new Error("RAWG_API_KEY env var is required");
  }

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

  console.log("RAWG detail backfill");
  console.log(`  concurrency: ${concurrency}`);
  console.log(`  limit: ${Number.isFinite(limit) ? limit : "no limit"}`);
  console.log(`  dry-run: ${dryRun ? "yes" : "no"}`);

  const startedAt = Date.now();

  // Candidate criterion: any row missing the detail-only fields. The bulk
  // Steam import wrote bare rows where themes/description/playtime are all
  // NULL; this query picks them up. The 23 already-detail-fetched games
  // (Half-Life, Hades, anything opened via game-detail) are excluded
  // because they have non-null themes from upsertGameFromRawg.
  // Order by id DESC so newer titles get backfilled first — gives faster
  // visible win on the user's recently-imported library.
  const rows = (await db
    .select({ id: games.id, title: games.title })
    .from(games)
    .where(
      or(
        isNull(games.themes),
        sql`array_length(${games.themes}, 1) IS NULL`,
        sql`array_length(${games.themes}, 1) = 0`,
      ),
    )
    .orderBy(sql`${games.id} DESC`)) as Row[];

  const candidates = Number.isFinite(limit) ? rows.slice(0, limit) : rows;

  console.log(`  candidates: ${candidates.length}/${rows.length}`);
  console.log("");

  let processed = 0;
  let enriched = 0;
  let notFound = 0;
  let errors = 0;
  let nextLog = PROGRESS_INTERVAL;

  for (let i = 0; i < candidates.length; i += concurrency) {
    const wave = candidates.slice(i, i + concurrency);

    const results = await Promise.all(
      wave.map(async (row) => {
        const detail = await fetchDetail(row.id, apiKey);
        return { row, detail };
      }),
    );

    for (const r of results) {
      processed++;
      if (r.detail == null) {
        notFound++;
        continue;
      }

      // Cap themes at 20 to bound DB array size — matches lib/games/server-actions.ts
      // and the Edge import path.
      const themes = (r.detail.tags ?? []).slice(0, 20).map((t) => t.name);
      const platforms = (r.detail.platforms ?? []).map((p) => p.platform.name);
      // RAWG sometimes returns "" for description_raw; coerce to null.
      const description = r.detail.description_raw?.trim() || null;
      // numeric(5,1) on disk → string for postgres-js.
      const playtimeAvgHours = r.detail.playtime ? String(r.detail.playtime) : null;

      // Skip the write entirely if RAWG had nothing to add — keeps the
      // notFound counter honest about coverage.
      if (
        themes.length === 0 &&
        platforms.length === 0 &&
        description == null &&
        playtimeAvgHours == null
      ) {
        notFound++;
        continue;
      }

      if (!dryRun) {
        try {
          await db
            .update(games)
            .set({
              themes,
              platforms,
              description,
              playtimeAvgHours,
              cachedAt: new Date(),
            })
            .where(eq(games.id, r.row.id));
          enriched++;
        } catch (err) {
          errors++;
          console.error(
            `  UPDATE failed for game ${r.row.id} (${r.row.title}): ${(err as Error).message}`,
          );
        }
      } else {
        enriched++;
      }
    }

    if (processed >= nextLog) {
      const elapsed = (Date.now() - startedAt) / 1000;
      const rate = processed / elapsed;
      const remaining = candidates.length - processed;
      const eta = remaining / rate;
      console.log(
        `  [${processed}/${candidates.length}] enriched=${enriched} not-found=${notFound} errors=${errors} | ${rate.toFixed(1)}/s | ETA ${eta.toFixed(0)}s`,
      );
      nextLog += PROGRESS_INTERVAL;
    }
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log("");
  console.log(`Done in ${elapsedSec}s`);
  console.log(`  processed: ${processed}`);
  console.log(`  enriched:  ${enriched}`);
  console.log(`  not-found: ${notFound}`);
  console.log(`  errors:    ${errors}`);

  process.exit(0);
}

void main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
