"use client";

import { useRef, useState, useTransition } from "react";
import { ReauthChallenge } from "@/components/settings/reauth-challenge";
import { updatePassword } from "@/lib/auth/password-actions";

export function ChangePasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<
    { kind: "ok" | "err"; text: string } | null
  >(null);
  // Form ref so we can call form.reset() on success — clears the typed
  // password values from the DOM (uncontrolled inputs would otherwise
  // retain them in their .value, recoverable via DevTools or the
  // browser's bfcache on back-navigation).
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={(fd) => {
        setMessage(null);
        startTransition(async () => {
          const result = await updatePassword(fd);
          if (!result.ok) {
            setMessage({ kind: "err", text: result.error });
          } else {
            setMessage({
              kind: "ok",
              text: hasPassword ? "Password changed." : "Password set.",
            });
            // Actually clear the password fields — blur() alone only
            // removes focus and would leave the typed values in the DOM.
            formRef.current?.reset();
          }
        });
      }}
      className="flex flex-col gap-4"
    >
      {!hasPassword && (
        <div className="rounded border border-[var(--border)] bg-[var(--bg-card)]/40 p-3 text-sm text-[var(--text-dim)]">
          You sign in with magic links. Adding a password gives you a faster
          login option without losing the magic-link option.
        </div>
      )}

      <ReauthChallenge hasPassword={hasPassword} />

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[var(--text-dim)]">New password</span>
        <input
          type="password"
          name="new_password"
          required
          minLength={8}
          autoComplete="new-password"
          className="w-full max-w-xs rounded border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm focus:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[var(--text-dim)]">Confirm new password</span>
        <input
          type="password"
          name="new_password_confirm"
          required
          minLength={8}
          autoComplete="new-password"
          className="w-full max-w-xs rounded border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm focus:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50"
      >
        {pending
          ? "Saving…"
          : hasPassword
            ? "Change password"
            : "Set password"}
      </button>

      {message && (
        <p
          role={message.kind === "err" ? "alert" : "status"}
          className={
            message.kind === "ok"
              ? "text-sm text-[var(--text-dim)]"
              : "text-sm text-[var(--danger)]"
          }
        >
          {message.text}
        </p>
      )}
    </form>
  );
}
