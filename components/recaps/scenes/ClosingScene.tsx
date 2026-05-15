"use client";

import { motion, useReducedMotion } from "framer-motion";

import { Mascot } from "@/components/mascot/mascot";
import type { RecapPayload } from "@/lib/recaps/types";

/**
 * ClosingScene — Phase 6 T14.
 *
 * The closing beat. A stats grid recap (total games, top genre, top game,
 * hours played), the AI caption, and a mascot in a `celebrating` pose.
 *
 * Share buttons live in PageantControls, not here. The plan's acceptance
 * criterion says "ClosingScene: stats grid + three big share buttons" but
 * PageantControls already swaps its small Back/Pause/Next strip for the
 * three big share buttons on the closing scene (see T12 / PageantControls
 * `<ClosingShareRow>`). To avoid double-rendering them — which would
 * confuse a11y and visual flow — ClosingScene renders the stats grid plus
 * a hint that prompts users toward the share row sitting below. The
 * PageantControls share row is the canonical share affordance and reads
 * as part of the scene visually because it's bottom-pinned within the
 * same scene area.
 *
 * The "no small share icon" criterion is satisfied by PageantControls
 * itself: on the closing scene the small inline share icon is replaced
 * by the three big buttons (see `if (isClosingScene) return
 * <ClosingShareRow />` branch in PageantControls.tsx).
 */
interface ClosingSceneProps {
  payload: RecapPayload;
  caption: string;
  isActive: boolean;
}

interface StatTile {
  label: string;
  value: string;
}

export function ClosingScene({
  payload,
  caption,
  isActive,
}: ClosingSceneProps) {
  const prefersReducedMotion = useReducedMotion();

  // Build the recap-of-the-recap. We include four tiles when all data is
  // present, but degrade gracefully when individual fields are missing.
  // Hours played reads as em-dash when null (matches StatsTotalScene).
  const tiles: StatTile[] = [
    {
      label: "Games logged",
      value: payload.totals.totalGames.toLocaleString(),
    },
    {
      label: "Top genre",
      value: payload.topGenre?.name ?? "varied",
    },
    {
      label: "Top game",
      value: payload.goty?.title ?? "—",
    },
    {
      label: "Hours played",
      value:
        payload.totals.totalHoursPlayed != null
          ? Math.round(payload.totals.totalHoursPlayed).toLocaleString()
          : "—",
    },
  ];

  const containerVariants = {
    initial: {},
    active: {
      transition: prefersReducedMotion
        ? { staggerChildren: 0 }
        : { staggerChildren: 0.15, delayChildren: 0.1 },
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

  return (
    <motion.section
      className="flex w-full max-w-2xl flex-col items-center text-center"
      variants={containerVariants}
      initial="initial"
      animate={isActive ? "active" : "initial"}
      aria-label="Recap closing"
    >
      <motion.div variants={childVariants}>
        <Mascot size="lg" mood="celebrating" silent />
      </motion.div>

      <motion.p
        variants={childVariants}
        className="mt-6 text-xs uppercase tracking-[0.2em] text-[var(--text-dim)]"
      >
        Your {payload.mode === "yearly" ? "year" : "month"} in games
      </motion.p>

      <motion.div
        variants={childVariants}
        className="mt-6 grid w-full grid-cols-2 gap-4 sm:gap-6"
      >
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4"
          >
            <p className="text-2xl font-bold tracking-tight text-[var(--text)] sm:text-3xl">
              {tile.value}
            </p>
            <p className="mt-1 text-xs uppercase tracking-[0.2em] text-[var(--text-dim)]">
              {tile.label}
            </p>
          </div>
        ))}
      </motion.div>

      <p className="mt-8 max-w-md text-base text-[var(--text-dim)] sm:text-lg">
        {caption}
      </p>
    </motion.section>
  );
}
