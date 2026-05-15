"use client";

import { motion, useReducedMotion } from "framer-motion";

import { Mascot } from "@/components/mascot/mascot";
import type { RecapPayload } from "@/lib/recaps/types";

/**
 * OpeningScene — Phase 6 T13.
 *
 * The first beat of the Pageant. Big year (or month name) display, mascot
 * in a `waving` pose to greet the viewer, and the AI-generated caption
 * below. The caption is supplied by `buildOpeningPrompt` from T5/T6 and
 * always passed in via props — this component does not know or care
 * whether the string came from the AI or the fallback template.
 *
 * Layout: centered single column. The motion structure is a parent
 * `motion.div` that orchestrates a children stagger, so the big year +
 * mascot + caption tween in sequence when `isActive` flips true.
 *
 * Reduced-motion: `useReducedMotion()` short-circuits the variants to
 * their final state and zeros the transition duration, so the scene
 * renders fully visible with no animation. The Pageant's own scene
 * transition is also flattened to instant by its parent under
 * reduced-motion (see Pageant.tsx), so this scene gets the prefer-static
 * treatment end-to-end.
 *
 * Accessibility: the caption is rendered unconditionally outside any
 * animation gate. Even if a future motion variant froze the visuals
 * (e.g. an unrecovered error in framer-motion), screen readers + scrape
 * tools still see the caption text in the DOM.
 */
interface OpeningSceneProps {
  payload: RecapPayload;
  caption: string;
  isActive: boolean;
}

export function OpeningScene({
  payload,
  caption,
  isActive,
}: OpeningSceneProps) {
  const prefersReducedMotion = useReducedMotion();

  // Derive the headline text from the recap window. The window is stored
  // as ISO strings; for the yearly recap the start date's UTC year is the
  // canonical label ("2026"). For monthly we render the full month+year
  // as a single line ("May 2026") so the opening still feels like a
  // titled beat rather than a bare numeral.
  const windowStart = new Date(payload.windowStart);
  const headline =
    payload.mode === "yearly"
      ? String(windowStart.getUTCFullYear())
      : windowStart.toLocaleString("en-US", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        });

  const containerVariants = {
    initial: {},
    active: {
      transition: prefersReducedMotion
        ? { staggerChildren: 0 }
        : { staggerChildren: 0.2, delayChildren: 0.05 },
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
      aria-label="Recap opening"
    >
      <motion.h1
        variants={childVariants}
        className="text-7xl font-bold tracking-tight text-[var(--text)] sm:text-8xl"
      >
        {headline}
      </motion.h1>

      <motion.div variants={childVariants} className="mt-8">
        <Mascot size="xl" mood="waving" silent />
      </motion.div>

      {/* Caption rendered unconditionally so SSR / a11y / scrape paths
          always see the text. The motion wrapper only adds a fade and is
          purely cosmetic. */}
      <motion.p
        variants={childVariants}
        className="mt-8 max-w-md text-base text-[var(--text-dim)] sm:text-lg"
      >
        {caption}
      </motion.p>
    </motion.section>
  );
}
