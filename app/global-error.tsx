"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Last-resort root-layout error boundary. Renders when the root layout
 * itself (or its Providers tree) throws before `app/error.tsx` can mount.
 *
 * Per Next.js docs this file MUST render its own <html> and <body> — the
 * usual root layout never executed, so nothing else is on the page. We
 * also can't depend on:
 *   - Providers (theme, supabase, mascot store) — they're the layer that
 *     just failed.
 *   - next/font (Geist) — would re-trigger a layout-time evaluation.
 *   - Any client store hook (e.g. `useMascotStore`) — same reason.
 *   - `globals.css` — the root layout's `import "./globals.css"` never
 *     executed, so CSS tokens like `--bg` aren't defined.
 *
 * `next/link` is safe here because it's a peer client component, not a
 * root-layout dep — it ships its own runtime. The styles are inlined as
 * literal hex values rather than `var(--bg)` references so the page still
 * looks like ours even with no stylesheet loaded. The mascot asset is a
 * raw <img> against `/mascot/confused.png` which the static handler
 * serves without any React tree.
 */
export default function GlobalErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error.tsx]", error.message, error.digest);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1.5rem",
          padding: "4rem 1.5rem",
          backgroundColor: "#0a0a0f",
          color: "#e4e4f0",
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          textAlign: "center",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- raw <img> intentional: Next/Image needs the root layout's Providers; this boundary runs when the layout itself broke. */}
        <img
          src="/mascot/confused.png"
          alt=""
          width={192}
          height={192}
          style={{
            imageRendering: "pixelated",
            width: 192,
            height: 192,
            objectFit: "cover",
          }}
        />
        <div style={{ maxWidth: 480 }}>
          <h1
            style={{
              fontSize: "1.25rem",
              fontWeight: 600,
              margin: 0,
              marginBottom: "0.5rem",
            }}
          >
            The whole thing fell over.
          </h1>
          <p
            style={{
              fontSize: "0.875rem",
              color: "#9494a8",
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            Something broke before we could even mount the page. Try refreshing —
            and if it keeps happening, the team has been notified.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={reset}
            style={{
              backgroundColor: "#7c5cff",
              color: "#ffffff",
              border: "none",
              borderRadius: "0.5rem",
              padding: "0.625rem 1rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          <Link
            href="/"
            style={{
              backgroundColor: "#16161f",
              color: "#e4e4f0",
              border: "1px solid #2a2a38",
              borderRadius: "0.5rem",
              padding: "0.625rem 1rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            Take me home
          </Link>
        </div>
        {error.digest && (
          <p
            style={{
              fontSize: "0.75rem",
              color: "#7d7d92",
              margin: 0,
            }}
          >
            Reference:{" "}
            <code style={{ fontFamily: "monospace" }}>{error.digest}</code>
          </p>
        )}
      </body>
    </html>
  );
}
