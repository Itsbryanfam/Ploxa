import { redirect } from "next/navigation";

import { listConnections } from "@/lib/imports/server-actions";
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

  const [fp, connections, params] = await Promise.all([
    getFingerprint(me.id),
    listConnections(),
    searchParams,
  ]);

  // getFingerprint returns null if our profile row was deleted — extreme
  // edge case (signed-in session against a hard-deleted profile). Bounce
  // to /home where the redirect logic will handle the broken-state.
  if (!fp) redirect("/home");

  // Surface only the platforms the user has actively connected. Manual users
  // (no platform_connections rows) still need a choice, so we fall back to
  // all three. ConnectionSummary.platform is already typed as
  // "steam" | "xbox" | "psn" so no narrowing is needed here.
  const connected = connections
    .filter((c) => c.isActive)
    .map((c) => c.platform);
  const userConnectedPlatforms: Array<"steam" | "xbox" | "psn"> =
    connected.length > 0 ? connected : ["steam", "xbox", "psn"];

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
