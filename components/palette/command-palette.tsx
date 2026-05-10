"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { usePaletteStore } from "@/lib/palette/palette-store";
import { PaletteInput } from "./palette-input";
import { GameSearchResults } from "./game-search-results";

export function CommandPalette() {
  const isOpen = usePaletteStore((s) => s.isOpen);
  const view = usePaletteStore((s) => s.view);
  const close = usePaletteStore((s) => s.close);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [mounted, setMounted] = useState(false);

  // SSR-safe portal guard: defer createPortal until after first client render.
  // The set-state-in-effect lint rule targets logic loops; this is the
  // hydration mount pattern, not a state-sync issue.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  // Auto-focus on open. The 50ms delay lets Framer Motion attach the card
  // to the DOM before we focus the input (especially needed on iOS Safari).
  // The cleanup clears the pending timer if the palette closes mid-animation.
  useEffect(() => {
    if (isOpen) {
      const id = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
    // Reset query when the palette closes. setState-in-effect is intentional —
    // local input state should not survive across opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery("");
  }, [isOpen]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            onClick={close}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          />
          {/* Card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -4 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="fixed left-1/2 top-[15vh] z-50 w-[92vw] max-w-2xl -translate-x-1/2 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-[var(--shadow-elev)]"
            role="dialog"
            aria-modal="true"
            aria-label="Game search"
          >
            <div className="flex items-center gap-3 border-b border-[var(--border-soft)] px-5 py-4">
              <PaletteSearchIcon />
              <PaletteInput ref={inputRef} value={query} onChange={setQuery} />
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {view === "search" ? (
                <GameSearchResults query={query} />
              ) : (
                <QuickLogView /* will be built in Task 12 */ />
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
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

// Placeholder until Task 12
function QuickLogView() {
  return <div className="px-5 py-8">[quick-log form wired in Task 12]</div>;
}
