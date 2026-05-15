"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePaletteStore } from "@/lib/palette/palette-store";
import { PaletteInput } from "./palette-input";
import { GameSearchResults } from "./game-search-results";
import { UserSearchResults } from "./user-search-results";
import { QuickLogForm } from "./quick-log-form";

/**
 * Command palette — backdrop + card, opened via the global Zustand store.
 *
 * Animations are pure CSS (see .palette-backdrop / .palette-card in
 * globals.css) so framer-motion isn't pulled into this chunk anymore.
 * To preserve the original exit fade, we keep the chrome mounted while a
 * close animation plays via the `closing` flag, then unmount.
 */
export function CommandPalette() {
  const isOpen = usePaletteStore((s) => s.isOpen);
  const view = usePaletteStore((s) => s.view);
  const close = usePaletteStore((s) => s.close);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);

  // SSR-safe portal guard: defer createPortal until after first client render.
  // The set-state-in-effect lint rule targets logic loops; this is the
  // hydration mount pattern, not a state-sync issue.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (isOpen) {
      // Abort any in-flight close animation when the palette re-opens before
      // the previous exit finished. setState-in-effect is intentional here:
      // closing is timer-coordinated lifecycle state, not derivable from props.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setClosing(false);
      // Auto-focus on open. The 50ms delay lets the card attach to the DOM
      // before we focus the input (especially needed on iOS Safari).
      const id = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
    if (!mounted) return;
    // isOpen flipped to false → play exit animation, then unmount and clear
    // local input state. 160ms covers both keyframes' 0.12/0.15s durations.
    setClosing(true);
    const t = setTimeout(() => {
      setClosing(false);
      setQuery("");
    }, 160);
    return () => clearTimeout(t);
  }, [isOpen, mounted]);

  if (!mounted || (!isOpen && !closing)) return null;

  // `@`-prefix routes the query to the user search; everything else stays
  // on game search. Strip the prefix before passing through so the user
  // results component sees just the inner query string.
  const isUserSearch = query.startsWith("@");
  const userQuery = isUserSearch ? query.slice(1) : "";

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        onClick={close}
        className={
          "palette-backdrop fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" +
          (closing ? " is-closing" : "")
        }
      />
      {/* Card */}
      <div
        className={
          "palette-card fixed left-1/2 top-[15vh] z-50 w-[92vw] max-w-2xl -translate-x-1/2 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-[var(--shadow-elev)]" +
          (closing ? " is-closing" : "")
        }
        role="dialog"
        aria-modal="true"
        aria-label={isUserSearch ? "People search" : "Game search"}
      >
        <div className="flex items-center gap-3 border-b border-[var(--border-soft)] px-5 py-4">
          <PaletteSearchIcon />
          <PaletteInput
            ref={inputRef}
            value={query}
            onChange={setQuery}
            placeholder="Search games, or @username for people..."
          />
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {view === "search" ? (
            isUserSearch ? (
              <UserSearchResults query={userQuery} />
            ) : (
              <GameSearchResults query={query} />
            )
          ) : (
            <QuickLogForm />
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}

function PaletteSearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-[var(--text-dim)]">
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
