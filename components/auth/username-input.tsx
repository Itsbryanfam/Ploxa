"use client";

import { useEffect, useRef, useState } from "react";
import { checkUsernameAvailability } from "@/lib/profile/server-actions";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available" }
  | { kind: "invalid"; message: string }
  | { kind: "reserved" }
  | { kind: "taken" };

const REASON_TO_MESSAGE: Record<"invalid" | "reserved" | "taken", string> = {
  invalid: "must be 3–24 chars: lowercase letters, digits, or _",
  reserved: "this name is reserved",
  taken: "already taken",
};

interface Props {
  /** Initial value (e.g., the current username when editing). */
  initialValue?: string;
  /** Treat the initialValue as already-yours, so it reads as available. */
  treatInitialAsValid?: boolean;
  /** Notify parent of value + validity. */
  onChange: (value: string, valid: boolean) => void;
  name?: string;
  id?: string;
  required?: boolean;
}

export function UsernameInput({
  initialValue = "",
  treatInitialAsValid = false,
  onChange,
  name = "username",
  id = "username",
  required,
}: Props) {
  const [value, setValue] = useState(initialValue);
  const [status, setStatus] = useState<Status>(
    treatInitialAsValid && initialValue
      ? { kind: "available" }
      : { kind: "idle" },
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeq = useRef(0);

  // Pin onChange in a ref so the notification effect only fires when the
  // value or status actually changes — not every time the parent
  // re-renders with a fresh inline closure. Without this, an inline
  // `onChange={(v, ok) => setX({ v, ok })}` in the parent loops forever:
  //   child notifies parent → parent setState → parent rerenders with a
  //   new onChange identity → child's effect sees the dep change → fires
  //   again → "Maximum update depth exceeded."
  // The update-ref effect has no deps so it runs after every render,
  // declared first so it commits before the notification effect — the
  // ref always holds the latest closure by the time we call it.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    onChangeRef.current(value, status.kind === "available");
  }, [value, status]);

  // Cancel any pending debounce on unmount so the stale callback doesn't try
  // to setState into a torn-down component (the seq guard already prevents
  // out-of-order state updates while mounted; this is the unmount case).
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function handleChange(next: string) {
    setValue(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (treatInitialAsValid && next === initialValue) {
      setStatus({ kind: "available" });
      return;
    }
    if (!next) {
      setStatus({ kind: "idle" });
      return;
    }
    setStatus({ kind: "checking" });
    const seq = ++requestSeq.current;
    debounceRef.current = setTimeout(async () => {
      const res = await checkUsernameAvailability(next);
      // Drop stale responses — if another keystroke fired a newer check
      // before this one returned, ignore this result.
      if (seq !== requestSeq.current) return;
      if (res.ok) {
        setStatus({ kind: "available" });
      } else {
        setStatus(
          res.reason === "invalid"
            ? { kind: "invalid", message: REASON_TO_MESSAGE.invalid }
            : { kind: res.reason },
        );
      }
    }, 300);
  }

  const message =
    status.kind === "checking"
      ? "…checking"
      : status.kind === "available"
        ? `✓ @${value} is available`
        : status.kind === "invalid"
          ? `✗ ${status.message}`
          : status.kind === "reserved"
            ? `✗ ${REASON_TO_MESSAGE.reserved}`
            : status.kind === "taken"
              ? `✗ ${REASON_TO_MESSAGE.taken}`
              : "";

  const messageColor =
    status.kind === "available"
      ? "text-green-500"
      : status.kind === "checking" || status.kind === "idle"
        ? "text-[var(--text-dim)]"
        : "text-red-500";

  return (
    <div>
      <Input
        id={id}
        name={name}
        type="text"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        required={required}
        value={value}
        onChange={(e) => handleChange(e.target.value.toLowerCase())}
      />
      {message && (
        <p className={cn("text-xs mt-1", messageColor)} aria-live="polite">
          {message}
        </p>
      )}
    </div>
  );
}
