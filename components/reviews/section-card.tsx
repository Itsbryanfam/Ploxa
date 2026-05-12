"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { regenerateSection } from "@/lib/reviews/server-actions";
import { readAccumulatedStream } from "@/lib/streams/read-accumulated";

interface Props {
  label: "Hook" | "Highs" | "Lows" | "Verdict";
  sectionIndex: 0 | 1 | 2 | 3;
  reviewId: string;
  text: string;
  onChange: (next: string) => void;
  /** When false (manual review), hide the Regenerate button — there's no
   *  Q&A context to draw from, so AI regenerate would just hallucinate. */
  canRegenerate: boolean;
}

export function SectionCard({
  label,
  sectionIndex,
  reviewId,
  text,
  onChange,
  canRegenerate,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function startEdit() {
    setDraft(text);
    setEditing(true);
  }
  function commitEdit() {
    onChange(draft);
    setEditing(false);
  }
  function cancelEdit() {
    setDraft(text);
    setEditing(false);
  }

  function regenerate() {
    setError(null);
    setStreaming(true);
    startTransition(async () => {
      const result = await regenerateSection({ reviewId, sectionIndex });
      if (!result.ok) {
        setError(result.error);
        setStreaming(false);
        return;
      }
      try {
        await readAccumulatedStream(result.stream, (latest) => {
          onChange(latest);
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Regenerate failed");
      } finally {
        setStreaming(false);
      }
    });
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4 space-y-3 group">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-[var(--text-faint)]">{label}</span>
        {!editing && (
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
            <Button variant="ghost" size="sm" onClick={startEdit} disabled={streaming}>
              Edit
            </Button>
            {canRegenerate && (
              <Button variant="ghost" size="sm" onClick={regenerate} disabled={pending || streaming}>
                {streaming ? "Rewriting…" : "Regenerate"}
              </Button>
            )}
          </div>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full min-h-24 rounded border border-[var(--border)] bg-transparent p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={cancelEdit}>
              Cancel
            </Button>
            <Button size="sm" onClick={commitEdit} disabled={draft.trim().length === 0}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text)]">
          {text}
          {streaming && <span className="animate-pulse">&#9612;</span>}
        </p>
      )}

      {error && (
        <p className="text-xs text-red-500" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
