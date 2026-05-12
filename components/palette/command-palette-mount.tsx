"use client";

import { useEffect, useState } from "react";
import { usePaletteStore } from "@/lib/palette/palette-store";

// Single-flight module promise so concurrent code paths (idle-prefetch and
// eager-on-open) share one network request and one parse.
let palettePromise: Promise<typeof import("./command-palette")> | null = null;
function loadPalette() {
  if (!palettePromise) {
    palettePromise = import("./command-palette");
  }
  return palettePromise;
}

// Reset the cached promise on failure so the next attempt actually retries
// instead of returning the already-rejected promise. Logs the failure so a
// silent network blip is at least visible in DevTools.
function handlePaletteLoadError(err: unknown) {
  console.error("CommandPalette chunk failed to load", err);
  palettePromise = null;
}

// Feature-detect via `typeof X === "function"` — the `"prop" in obj` form
// narrows `window` to a type missing the prop in the else branch, which TS
// then collapses to `never` for the setTimeout fallback. `typeof` checks
// against the runtime value without touching the type system.
function scheduleIdle(cb: () => void): number {
  return typeof window.requestIdleCallback === "function"
    ? window.requestIdleCallback(cb, { timeout: 3000 })
    : window.setTimeout(cb, 1500);
}

function cancelIdle(handle: number): void {
  if (typeof window.cancelIdleCallback === "function") {
    window.cancelIdleCallback(handle);
  } else {
    window.clearTimeout(handle);
  }
}

/**
 * Thin bootstrap that defers the heavy palette tree (Mascot, react-query
 * useQuery for game search, Image, Zustand selectors used inside it, etc.)
 * until either:
 *
 *   a) requestIdleCallback fires after first paint — warms the chunk in the
 *      background so ⌘K feels instant when the user finally presses it, or
 *   b) the user opens the palette before idle preload completes — fetches
 *      it eagerly in that case.
 *
 * Stays mounted across the session; the lazy `Palette` reference is reused
 * for every subsequent open so only the very first open ever pays for the
 * chunk fetch.
 */
export function CommandPaletteMount() {
  const isOpen = usePaletteStore((s) => s.isOpen);
  const [Palette, setPalette] = useState<React.ComponentType | null>(null);

  // Idle prefetch after first paint.
  useEffect(() => {
    if (Palette) return;
    const handle = scheduleIdle(() => {
      loadPalette()
        .then((m) => setPalette(() => m.CommandPalette))
        .catch(handlePaletteLoadError);
    });
    return () => cancelIdle(handle);
  }, [Palette]);

  // Eager fetch if the user opens before idle prefetch lands.
  useEffect(() => {
    if (isOpen && !Palette) {
      loadPalette()
        .then((m) => setPalette(() => m.CommandPalette))
        .catch(handlePaletteLoadError);
    }
  }, [isOpen, Palette]);

  if (!Palette) return null;
  return <Palette />;
}
