import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { profiles, tasteFingerprints } from "@/lib/db/schema";
import { dominantPose, mascotMoodForPose } from "@/lib/og/dominant-pose";
import { TasteCard } from "@/lib/og/taste-card";
import { playstyleFromMechanics } from "@/lib/taste/playstyle";

// Note: this route uses the default Node runtime (not Edge) because the
// project's db client (postgres-js) is Node-only. Matches the pattern
// established by app/og/review/[id]/route.tsx. ImageResponse works in
// both runtimes in Next 16. If a future PR migrates db to an
// Edge-compatible client, add `export const runtime = "edge"`.

const NARRATIVE_TRUNCATE_LEN = 250;

function lengthSweetSpot(lengthPref: Record<string, number>): string {
  const buckets: Array<[string, string]> = [
    ["<5h", "<5 HRS"],
    ["5-10h", "5–10 HRS"],
    ["10-30h", "10–30 HRS"],
    ["30-60h", "30–60 HRS"],
    ["60h+", "60+ HRS"],
  ];
  let best: string | null = null;
  let bestScore = 0;
  for (const [k, label] of buckets) {
    const score = lengthPref[k] ?? 0;
    if (score > bestScore) {
      best = label;
      bestScore = score;
    }
  }
  return best ?? "VARIED";
}

function topGenre(genreVec: Record<string, number>): string {
  let best: string | null = null;
  let bestScore = -Infinity;
  for (const [k, v] of Object.entries(genreVec)) {
    if (v > bestScore) {
      best = k;
      bestScore = v;
    }
  }
  return (best ?? "UNDISCOVERED").toUpperCase();
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1).trimEnd() + "…";
}

export async function GET(
  request: Request,
  context: { params: Promise<{ username: string }> },
): Promise<Response> {
  const { username } = await context.params;

  // Look up profile + privacy gate.
  const [profile] = await db
    .select({
      userId: profiles.userId,
      isPublic: profiles.isPublic,
    })
    .from(profiles)
    .where(eq(profiles.username, username))
    .limit(1);
  if (!profile) return new NextResponse("Not Found", { status: 404 });
  if (!profile.isPublic) return new NextResponse("Not Found", { status: 404 });

  const [fp] = await db
    .select({
      narrative: tasteFingerprints.narrativeSummary,
      genre: tasteFingerprints.genreVector,
      mechanic: tasteFingerprints.mechanicVector,
      theme: tasteFingerprints.themeVector,
      length: tasteFingerprints.lengthPreference,
    })
    .from(tasteFingerprints)
    .where(eq(tasteFingerprints.userId, profile.userId))
    .limit(1);
  if (!fp || !fp.narrative) return new NextResponse("Not Found", { status: 404 });

  const vectors = {
    genre: (fp.genre as Record<string, number>) ?? {},
    theme: (fp.theme as Record<string, number>) ?? {},
    mechanic: (fp.mechanic as Record<string, number>) ?? {},
    gameMode: {},
    playerPerspective: {},
  };
  const pose = dominantPose(vectors);
  const playstyle = playstyleFromMechanics(vectors.mechanic);
  const top = topGenre(vectors.genre);
  const sweet = lengthSweetSpot((fp.length as Record<string, number>) ?? {});

  // Absolute URL for the mascot sprite. Vercel OG cannot read /public
  // directly — it must fetch the image over HTTP. request.url is the
  // public-facing URL on Vercel; locally it's http://localhost:3000.
  // Future task: defensive fallback to NEXT_PUBLIC_SITE_URL when
  // request.url proxies surface issues (e.g. reverse-proxied dev setups).
  const origin = new URL(request.url).origin;
  const mascotMoodPng = mascotMoodForPose(pose);
  const mascotImageUrl = `${origin}/mascot/${mascotMoodPng}.png`;

  const narrative = truncate(fp.narrative, NARRATIVE_TRUNCATE_LEN);

  return new ImageResponse(
    (
      <TasteCard
        username={username}
        narrative={narrative}
        topGenre={top}
        playstyle={playstyle.toUpperCase()}
        lengthSweetSpot={sweet}
        pose={pose}
        mascotImageUrl={mascotImageUrl}
      />
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        "Cache-Control": "public, s-maxage=604800, stale-while-revalidate=86400",
      },
    },
  );
}
