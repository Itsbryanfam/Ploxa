import Link from "next/link";

import { Mascot } from "@/components/mascot/mascot";
import { avatarColorFor } from "@/lib/design/avatar-palette";

/**
 * Shared 2/3/4-column responsive grid used by both /followers and /following.
 * Server component — no interactivity, the whole cell is a link.
 *
 * Source rows come from getFollowers/getFollowing which only project the
 * legacy `avatarUrl` column. If the URL is missing we fall back to a
 * deterministic initials chip via `avatarColorFor(userId)` — matches the
 * fallback branch of components/ui/avatar.tsx so the empty-pfp case
 * looks identical to the header avatar elsewhere in the app.
 */
export function FollowersGrid({
  users,
  emptyText = "No one yet.",
}: {
  users: Array<{
    userId: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  }>;
  emptyText?: string;
}) {
  if (users.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <Mascot size="lg" mood="idle" silent />
        <p className="text-sm text-[var(--text-dim)]">{emptyText}</p>
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
      {users.map((u) => (
        <li key={u.userId}>
          <Link
            href={`/u/${u.username}`}
            className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 hover:border-[var(--border-hover)] transition"
          >
            {u.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL not in remotePatterns; small fixed size.
              <img
                src={u.avatarUrl}
                alt={u.username}
                width={40}
                height={40}
                className="rounded-full object-cover"
                style={{ width: 40, height: 40 }}
              />
            ) : (
              <div
                role="img"
                aria-label={u.username}
                className="rounded-full flex items-center justify-center text-white font-medium select-none"
                style={{
                  width: 40,
                  height: 40,
                  backgroundColor: avatarColorFor(u.userId),
                  fontSize: 20,
                }}
              >
                {(u.displayName ?? u.username).charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">
                {u.displayName ?? u.username}
              </p>
              <p className="text-xs text-[var(--text-dim)] truncate">
                @{u.username}
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
