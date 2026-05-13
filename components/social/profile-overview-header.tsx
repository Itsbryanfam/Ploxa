import Link from "next/link";

import { Mascot } from "@/components/mascot/mascot";

import { BlockAction } from "./block-action";
import { FollowButton } from "./follow-button";

/**
 * Profile hub header. Server component — embeds two client islands
 * (FollowButton, BlockAction) only when the viewer is logged-in AND
 * non-owner.
 *
 * Blocked-pair viewers can't reach here: getProfileSummary returns
 * null for those, so the parent page hits notFound() before rendering.
 * That means we don't need to defensively hide the FollowButton based
 * on a "blocked" prop — the very rendering of this header is the proof
 * we're not blocked.
 */
export function ProfileOverviewHeader({
  profile,
  isOwner,
  isViewerLoggedIn,
  isFollowing,
  followerCount,
  followingCount,
}: {
  profile: {
    userId: string;
    username: string;
    displayName: string | null;
    bio: string | null;
    avatarUrl: string | null;
  };
  isOwner: boolean;
  isViewerLoggedIn: boolean;
  isFollowing: boolean;
  followerCount: number;
  followingCount: number;
}) {
  const showActions = isViewerLoggedIn && !isOwner;
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-center gap-6">
        <Mascot size="xl" mood="idle" silent />
        <div>
          <h1 className="text-3xl font-bold">
            {profile.displayName ?? profile.username}
          </h1>
          <p className="text-sm text-[var(--text-dim)]">@{profile.username}</p>
          {profile.bio && (
            <p className="mt-2 text-sm text-[var(--text)] max-w-md">
              {profile.bio}
            </p>
          )}
          <p className="mt-3 text-sm text-[var(--text-dim)]">
            <Link
              href={`/u/${profile.username}/followers`}
              className="hover:text-[var(--text)] hover:underline"
            >
              {followerCount} {followerCount === 1 ? "follower" : "followers"}
            </Link>
            <span className="mx-2">·</span>
            <Link
              href={`/u/${profile.username}/following`}
              className="hover:text-[var(--text)] hover:underline"
            >
              {followingCount} following
            </Link>
          </p>
        </div>
      </div>

      {showActions && (
        <div className="flex items-center gap-2">
          <FollowButton
            targetUserId={profile.userId}
            initialIsFollowing={isFollowing}
          />
          <BlockAction
            targetUserId={profile.userId}
            targetUsername={profile.username}
          />
        </div>
      )}
    </header>
  );
}
