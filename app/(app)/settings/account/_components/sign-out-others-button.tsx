"use client";

import { useState, useTransition } from "react";
import { signOutOtherSessions } from "@/lib/auth/sessions-actions";

export function SignOutOthersButton() {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<
    { kind: "ok" | "err"; text: string } | null
  >(null);

  if (message?.kind === "ok") {
    // Recoverable success state — a Dismiss button returns to idle so the
    // user can sign out other sessions again later (e.g., a second device
    // signs in while this tab stays open).
    return (
      <div className="flex items-center gap-3">
        <p role="status" className="text-sm text-[var(--text-dim)]">
          {message.text}
        </p>
        <button
          type="button"
          onClick={() => setMessage(null)}
          className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-dim)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          Dismiss
        </button>
      </div>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="self-start rounded border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        Sign out other sessions
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-[var(--border)] bg-[var(--bg-card)]/40 p-3">
      <p className="text-sm">
        This signs you out everywhere except this browser. Continue?
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await signOutOtherSessions();
              if (!result.ok) {
                setMessage({ kind: "err", text: result.error });
                setConfirming(false);
              } else {
                setMessage({
                  kind: "ok",
                  text: "Signed out everywhere except this browser.",
                });
              }
            })
          }
          className="rounded border border-[var(--danger)] bg-[var(--danger)] px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50"
        >
          {pending ? "Signing out…" : "Yes, sign out others"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded border border-[var(--border)] px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          Cancel
        </button>
      </div>
      {message?.kind === "err" && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {message.text}
        </p>
      )}
    </div>
  );
}
