import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { MilestoneToast } from "@/components/taste/milestone-toast";
import { TierEmpty } from "@/components/taste/tier-empty";
import { TierNarrative } from "@/components/taste/tier-narrative";
import { TierSparse } from "@/components/taste/tier-sparse";
import { getProfileByUsername } from "@/lib/profile/server-actions";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { getFingerprint } from "@/lib/taste/server-actions";

// Refresh button triggers `router.refresh()` after a successful refresh;
// cached page output would mask the new narrative. Mark dynamic so RSC
// always re-runs `getFingerprint` against the latest DB snapshot.
export const dynamic = "force-dynamic";

/**
 * Shared (profile, viewer, fingerprint) loader wrapped in React's cache() so
 * generateMetadata and the page body collapse to one set of queries per
 * request instead of two parallel-but-duplicated chains. Same pattern as the
 * canonical review page.
 *
 * Returns null for the same conditions the page-body 404s on:
 *   - profile not found
 *   - profile is private + viewer is not owner
 *   - fingerprint visibility check fails (mirrors getFingerprint's own gate)
 *   - tier is empty + viewer is not owner
 * Both metadata and the page body see null and fall back identically.
 */
const getTastePageData = cache(async (username: string) => {
  const profile = await getProfileByUsername(username);
  if (!profile) return null;

  const viewer = await getCachedUser();
  const isOwner = viewer?.id === profile.userId;

  // Page-level privacy gate (matches the page body).
  if (!profile.isPublic && !isOwner) return null;

  // getFingerprint also runs its own owner-or-public visibility check; the
  // null return below covers TOCTOU privacy flips.
  const fp = await getFingerprint(profile.userId);
  if (!fp) return null;

  // Empty-tier page is owner-only — same gate the page body honors so we
  // don't leak "user has no logs" via metadata to strangers.
  if (fp.tier === "empty" && !isOwner) return null;

  return { profile, viewer, isOwner, fp };
});

/**
 * Build an absolute origin (proto + host) from request headers for use in
 * the ShareModal's profile URL + OG preview src. Relies on the standard
 * `x-forwarded-proto` / `host` headers Vercel + most reverse proxies set.
 * Falls back to `http://localhost:3000` for local dev where the proxy
 * header may not be present.
 */
async function resolveOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

/**
 * Pick the most prominent label from a vector record (genre / mechanic /
 * theme). Used by generateMetadata to surface a meaningful description hint
 * — "RPG-leaning taste profile" reads better in unfurls than "RPG vector 4.2".
 */
function topLabel(vec: Record<string, number>): string | null {
  let best: string | null = null;
  let bestScore = -Infinity;
  for (const [k, v] of Object.entries(vec)) {
    if (v > bestScore) {
      best = k;
      bestScore = v;
    }
  }
  return best;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const data = await getTastePageData(username);
  if (!data) return { title: "Letterboxd for Games" };
  const { profile, fp } = data;
  const subject = profile.displayName ?? profile.username;
  const title = `${subject}'s taste`;
  // Description preference order: narrative excerpt (richest signal) →
  // top genre fallback (works for sparse tier with no narrative) → tier-only.
  const narrativeSnippet = fp.narrative?.trim().length
    ? fp.narrative.trim().slice(0, 200)
    : null;
  const top = topLabel(fp.vectors.genre);
  const description = narrativeSnippet
    ? `${fp.tier} taste profile — ${narrativeSnippet}`
    : top
      ? `${fp.tier} taste profile — ${top}-leaning, ${fp.logCount} log${fp.logCount === 1 ? "" : "s"}`
      : `${fp.tier} taste profile — ${fp.logCount} log${fp.logCount === 1 ? "" : "s"}`;
  // Reuse the existing /api/og/taste/[username] card built by an earlier task —
  // it renders narrative + top-genre + playstyle in the trading-card style and
  // already gates on profile.isPublic. No new OG route needed for taste.
  const ogImage = `/api/og/taste/${profile.username}`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [ogImage],
      type: "profile",
      url: `/u/${profile.username}/taste`,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function UserTastePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const data = await getTastePageData(username);
  if (!data) notFound();
  const { profile, fp, isOwner } = data;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-8">
        <h1 className="font-mono text-2xl">
          {isOwner ? "Your taste" : `${profile.displayName ?? username}'s taste`}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {fp.logCount} {fp.logCount === 1 ? "log" : "logs"} · tier:{" "}
          <span className="font-mono">{fp.tier}</span>
        </p>
      </header>

      {fp.tier === "empty" && <TierEmpty />}

      {fp.tier === "sparse" && (
        <TierSparse
          logCount={fp.logCount}
          vectors={fp.vectors}
          lengthPreference={fp.lengthPreference}
        />
      )}

      {(fp.tier === "sharpening" || fp.tier === "full") && (
        <TierNarrative
          tier={fp.tier}
          narrative={fp.narrative}
          narrativeGeneratedAt={fp.narrativeGeneratedAt}
          vectors={fp.vectors}
          lengthPreference={fp.lengthPreference}
          isOwner={isOwner}
          isPublic={profile.isPublic}
          username={username}
          origin={await resolveOrigin()}
        />
      )}

      {isOwner && (
        <MilestoneToast
          userId={profile.userId}
          narrative={fp.narrative}
          narrativeGeneratedAt={fp.narrativeGeneratedAt}
        />
      )}
    </main>
  );
}
