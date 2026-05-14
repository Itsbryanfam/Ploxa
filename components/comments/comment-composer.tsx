"use client";
import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";

import { createComment } from "@/lib/social/comments/server-actions";

/**
 * Comment composer — plain textarea + server-action submit.
 *
 * Autocomplete: the spec calls for an @-mention popover. For Phase 5 we ship
 * plain typing only (mentions ARE parsed server-side by parseMentions; the UI
 * affordance is just deferred). Popover scaffold belongs to Phase 6 polish.
 */
export function CommentComposer(props: {
  reviewId: string;
  parentId: string | null;
  onSubmitted?: () => void;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  function onSubmit() {
    if (body.trim().length === 0) return;
    setError(null);
    startTransition(async () => {
      const result = await createComment({
        reviewId: props.reviewId,
        body: body.trim(),
        parentId: props.parentId,
      });
      if (result.ok) {
        setBody("");
        props.onSubmitted?.();
        router.refresh();
      } else {
        setError("Couldn't post your comment. Please try again.");
      }
    });
  }

  return (
    <div className="space-y-2 py-3">
      <textarea
        ref={ref}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={props.parentId ? "Write a reply…" : "Write a comment…"}
        aria-label={props.parentId ? "Reply" : "Comment"}
        rows={3}
        maxLength={5000}
        className="w-full p-2 text-sm rounded border border-[var(--border)] bg-[var(--bg-card)]"
      />
      {error && (
        <p className="text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onSubmit}
          disabled={pending || body.trim().length === 0}
          className="px-3 py-1.5 text-sm rounded bg-[var(--accent)] text-white hover:brightness-110 disabled:opacity-50"
        >
          {pending ? "Posting…" : "Post"}
        </button>
      </div>
    </div>
  );
}
