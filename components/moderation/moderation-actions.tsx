"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { EyeOff, Check } from "lucide-react";
import { toast } from "sonner";

import { resolveReport } from "@/lib/social/moderation/server-actions";

/**
 * Per-row admin actions for the moderation queue. Hide marks comments as
 * `is_hidden=true` (review/list/profile resolutions are metadata-only — see
 * resolveReport docs). Keep records the resolution with no target mutation.
 *
 * Surfaces success + failure via `sonner` toasts (Toaster mounted globally
 * in app/providers.tsx) for consistency with the rest of the client UI.
 */
export function ModerationActions({
  reportId,
  targetType,
}: {
  reportId: string;
  targetType: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function act(action: "hide" | "keep") {
    startTransition(async () => {
      const result = await resolveReport({ reportId, action });
      if (result.ok) {
        router.refresh();
        toast.success("Report resolved");
      } else {
        toast.error(`Couldn't resolve report: ${result.reason ?? "unknown"}`);
      }
    });
  }

  return (
    <div className="flex gap-2">
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
        <EyeOff size={12} /> Hide
      </button>
      <button
        type="button"
        onClick={() => act("keep")}
        disabled={pending}
        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-[var(--bg-card-hover)] border border-[var(--border)] hover:border-[var(--accent)] disabled:opacity-60"
      >
        <Check size={12} /> Keep
      </button>
    </div>
  );
}
