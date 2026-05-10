"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { usePaletteStore } from "@/lib/palette/palette-store";
import { PaletteInput } from "./palette-input";
import { Mascot } from "@/components/mascot/mascot";

export function CommandPalette() {
  const isOpen = usePaletteStore((s) => s.isOpen);
  const view = usePaletteStore((s) => s.view);
  const close = usePaletteStore((s) => s.close);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Auto-focus on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
    }
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
                <SearchView query={query} />
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

// Stub for now; Task 11 fills it
function SearchView({ query }: { query: string }) {
  if (query.length < 2) {
    return (
      <div className="px-5 py-12 text-center">
        <Mascot size="md" mood="idle" silent />
        <p className="mt-4 text-sm text-[var(--text-dim)]">Start typing to search.</p>
      </div>
    );
  }
  return (
    <div className="px-5 py-8 text-sm text-[var(--text-dim)]">
      [results for &quot;{query}&quot; wired in Task 11]
    </div>
  );
}

// Placeholder until Task 12
function QuickLogView() {
  return <div className="px-5 py-8">[quick-log form wired in Task 12]</div>;
}
