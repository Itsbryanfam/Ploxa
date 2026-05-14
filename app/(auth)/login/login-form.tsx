"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { loginWithPassword, sendMagicLink, type ActionResult } from "./actions";

type Mode = "password" | "magic";

export function LoginForm({ next }: { next?: string }) {
  const [mode, setMode] = useState<Mode>("password");
  const [pwState, pwAction, pwPending] = useActionState<ActionResult, FormData>(
    loginWithPassword,
    undefined,
  );
  const [mlState, mlAction, mlPending] = useActionState<ActionResult, FormData>(
    sendMagicLink,
    undefined,
  );

  const state = mode === "password" ? pwState : mlState;
  const pending = mode === "password" ? pwPending : mlPending;

  return (
    <form action={mode === "password" ? pwAction : mlAction} className="space-y-4">
      {next && <input type="hidden" name="next" value={next} />}

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
          disabled={pending}
        />
      </div>

      {mode === "password" && (
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            disabled={pending}
          />
        </div>
      )}

      {state?.error && (
        <p className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
          {state.error}
        </p>
      )}
      {state?.success && (
        <p className="rounded-md border border-[var(--success)]/30 bg-[var(--success)]/10 px-3 py-2 text-sm text-[var(--success)]">
          {state.success}
        </p>
      )}

      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
        {pending
          ? mode === "password"
            ? "Logging in…"
            : "Sending link…"
          : mode === "password"
            ? "Log in"
            : "Send magic link"}
      </Button>

      <button
        type="button"
        role="switch"
        aria-checked={mode === "magic"}
        aria-label="Use magic link instead of password"
        className="block w-full text-center text-sm text-[var(--text-dim)] hover:text-[var(--accent)]"
        onClick={() => setMode((m) => (m === "password" ? "magic" : "password"))}
      >
        {mode === "password" ? "Or send me a magic link instead" : "Or use my password instead"}
      </button>
    </form>
  );
}
