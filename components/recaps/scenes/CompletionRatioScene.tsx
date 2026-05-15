"use client";

import { motion, useReducedMotion } from "framer-motion";

import type { RecapPayload } from "@/lib/recaps/types";

/**
 * CompletionRatioScene — Phase 6 T14.
 *
 * Substitute for `taste_evolution` when a single-quarter window means we
 * can't compare Q1 vs Q4 vibes. Two-column layout mirroring
 * TasteEvolutionScene: completed-% on the left, dropped-% on the right,
 * with a subtle divider between.
 *
 * Uses `payload.completionRatio`. The substitution pass always fires for
 * yearly mode (since tasteEvolution is never computed today), so this
 * field is reliably set when this scene is in `payload.scenes`. We
 * defensively render a calm fallback if it's absent.
 */
interface CompletionRatioSceneProps {
  payload: RecapPayload;
  caption: string;
  isActive: boolean;
}

export function CompletionRatioScene({
  payload,
  caption,
  isActive,
}: CompletionRatioSceneProps) {
  const prefersReducedMotion = useReducedMotion();
  const ratio = payload.completionRatio;

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
      aria-label="Completion ratio"
    >
      <p className="text-xs uppercase tracking-[0.2em] text-[var(--text-dim)]">
        How you finished what you started
      </p>

      {ratio ? (
        <div className="mt-8 grid w-full grid-cols-1 gap-8 sm:grid-cols-[1fr_auto_1fr] sm:gap-4">
          <motion.div
            variants={columnVariants}
            className="flex flex-col items-center"
          >
            <span className="text-xs uppercase tracking-[0.2em] text-[var(--text-dim)]">
              Completed
            </span>
            <p className="mt-3 text-5xl font-bold tabular-nums tracking-tight text-[var(--text)] sm:text-6xl">
              {ratio.completedPct}%
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
              Dropped
            </span>
            <p className="mt-3 text-5xl font-bold tabular-nums tracking-tight text-[var(--text)] sm:text-6xl">
              {ratio.droppedPct}%
            </p>
          </motion.div>
        </div>
      ) : (
        <p className="mt-8 text-base text-[var(--text-dim)]">
          Your completion rate was hard to pin down.
        </p>
      )}

      <p className="mt-10 max-w-md text-base text-[var(--text-dim)] sm:text-lg">
        {caption}
      </p>
    </motion.section>
  );
}
