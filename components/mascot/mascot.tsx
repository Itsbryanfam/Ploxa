"use client";

import { motion, AnimatePresence } from "framer-motion";

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
 * Placeholder mascot — a CSS-drawn pixel character.
 *
 * Phase 7 will replace the SVG body with a commissioned sprite sheet.
 * Until then, this stub establishes the state-machine wiring, animation
 * timings, and consistent sizing so swapping the artwork is mechanical.
 */
export function Mascot({ size = "md", className, mood: moodProp, message: msgProp, silent }: MascotProps) {
  const storeState = useMascotStore((s) => s.state);
  const mood = moodProp ?? storeState.mood;
  const message = msgProp ?? storeState.message;
  const px = SIZE_PX[size];

  return (
    <div className={cn("relative inline-block select-none", className)} style={{ width: px, height: px }}>
      <MascotSprite mood={mood} sizePx={px} />
      <AnimatePresence>
        {!silent && message && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -5, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="absolute left-full top-0 ml-3 max-w-[280px] whitespace-normal rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text)] shadow-[var(--shadow-elev)]"
          >
            {message}
            <span
              aria-hidden
              className="absolute -left-2 top-3 h-3 w-3 rotate-45 border-b border-l border-[var(--border)] bg-[var(--bg-card)]"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MascotSprite({ mood, sizePx }: { mood: MascotMood; sizePx: number }) {
  // Animation variants per mood — Framer Motion handles easings nicely.
  const variants: Record<MascotMood, Parameters<typeof motion.div>[0]["animate"]> = {
    idle: { y: [0, -3, 0], transition: { duration: 3, repeat: Infinity, ease: "easeInOut" } },
    waving: { rotate: [0, -8, 8, -8, 0], transition: { duration: 1.5, repeat: Infinity, ease: "easeInOut" } },
    thinking: { y: [0, -2, 0], transition: { duration: 1.2, repeat: Infinity, ease: "easeInOut" } },
    celebrating: {
      y: [0, -16, 0, -8, 0],
      rotate: [0, -10, 10, -5, 0],
      transition: { duration: 0.8, repeat: Infinity, ease: "easeInOut" },
    },
    confused: { rotate: [0, 5, -5, 0], transition: { duration: 1.5, repeat: Infinity, ease: "easeInOut" } },
    pointing: { x: [0, 4, 0], transition: { duration: 2, repeat: Infinity, ease: "easeInOut" } },
    asleep: { y: [0, 1, 0], transition: { duration: 4, repeat: Infinity, ease: "easeInOut" } },
  };

  const isThinking = mood === "thinking";

  return (
    <motion.div
      animate={variants[mood]}
      className="relative h-full w-full"
      style={{ filter: mood === "asleep" ? "brightness(0.7) saturate(0.5)" : undefined }}
    >
      <PixelBlob sizePx={sizePx} mood={mood} />
      {isThinking && <ThinkingDots sizePx={sizePx} />}
    </motion.div>
  );
}

/**
 * The placeholder sprite — a friendly purple "blob" with eyes.
 * Pure SVG with hard pixel edges via shape-rendering.
 * This is intentionally simple — meant to be replaced.
 */
function PixelBlob({ sizePx, mood }: { sizePx: number; mood: MascotMood }) {
  const eyeShape = mood === "asleep" || mood === "thinking" ? "—" : "•";
  const mouthPath =
    mood === "celebrating"
      ? "M 22 38 Q 32 50 42 38" // big smile
      : mood === "confused"
        ? "M 22 42 Q 32 36 42 42" // upside down
        : mood === "asleep"
          ? "M 26 42 L 38 42" // flat line
          : "M 24 40 Q 32 46 40 40"; // gentle smile

  return (
    <svg
      viewBox="0 0 64 64"
      width={sizePx}
      height={sizePx}
      shapeRendering="crispEdges"
      className="pixelated drop-shadow-[0_4px_12px_rgba(124,92,255,0.35)]"
    >
      {/* Body — pixel-ish blob */}
      <rect x="14" y="16" width="36" height="32" fill="#7c5cff" />
      <rect x="12" y="20" width="40" height="24" fill="#7c5cff" />
      <rect x="16" y="14" width="32" height="36" fill="#7c5cff" />
      <rect x="10" y="24" width="44" height="16" fill="#7c5cff" />

      {/* Highlight (pixel sheen) */}
      <rect x="18" y="18" width="6" height="3" fill="#a386ff" />
      <rect x="22" y="20" width="3" height="2" fill="#a386ff" />

      {/* Bottom shadow */}
      <rect x="14" y="44" width="36" height="2" fill="#5a3edb" />
      <rect x="16" y="46" width="32" height="2" fill="#5a3edb" />

      {/* Feet */}
      <rect x="20" y="48" width="6" height="4" fill="#5a3edb" />
      <rect x="38" y="48" width="6" height="4" fill="#5a3edb" />

      {/* Eyes */}
      <text x="22" y="32" fontSize="8" fontWeight="bold" fill="#ffffff" textAnchor="middle">
        {eyeShape}
      </text>
      <text x="42" y="32" fontSize="8" fontWeight="bold" fill="#ffffff" textAnchor="middle">
        {eyeShape}
      </text>

      {/* Mouth */}
      <path d={mouthPath} stroke="#ffffff" strokeWidth="1.5" fill="none" strokeLinecap="round" />

      {/* Cheek dots when celebrating */}
      {mood === "celebrating" && (
        <>
          <rect x="18" y="36" width="2" height="2" fill="#ffb84a" />
          <rect x="44" y="36" width="2" height="2" fill="#ffb84a" />
        </>
      )}
    </svg>
  );
}

function ThinkingDots({ sizePx }: { sizePx: number }) {
  const offset = sizePx * 0.7;
  return (
    <div
      className="absolute flex gap-1"
      style={{ left: `${offset}px`, top: `-${sizePx * 0.1}px` }}
    >
      {[0, 0.15, 0.3].map((delay, i) => (
        <motion.div
          key={i}
          animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 0.9, repeat: Infinity, delay, ease: "easeInOut" }}
          className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]"
        />
      ))}
    </div>
  );
}
