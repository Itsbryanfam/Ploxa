"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { relativeTime } from "@/lib/utils";
import { markRead, type InboxRow } from "@/lib/social/notifications/server-actions";

const COPY: Record<InboxRow["type"], (actor: string) => string> = {
  new_follower: (a) => `@${a} started following you`,
  review_liked: (a) => `@${a} liked your review`,
  list_liked: (a) => `@${a} liked your list`,
  review_commented: (a) => `@${a} commented on your review`,
  comment_replied: (a) => `@${a} replied to your comment`,
  wishlist_logged_by_friend: (a) => `@${a} just started a game on your wishlist`,
};

/**
 * Target URL resolver. Phase 5 ships with new_follower routing to the actor's
 * profile (the canonical URL is known). Other notification types route to
 * /home/feed as a sane fallback until T26 (discovery routes) exposes the
 * username+slug pairs needed to resolve review/list/comment IDs to their
 * canonical pages.
 */
function getTargetHref(row: InboxRow): string {
  if (row.type === "new_follower" && row.actorUsername) {
    return `/u/${row.actorUsername}`;
  }
  // TODO(T26): resolve review/list/comment targets to canonical URLs
  // once the discovery query helpers expose username+slug pairs by id.
  return "/home/feed";
}

export function NotificationRow(props: { row: InboxRow }) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  function onClick() {
    if (!props.row.readAt) {
      startTransition(async () => {
        await markRead(props.row.id);
      });
    }
    router.push(getTargetHref(props.row));
  }

  return (
    <li
      onClick={onClick}
      className={`flex items-center gap-3 p-3 rounded cursor-pointer hover:bg-[var(--bg-card)] ${
        props.row.readAt ? "" : "border-l-2 border-[var(--accent)]"
      }`}
    >
      {props.row.actorAvatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL not in remotePatterns; small fixed size.
        <img
          src={props.row.actorAvatarUrl}
          alt={props.row.actorUsername ?? ""}
          width={40}
          height={40}
          className="rounded-full object-cover shrink-0"
          style={{ width: 40, height: 40 }}
        />
      ) : (
        <div
          className="rounded-full bg-[var(--bg-card)] shrink-0"
          style={{ width: 40, height: 40 }}
        />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm">
          {COPY[props.row.type](props.row.actorUsername ?? "someone")}
        </p>
        <p className="text-xs text-[var(--text-dim)]">{relativeTime(props.row.createdAt)}</p>
      </div>
    </li>
  );
}
