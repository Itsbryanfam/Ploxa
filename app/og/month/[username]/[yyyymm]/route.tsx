/**
 * /og/month/[username]/[yyyymm] — monthly summary OG image.
 *
 * Phase 6 T15 (route), T16 (payload loading). Returns 1200×630 PNG via
 * next/og ImageResponse.
 *
 * Privacy note: this endpoint intentionally does NOT 404 private profiles.
 * See /og/year/[username]/[year]/route.tsx for the full rationale.
 *
 * Payload loading: uses `cacheOrBuildMonthly` (implemented in T16) which
 * follows the same cache-or-build contract as `cacheOrBuildYearly` —
 * SELECT first, return cached when locked/fresh/past, else build + UPSERT.
 * The too_sparse sentinel is rendered as a calm sparse card.
 */

import { ImageResponse } from "next/og";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { cacheOrBuildMonthly } from "@/lib/recaps/cache-or-build";
import { RecapOgCard } from "@/lib/recaps/og/card";

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

  const payload = await cacheOrBuildMonthly({
    userId: profile.user_id,
    year,
    monthIndex,
  });

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
