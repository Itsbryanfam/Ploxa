"use client";

import { useState, useTransition } from "react";

import { follow, unfollow } from "@/lib/social/follows/server-actions";

/**
 * Optimistic follow toggle. Flips local state immediately, then commits
 * via the server action inside a React transition. On non-ok result we
 * roll the local state back to keep the UI honest. The toggle stays
 * idempotent at the action layer (follow uses INSERT ... ON CONFLICT,
 * unfollow's DELETE is a no-op when no row exists), so rapid double
 * clicks don't corrupt state.
 *
 * Rendered conditionally by ProfileOverviewHeader — only logged-in
 * non-owner viewers see this button. Blocked-pair viewers never reach
 * the profile (getProfileSummary returns null), so this button never
 * renders for them.
 */
export function FollowButton({
  targetUserId,
  initialIsFollowing,
}: {
  targetUserId: string;
  targetUsername: string;
  initialIsFollowing: boolean;
}) {
  const [isFollowing, setIsFollowing] = useState(initialIsFollowing);
  const [isPending, startTransition] = useTransition();

  function toggle() {
    const next = !isFollowing;
    setIsFollowing(next); // optimistic flip
    startTransition(async () => {
      const result = next
        ? await follow(targetUserId)
        : await unfollow(targetUserId);
      if (!result.ok) {
        setIsFollowing(!next); // rollback on failure
      }
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={isPending}
      aria-pressed={isFollowing}
      className={
        isFollowing
          ? "px-4 py-1.5 text-sm rounded-md border border-[var(--border)] hover:border-[var(--border-hover)] disabled:opacity-60"
          : "px-4 py-1.5 text-sm rounded-md bg-[var(--text)] text-[var(--bg)] hover:opacity-90 disabled:opacity-60"
      }
    >
      {isFollowing ? "Following ✓" : "Follow"}
    </button>
  );
}
