import { notFound } from "next/navigation";

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

  const fp = await getFingerprint(profile.userId);

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
        />
      )}
    </main>
  );
}
