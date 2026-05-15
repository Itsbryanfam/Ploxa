"use client";

import { motion, useReducedMotion } from "framer-motion";

import { Mascot } from "@/components/mascot/mascot";
import type { RecapPayload, TopGameRef } from "@/lib/recaps/types";

/**
 * GotyScene — Phase 6 T14.
 *
 * The "your top-rated game of the window" beat. Full-bleed game cover as
 * background, a dark gradient overlay for legibility, and the game title +
 * rating chip centered over the top. The AI caption sits beneath.
 *
 * Mascot in a `celebrating` pose sits in a bottom corner — this is one of
 * the emotionally-loaded beats so the mascot pulls weight here.
 *
 * Cover fallback: when `payload.goty.coverUrl` is null we render a tinted
 * gradient panel in the accent color, matching the rest of the recap's
 * null-cover treatment (TopGamesScene, LongestGameScene).
 *
 * Defensive: `payload.goty` is optional in the type. The aggregator
 * always sets it when there's at least one log, but we defensively render
 * a calm fallback if the field is absent so the pageant never crashes.
 */
interface GotySceneProps {
  payload: RecapPayload;
  caption: string;
  isActive: boolean;
}

export function GotyScene({
  payload,
  caption,
  isActive,
}: GotySceneProps) {
  const prefersReducedMotion = useReducedMotion();
  const goty = payload.goty;

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

  if (!goty) {
    // Defensive fallback when goty data is missing.
    return (
      <section
        className="flex w-full max-w-2xl flex-col items-center text-center"
        aria-label="Top-rated game of the window"
      >
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--text-dim)]">
          Top-rated game
        </p>
        <p className="mt-8 max-w-md text-base text-[var(--text-dim)] sm:text-lg">
          {caption}
        </p>
      </section>
    );
  }

  return (
    <motion.section
      className="relative flex w-full max-w-3xl flex-col items-center text-center"
      variants={containerVariants}
      initial="initial"
      animate={isActive ? "active" : "initial"}
      aria-label="Top-rated game of the window"
    >
      <p className="text-xs uppercase tracking-[0.2em] text-[var(--text-dim)]">
        Top-rated game
      </p>

      <motion.div variants={childVariants} className="relative mt-6">
        <CoverHero game={goty} />
      </motion.div>

      <motion.div variants={childVariants} className="mt-6">
        <h2 className="text-4xl font-bold tracking-tight text-[var(--text)] sm:text-5xl">
          {goty.title}
        </h2>
        <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-1.5 font-mono text-sm font-medium text-[var(--accent-fg)]">
          <span>{goty.rating}/5</span>
        </div>
      </motion.div>

      <motion.div variants={childVariants} className="mt-6">
        <Mascot size="md" mood="celebrating" silent />
      </motion.div>

      <p className="mt-6 max-w-md text-base text-[var(--text-dim)] sm:text-lg">
        {caption}
      </p>
    </motion.section>
  );
}

/**
 * Cover hero: a larger version of the cover for the GotyScene's central
 * focus. Uses a dark gradient overlay to keep title text legible against
 * arbitrary cover colors when the user views the recap full-bleed.
 *
 * Plain `<img>` (not next/image) because cover URLs come from RAWG and
 * are not in `remotePatterns` — same rationale as other scenes.
 */
function CoverHero({ game }: { game: TopGameRef }) {
  if (!game.coverUrl) {
    return (
      <div
        className="h-64 w-48 rounded-xl bg-gradient-to-br from-[var(--accent)]/40 to-[var(--bg)] shadow-2xl"
        aria-hidden="true"
      />
    );
  }
  return (
    <div className="relative h-64 w-48 overflow-hidden rounded-xl shadow-2xl">
      {/* eslint-disable-next-line @next/next/no-img-element -- RAWG covers aren't in remotePatterns */}
      <img
        src={game.coverUrl}
        alt=""
        className="h-full w-full object-cover"
      />
      <div
        className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent"
        aria-hidden="true"
      />
    </div>
  );
}
