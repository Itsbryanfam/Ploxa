"use client";

import { motion, useReducedMotion } from "framer-motion";

import type { RecapPayload, TopGameRef } from "@/lib/recaps/types";

/**
 * TopGamesScene — Phase 6 T13.
 *
 * Vertical poster stack of the user's top 5 (yearly) or top 3 (monthly)
 * games for the window. Each row staggers in from the bottom 150ms after
 * the previous so the eye lands top-to-bottom rather than all-at-once.
 *
 * Layout: rows of small cover + title + rating. The cover URL may be
 * `null` (manual import, IGDB gap) — we fall back to a gradient placeholder
 * panel of the same size so the row alignment stays stable. The
 * accent-tinted gradient is the same trick used by `GameCard` for missing
 * covers elsewhere in the app.
 *
 * Reduced-motion: rows render in place with no fade or offset.
 *
 * The plan calls for "1-by-1 reveal with stagger" — we use Framer's
 * `staggerChildren` rather than per-row delays so a future tweak (e.g.,
 * changing 5→3 in the monthly case) doesn't require updating per-row
 * timing math.
 */
interface TopGamesSceneProps {
  payload: RecapPayload;
  caption: string;
  isActive: boolean;
}

export function TopGamesScene({
  payload,
  caption,
  isActive,
}: TopGamesSceneProps) {
  const prefersReducedMotion = useReducedMotion();

  // Yearly recaps surface up to 5, monthly up to 3. We honor whatever the
  // aggregator delivered in `payload.topGames` (it's already capped) but
  // additionally clamp to the mode-appropriate ceiling so a stale cache
  // built with a different mode can't blow past the design.
  const limit = payload.mode === "yearly" ? 5 : 3;
  const games = payload.topGames.slice(0, limit);

  const containerVariants = {
    initial: {},
    active: {
      transition: prefersReducedMotion
        ? { staggerChildren: 0 }
        : { staggerChildren: 0.15, delayChildren: 0.1 },
    },
  } as const;

  const rowVariants = {
    initial: prefersReducedMotion
      ? { opacity: 1, x: 0 }
      : { opacity: 0, x: -24 },
    active: {
      opacity: 1,
      x: 0,
      transition: { duration: prefersReducedMotion ? 0 : 0.4 },
    },
  } as const;

  return (
    <motion.section
      className="flex w-full max-w-xl flex-col"
      variants={containerVariants}
      initial="initial"
      animate={isActive ? "active" : "initial"}
      aria-label="Top games of the window"
    >
      <h2 className="mb-6 text-center text-xs uppercase tracking-[0.2em] text-[var(--text-dim)]">
        Your top {games.length}
      </h2>

      <ol className="flex flex-col gap-3">
        {games.map((game, i) => (
          <motion.li
            key={game.gameId}
            variants={rowVariants}
            className="flex items-center gap-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3"
          >
            <span className="w-6 shrink-0 text-center font-mono text-sm text-[var(--text-dim)]">
              {i + 1}
            </span>
            <PosterCell game={game} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-medium text-[var(--text)]">
                {game.title}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-[var(--bg)] px-2 py-1 font-mono text-xs text-[var(--text)]">
              {game.rating}/5
            </span>
          </motion.li>
        ))}
      </ol>

      <p className="mt-8 text-center text-base text-[var(--text-dim)] sm:text-lg">
        {caption}
      </p>
    </motion.section>
  );
}

/**
 * Compact poster cell. Real cover when available, otherwise a gradient
 * fallback in the accent + bg colors so the row still reads visually.
 * Plain `<img>` (not next/image) because cover URLs come from RAWG and
 * are not in `remotePatterns` — same rationale as FeaturedListCard.
 */
function PosterCell({ game }: { game: TopGameRef }) {
  if (!game.coverUrl) {
    return (
      <div
        className="h-14 w-10 shrink-0 rounded-md bg-gradient-to-br from-[var(--accent)]/30 to-[var(--bg)]"
        aria-hidden="true"
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- RAWG covers aren't in remotePatterns
    <img
      src={game.coverUrl}
      alt=""
      className="h-14 w-10 shrink-0 rounded-md object-cover"
    />
  );
}
