"use client";

/**
 * RefreshButton — Phase 6 T20.
 *
 * Client component rendered on the closing scene of a current-year recap
 * (owner-only, non-locked). Calls the `refreshYearly` server action, then
 * reloads the page so the newly built payload is fetched from the server.
 *
 * States:
 *   - idle      → "Refresh my year" button
 *   - pending   → "Refreshing…" (disabled, aria-busy)
 *   - done      → "Refreshed." text (page reloads before this renders)
 *   - error     → error message below the button (rate-limit or server error)
 *
 * The `window.location.reload()` on success means the `done` state will
 * almost never be seen in practice — it's defensive for environments where
 * `reload()` is suppressed (SSR tests, storybook).
 */

import { useState, useTransition } from "react";
import { refreshYearly } from "@/lib/recaps/refresh-action";

interface RefreshButtonProps {
  year: number;
}

export function RefreshButton({ year }: RefreshButtonProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleClick = () => {
    setError(null);
    startTransition(async () => {
      const res = await refreshYearly({ year });
      if (res.ok) {
        setDone(true);
        // Hard reload so the server-rendered page reflects the new payload.
        window.location.reload();
      } else {
        setError(res.error);
      }
    });
  };

  if (done) {
    return (
      <p className="text-sm text-[var(--text-dim)]">Refreshed.</p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        aria-busy={pending}
        className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-5 py-2 text-sm text-[var(--text)] hover:bg-[var(--bg-card-hover)] disabled:opacity-50"
      >
        {pending ? "Refreshing…" : "Refresh my year"}
      </button>
      {error && (
        <p role="alert" className="text-xs text-[var(--text-dim)]">
          {error}
        </p>
      )}
    </div>
  );
}
