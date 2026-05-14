"use client";
import { useTransition } from "react";
import Link from "next/link";

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
 * Notification row. Renders as a Next.js <Link> when the server-resolved
 * targetHref is non-null (free keyboard accessibility + semantic navigation),
 * or as a plain non-interactive <li> when the target was hard-deleted, the
 * actor was soft-deleted, or the type has no resolved route yet.
 *
 * The previous implementation rendered as <li onClick> with no role or
 * tabIndex — keyboard users could not activate notifications (WCAG 2.1.1).
 * The fallback href-resolver also dead-ended every type except new_follower
 * on /home/feed; that's now resolved server-side in getInbox via batched
 * lookups. See lib/social/notifications/target-resolver.ts for the URL shape
 * matrix.
 */
export function NotificationRow(props: { row: InboxRow }) {
  const [, startTransition] = useTransition();

  function markReadOnce() {
    if (!props.row.readAt) {
      startTransition(async () => {
        await markRead(props.row.id);
      });
    }
  }

  const unreadBorderClass = props.row.readAt
    ? ""
    : "border-l-2 border-[var(--accent)]";
  const baseClass = `flex items-center gap-3 p-3 rounded ${unreadBorderClass}`;

  const inner = (
    <>
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
        <p className="text-xs text-[var(--text-dim)]">
          {relativeTime(props.row.createdAt)}
        </p>
      </div>
    </>
  );

  // Tombstone path: target was hard-deleted, actor was soft-deleted, or the
  // type has no resolved route. Render as a plain non-interactive list item —
  // never as a click-able dead link.
  if (!props.row.targetHref) {
    return <li className={baseClass}>{inner}</li>;
  }

  // Live path: render as Next Link. The browser handles keyboard activation
  // for free (Enter on a focused anchor); we attach mark-as-read to onClick
  // (also fires on Enter via synthetic keyboard click).
  return (
    <li>
      <Link
        href={props.row.targetHref}
        onClick={markReadOnce}
        className={`${baseClass} hover:bg-[var(--bg-card)] focus-visible:bg-[var(--bg-card)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]`}
      >
        {inner}
      </Link>
    </li>
  );
}
