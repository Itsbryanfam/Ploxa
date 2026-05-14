"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ReauthChallenge } from "@/components/settings/reauth-challenge";
import { softDeleteAccount } from "@/lib/settings/account-deletion-actions";

type Props = { hasPassword: boolean; username: string };

export function DeleteAccountFlow({ hasPassword, username }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-[var(--danger)] bg-[var(--danger)] px-3 py-2 text-sm text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        Delete my account
      </button>
    );
  }

  return (
    <form
      action={(fd) => {
        setError(null);
        startTransition(async () => {
          const result = await softDeleteAccount(fd);
          if (!result.ok) {
            setError(result.error);
          } else {
            // Hard navigation — the global sign-out has invalidated the
            // session cookie, so router.push (which keeps client cache)
            // would render stale auth state. router.replace + refresh
            // is the safe combo.
            router.replace("/account-deleted");
            router.refresh();
          }
        });
      }}
      className="flex flex-col gap-4 rounded border border-[var(--danger)]/50 bg-[var(--bg-card)]/40 p-4"
    >
      <div className="text-sm">
        <p className="font-medium">This will:</p>
        <ul className="mt-2 list-disc pl-5 text-[var(--text-dim)]">
          <li>Hide your reviews and ratings from the feed immediately</li>
          <li>
            Remove your taste fingerprint from your followers&apos;
            recommendations
          </li>
          <li>Hide your imported library</li>
          <li>
            Permanently delete everything in 30 days unless you sign back in
            to cancel
          </li>
        </ul>
      </div>

      <ReauthChallenge hasPassword={hasPassword} />

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[var(--text-dim)]">
          Type your username (
          <code className="text-[var(--text)]">{username}</code>) to confirm
        </span>
        <input
          type="text"
          name="confirm_username"
          required
          autoComplete="off"
          className="w-full max-w-xs rounded border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm focus:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        />
      </label>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded border border-[var(--danger)] bg-[var(--danger)] px-3 py-2 text-sm text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50"
        >
          {pending ? "Deleting…" : "Delete my account"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded border border-[var(--border)] px-3 py-2 text-sm hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          Cancel
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
    </form>
  );
}
