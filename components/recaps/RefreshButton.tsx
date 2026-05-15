"use client";

/**
 * RefreshButton — Phase 6 T20.
 *
 * Inline button rendered as a sibling of the share buttons in the
 * closing-scene control row. Calls the `refreshYearly` server action,
 * then reloads the page so the newly built payload is fetched.
 *
 * Styled to match the "Copy link" secondary button so the closing
 * action row reads as one coherent group rather than the prior
 * absolutely-positioned floating pill above the share row.
 *
 * Error display: any error (rate-limit, server) renders below the
 * row via the `onError` callback. The parent owns the surface area
 * for that message so it can position it relative to the whole row.
 */

import { useState, useTransition } from "react";
import { refreshYearly } from "@/lib/recaps/refresh-action";

interface RefreshButtonProps {
  year: number;
  onError?: (message: string | null) => void;
}

export function RefreshButton({ year, onError }: RefreshButtonProps) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  const handleClick = () => {
    onError?.(null);
    startTransition(async () => {
      const res = await refreshYearly({ year });
      if (res.ok) {
        setDone(true);
        // Hard reload so the server-rendered page reflects the new payload.
        window.location.reload();
      } else {
        onError?.(res.error);
      }
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending || done}
      aria-busy={pending}
      className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-6 py-3 text-sm font-medium text-[var(--text)] shadow-lg transition-colors hover:bg-[var(--bg-card-hover)] disabled:opacity-50"
    >
      {done ? "Refreshed" : pending ? "Refreshing…" : "Refresh my year"}
    </button>
  );
}
