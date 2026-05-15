"use client";

import { Feather } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";

import type { RecapPayload } from "@/lib/recaps/types";

/**
 * ReviewsScene — Phase 6 T13.
 *
 * The "you wrote N reviews" beat. A feather/quill icon, the review count
 * in big type, and a single favorite-review snippet rendered as a styled
 * blockquote.
 *
 * `favoriteReviewSnippet` is optional — the aggregator only populates it
 * when there's at least one review with sufficient text. The component
 * handles both the "has snippet" and "count-only" branches.
 *
 * The blockquote opening/closing typographic quotes are rendered via the
 * `&ldquo;` / `&rdquo;` HTML entities. They are decorative typography,
 * not punctuation that would be confused with code or filenames.
 *
 * Reduced-motion: caption + count + blockquote all render in place; no
 * stagger, no fade.
 */
interface ReviewsSceneProps {
  payload: RecapPayload;
  caption: string;
  isActive: boolean;
}

export function ReviewsScene({
  payload,
  caption,
  isActive,
}: ReviewsSceneProps) {
  const prefersReducedMotion = useReducedMotion();

  const count = payload.totals.reviewCount;
  const snippet = payload.favoriteReviewSnippet;

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

  return (
    <motion.section
      className="flex w-full max-w-2xl flex-col items-center text-center"
      variants={containerVariants}
      initial="initial"
      animate={isActive ? "active" : "initial"}
      aria-label="Reviews this window"
    >
      {/* Caption sits above the count per the plan: "caption above quill". */}
      <p className="max-w-md text-base text-[var(--text-dim)] sm:text-lg">
        {caption}
      </p>

      <motion.div
        variants={childVariants}
        className="mt-8 text-[var(--accent)]"
        aria-hidden="true"
      >
        <Feather size={48} strokeWidth={1.5} />
      </motion.div>

      <motion.div variants={childVariants} className="mt-4">
        <p className="text-6xl font-bold tabular-nums text-[var(--text)] sm:text-7xl">
          {count.toLocaleString()}
        </p>
        <p className="mt-2 text-xs uppercase tracking-[0.2em] text-[var(--text-dim)]">
          {count === 1 ? "review written" : "reviews written"}
        </p>
      </motion.div>

      {snippet ? (
        <motion.blockquote
          variants={childVariants}
          className="mt-8 max-w-xl border-l-2 border-[var(--accent)] pl-4 text-left text-base italic text-[var(--text)] sm:text-lg"
        >
          &ldquo;{snippet.snippet}&rdquo;
          <footer className="mt-2 text-xs not-italic uppercase tracking-[0.2em] text-[var(--text-dim)]">
            on {snippet.gameTitle}
          </footer>
        </motion.blockquote>
      ) : null}
    </motion.section>
  );
}
