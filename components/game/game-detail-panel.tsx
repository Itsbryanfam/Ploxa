"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";

// Refactored from the bare Framer Motion overlay+panel pair (audit #24/#25):
// the previous component was missing focus trap, body-scroll lock, and
// prefers-reduced-motion handling — its own TODO comment noted the gap.
// Sheet (Radix Dialog under the hood) gives us all three:
//   - focus trap + restore via Radix Dialog Portal
//   - body-scroll lock via Radix Dialog Portal
//   - tw-animate-css slide animations honor prefers-reduced-motion in v4
//   - accessible Close button + Escape handling
// Visual structure (right-side max-w-2xl sliding panel) is preserved.
export function GameDetailPanel({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  // We start open and ride the route stack to control unmount. When the
  // user closes via Escape / overlay click / Close button, Sheet fires
  // onOpenChange(false); we flip our local state so the close animation
  // plays, then trigger router.back() so the underlying page renders.
  const [open, setOpen] = useState(true);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        setOpen(false);
        router.back();
      }}
    >
      <SheetContent
        side="right"
        className="w-full max-w-2xl overflow-y-auto p-0 sm:max-w-2xl"
      >
        {/* Radix requires a DialogTitle for a11y. The visible "Game detail"
            caption below is decorative (uppercase, faint); we expose the
            same string to screen readers via an sr-only SheetTitle. */}
        <SheetTitle className="sr-only">Game detail</SheetTitle>
        <div
          className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border-soft)] bg-[var(--bg)]/80 px-6 py-3 backdrop-blur"
        >
          <span
            aria-hidden
            className="text-xs uppercase tracking-wide text-[var(--text-faint)]"
          >
            Game detail
          </span>
          {/* Sheet renders its own Close (X) button via the Sheet primitive
              — see components/ui/sheet.tsx. No manual close button here. */}
        </div>
        <div className="px-6 py-6">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
