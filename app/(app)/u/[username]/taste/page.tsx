import { notFound } from "next/navigation";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import { ChartGrid } from "@/components/taste/chart-grid";
import { getProfileByUsername } from "@/lib/profile/server-actions";
import { getFingerprint } from "@/lib/taste/server-actions";

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

  // T3 ships sharpening-tier render only. T6 adds empty/sparse/full
  // variants. For owners at empty/sparse, fall through to the same
  // chart-only view (which will show "No signal yet" placeholders).
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

      <ChartGrid vectors={fp.vectors} lengthPreference={fp.lengthPreference} />
    </main>
  );
}
