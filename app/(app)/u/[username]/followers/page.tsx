import { notFound } from "next/navigation";

import { FollowersGrid } from "@/components/social/followers-grid";
import { getProfileByUsername } from "@/lib/profile/server-actions";
import { getFollowers } from "@/lib/social/follows/server-actions";
import { getCachedUser } from "@/lib/supabase/auth-cache";

/**
 * Followers list for @{username}. Same privacy contract as the overview
 * hub — private profile + non-owner viewer → 404 (no existence leak).
 * Block-filtering is applied inside getFollowers via withBlockedFilter,
 * so the viewer never sees rows for users they've blocked or been
 * blocked by.
 */
export default async function FollowersPage({
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

  const followers = await getFollowers(profile.userId, viewer?.id ?? null);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">
          @{profile.username}&apos;s followers
        </h1>
        <p className="text-sm text-[var(--text-dim)] mt-1">
          {followers.length}{" "}
          {followers.length === 1 ? "person" : "people"}
        </p>
      </header>
      <FollowersGrid users={followers} />
    </div>
  );
}
