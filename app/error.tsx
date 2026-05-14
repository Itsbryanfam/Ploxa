"use client";

import { useEffect } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Mascot } from "@/components/mascot/mascot";

/**
 * Root error boundary. Per Next.js docs this MUST be a Client Component
 * so the framework can attach the `reset` handler — that's why we can't
 * just use the EmptyState server component here.
 *
 * Catches any unhandled throw from a Server Component / Server Action /
 * RSC render below the root layout. The root layout (and its Providers)
 * keeps working; only the route subtree gets the recovery UI. If the
 * layout itself fails, app/global-error.tsx takes over instead.
 *
 * The brand-voice copy is inlined here rather than pulled from
 * lib/mascot/copy.ts to avoid importing the whole `MascotScenario`
 * module into the error boundary's client bundle.
 */
export default function GlobalErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to the browser console so it surfaces in Vercel runtime logs +
    // any client-error reporting middleware. `digest` is Next's
    // server-side correlation id when the throw came from an RSC.
    console.error("[error.tsx]", error.message, error.digest);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <Mascot size="xl" mood="confused" silent />
      <div className="space-y-2">
        <h1 className="text-xl font-semibold text-[var(--text)]">
          Something broke. Not your fault. Probably.
        </h1>
        <p className="text-sm text-[var(--text-dim)]">
          The server hit an unexpected snag. Give it a sec and try again — or
          head home and pretend this never happened.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button variant="primary" size="md" onClick={reset}>
          Try again
        </Button>
        <Link href="/">
          <Button variant="secondary" size="md">
            Take me home
          </Button>
        </Link>
      </div>
      {error.digest && (
        <p className="text-xs text-[var(--text-faint)]">
          Reference: <code className="font-mono">{error.digest}</code>
        </p>
      )}
    </div>
  );
}
