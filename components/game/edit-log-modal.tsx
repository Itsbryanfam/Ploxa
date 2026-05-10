"use client";

import type { LibraryItem } from "@/lib/logs/server-actions";

// Stub — fully implemented in Task 31.
export function EditLogModal({ item, onClose }: { item: LibraryItem; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <p>EditLogModal stub for {item.game.title}. Built in Task 31.</p>
        <button onClick={onClose} className="mt-4 text-[var(--accent)]">
          Close
        </button>
      </div>
    </div>
  );
}
