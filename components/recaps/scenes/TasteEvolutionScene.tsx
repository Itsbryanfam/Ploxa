"use client";

import { motion, useReducedMotion } from "framer-motion";

import type { RecapPayload } from "@/lib/recaps/types";

/**
 * TasteEvolutionScene — Phase 6 T14.
 *
 * The "how your taste shifted across the year" beat. Two-column layout
 * comparing the Q1 vibe to the Q4 vibe, with a subtle divider between.
 * The AI caption sits beneath.
 *
 * Important: `payload.tasteEvolution` is currently always undefined (the
 * T3 aggregator doesn't compute Q1/Q4 vibes — that's a future stretch
 * task). When this scene renders without the data, we show a calm "your
 * taste held steady" fallback. The substitution pass swaps this scene for
 * `completion_ratio` when the data is missing, so this scene normally
 * shouldn't render without it — but we defensively handle the absent
 * case so the pageant never crashes.
 */
interface TasteEvolutionSceneProps {
  payload: RecapPayload;
  caption: string;
  isActive: boolean;
}

export function TasteEvolutionScene({
  payload,
  caption,
  isActive,
}: TasteEvolutionSceneProps) {
  const prefersReducedMotion = useReducedMotion();
  const evolution = payload.tasteEvolution;

  const containerVariants = {
    initial: {},
    active: {
      transition: prefersReducedMotion
        ? { staggerChildren: 0 }
        : { staggerChildren: 0.25, delayChildren: 0.1 },
    },
  } as const;

  const columnVariants = {
    initial: prefersReducedMotion
      ? { opacity: 1, y: 0 }
      : { opacity: 0, y: 16 },
    active: {
      opacity: 1,
      y: 0,
      transition: { duration: prefersReducedMotion ? 0 : 0.4 },
    },
  } as const;

  return (
    <motion.section
      className="flex w-full max-w-3xl flex-col items-center text-center"
      variants={containerVariants}
      initial="initial"
      animate={isActive ? "active" : "initial"}
      aria-label="Taste evolution"
    >
      <p className="text-xs uppercase tracking-[0.2em] text-[var(--text-dim)]">
        How your taste shifted
      </p>

      {evolution ? (
        <div className="mt-8 grid w-full grid-cols-1 gap-8 sm:grid-cols-[1fr_auto_1fr] sm:gap-4">
          <motion.div
            variants={columnVariants}
            className="flex flex-col items-center"
          >
            <span className="text-xs uppercase tracking-[0.2em] text-[var(--text-dim)]">
              Q1
            </span>
            <p className="mt-3 text-3xl font-bold tracking-tight text-[var(--text)] sm:text-4xl">
              {evolution.q1Vibe}
            </p>
          </motion.div>

          {/* Vertical divider — visible on sm+ only. */}
          <motion.div
            variants={columnVariants}
            className="hidden self-stretch border-l border-[var(--border)] sm:block"
            aria-hidden="true"
          />

          <motion.div
            variants={columnVariants}
            className="flex flex-col items-center"
          >
            <span className="text-xs uppercase tracking-[0.2em] text-[var(--text-dim)]">
              Q4
            </span>
            <p className="mt-3 text-3xl font-bold tracking-tight text-[var(--text)] sm:text-4xl">
              {evolution.q4Vibe}
            </p>
          </motion.div>
        </div>
      ) : (
        <p className="mt-8 text-base text-[var(--text-dim)]">
          Your taste held steady through the year.
        </p>
      )}

      <p className="mt-10 max-w-md text-base text-[var(--text-dim)] sm:text-lg">
        {caption}
      </p>
    </motion.section>
  );
}
