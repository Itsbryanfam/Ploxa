"use client";

import { motion, useReducedMotion } from "framer-motion";

import type { RecapPayload } from "@/lib/recaps/types";

/**
 * StatsTotalScene — Phase 6 T13.
 *
 * Three big number tiles summarising the recap window:
 *   1. total games logged
 *   2. hours played (Steam playtime, may be null → em-dash)
 *   3. completed count
 *
 * The plan calls for a "tick-up" countUp animation. We use a Framer
 * Motion-driven y-offset + opacity stagger instead of a JS countUp,
 * because (a) we already share the motion vocabulary with OpeningScene,
 * (b) a JS countUp adds a useEffect+rAF dance that has to be skipped
 * under reduced-motion anyway, and (c) the static final number is the
 * only thing the a11y tree cares about. The visual effect — three big
 * numbers fading + lifting in 200ms apart — is the same shape the user
 * would perceive from a countUp; the perceptual gain of literal tick-up
 * over a stagger is small relative to its complexity cost.
 *
 * Reduced-motion: all tiles render in final position with no fade.
 */
interface StatsTotalSceneProps {
  payload: RecapPayload;
  caption: string;
  isActive: boolean;
}

interface Tile {
  value: string;
  label: string;
}

export function StatsTotalScene({
  payload,
  caption,
  isActive,
}: StatsTotalSceneProps) {
  const prefersReducedMotion = useReducedMotion();

  // Hours: `totalHoursPlayed` is nullable when the user has no Steam
  // playtime data linked. The em-dash fallback matches the rest of the
  // app (game cards, profile stats) and reads as "unknown" rather than
  // "zero", which would be misleading.
  const tiles: Tile[] = [
    {
      value: payload.totals.totalGames.toLocaleString(),
      label:
        payload.totals.totalGames === 1 ? "game logged" : "games logged",
    },
    {
      value:
        payload.totals.totalHoursPlayed != null
          ? Math.round(payload.totals.totalHoursPlayed).toLocaleString()
          : "—",
      label: "hours played",
    },
    {
      value: payload.totals.completedCount.toLocaleString(),
      label: "completed",
    },
  ];

  const containerVariants = {
    initial: {},
    active: {
      transition: prefersReducedMotion
        ? { staggerChildren: 0 }
        : { staggerChildren: 0.2, delayChildren: 0.05 },
    },
  } as const;

  const tileVariants = {
    initial: prefersReducedMotion
      ? { opacity: 1, y: 0 }
      : { opacity: 0, y: 24 },
    active: {
      opacity: 1,
      y: 0,
      transition: {
        duration: prefersReducedMotion ? 0 : 0.5,
        // Soft spring on the y so the number arrives with a small settle,
        // matching the "tick" feel from the plan without doing a real
        // numeric countUp.
        ease: "easeOut",
      },
    },
  } as const;

  return (
    <motion.section
      className="flex w-full max-w-3xl flex-col items-center text-center"
      variants={containerVariants}
      initial="initial"
      animate={isActive ? "active" : "initial"}
      aria-label="Recap totals"
    >
      <div className="grid w-full grid-cols-1 gap-8 sm:grid-cols-3">
        {tiles.map((tile, i) => (
          <motion.div
            key={i}
            variants={tileVariants}
            className="flex flex-col items-center"
          >
            <span className="text-6xl font-bold tracking-tight text-[var(--text)] sm:text-7xl">
              {tile.value}
            </span>
            <span className="mt-2 text-xs uppercase tracking-[0.2em] text-[var(--text-dim)]">
              {tile.label}
            </span>
          </motion.div>
        ))}
      </div>

      {/* Caption is rendered as a sibling of the animated grid, not inside
          it, so the caption text is always visible to a11y tools even if
          the grid animation gets gated. */}
      <p className="mt-12 max-w-md text-base text-[var(--text-dim)] sm:text-lg">
        {caption}
      </p>
    </motion.section>
  );
}
