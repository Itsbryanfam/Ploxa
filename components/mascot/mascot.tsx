"use client";

import { memo } from "react";
import Image from "next/image";

import { cn } from "@/lib/utils";

import { useMascotStore } from "./mascot-store";
import type { MascotMood } from "./states";

interface MascotProps {
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  /** Override the global store mood (for static contexts like illustrations). */
  mood?: MascotMood;
  /** Optional speech bubble override. */
  message?: string;
  /** Hide speech bubble even if mood/message would show one. */
  silent?: boolean;
}

const SIZE_PX: Record<NonNullable<MascotProps["size"]>, number> = {
  sm: 48,
  md: 80,
  lg: 128,
  xl: 192,
};

/**
 * Mascot sprite — one pixel-art PNG per mood, served from /public/mascot/.
 *
 * Each mood (idle | waving | thinking | celebrating | confused | pointing |
 * asleep) has its own frame generated with Nano Banana off a shared
 * character reference. The wrapper carries `data-mood`, which drives the
 * per-mood CSS keyframe animation defined in app/globals.css — the sprite
 * bobs/waves/etc. on the compositor with no JS runtime cost.
 *
 * Why `unoptimized`: Next's AVIF/WebP conversion softens deliberate pixel
 * edges. We serve the PNGs raw; `.pixelated` then forces nearest-neighbor
 * resampling at any display size.
 *
 * Why `object-cover`: source PNGs have transparent margin around the
 * character. `cover` crops that margin so the character fills the box
 * the way the old SVG body used to. The character is centered in every
 * frame, so cropping the empty sides is safe.
 */
export const Mascot = memo(function Mascot({
  size = "md",
  className,
  mood: moodProp,
  message: msgProp,
  silent,
}: MascotProps) {
  const storeState = useMascotStore((s) => s.state);
  const mood = moodProp ?? storeState.mood;
  const message = msgProp ?? storeState.message;
  const px = SIZE_PX[size];

  return (
    <div
      className={cn("mascot-root relative inline-block select-none", className)}
      data-mood={mood}
      style={{ width: px, height: px }}
    >
      <div className="mascot-sprite relative h-full w-full">
        <Image
          src={`/mascot/${mood}.png`}
          alt=""
          width={px}
          height={px}
          className="pixelated h-full w-full object-cover"
          unoptimized
          priority={size === "lg" || size === "xl"}
        />
      </div>
      {!silent && message && (
        <div className="mascot-bubble absolute left-full top-0 ml-3 max-w-[280px] whitespace-normal rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text)] shadow-[var(--shadow-elev)]">
          {message}
          <span
            aria-hidden
            className="absolute -left-2 top-3 h-3 w-3 rotate-45 border-b border-l border-[var(--border)] bg-[var(--bg-card)]"
          />
        </div>
      )}
    </div>
  );
});
