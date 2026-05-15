"use client";

import { Sparkles } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";

import type { RecapPayload, TopGameRef } from "@/lib/recaps/types";

/**
 * SurpriseScene — Phase 6 T14.
 *
 * The "you didn't expect this one to land" beat. A game cover at center
 * with a sparkle decoration around it, the rating + surprise-genre
 * annotation ("Action: 4.5/5 vs your typical 3.2/5"), and the AI caption
 * beneath.
 *
 * The sparkle decoration is three Lucide `Sparkles` icons absolutely
 * positioned around the cover. Under reduced-motion they sit static; with
 * motion they pulse gently. The choice of three sparkles (not many) keeps
 * the visual tasteful per the calm-copy / no-emojis house style.
 *
 * Defensive: `payload.surprise` is optional. When absent the substitution
 * pass swaps this scene for `mood_themes`, but we render a calm fallback
 * if the field arrives undefined.
 */
interface SurpriseSceneProps {
  payload: RecapPayload;
  caption: string;
  isActive: boolean;
}

export function SurpriseScene({
  payload,
  caption,
  isActive,
}: SurpriseSceneProps) {
  const prefersReducedMotion = useReducedMotion();
  const surprise = payload.surprise;

  const containerVariants = {
    initial: {},
    active: {
      transition: prefersReducedMotion
        ? { staggerChildren: 0 }
        : { staggerChildren: 0.18, delayChildren: 0.1 },
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

  // Sparkle pulse — opacity flick on a 2s cycle when active, static otherwise.
  const sparkleAnim =
    !prefersReducedMotion && isActive
      ? {
          opacity: [0.4, 1, 0.4],
          transition: {
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut" as const,
          },
        }
      : { opacity: 0.85 };

  return (
    <motion.section
      className="flex w-full max-w-2xl flex-col items-center text-center"
      variants={containerVariants}
      initial="initial"
      animate={isActive ? "active" : "initial"}
      aria-label="Year-end surprise"
    >
      <p className="text-xs uppercase tracking-[0.2em] text-[var(--text-dim)]">
        Your biggest surprise
      </p>

      {surprise ? (
        <>
          <motion.div
            variants={childVariants}
            className="relative mt-6"
          >
            {/* Sparkles around the cover. Top-left, top-right, bottom-right. */}
            <motion.div
              className="absolute -left-6 -top-6 text-[var(--accent)]"
              aria-hidden="true"
              animate={sparkleAnim}
            >
              <Sparkles size={24} strokeWidth={1.5} />
            </motion.div>
            <motion.div
              className="absolute -right-6 -top-4 text-[var(--accent)]"
              aria-hidden="true"
              animate={sparkleAnim}
            >
              <Sparkles size={20} strokeWidth={1.5} />
            </motion.div>
            <motion.div
              className="absolute -bottom-4 -right-6 text-[var(--accent)]"
              aria-hidden="true"
              animate={sparkleAnim}
            >
              <Sparkles size={28} strokeWidth={1.5} />
            </motion.div>

            <CoverPanel game={surprise.game} />
          </motion.div>

          <motion.h2
            variants={childVariants}
            className="mt-6 text-3xl font-bold tracking-tight text-[var(--text)] sm:text-4xl"
          >
            {surprise.game.title}
          </motion.h2>

          {/* Rating delta annotation: "Action: 4.5/5 vs your typical 3.2/5". */}
          <motion.p
            variants={childVariants}
            className="mt-3 font-mono text-sm text-[var(--text-dim)] sm:text-base"
          >
            {surprise.surpriseGenre}: {surprise.game.rating}/5
            <span className="mx-2 text-[var(--text-dim)]">vs typical</span>
            {formatBaseline(surprise.baselineAvg)}/5
          </motion.p>
        </>
      ) : (
        <p className="mt-8 text-base text-[var(--text-dim)]">
          No standout surprises this window.
        </p>
      )}

      <p className="mt-8 max-w-md text-base text-[var(--text-dim)] sm:text-lg">
        {caption}
      </p>
    </motion.section>
  );
}

/**
 * Cover for the surprise. Same null-cover fallback pattern as the other
 * scenes.
 */
function CoverPanel({ game }: { game: TopGameRef }) {
  if (!game.coverUrl) {
    return (
      <div
        className="h-48 w-36 rounded-xl bg-gradient-to-br from-[var(--accent)]/40 to-[var(--bg)] shadow-xl"
        aria-hidden="true"
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- RAWG covers aren't in remotePatterns
    <img
      src={game.coverUrl}
      alt=""
      className="h-48 w-36 rounded-xl object-cover shadow-xl"
    />
  );
}

/**
 * Format the baseline avg rating to one decimal place. Drops a trailing
 * zero on whole numbers so "3.0" reads as "3" — matches the rating
 * formatting elsewhere.
 */
function formatBaseline(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
