"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { unblock } from "@/lib/social/blocks/server-actions";
import { Mascot } from "@/components/mascot/mascot";
import { relativeTime } from "@/lib/utils";

interface BlockedUser {
  userId: string;
  username: string;
  displayName: string | null;
  profilePictureUrl: string | null;
  blockedAt: Date;
}

interface Props {
  initial: BlockedUser[];
}

export function BlockedList({ initial }: Props) {
  const [rows, setRows] = useState(initial);
  const [, startTransition] = useTransition();
  // Per-row pending tracking. A shared useTransition `pending` would freeze
  // every Unblock button while any single row is in flight — punishing users
  // with multiple blocked accounts. Keying by userId lets each row's spinner
  // / disabled state stay local.
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [errorMap, setErrorMap] = useState<Record<string, string>>({});

  function handleUnblock(userId: string) {
    setErrorMap((prev) => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
    setPendingIds((prev) => new Set(prev).add(userId));

    // Optimistically remove the row
    setRows((prev) => prev.filter((r) => r.userId !== userId));

    startTransition(async () => {
      const res = await unblock(userId);
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
      if (!res.ok) {
        // Restore the row on failure
        setRows((prev) => {
          const wasRemoved = initial.find((r) => r.userId === userId);
          if (!wasRemoved) return prev;
          // Re-insert in original sort order (newest first by blockedAt)
          const merged = [...prev, wasRemoved].sort(
            (a, b) =>
              new Date(b.blockedAt).getTime() - new Date(a.blockedAt).getTime(),
          );
          return merged;
        });
        setErrorMap((prev) => ({
          ...prev,
          [userId]: "Failed to unblock. Please try again.",
        }));
      }
    });
  }

  if (rows.length === 0) {
    return (
      <div className="text-center py-12">
        <Mascot size="lg" mood="idle" silent />
        <p className="mt-4 text-sm text-[var(--text-dim)]">
          You haven&apos;t blocked anyone.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {rows.map((b) => (
        <li
          key={b.userId}
          className="flex items-center justify-between p-3 rounded-lg border border-[var(--border)]"
        >
          <div className="flex items-center gap-3 min-w-0">
            {b.profilePictureUrl ? (
              <Image
                src={b.profilePictureUrl}
                alt=""
                width={40}
                height={40}
                className="rounded-full"
                unoptimized
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-[var(--bg-card)]" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">
                {b.displayName ?? b.username}
              </p>
              <p className="text-xs text-[var(--text-dim)]">
                @{b.username} &middot; Blocked {relativeTime(b.blockedAt)}
              </p>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1 shrink-0 ml-3">
            <button
              type="button"
              onClick={() => handleUnblock(b.userId)}
              disabled={pendingIds.has(b.userId)}
              className="px-3 py-1.5 text-sm rounded-md border border-[var(--border)] hover:border-[var(--border-hover)] disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              Unblock
            </button>
            {errorMap[b.userId] && (
              <p className="text-xs text-[var(--danger)]" role="alert">
                {errorMap[b.userId]}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
