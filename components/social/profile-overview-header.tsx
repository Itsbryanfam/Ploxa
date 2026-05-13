import Link from "next/link";

import { Mascot } from "@/components/mascot/mascot";

import { BlockAction } from "./block-action";
import { FollowButton } from "./follow-button";

/**
 * Profile hub header. Server component — embeds two client islands
 * (FollowButton, BlockAction) only when the viewer is logged-in AND
 * non-owner.
 *
 * Avatar render rules:
 *   - profilePictureUrl set → raw <img> (Supabase Storage URLs aren't in
 *     remotePatterns; same convention as components/ui/avatar.tsx).
 *   - profilePictureUrl null → Mascot fallback (idle, silent, xl).
 *
 *   GIF avatars are rendered as their first-frame poster here without the
 *   hover-to-animate behavior — that lives in <Avatar> (client component)
 *   and isn't worth a client-island regression on the header just for the
 *   bigger profile-hub size. Tradeoff documented; revisit if GIF avatars
 *   gain wider usage.
 *
 * Display-name fallback intentionally walks `displayName ?? username` —
 * if the row was seeded with email-as-displayName (legacy ensureMyProfile
 * behavior pre-2026-05-13 fix), the email would leak here. The fix landed
 * in lib/profile/server-actions.ts but pre-existing rows must be
 * backfilled (UPDATE display_name = NULL) for the leak to clear.
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
    profilePictureUrl: string | null;
    profilePictureKind: "static" | "gif" | null;
  };
  isOwner: boolean;
  isViewerLoggedIn: boolean;
  isFollowing: boolean;
  followerCount: number;
  followingCount: number;
}) {
  const showActions = isViewerLoggedIn && !isOwner;
  const displayName = profile.displayName ?? profile.username;
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-center gap-6">
        {profile.profilePictureUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URLs not in remotePatterns; same convention as components/ui/avatar.tsx
          <img
            src={profile.profilePictureUrl}
            alt={`${displayName}'s avatar`}
            width={128}
            height={128}
            className="rounded-full object-cover shrink-0"
            style={{ width: 128, height: 128 }}
          />
        ) : (
          <Mascot size="xl" mood="idle" silent />
        )}
        <div>
          <h1 className="text-3xl font-bold">
            {displayName}
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
