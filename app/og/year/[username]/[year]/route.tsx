/**
 * /og/year/[username]/[year] — yearly summary OG image.
 *
 * Phase 6 T15. Returns 1200×630 PNG via next/og ImageResponse.
 *
 * Privacy note: this endpoint intentionally does NOT 404 private profiles.
 * Contrast with /og/profile/[username] which does 404 private profiles.
 * Rationale: if a user shares their recap URL (e.g. posts it to social media),
 * the OG unfurler hitting this endpoint is their intent — sharing is consent.
 * A user who hasn't shared won't have their URL discovered by crawlers.
 */

import { ImageResponse } from "next/og";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { cacheOrBuildYearly } from "@/lib/recaps/cache-or-build";
import { RecapOgCard } from "@/lib/recaps/og/card";

const MIN_YEAR = 2020;
const MAX_YEAR = 2100;

function parseYear(raw: string): number | null {
  const year = Number.parseInt(raw, 10);
  if (!Number.isInteger(year) || year <= MIN_YEAR || year >= MAX_YEAR) return null;
  return year;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ username: string; year: string }> },
) {
  const { username, year: yearStr } = await params;

  const year = parseYear(yearStr);
  if (year === null) return new Response("Not found", { status: 404 });

  // Load profile directly — skip getProfileByUsername because that helper
  // calls getCachedUser() (auth cookie) which is unavailable in OG routes
  // (no session cookie from unfurlers). We only need userId + existence check.
  const rows = (await db.execute<{ user_id: string }>(sql`
    SELECT p.user_id
    FROM profiles p
    WHERE p.username = ${username}
      AND p.deleted_at IS NULL
    LIMIT 1
  `)) as unknown as Array<{ user_id: string }>;

  const profile = rows[0];
  // No profile at all → 404. A non-existent user has nothing to show.
  if (!profile) return new Response("Not found", { status: 404 });

  // Privacy: we do NOT 404 private profiles here — see module comment above.

  const { payload } = await cacheOrBuildYearly({ userId: profile.user_id, year });

  return new ImageResponse(
    (
      <RecapOgCard
        payload={payload}
        username={username}
        urlSuffix={`year/${year}`}
      />
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        // 24h public cache — same shape as /og/profile/[username].
        "cache-control": "public, s-maxage=86400, max-age=86400",
      },
    },
  );
}
