"use client";

import { useState, useTransition } from "react";
import {
  updateCadence,
  updateEmailType,
} from "@/lib/settings/notification-prefs-actions";

type Cadence = "off" | "daily" | "weekly";

interface InitialPrefs {
  emailDigestCadence: Cadence;
  emailFollows: boolean;
  emailReactions: boolean;
  emailComments: boolean;
  emailWishlist: boolean;
}

interface Props {
  initial: InitialPrefs;
}

const CADENCE_OPTIONS: { value: Cadence; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
];

const EMAIL_TYPE_OPTIONS: {
  key: keyof Omit<InitialPrefs, "emailDigestCadence">;
  type: "follows" | "reactions" | "comments" | "wishlist";
  label: string;
}[] = [
  { key: "emailFollows", type: "follows", label: "Someone follows me" },
  { key: "emailReactions", type: "reactions", label: "Someone reacts to my review" },
  { key: "emailComments", type: "comments", label: "Someone comments on my review" },
  { key: "emailWishlist", type: "wishlist", label: "A friend logs a game on my wishlist" },
];

const CADENCE_KEY = "cadence";

export function NotificationPrefsForm({ initial }: Props) {
  const [cadence, setCadence] = useState<Cadence>(initial.emailDigestCadence);
  const [emailTypes, setEmailTypes] = useState({
    emailFollows: initial.emailFollows,
    emailReactions: initial.emailReactions,
    emailComments: initial.emailComments,
    emailWishlist: initial.emailWishlist,
  });
  const [error, setError] = useState<string | null>(null);
  // Per-control pending set. Mirrors T8's BlockedList pattern: a single
  // useTransition `pending` would freeze every control while any single
  // save is in flight (so changing cadence would lock all 4 checkboxes).
  // Tracking by key lets each control's disabled state stay local.
  const [pendingControls, setPendingControls] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  function markPending(key: string, on: boolean) {
    setPendingControls((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function handleCadenceChange(next: Cadence) {
    const prev = cadence;
    setError(null);
    setCadence(next);
    markPending(CADENCE_KEY, true);
    startTransition(async () => {
      const res = await updateCadence(next);
      markPending(CADENCE_KEY, false);
      if (!res.ok) {
        setCadence(prev);
        setError(res.error);
      }
    });
  }

  function handleTypeChange(
    key: keyof typeof emailTypes,
    type: "follows" | "reactions" | "comments" | "wishlist",
    next: boolean,
  ) {
    const prev = emailTypes[key];
    setError(null);
    setEmailTypes((s) => ({ ...s, [key]: next }));
    markPending(key, true);
    startTransition(async () => {
      const res = await updateEmailType(type, next);
      markPending(key, false);
      if (!res.ok) {
        setEmailTypes((s) => ({ ...s, [key]: prev }));
        setError(res.error);
      }
    });
  }

  const cadencePending = pendingControls.has(CADENCE_KEY);
  const anyPending = pendingControls.size > 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Cadence */}
      <div className="flex flex-col gap-2">
        <label
          htmlFor="cadence-select"
          className="text-sm font-medium text-[var(--text)]"
        >
          Email digest cadence
        </label>
        <select
          id="cadence-select"
          value={cadence}
          disabled={cadencePending}
          onChange={(e) => handleCadenceChange(e.target.value as Cadence)}
          className={[
            "w-48 rounded-md border border-[var(--border)] bg-[var(--bg-card)]",
            "px-3 py-2 text-sm text-[var(--text)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
            "disabled:opacity-60 disabled:cursor-not-allowed",
          ].join(" ")}
        >
          {CADENCE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-[var(--text-dim)]">
          How often you receive a summary email of your social activity.
        </p>
      </div>

      {/* Per-type opt-outs */}
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium text-[var(--text)]">Email me when&hellip;</legend>
        <div className="flex flex-col gap-2">
          {EMAIL_TYPE_OPTIONS.map(({ key, type, label }) => {
            const itemPending = pendingControls.has(key);
            return (
              <label
                key={type}
                className={[
                  "flex items-center gap-3 cursor-pointer select-none",
                  itemPending ? "opacity-60" : "",
                ].join(" ")}
              >
                <input
                  type="checkbox"
                  checked={emailTypes[key]}
                  disabled={itemPending}
                  onChange={(e) => handleTypeChange(key, type, e.target.checked)}
                  className={[
                    "h-4 w-4 rounded border border-[var(--border)] bg-[var(--bg-card)]",
                    "accent-[var(--accent)]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                    "disabled:cursor-not-allowed",
                  ].join(" ")}
                />
                <span className="text-sm text-[var(--text)]">{label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {anyPending && (
        <p className="text-xs text-[var(--text-dim)]" aria-live="polite">
          Saving&hellip;
        </p>
      )}

      {error && (
        <p className="text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
