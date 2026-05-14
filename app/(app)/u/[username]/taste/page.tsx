import { headers } from "next/headers";
import { notFound } from "next/navigation";

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

export default async function UserTastePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const profile = await getProfileByUsername(username);
  if (!profile) notFound();

  const me = await getCachedUser();
  const isOwner = me?.id === profile.userId;

  // Privacy gate: 404 when profile is private and viewer isn't owner.
  if (!profile.isPublic && !isOwner) notFound();

  // getFingerprint also runs its own owner-or-public visibility check
  // against the same profile row (defense in depth — it's a "use server"
  // RPC). Returning null here would only happen on a TOCTOU race with a
  // privacy flip; treat it the same as the page-level gate above.
  const fp = await getFingerprint(profile.userId);
  if (!fp) notFound();

  // Empty-tier page is owner-only — non-owners 404 so we don't leak the
  // "user has no logs" state to strangers browsing a public profile.
  if (fp.tier === "empty" && !isOwner) notFound();

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
