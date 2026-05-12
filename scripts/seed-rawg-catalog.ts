/**
 * Pre-cache the top N most-added-by-users games on RAWG into our local
 * `games` table. Run once after a fresh clone or to refresh the catalog;
 * idempotent — uses ON CONFLICT (id) DO NOTHING.
 *
 * Why: imports use a local cache-first match path. An empty catalog forces
 * every game through RAWG-on-miss, which is slow and burns budget. Seeding
 * the ~5K most-added titles means typical Steam/Xbox imports hit cache on
 * the vast majority of their library.
 *
 * Run:
 *   pnpm tsx --conditions react-server --env-file=.env scripts/seed-rawg-catalog.ts
 *   SEED_COUNT=2000 pnpm tsx --conditions react-server --env-file=.env scripts/seed-rawg-catalog.ts
 *
 * Note: ordering=-added pulls games sorted by how many RAWG users added
 * them to their library — i.e., the games people actually play. Better hit
 * rate than ordering by rating (which biases toward older critically-loved
 * games) for import-cache purposes.
 */
import { sql } from "drizzle-orm";

import { db } from "../lib/db";
import { games } from "../lib/db/schema";
import { requireEnv } from "../lib/env";

interface RawgListResponse {
  count: number;
  next: string | null;
  results: Array<{
    id: number;
    slug: string;
    name: string;
    released: string | null;
    background_image: string | null;
    rating: number | null;
    metacritic: number | null;
    genres?: Array<{ name: string }>;
    parent_platforms?: Array<{ platform: { name: string } }>;
  }>;
}

const PAGE_SIZE = 40;
const POLITE_DELAY_MS = 200;

async function main() {
  const rawgKey = requireEnv("RAWG_API_KEY");
  const target = Number.parseInt(process.env.SEED_COUNT ?? "5000", 10);
  if (!Number.isFinite(target) || target <= 0) {
    throw new Error(`SEED_COUNT must be a positive integer; got "${process.env.SEED_COUNT}"`);
  }
  const totalPages = Math.ceil(target / PAGE_SIZE);

  console.log(`Seeding top ${target} games from RAWG (-added ordering, ${totalPages} pages × ${PAGE_SIZE})…`);
  const startTime = Date.now();

  const initialCount = await currentGamesCount();
  console.log(`  starting games table count: ${initialCount}`);

  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (let page = 1; page <= totalPages; page++) {
    const url =
      `https://api.rawg.io/api/games` +
      `?key=${rawgKey}&ordering=-added&page_size=${PAGE_SIZE}&page=${page}`;

    let payload: RawgListResponse;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`  page ${page}/${totalPages}: HTTP ${res.status} — skipping`);
        errors++;
        continue;
      }
      payload = (await res.json()) as RawgListResponse;
    } catch (err) {
      console.error(`  page ${page}/${totalPages}: fetch failed — ${(err as Error).message}`);
      errors++;
      continue;
    }

    if (!payload.results?.length) {
      console.log(`  page ${page}/${totalPages}: empty results — RAWG end-of-list?`);
      break;
    }

    const rows = payload.results.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.name,
      released: r.released ? new Date(r.released) : null,
      coverUrl: r.background_image,
      genres: (r.genres ?? []).map((g) => g.name),
      platforms: (r.parent_platforms ?? []).map((p) => p.platform.name),
      rawgRating: r.rating != null ? String(r.rating) : null,
      metacriticScore: r.metacritic,
    }));

    try {
      const result = await db
        .insert(games)
        .values(rows)
        .onConflictDoNothing({ target: games.id })
        .returning({ id: games.id });
      inserted += result.length;
      skipped += rows.length - result.length;
      console.log(
        `  page ${page}/${totalPages}: ${result.length} inserted, ${rows.length - result.length} already present`,
      );
    } catch (err) {
      console.error(`  page ${page}/${totalPages}: DB insert failed — ${(err as Error).message}`);
      errors++;
    }

    // Be polite to RAWG between requests
    if (page < totalPages) {
      await new Promise((r) => setTimeout(r, POLITE_DELAY_MS));
    }
  }

  const finalCount = await currentGamesCount();
  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("");
  console.log(`Done in ${elapsedSec}s`);
  console.log(`  pages OK         : ${totalPages - errors}/${totalPages}`);
  console.log(`  pages errored    : ${errors}`);
  console.log(`  rows newly added : ${inserted}`);
  console.log(`  rows already cached: ${skipped}`);
  console.log(`  games table: ${initialCount} → ${finalCount} (+${finalCount - initialCount})`);

  // Defensive: close any pg pool. Drizzle's postgres-js driver doesn't expose
  // direct .end() through the wrapper; the script will exit cleanly once the
  // event loop drains.
  process.exit(errors > 0 && inserted === 0 ? 1 : 0);
}

async function currentGamesCount(): Promise<number> {
  const result = await db.execute<{ count: number }>(sql`SELECT COUNT(*)::int AS count FROM games`);
  // postgres-js returns RowList; Drizzle's execute wrapper passes it through.
  const rows = result as unknown as Array<{ count: number }>;
  return Number(rows[0]?.count ?? 0);
}

void main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
