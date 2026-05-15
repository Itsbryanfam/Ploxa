import "server-only";
import crypto from "node:crypto";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { buildRecap } from "./aggregate";
import { generateAllCaptions } from "./captions";
import { yearWindow, monthWindow } from "./window";
import type { RecapPayload } from "./types";

/**
 * cache-or-build.ts — Phase 6 T11.
 *
 * The cache-or-build flow for year-in-review (and, with a sibling helper in
 * T16, monthly). The contract:
 *
 *   1. SELECT the existing `year_in_reviews` row for (user_id, year).
 *   2. If a row exists and ANY of these holds, return its payload as-is
 *      with no aggregator run and no AI calls:
 *        - locked_at IS NOT NULL          (admin/operator pinned)
 *        - year === current year AND generated_at > now - 7 days  (fresh)
 *        - year < current year             (past years are immutable)
 *   3. Otherwise: run `buildRecap`.
 *        - If the result is `too_sparse`, return it without writing a row;
 *          the page falls back to <SparseDataState/>. We intentionally do
 *          NOT cache the sparse decision so a user who logs more games
 *          immediately unlocks their recap on the next visit.
 *        - If the result is `ok`, run `generateAllCaptions`, stamp the
 *          captions onto the payload, and UPSERT.
 *
 * Past-year semantics: once we hit 2027-01-01, year=2026 becomes a past
 * year. A row generated during 2026 (locked or otherwise) is the
 * authoritative record of that year; we never re-aggregate it because:
 *   (a) it's the user's "memory" of that year — rewriting it after the fact
 *       feels off, and
 *   (b) the source logs are append-only-ish but ratings can change, and
 *       letting an AI re-write a finished year for a stale caption is
 *       a bad bargain.
 *
 * The cache-skip only applies when a row exists. If no row exists for a
 * past year (e.g. a user views their 2025 recap for the first time in
 * 2027), we DO build it — the user has never seen this view before, so
 * "immutable" doesn't yet apply.
 *
 * Share-image hash: a SHA-256 of the canonical JSON payload, truncated to
 * 32 hex chars. We store it for OG-image cache invalidation (T15 wires
 * the OG route to read this and stamp it into its own ETag).
 */

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

interface CacheOrBuildInput {
  userId: string;
  year: number;
  /** When true, skip the cache short-circuit and force a fresh aggregator run.
   *  The locked_at check still takes precedence — locked years are immutable. */
  forceBuild?: boolean;
}

export interface CacheOrBuildYearlyResult {
  payload: RecapPayload;
  /** The locked_at timestamp string from the DB row, or null if not locked / no row. */
  lockedAt: string | null;
}

export async function cacheOrBuildYearly(
  input: CacheOrBuildInput,
): Promise<CacheOrBuildYearlyResult> {
  const { userId, year, forceBuild = false } = input;

  // 1. SELECT existing row. The type generic is inlined (rather than a
  // named interface) because drizzle's `db.execute<T>` requires T to
  // structurally satisfy `Record<string, unknown>`, which inline object
  // literals do automatically. Same pattern as aggregate.ts.
  const rows = (await db.execute<{
    payload: RecapPayload;
    locked_at: string | null;
    generated_at: string;
  }>(sql`
    SELECT payload, locked_at, generated_at::text
    FROM year_in_reviews
    WHERE user_id = ${userId} AND year = ${year}
    LIMIT 1
  `)) as unknown as Array<{
    payload: RecapPayload;
    locked_at: string | null;
    generated_at: string;
  }>;

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const sevenDaysAgoMs = now.getTime() - ONE_WEEK_MS;

  // 2. Cache short-circuit — only when a row exists.
  // locked_at always wins over forceBuild (locked years are immutable).
  if (rows[0]) {
    const isLocked = rows[0].locked_at !== null;
    const isFreshCurrentYear =
      year === currentYear &&
      new Date(rows[0].generated_at).getTime() > sevenDaysAgoMs;
    const isPastYear = year < currentYear;

    if (isLocked || (!forceBuild && (isFreshCurrentYear || isPastYear))) {
      return { payload: rows[0].payload, lockedAt: rows[0].locked_at };
    }
  }

  // 3. Build path.
  const { start, end } = yearWindow(year);
  const payload = await buildRecap({
    userId,
    windowStart: start,
    windowEnd: end,
    mode: "yearly",
  });

  // 3a. Sparse short-circuit — return as-is, do NOT write a row.
  if (payload.tier === "too_sparse") {
    return { payload, lockedAt: null };
  }

  // 3b. AI captions overlay.
  const captions = await generateAllCaptions(payload, userId);
  payload.captions = captions;

  // Share-image hash for OG cache invalidation. Truncated SHA-256 hex is
  // fine — collision risk per-user-year is negligible.
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 32);

  // UPSERT. The unique index on (user_id, year) is what ON CONFLICT
  // targets — see schema.ts year_in_reviews_user_year_uniq.
  await db.execute(sql`
    INSERT INTO year_in_reviews (user_id, year, payload, share_image_hash, generated_at)
    VALUES (
      ${userId},
      ${year},
      ${JSON.stringify(payload)}::jsonb,
      ${hash},
      now()
    )
    ON CONFLICT (user_id, year) DO UPDATE SET
      payload = EXCLUDED.payload,
      share_image_hash = EXCLUDED.share_image_hash,
      generated_at = now()
  `);

  // Freshly built rows are never locked — locked_at is only set by the
  // annual_locked cron / T19. Return null to reflect that.
  return { payload, lockedAt: null };
}

/**
 * cacheOrBuildMonthly — Phase 6 T16.
 *
 * Sibling to `cacheOrBuildYearly` targeting the `monthly_recaps` table.
 * The cache-or-build contract is identical; only the time window and the
 * "past month" definition differ:
 *
 *   1. SELECT the existing `monthly_recaps` row for (user_id, year, month_index).
 *   2. If a row exists and ANY of these holds, return its payload as-is:
 *        - locked_at IS NOT NULL          (admin/operator pinned)
 *        - same year+month as current month AND generated_at > now - 7 days
 *        - past month (year < currentYear OR (year === currentYear AND monthIndex < currentMonth))
 *   3. Otherwise: run `buildRecap` with mode "monthly".
 *        - too_sparse → return without writing.
 *        - ok → generateAllCaptions, stamp, UPSERT into monthly_recaps.
 *
 * Past-month semantics: once a month rolls over it is treated as immutable.
 * A row generated during that month is the authoritative record. The same
 * rationale as yearly applies (user's "memory", stale re-aggregation is a
 * bad bargain). The cache short-circuit only applies when a row exists; if no
 * row exists for a past month we DO build it the first time the user views it.
 *
 * monthIndex is 1-based (1=January … 12=December) throughout — matches the
 * plan convention, the `monthly_recaps` schema column, and `monthWindow()`.
 */

interface CacheOrBuildMonthlyInput {
  userId: string;
  year: number;
  monthIndex: number; // 1-based
}

export interface CacheOrBuildMonthlyResult {
  payload: RecapPayload;
  /** The locked_at timestamp string from the DB row, or null if not locked / no row. */
  lockedAt: string | null;
}

export async function cacheOrBuildMonthly(
  input: CacheOrBuildMonthlyInput,
): Promise<CacheOrBuildMonthlyResult> {
  const { userId, year, monthIndex } = input;

  // 1. SELECT existing row.
  const rows = (await db.execute<{
    payload: RecapPayload;
    locked_at: string | null;
    generated_at: string;
  }>(sql`
    SELECT payload, locked_at, generated_at::text
    FROM monthly_recaps
    WHERE user_id = ${userId} AND year = ${year} AND month_index = ${monthIndex}
    LIMIT 1
  `)) as unknown as Array<{
    payload: RecapPayload;
    locked_at: string | null;
    generated_at: string;
  }>;

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  // getUTCMonth() is 0-based; convert to 1-based for comparison with monthIndex.
  const currentMonth = now.getUTCMonth() + 1;
  const sevenDaysAgoMs = now.getTime() - ONE_WEEK_MS;

  // 2. Cache short-circuit — only when a row exists.
  if (rows[0]) {
    const isLocked = rows[0].locked_at !== null;
    const isFreshCurrentMonth =
      year === currentYear &&
      monthIndex === currentMonth &&
      new Date(rows[0].generated_at).getTime() > sevenDaysAgoMs;
    const isPastMonth =
      year < currentYear ||
      (year === currentYear && monthIndex < currentMonth);

    if (isLocked || isFreshCurrentMonth || isPastMonth) {
      return { payload: rows[0].payload, lockedAt: rows[0].locked_at };
    }
  }

  // 3. Build path. monthWindow accepts 1-based monthIndex (see window.ts).
  const { start, end } = monthWindow(year, monthIndex);
  const payload = await buildRecap({
    userId,
    windowStart: start,
    windowEnd: end,
    mode: "monthly",
  });

  // 3a. Sparse short-circuit — return as-is, do NOT write a row.
  if (payload.tier === "too_sparse") {
    return { payload, lockedAt: null };
  }

  // 3b. AI captions overlay.
  const captions = await generateAllCaptions(payload, userId);
  payload.captions = captions;

  // Share-image hash for OG cache invalidation.
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 32);

  // UPSERT. ON CONFLICT targets the unique (user_id, year, month_index) index.
  await db.execute(sql`
    INSERT INTO monthly_recaps (user_id, year, month_index, payload, share_image_hash, generated_at)
    VALUES (
      ${userId},
      ${year},
      ${monthIndex},
      ${JSON.stringify(payload)}::jsonb,
      ${hash},
      now()
    )
    ON CONFLICT (user_id, year, month_index) DO UPDATE SET
      payload = EXCLUDED.payload,
      share_image_hash = EXCLUDED.share_image_hash,
      generated_at = now()
  `);

  // Freshly built monthly rows are never locked.
  return { payload, lockedAt: null };
}
