"use client";

import { RotateCcw } from "lucide-react";
import {
  motion,
  useReducedMotion,
  type TargetAndTransition,
} from "framer-motion";

import type { RecapPayload, TopGameRef } from "@/lib/recaps/types";

/**
 * MostReplayedScene — Phase 6 T14.
 *
 * Substitute for `longest_game` when the user has no Steam playtime data.
 * Same visual shape as LongestGameScene: an icon (rotate-cw instead of
 * hourglass), the game cover, and the count as a big number. The label
 * changes from "hours played" to "times replayed".
 *
 * Uses `payload.mostReplayed` (replayCount + the game ref). The
 * substitution pass guarantees this field is set when this scene is in
 * `payload.scenes`, but we defensively render a calm fallback if it's
 * absent.
 */
interface MostReplayedSceneProps {
  payload: RecapPayload;
  caption: string;
  isActive: boolean;
}

export function MostReplayedScene({
  payload,
  caption,
  isActive,
}: MostReplayedSceneProps) {
  const prefersReducedMotion = useReducedMotion();
  const replayed = payload.mostReplayed;

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

  // The rotate-cw icon spins slowly when playing, static under
  // reduced-motion. Mirrors the LongestGameScene hourglass-tilt pattern.
  const spinAnim: TargetAndTransition =
    !prefersReducedMotion && isActive
      ? {
          rotate: 360,
          transition: {
            duration: 6,
            repeat: Infinity,
            ease: "linear",
          },
        }
      : { rotate: 0 };

  return (
    <motion.section
      className="flex w-full max-w-2xl flex-col items-center text-center"
      variants={containerVariants}
      initial="initial"
      animate={isActive ? "active" : "initial"}
      aria-label="Most replayed game"
    >
      <motion.div
        variants={childVariants}
        className="text-[var(--accent)]"
        aria-hidden="true"
      >
        <motion.div animate={spinAnim}>
          <RotateCcw size={64} strokeWidth={1.5} />
        </motion.div>
      </motion.div>

      {replayed ? (
        <>
          <motion.div
            variants={childVariants}
            className="mt-8 flex items-center gap-6"
          >
            <CoverPanel game={replayed.game} />
            <div className="text-left">
              <p className="text-6xl font-bold tabular-nums text-[var(--text)] sm:text-7xl">
                {replayed.replayCount}
              </p>
              <p className="mt-1 text-xs uppercase tracking-[0.2em] text-[var(--text-dim)]">
                {replayed.replayCount === 1 ? "time replayed" : "times replayed"}
              </p>
            </div>
          </motion.div>

          <motion.p
            variants={childVariants}
            className="mt-4 text-lg font-medium text-[var(--text)]"
          >
            {replayed.game.title}
          </motion.p>
        </>
      ) : (
        <p className="mt-8 text-base text-[var(--text-dim)]">
          No standout replays this window.
        </p>
      )}

      <p className="mt-8 max-w-md text-base text-[var(--text-dim)] sm:text-lg">
        {caption}
      </p>
    </motion.section>
  );
}

/**
 * Cover panel — mirrors LongestGameScene's `CoverPanel` for visual
 * continuity between the primary and substitute scenes.
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
