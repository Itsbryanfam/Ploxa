/**
 * /og/month/[username]/[yyyymm] — monthly summary OG image.
 *
 * Phase 6 T15. Returns 1200×630 PNG via next/og ImageResponse.
 *
 * Privacy note: this endpoint intentionally does NOT 404 private profiles.
 * See /og/year/[username]/[year]/route.tsx for the full rationale.
 *
 * Monthly payload loading: T16 will implement `cacheOrBuildMonthly`. Until
 * then this route reads directly from the `monthly_recaps` table and renders
 * a "not enough data yet" card when no row exists. T16 replaces the
 * `getMonthlyPayload` helper below with a `cacheOrBuildMonthly` call —
 * the route handler itself stays unchanged.
 *
 * TODO(T16): replace `getMonthlyPayload` with `cacheOrBuildMonthly`.
 */

import { ImageResponse } from "next/og";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { RecapOgCard } from "@/lib/recaps/og/card";
import type { RecapPayload } from "@/lib/recaps/types";

// ─────────────────────────────────────────────────────────────
// yyyymm parser — format YYYYMM, e.g. "202605" = May 2026.
// ─────────────────────────────────────────────────────────────
function parseYyyymm(raw: string): { year: number; monthIndex: number } | null {
  if (raw.length !== 6 || !/^\d{6}$/.test(raw)) return null;
  const year = Number.parseInt(raw.slice(0, 4), 10);
  const monthIndex = Number.parseInt(raw.slice(4, 6), 10);
  if (year < 2020 || year > 2100) return null;
  if (monthIndex < 1 || monthIndex > 12) return null;
  return { year, monthIndex };
}

// ─────────────────────────────────────────────────────────────
// TODO(T16): replace this helper with `cacheOrBuildMonthly`.
// Reads from `monthly_recaps` only — returns null when no row exists.
// T16 will add the build path (aggregate + captions + UPSERT) matching
// the shape of cacheOrBuildYearly in lib/recaps/cache-or-build.ts.
// ─────────────────────────────────────────────────────────────
async function getMonthlyPayload(
  userId: string,
  year: number,
  monthIndex: number,
): Promise<RecapPayload | null> {
  const rows = (await db.execute<{ payload: RecapPayload }>(sql`
    SELECT payload
    FROM monthly_recaps
    WHERE user_id = ${userId}
      AND year = ${year}
      AND month_index = ${monthIndex}
    LIMIT 1
  `)) as unknown as Array<{ payload: RecapPayload }>;
  return rows[0]?.payload ?? null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ username: string; yyyymm: string }> },
) {
  const { username, yyyymm } = await params;

  const parsed = parseYyyymm(yyyymm);
  if (!parsed) return new Response("Not found", { status: 404 });
  const { year, monthIndex } = parsed;

  // Load profile directly — skip getProfileByUsername because that helper
  // calls getCachedUser() (auth cookie) which is unavailable in OG routes.
  const rows = (await db.execute<{ user_id: string }>(sql`
    SELECT p.user_id
    FROM profiles p
    WHERE p.username = ${username}
      AND p.deleted_at IS NULL
    LIMIT 1
  `)) as unknown as Array<{ user_id: string }>;

  const profile = rows[0];
  if (!profile) return new Response("Not found", { status: 404 });

  // Privacy: we do NOT 404 private profiles here — see module comment above.

  const rawPayload = await getMonthlyPayload(profile.user_id, year, monthIndex);

  // No monthly recap row yet → render a calm sparse card.
  // This happens when the user has not generated their monthly recap yet
  // (T16 will add the build-on-demand path).
  const payload: RecapPayload = rawPayload ?? {
    tier: "too_sparse",
    mode: "monthly",
    windowStart: new Date(Date.UTC(year, monthIndex - 1, 1)).toISOString(),
    windowEnd: new Date(Date.UTC(year, monthIndex, 1)).toISOString(),
    scenes: [],
    totals: {
      totalGames: 0,
      totalHoursPlayed: null,
      completedCount: 0,
      droppedCount: 0,
      replayingCount: 0,
      reviewCount: 0,
    },
    topGames: [],
    captions: {},
  };

  return new ImageResponse(
    (
      <RecapOgCard
        payload={payload}
        username={username}
        urlSuffix={`month/${yyyymm}`}
      />
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        "cache-control": "public, s-maxage=86400, max-age=86400",
      },
    },
  );
}
