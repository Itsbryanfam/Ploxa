"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";

import { relativeTime } from "@/lib/utils";
import { editComment, softDeleteComment } from "@/lib/social/comments/server-actions";
import { avatarColorFor } from "@/lib/design/avatar-palette";
import { ReportModal } from "@/components/moderation/report-modal";
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
  author: {
    username: string;
    displayName: string | null;
    profilePictureUrl: string | null;
  };
  viewerId: string | null;
  onReply?: (commentId: string) => void;
}) {
  const router = useRouter();
  const isOwner = props.viewerId === props.comment.userId;
  const isDeleted = props.comment.body === "[deleted]";
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(props.comment.body);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSaveEdit() {
    startTransition(async () => {
      await editComment({ commentId: props.comment.id, body });
      setEditing(false);
      router.refresh();
    });
  }

  function onDelete() {
    startTransition(async () => {
      await softDeleteComment({ commentId: props.comment.id });
      setConfirmDeleteOpen(false);
      router.refresh();
    });
  }

  return (
    <article className="flex gap-3 py-3">
      {props.author.profilePictureUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL not in remotePatterns; small fixed size.
        <img
          src={props.author.profilePictureUrl}
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
            {!isOwner && props.viewerId && (
              <ReportModal targetType="comment" targetId={props.comment.id} />
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
              <button
                type="button"
                onClick={() => setConfirmDeleteOpen(true)}
                className="hover:text-[var(--text)]"
              >
                Delete
              </button>
            )}
          </footer>
        )}
      </div>

      {/* Destructive confirm — Radix gives us focus trap, Esc, focus restore.
          Soft-delete preserves replies under "[deleted]" so the thread tree
          stays intact; we surface that explicitly so deleting feels
          predictable rather than scary. */}
      <Dialog.Root open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[min(420px,calc(100vw-32px))] rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-6 shadow-2xl">
            <Dialog.Title className="text-lg font-semibold">
              Delete this comment?
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-[var(--text-dim)]">
              Your comment text is removed and replaced with &ldquo;[deleted]&rdquo;.
              Replies stay so the thread reads in order. You can&apos;t undo this.
            </Dialog.Description>
            <div className="mt-6 flex justify-end gap-2">
              <Dialog.Close asChild>
                <button
                  type="button"
                  disabled={pending}
                  className="px-4 py-1.5 text-sm rounded-md border border-[var(--border)] hover:border-[var(--border-hover)] disabled:opacity-50"
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="button"
                onClick={onDelete}
                disabled={pending}
                className="px-4 py-1.5 text-sm rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {pending ? "Deleting…" : "Delete"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </article>
  );
}
