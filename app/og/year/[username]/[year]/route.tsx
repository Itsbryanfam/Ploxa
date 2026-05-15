/**
 * /og/year/[username]/[year] — yearly summary OG image.
 *
 * Phase 6 T15. Returns 1200×630 PNG via next/og ImageResponse.
 *
 * Privacy: 404s private profiles (F-001). The URL is enumerable (username
 * is public, year guessable), so "sharing is consent" doesn't hold —
 * matches /og/profile/[username], which also 404s private profiles.
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
  const rows = (await db.execute<{ user_id: string; is_public: boolean }>(sql`
    SELECT p.user_id, p.is_public
    FROM profiles p
    WHERE p.username = ${username}
      AND p.deleted_at IS NULL
    LIMIT 1
  `)) as unknown as Array<{ user_id: string; is_public: boolean }>;

  const profile = rows[0];
  // No profile at all → 404. A non-existent user has nothing to show.
  if (!profile) return new Response("Not found", { status: 404 });

  // Private profiles 404 here too — the URL is enumerable, so "sharing is
  // consent" doesn't hold. Matches /og/profile/[username].
  if (!profile.is_public) return new Response("Not found", { status: 404 });

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
