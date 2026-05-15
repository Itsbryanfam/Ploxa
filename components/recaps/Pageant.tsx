"use client";

import type { RecapPayload, RecapMode } from "@/lib/recaps/types";

/**
 * Pageant — Phase 6 T11 STUB.
 *
 * This is a placeholder component shipped by T11 so the YIR page route
 * (`/u/[username]/year/[year]/page.tsx`) compiles and renders end-to-end.
 * T12 replaces this with the full Framer Motion scene sequencer
 * (auto-advance, tap-third-zones, swipe, keyboard, progress bar, share
 * affordance).
 *
 * Until T12 lands the stub renders:
 *   - A short header explaining this is a placeholder
 *   - A JSON dump of the payload shape (scenes + captions) so manual QA
 *     can sanity-check the cache-or-build flow without the visual sequencer.
 *
 * The signature here MUST match what T12 will accept (`payload`, `mode`,
 * `initialSceneIndex`) so the page-level call site doesn't need to change
 * when T12 swaps the body.
 */
interface PageantProps {
  payload: RecapPayload;
  mode: RecapMode;
  initialSceneIndex?: number;
}

export function Pageant({ payload, mode, initialSceneIndex = 0 }: PageantProps) {
  // TODO(T12): replace this entire return with the real Framer Motion scene
  // sequencer. Keep the props signature stable; page.tsx is the contract.
  return (
    <div className="min-h-screen bg-[var(--bg)] p-8 text-[var(--text)]">
      <p className="text-xs text-[var(--text-dim)] font-mono">
        Pageant placeholder — T12 will wire the scene sequencer here.
      </p>
      <pre className="mt-4 overflow-auto text-xs text-[var(--text-dim)]">
        {JSON.stringify(
          {
            mode,
            initialSceneIndex,
            tier: payload.tier,
            scenes: payload.scenes,
            captions: payload.captions,
          },
          null,
          2,
        )}
      </pre>
    </div>
  );
}
