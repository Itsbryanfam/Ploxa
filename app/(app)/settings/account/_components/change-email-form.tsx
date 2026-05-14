"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ReauthChallenge } from "@/components/settings/reauth-challenge";
import {
  updateEmailAddress,
  getLiveCurrentEmail,
} from "@/lib/auth/email-actions";

type Props = { hasPassword: boolean; cachedEmail: string };

export function ChangeEmailForm({ hasPassword, cachedEmail }: Props) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<
    { kind: "ok" | "err"; text: string } | null
  >(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [liveEmail, setLiveEmail] = useState(cachedEmail);
  const formRef = useRef<HTMLFormElement>(null);

  // Poll the live-actual email every 30s WHILE a change is pending.
  // Stops automatically when pendingEmail clears (either via successful
  // confirmation detection or the user navigating away). The effect
  // early-returns when pendingEmail is null so we don't burn admin SDK
  // calls on the steady state.
  //
  // liveEmail is intentionally NOT in the dependency array — we use the
  // functional setLiveEmail((prev) => …) form so the interval doesn't
  // restart every time the live value changes. Otherwise an intermediate
  // confirmation flip would reset the 30s clock and delay detection.
  useEffect(() => {
    if (!pendingEmail) return;
    const check = async () => {
      const live = await getLiveCurrentEmail();
      if (!live) return;
      setLiveEmail((prev) => (live === prev ? prev : live));
      if (live === pendingEmail) {
        setPendingEmail(null);
        setMessage({ kind: "ok", text: "Email change confirmed." });
      }
    };
    // Immediate first check so users who confirm both links within the
    // first 30s see feedback right away rather than waiting for the
    // initial interval tick.
    void check();
    const interval = setInterval(check, 30_000);
    return () => clearInterval(interval);
  }, [pendingEmail]);

  return (
    <div className="flex flex-col gap-3">
      {pendingEmail && (
        <div
          role="status"
          className="rounded border border-[var(--border)] bg-[var(--bg-card)]/40 p-3 text-sm text-[var(--text-dim)]"
        >
          Change pending. Current email is still{" "}
          <strong className="text-[var(--text)]">{liveEmail}</strong>. Click
          the confirmation links sent to both{" "}
          <strong className="text-[var(--text)]">{liveEmail}</strong> and{" "}
          <strong className="text-[var(--text)]">{pendingEmail}</strong> to
          complete the change.
        </div>
      )}

      <form
        ref={formRef}
        action={(fd) => {
          setMessage(null);
          const newEmail = String(fd.get("new_email") ?? "");
          startTransition(async () => {
            const result = await updateEmailAddress(fd);
            if (!result.ok) {
              setMessage({ kind: "err", text: result.error });
            } else {
              setPendingEmail(newEmail);
              setMessage({
                kind: "ok",
                text: "Confirmation links sent to both your old email and your new one. The change applies once you click both.",
              });
              formRef.current?.reset();
            }
          });
        }}
        className="flex flex-col gap-4"
      >
        <ReauthChallenge hasPassword={hasPassword} />

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[var(--text-dim)]">New email</span>
          <input
            type="email"
            name="new_email"
            required
            autoComplete="email"
            className="w-full max-w-xs rounded border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm focus:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          className="self-start rounded border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50"
        >
          {pending ? "Sending…" : "Change email"}
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
    </div>
  );
}
