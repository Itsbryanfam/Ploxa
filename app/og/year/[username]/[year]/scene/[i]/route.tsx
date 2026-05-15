/**
 * /og/year/[username]/[year]/scene/[i] — per-scene yearly OG image.
 *
 * Phase 6 T15. Returns 1200×630 PNG via next/og ImageResponse.
 *
 * Privacy note: this endpoint intentionally does NOT 404 private profiles.
 * Sharing a scene-specific URL (e.g. "scene 4 of my 2026 year") is an
 * explicit sharing action — hitting this OG route is the user's intent.
 * See /og/year/[username]/[year]/route.tsx for the full rationale.
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

function parseSceneIndex(raw: string): number | null {
  const idx = Number.parseInt(raw, 10);
  if (!Number.isInteger(idx) || idx < 0) return null;
  return idx;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ username: string; year: string; i: string }> },
) {
  const { username, year: yearStr, i: iStr } = await params;

  const year = parseYear(yearStr);
  if (year === null) return new Response("Not found", { status: 404 });

  const sceneIndex = parseSceneIndex(iStr);
  if (sceneIndex === null) return new Response("Not found", { status: 404 });

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

  const payload = await cacheOrBuildYearly({ userId: profile.user_id, year });

  // Out-of-range scene index: render summary card rather than 404.
  // This keeps unfurlers from showing a broken card when a recap is rebuilt
  // and the scene list changes length.
  const safeSceneIndex =
    sceneIndex < payload.scenes.length ? sceneIndex : undefined;

  return new ImageResponse(
    (
      <RecapOgCard
        payload={payload}
        username={username}
        sceneIndex={safeSceneIndex}
        urlSuffix={`year/${year}`}
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
