"use client";
import Link from "next/link";
import { useState } from "react";

export function ImportsNudge() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  function dismiss() {
    document.cookie = "imports-nudge-dismissed=1; max-age=31536000; path=/";
    setDismissed(true);
  }

  return (
    <div className="border border-[var(--border)] rounded-md p-4 flex items-center gap-3 bg-[var(--bg-card)]">
      <div className="flex-1">
        <div className="text-sm font-medium">Skip the manual entry</div>
        <div className="text-xs text-[var(--text-muted)]">
          Connect Steam or Xbox to bulk-import your library.
        </div>
      </div>
      <Link
        href="/settings#connections"
        className="text-xs px-3 py-1.5 rounded bg-[var(--accent)] text-white shrink-0"
      >
        Connect →
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="text-[var(--text-muted)] hover:text-[var(--text)] px-2 shrink-0"
      >
        ×
      </button>
    </div>
  );
}
