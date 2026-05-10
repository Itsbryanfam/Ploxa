"use client";

import { useEffect } from "react";
import { usePaletteStore } from "@/lib/palette/palette-store";

export function PaletteKeyboardShortcut() {
  const toggle = usePaletteStore((s) => s.toggle);
  const close = usePaletteStore((s) => s.close);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      // Skip while an IME composition session is active (e.g. CJK input methods)
      // — otherwise `keydown` events from composing a character can spuriously
      // toggle the palette.
      if (e.isComposing) return;
      // Don't intercept ⌘K when user is typing in an input/textarea/contenteditable
      const target = e.target as HTMLElement;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        // Allow ⌘K from inside the palette's own input (handled separately)
        if (isTyping && !target.dataset.paletteInput) return;
        e.preventDefault();
        toggle();
        return;
      }
      if (e.key === "Escape") {
        close();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggle, close]);

  return null;
}
