"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { EyeOff, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { resolveReport } from "@/lib/social/moderation/server-actions";

/**
 * Per-row admin actions for the moderation queue. Hide marks comments as
 * `is_hidden=true` (review/list/profile resolutions are metadata-only — see
 * resolveReport docs). Keep records the resolution with no target mutation.
 *
 * On a successful action we:
 *   1. fire `onResolved(reportId)` so the parent ReportsQueue removes the row
 *      optimistically (no waiting for `router.refresh()` to land), and
 *   2. still call `router.refresh()` so any other server-rendered surfaces
 *      (counts, etc.) update on the next navigation.
 *
 * Per-row pending uses `useTransition` — the spinner replaces the
 * Hide/Keep icons while the action is in flight, so a slow round-trip
 * doesn't look like a no-op click.
 *
 * Surfaces success + failure via `sonner` toasts (Toaster mounted globally
 * in app/providers.tsx) for consistency with the rest of the client UI.
 */
export function ModerationActions({
  reportId,
  targetType,
  onResolved,
}: {
  reportId: string;
  targetType: string;
  onResolved?: (reportId: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function act(action: "hide" | "keep") {
    startTransition(async () => {
      const result = await resolveReport({ reportId, action });
      if (result.ok) {
        // Optimistic removal first so the row vanishes from the visible list
        // immediately; router.refresh() rehydrates server data in the
        // background. Without onResolved the row would linger until the
        // refresh round-trip completed, which a mod would read as a stalled
        // click (and likely re-click).
        onResolved?.(reportId);
        router.refresh();
        toast.success("Report resolved");
      } else {
        toast.error(`Couldn't resolve report: ${result.reason ?? "unknown"}`);
      }
    });
  }

  return (
    <div className="flex gap-2" aria-busy={pending}>
      <button
        type="button"
        onClick={() => act("hide")}
        disabled={pending}
        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-[var(--bg-card-hover)] border border-[var(--border)] hover:border-[var(--accent)] disabled:opacity-60"
        title={
          targetType === "comment"
            ? "Hide this comment"
            : "Mark resolved (hide manually for non-comment targets)"
        }
      >
        {pending ? (
          <Loader2 size={12} className="animate-spin" aria-hidden="true" />
        ) : (
          <EyeOff size={12} aria-hidden="true" />
        )}
        Hide
      </button>
      <button
        type="button"
        onClick={() => act("keep")}
        disabled={pending}
        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-[var(--bg-card-hover)] border border-[var(--border)] hover:border-[var(--accent)] disabled:opacity-60"
      >
        {pending ? (
          <Loader2 size={12} className="animate-spin" aria-hidden="true" />
        ) : (
          <Check size={12} aria-hidden="true" />
        )}
        Keep
      </button>
    </div>
  );
}
