"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UsernameInput } from "@/components/auth/username-input";

import { signup, type ActionResult } from "./actions";

export function SignupForm() {
  const [state, action, pending] = useActionState<ActionResult, FormData>(signup, undefined);
  const [username, setUsername] = useState({ value: "", valid: false });

  return (
    <form action={action} className="space-y-4">
      {/* Hidden input mirrors UsernameInput value so FormData includes it */}
      <input type="hidden" name="username" value={username.value} />

      <div className="space-y-2">
        <Label htmlFor="username">Username</Label>
        {/*
          key remounts UsernameInput when suggestion chips update state,
          ensuring initialValue is picked up after a chip click.
        */}
        <UsernameInput
          key={state?.suggestions?.join(",") ?? "x"}
          id="username"
          name="_username_display"
          initialValue={username.value}
          required
          onChange={(value, valid) => setUsername({ value, valid })}
        />
      </div>

      {/* Suggestion chips — shown when a username collision returns alternatives */}
      {state?.suggestions && state.suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {state.suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setUsername({ value: s, valid: true })}
              className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--text)] hover:border-[var(--accent)] transition-colors"
            >
              @{s}
            </button>
          ))}
        </div>
      )}

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

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          minLength={8}
          required
          disabled={pending}
        />
        <p className="text-xs text-[var(--text-faint)]">
          You can also log in with a magic link instead — no password required.
        </p>
      </div>

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

      <Button
        type="submit"
        variant="primary"
        size="lg"
        className="w-full"
        disabled={!username.valid || pending}
      >
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
