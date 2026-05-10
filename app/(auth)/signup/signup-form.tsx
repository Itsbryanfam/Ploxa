"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { signup, type ActionResult } from "./actions";

export function SignupForm() {
  const [state, action, pending] = useActionState<ActionResult, FormData>(signup, undefined);

  return (
    <form action={action} className="space-y-4">
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

      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
