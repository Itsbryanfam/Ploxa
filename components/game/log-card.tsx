"use client";

import { useState } from "react";
import Link from "next/link";
import type { LibraryItem } from "@/lib/logs/server-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { HeartRating } from "@/components/ui/heart-rating";
import { Button } from "@/components/ui/button";
import { EditLogModal } from "./edit-log-modal";

export function LogCard({ item }: { item: LibraryItem }) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-[var(--text-faint)]">Your log</p>
          <StatusBadge status={item.status} size="lg" />
        </div>
        <div className="flex gap-1">
          <Link
            href={
              item.existingReviewId
                ? `/games/${item.game.slug}/review?reviewId=${item.existingReviewId}`
                : `/games/${item.game.slug}/review`
            }
            className="text-xs text-[var(--text-dim)] hover:text-[var(--accent)] transition px-2 py-1 border border-[var(--border)] rounded"
          >
            {item.existingReviewId ? "Edit review" : "Write with mascot"}
          </Link>
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
        </div>
      </div>

      {item.rating != null && (
        <div>
          <p className="text-xs uppercase tracking-wide text-[var(--text-faint)] mb-1">Rating</p>
          <HeartRating value={item.rating} disabled size={20} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 text-sm">
        {item.startedAt && (
          <div>
            <p className="text-xs text-[var(--text-faint)]">Started</p>
            <p className="text-[var(--text-dim)]">
              {new Date(item.startedAt).toLocaleDateString()}
            </p>
          </div>
        )}
        {item.finishedAt && (
          <div>
            <p className="text-xs text-[var(--text-faint)]">Finished</p>
            <p className="text-[var(--text-dim)]">
              {new Date(item.finishedAt).toLocaleDateString()}
            </p>
          </div>
        )}
        {item.hoursPlayed != null && (
          <div>
            <p className="text-xs text-[var(--text-faint)]">Hours</p>
            <p className="text-[var(--text-dim)]">{item.hoursPlayed}h</p>
          </div>
        )}
      </div>

      {item.notes && (
        <div>
          <p className="text-xs uppercase tracking-wide text-[var(--text-faint)] mb-1">Notes</p>
          <p className="text-sm text-[var(--text-dim)]">{item.notes}</p>
        </div>
      )}

      {editing && <EditLogModal item={item} onClose={() => setEditing(false)} />}
    </div>
  );
}
