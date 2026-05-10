"use client";

import { usePaletteStore } from "@/lib/palette/palette-store";

export function HeaderSearchInput() {
  const open = usePaletteStore((s) => s.open);

  return (
    <button
      type="button"
      onClick={open}
      className="group flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-faint)] transition-colors hover:border-[var(--accent-soft)] hover:text-[var(--text-dim)] w-full max-w-md"
      aria-label="Search games (Cmd+K)"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-[var(--text-faint)]">
        <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span className="flex-1 text-left">Search games...</span>
      <kbd className="hidden md:inline-flex items-center gap-0.5 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--text-faint)]">
        <span>⌘</span>K
      </kbd>
    </button>
  );
}
