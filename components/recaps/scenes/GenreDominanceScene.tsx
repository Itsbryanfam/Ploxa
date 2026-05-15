"use client";

import { motion, useReducedMotion } from "framer-motion";

import type { RecapPayload } from "@/lib/recaps/types";

/**
 * GenreDominanceScene — Phase 6 T14.
 *
 * The "this one genre owned your window" beat. A large genre name centered,
 * an SVG donut chart sliver showing the percentage, and the secondary genre
 * name + pct below in smaller type. The AI caption sits beneath.
 *
 * No mascot — the chart is the visual hero. The donut is rendered with
 * `stroke-dasharray` math so it has no charting-library dependency and
 * still animates naturally under framer-motion when isActive flips true.
 *
 * Defensive: `payload.topGenre` is optional. Render a calm fallback when
 * absent.
 */
interface GenreDominanceSceneProps {
  payload: RecapPayload;
  caption: string;
  isActive: boolean;
}

const DONUT_SIZE = 200;
const DONUT_STROKE = 24;

export function GenreDominanceScene({
  payload,
  caption,
  isActive,
}: GenreDominanceSceneProps) {
  const prefersReducedMotion = useReducedMotion();
  const genre = payload.topGenre;

  const containerVariants = {
    initial: {},
    active: {
      transition: prefersReducedMotion
        ? { staggerChildren: 0 }
        : { staggerChildren: 0.2, delayChildren: 0.1 },
    },
  } as const;

  const childVariants = {
    initial: prefersReducedMotion
      ? { opacity: 1, y: 0 }
      : { opacity: 0, y: 16 },
    active: {
      opacity: 1,
      y: 0,
      transition: { duration: prefersReducedMotion ? 0 : 0.4 },
    },
  } as const;

  if (!genre) {
    return (
      <section
        className="flex w-full max-w-2xl flex-col items-center text-center"
        aria-label="Genre dominance"
      >
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--text-dim)]">
          Your top genre
        </p>
        <p className="mt-8 max-w-md text-base text-[var(--text-dim)] sm:text-lg">
          {caption}
        </p>
      </section>
    );
  }

  // Circle math for the donut sliver. The percentage drives stroke-dasharray
  // so the filled arc renders the right length without any client-side JS.
  const radius = (DONUT_SIZE - DONUT_STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  // Clamp the pct in case the aggregator returned a value outside [0, 100].
  const clampedPct = Math.max(0, Math.min(100, genre.pct));
  const dashOffset = circumference - (clampedPct / 100) * circumference;

  return (
    <motion.section
      className="flex w-full max-w-2xl flex-col items-center text-center"
      variants={containerVariants}
      initial="initial"
      animate={isActive ? "active" : "initial"}
      aria-label="Genre dominance"
    >
      <motion.h2
        variants={childVariants}
        className="text-5xl font-bold tracking-tight text-[var(--text)] sm:text-6xl"
      >
        {genre.name}
      </motion.h2>

      <motion.div
        variants={childVariants}
        className="relative mt-8"
        style={{ width: DONUT_SIZE, height: DONUT_SIZE }}
      >
        <svg
          width={DONUT_SIZE}
          height={DONUT_SIZE}
          viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`}
          aria-hidden="true"
        >
          {/* Track */}
          <circle
            cx={DONUT_SIZE / 2}
            cy={DONUT_SIZE / 2}
            r={radius}
            fill="none"
            stroke="var(--border)"
            strokeWidth={DONUT_STROKE}
          />
          {/* Filled sliver — rotated -90deg so the arc starts at 12 o'clock. */}
          <circle
            cx={DONUT_SIZE / 2}
            cy={DONUT_SIZE / 2}
            r={radius}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={DONUT_STROKE}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            transform={`rotate(-90 ${DONUT_SIZE / 2} ${DONUT_SIZE / 2})`}
          />
        </svg>
        {/* Center label: the percentage in big tabular nums. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold tabular-nums text-[var(--text)] sm:text-4xl">
            {clampedPct}%
          </span>
          <span className="mt-1 text-xs uppercase tracking-[0.2em] text-[var(--text-dim)]">
            of your library
          </span>
        </div>
      </motion.div>

      {genre.secondName ? (
        <motion.p
          variants={childVariants}
          className="mt-6 text-sm text-[var(--text-dim)]"
        >
          {genre.secondName} · {genre.secondPct}%
        </motion.p>
      ) : null}

      <p className="mt-6 max-w-md text-base text-[var(--text-dim)] sm:text-lg">
        {caption}
      </p>
    </motion.section>
  );
}
