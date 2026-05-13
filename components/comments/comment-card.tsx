"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { relativeTime } from "@/lib/utils";
import { editComment, softDeleteComment } from "@/lib/social/comments/server-actions";
import { avatarColorFor } from "@/lib/design/avatar-palette";
import { FlaggedBadge } from "./flagged-badge";

export function CommentCard(props: {
  comment: {
    id: string;
    body: string;
    userId: string;
    createdAt: Date;
    editedAt: Date | null;
    isHidden: boolean;
  };
  author: { username: string; displayName: string | null; avatarUrl: string | null };
  viewerId: string | null;
  onReply?: (commentId: string) => void;
}) {
  const router = useRouter();
  const isOwner = props.viewerId === props.comment.userId;
  const isDeleted = props.comment.body === "[deleted]";
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(props.comment.body);
  const [pending, startTransition] = useTransition();

  function onSaveEdit() {
    startTransition(async () => {
      await editComment({ commentId: props.comment.id, body });
      setEditing(false);
      router.refresh();
    });
  }

  function onDelete() {
    if (!confirm("Delete this comment? The thread structure is preserved.")) return;
    startTransition(async () => {
      await softDeleteComment({ commentId: props.comment.id });
      router.refresh();
    });
  }

  return (
    <article className="flex gap-3 py-3">
      {props.author.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL not in remotePatterns; small fixed size.
        <img
          src={props.author.avatarUrl}
          alt={props.author.username}
          width={32}
          height={32}
          className="rounded-full object-cover shrink-0"
          style={{ width: 32, height: 32 }}
        />
      ) : (
        <div
          role="img"
          aria-label={props.author.username}
          className="rounded-full flex items-center justify-center text-white font-medium select-none shrink-0"
          style={{
            width: 32,
            height: 32,
            backgroundColor: avatarColorFor(props.comment.userId),
            fontSize: 14,
          }}
        >
          {(props.author.displayName ?? props.author.username).charAt(0).toUpperCase()}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <header className="flex items-baseline gap-2 text-xs text-[var(--text-dim)]">
          <a href={`/u/${props.author.username}`} className="font-medium text-[var(--text)] hover:underline">
            @{props.author.username}
          </a>
          <span>{relativeTime(props.comment.createdAt)}</span>
          {props.comment.editedAt && <span>(edited)</span>}
        </header>
        {props.comment.isHidden && isOwner && <FlaggedBadge />}
        {editing ? (
          <div className="mt-2 space-y-2">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full p-2 text-sm rounded border border-[var(--border)] bg-[var(--bg-card)]"
              rows={3}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onSaveEdit}
                disabled={pending || body.trim().length === 0}
                className="px-2 py-1 text-xs rounded bg-[var(--accent)] text-white disabled:opacity-50"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setBody(props.comment.body);
                }}
                className="px-2 py-1 text-xs rounded border border-[var(--border)]"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p
            className={`mt-1 text-sm whitespace-pre-wrap ${isDeleted ? "italic text-[var(--text-dim)]" : ""}`}
          >
            {props.comment.body}
          </p>
        )}
        {!editing && !isDeleted && (
          <footer className="mt-2 flex gap-3 text-xs text-[var(--text-dim)]">
            {props.onReply && (
              <button
                type="button"
                onClick={() => props.onReply!(props.comment.id)}
                className="hover:text-[var(--text)]"
              >
                Reply
              </button>
            )}
            {isOwner && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="hover:text-[var(--text)]"
              >
                Edit
              </button>
            )}
            {isOwner && (
              <button type="button" onClick={onDelete} className="hover:text-[var(--text)]">
                Delete
              </button>
            )}
          </footer>
        )}
      </div>
    </article>
  );
}
