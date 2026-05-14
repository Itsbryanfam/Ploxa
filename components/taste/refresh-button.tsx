"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { refreshFingerprint } from "@/lib/taste/server-actions";

/**
 * Owner-only client island that triggers the manual refresh server action,
 * shows a pending state, and surfaces structured failures via toast.
 *
 * Mounted only inside TierNarrative behind an `isOwner` check (the server
 * action also re-verifies auth on the server, so the client gate is for UX
 * not security). On success we call `router.refresh()` rather than
 * round-tripping through React Query — the page is a server component, so
 * a refresh re-runs `getFingerprint` and re-renders the new narrative.
 */
export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const result = await refreshFingerprint();
      if (result.ok) {
        toast.success("Fingerprint refreshed");
        router.refresh();
        return;
      }
      if (result.reason === "rate-limited") {
        // retryAfterSeconds is already in seconds; round up to hours so the
        // toast reads cleanly even when the rate limit window is shorter
        // than a full hour remaining.
        const hrs = Math.ceil((result.retryAfterSeconds ?? 3600) / 3600);
        toast.error(`You can refresh again in ${hrs}h.`);
        return;
      }
      if (result.reason === "ai-failure") {
        toast.error("Couldn't refresh right now — try again in a few minutes.");
        return;
      }
      // reason === "unauthorized"
      toast.error("You need to be signed in to refresh.");
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="rounded border border-[var(--border)] px-3 py-1 text-xs hover:bg-[var(--bg-card-hover)] disabled:opacity-60"
    >
      {pending ? "Refreshing…" : "Refresh fingerprint"}
    </button>
  );
}
