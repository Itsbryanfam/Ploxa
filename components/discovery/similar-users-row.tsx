import Link from "next/link";
import { FollowButton } from "@/components/social/follow-button";
import { tierForUser } from "@/lib/taste/tier";
import type { SimilarUser } from "@/lib/social/discovery/similar-users";

/**
 * Grid of similar-taste users. The avatar + name block is a single
 * `<Link className="contents">` so the entire card content (minus the
 * follow button) becomes one clickable region; FollowButton sits as a
 * sibling so we don't nest interactive elements inside an anchor.
 *
 * Empty state lives at the page level — this component stays silent
 * (returns null) so the parent owns the "no matches" UX (e.g. mascot
 * empty state on /discover/people).
 *
 * Tier badge: `tierForUser` returns "empty" | "sparse" | "sharpening" |
 * "full". The "empty" tier is filtered out upstream (getSimilarUsers
 * requires >= 10 logs to enter the candidate pool), so we won't render
 * "empty" here; guard anyway for defense in depth.
 */
export function SimilarUsersRow({ users }: { users: SimilarUser[] }) {
  if (users.length === 0) {
    return null; // page-level empty state owns this; row stays silent
  }
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {users.map((u) => {
        const tier = tierForUser(u.tierLogCount);
        const tierLabel = tier === "empty" ? "" : tier.charAt(0).toUpperCase() + tier.slice(1);
        return (
          <li
            key={u.userId}
            className="flex flex-col items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4 text-center focus-within:ring-2 focus-within:ring-[var(--accent)] focus-within:ring-offset-2 focus-within:ring-offset-[var(--bg)]"
          >
            <Link href={`/u/${u.username}`} className="contents">
              {u.profilePictureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URLs not in remotePatterns
                <img
                  src={u.profilePictureUrl}
                  alt=""
                  width={64}
                  height={64}
                  className="rounded-full object-cover"
                  style={{ width: 64, height: 64 }}
                />
              ) : (
                <div
                  className="rounded-full bg-[var(--bg)]"
                  style={{ width: 64, height: 64 }}
                />
              )}
              <div className="space-y-0.5">
                <p className="text-sm font-semibold">{u.displayName ?? u.username}</p>
                <p className="text-xs text-[var(--text-dim)]">@{u.username}</p>
                {tierLabel && (
                  <p className="text-xs text-[var(--text-faint)]">
                    {tierLabel} · {Math.round(u.similarity * 100)}% match
                  </p>
                )}
              </div>
            </Link>
            <FollowButton targetUserId={u.userId} initialIsFollowing={false} />
          </li>
        );
      })}
    </ul>
  );
}
