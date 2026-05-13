import { notFound } from "next/navigation";

import { FollowersGrid } from "@/components/social/followers-grid";
import { getProfileByUsername } from "@/lib/profile/server-actions";
import { getFollowing } from "@/lib/social/follows/server-actions";
import { getCachedUser } from "@/lib/supabase/auth-cache";

/**
 * Following list for @{username}. Mirrors the followers route — same
 * privacy gate, same block filtering, only the loader and header copy
 * differ.
 */
export default async function FollowingPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const [profile, viewer] = await Promise.all([
    getProfileByUsername(username),
    getCachedUser(),
  ]);
  if (!profile) notFound();
  if (!profile.isPublic && viewer?.id !== profile.userId) notFound();

  const following = await getFollowing(profile.userId, viewer?.id ?? null);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">
          @{profile.username} is following
        </h1>
        <p className="text-sm text-[var(--text-dim)] mt-1">
          {following.length}{" "}
          {following.length === 1 ? "person" : "people"}
        </p>
      </header>
      <FollowersGrid users={following} emptyText="Not following anyone yet." />
    </div>
  );
}
