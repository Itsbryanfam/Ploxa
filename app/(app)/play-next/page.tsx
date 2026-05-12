import { redirect } from "next/navigation";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import { getFingerprint } from "@/lib/taste/server-actions";

import { PlayNextClient } from "./_client";

// `force-dynamic` because the route reads session + a fingerprint snapshot
// that's specific to the signed-in user — must not be cached at the route
// level. URL state is authoritative on the client island.
export const dynamic = "force-dynamic";

export const metadata = { title: "What should I play? — Letterboxd for Games" };

export default async function PlayNextPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await getCachedUser();
  if (!me) redirect("/login?next=/play-next");

  const fp = await getFingerprint(me.id);
  const params = await searchParams;

  // T10 swaps the hardcoded list for real platform_connections data.
  // Keeping all three here so the demo flow works for unconnected users.
  const userConnectedPlatforms: Array<"steam" | "xbox" | "psn"> = [
    "steam",
    "xbox",
    "psn",
  ];

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-8">
        <h1 className="font-mono text-2xl">What should I play next?</h1>
      </header>
      <PlayNextClient
        initialParams={params}
        tier={fp.tier}
        userConnectedPlatforms={userConnectedPlatforms}
      />
    </main>
  );
}
