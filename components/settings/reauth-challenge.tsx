"use client";

import { useState } from "react";
import { sendReauthOtp } from "@/lib/auth/reauth-actions";

type Props = {
  /** True when the current user has a password set (change-password mode). */
  hasPassword: boolean;
  /**
   * Form-field names — the parent server action reads these from FormData.
   * Defaults match what the consuming forms in this overhaul use.
   */
  passwordFieldName?: string;
  codeFieldName?: string;
};

export function ReauthChallenge({
  hasPassword,
  passwordFieldName = "current_password",
  codeFieldName = "otp_code",
}: Props) {
  if (hasPassword) {
    return (
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[var(--text-dim)]">Current password</span>
        <input
          type="password"
          name={passwordFieldName}
          required
          autoComplete="current-password"
          className="w-full max-w-xs rounded border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm focus:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        />
      </label>
    );
  }
  // Keying on codeFieldName ensures the OTP state machine resets if a parent
  // form remounts ReauthChallenge with different field names (latent
  // safety; current consumers all use the default).
  return <OtpChallenge key={codeFieldName} codeFieldName={codeFieldName} />;
}

function OtpChallenge({ codeFieldName }: { codeFieldName: string }) {
  // NOTE: form.reset() called by a parent form does NOT reset this
  // component's React state (sent, sending, error). After a successful
  // parent submit the OTP "Enter code" view stays visible. If a future
  // consumer needs a full reset on parent-form submit, remount this
  // component by changing its key prop rather than relying on form.reset().
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setSending(true);
    setError(null);
    try {
      await sendReauthOtp();
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send code");
    } finally {
      setSending(false);
    }
  }

  if (!sent) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-[var(--text-dim)]">
          We&apos;ll email you a 6-digit code to confirm this change.
        </p>
        <button
          type="button"
          onClick={send}
          disabled={sending}
          className="self-start rounded border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send code"}
        </button>
        {error ? (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-[var(--text-dim)]">6-digit code from your email</span>
      <input
        // autoFocus moves keyboard focus into the new input on the
        // post-send swap so screen readers announce "6-digit code from
        // your email" without the user having to scan the changed region.
        autoFocus
        type="text"
        name={codeFieldName}
        required
        inputMode="numeric"
        pattern="[0-9]{6}"
        maxLength={6}
        autoComplete="one-time-code"
        className="w-32 rounded border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm tracking-widest focus:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      />
      <button
        type="button"
        onClick={send}
        disabled={sending}
        className="self-start rounded-sm text-xs text-[var(--text-dim)] underline hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50"
      >
        {sending ? "Sending…" : "Resend code"}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </label>
  );
}
