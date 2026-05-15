"use client";

import { Hourglass } from "lucide-react";
import {
  motion,
  useReducedMotion,
  type TargetAndTransition,
} from "framer-motion";

import type { RecapPayload, TopGameRef } from "@/lib/recaps/types";

/**
 * LongestGameScene — Phase 6 T13.
 *
 * The "you spent the most time here" beat. Hourglass icon (Lucide), the
 * game's cover, the hours played as a big number, and the game title.
 *
 * The plan suggests a CSS hourglass animation. We use a Lucide `Hourglass`
 * icon + a Framer motion rotation transform for the playing state. Under
 * reduced-motion the icon is static.
 *
 * `payload.longestGame` is optional — when the user has no Steam playtime
 * the substitution pass (T4) swaps this scene out for `most_replayed`, so
 * by the time this component renders the field should be present. We
 * defensively render a calm fallback if it isn't, rather than crashing.
 */
interface LongestGameSceneProps {
  payload: RecapPayload;
  caption: string;
  isActive: boolean;
}

export function LongestGameScene({
  payload,
  caption,
  isActive,
}: LongestGameSceneProps) {
  const prefersReducedMotion = useReducedMotion();

  const longest = payload.longestGame;

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

  // Hourglass tilt: a gentle ±15deg sway when playing, static when paused
  // or reduced-motion. The transform is on a wrapper so the icon's own
  // pixel shape stays crisp at any tilt. Framer-motion's `Easing` type
  // is a narrow string-literal union — annotating the local lets us use
  // "easeInOut" without TS widening it to `string`.
  const hourglassAnim: TargetAndTransition =
    !prefersReducedMotion && isActive
      ? {
          rotate: [0, 15, -15, 0],
          transition: {
            duration: 3,
            repeat: Infinity,
            ease: "easeInOut",
          },
        }
      : { rotate: 0 };

  return (
    <motion.section
      className="flex w-full max-w-2xl flex-col items-center text-center"
      variants={containerVariants}
      initial="initial"
      animate={isActive ? "active" : "initial"}
      aria-label="Longest game"
    >
      <motion.div
        variants={childVariants}
        className="text-[var(--accent)]"
        aria-hidden="true"
      >
        <motion.div animate={hourglassAnim}>
          <Hourglass size={64} strokeWidth={1.5} />
        </motion.div>
      </motion.div>

      {longest ? (
        <>
          <motion.div
            variants={childVariants}
            className="mt-8 flex items-center gap-6"
          >
            <CoverPanel game={longest.game} />
            <div className="text-left">
              <p className="text-6xl font-bold tabular-nums text-[var(--text)] sm:text-7xl">
                {formatHours(longest.hoursPlayed)}
              </p>
              <p className="mt-1 text-xs uppercase tracking-[0.2em] text-[var(--text-dim)]">
                hours played
              </p>
            </div>
          </motion.div>

          <motion.p
            variants={childVariants}
            className="mt-4 text-lg font-medium text-[var(--text)]"
          >
            {longest.game.title}
          </motion.p>
        </>
      ) : (
        // Defensive: substitution should have swapped this scene if no
        // playtime existed, but render a calm placeholder rather than
        // crashing if the payload arrives with the field missing.
        <p className="mt-8 text-base text-[var(--text-dim)]">
          No playtime data this window.
        </p>
      )}

      <p className="mt-8 max-w-md text-base text-[var(--text-dim)] sm:text-lg">
        {caption}
      </p>
    </motion.section>
  );
}

/**
 * Game cover at a tile size that pairs visually with the big hours
 * number on the right. Same null-cover fallback as TopGamesScene.
 */
function CoverPanel({ game }: { game: TopGameRef }) {
  if (!game.coverUrl) {
    return (
      <div
        className="h-32 w-24 shrink-0 rounded-lg bg-gradient-to-br from-[var(--accent)]/30 to-[var(--bg)]"
        aria-hidden="true"
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- RAWG covers aren't in remotePatterns
    <img
      src={game.coverUrl}
      alt=""
      className="h-32 w-24 shrink-0 rounded-lg object-cover"
    />
  );
}

/**
 * Format hours played for display. Whole-hour values render without a
 * decimal ("45"); fractional values get one decimal place ("45.5"). We
 * round to one decimal across the board to avoid noise like "45.4999".
 */
function formatHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(1);
}
