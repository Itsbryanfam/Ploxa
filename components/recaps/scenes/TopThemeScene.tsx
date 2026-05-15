"use client";

import { Tag } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";

import type { RecapPayload } from "@/lib/recaps/types";

/**
 * TopThemeScene — Phase 6 T14.
 *
 * Substitute for `mechanic_love` when the user has fewer than 3 mechanics
 * across the window. Same visual shape as MechanicLoveScene: a small icon,
 * a label, and the theme name in big display type.
 *
 * Uses `payload.topTheme`. The substitution pass guarantees this field is
 * set when this scene is in `payload.scenes`, but we render a calm
 * fallback if it's absent.
 */
interface TopThemeSceneProps {
  payload: RecapPayload;
  caption: string;
  isActive: boolean;
}

export function TopThemeScene({
  payload,
  caption,
  isActive,
}: TopThemeSceneProps) {
  const prefersReducedMotion = useReducedMotion();
  const theme = payload.topTheme;

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

  return (
    <motion.section
      className="flex w-full max-w-2xl flex-col items-center text-center"
      variants={containerVariants}
      initial="initial"
      animate={isActive ? "active" : "initial"}
      aria-label="Top theme"
    >
      <motion.div
        variants={childVariants}
        className="text-[var(--accent)]"
        aria-hidden="true"
      >
        <Tag size={56} strokeWidth={1.5} />
      </motion.div>

      <motion.p
        variants={childVariants}
        className="mt-4 text-xs uppercase tracking-[0.2em] text-[var(--text-dim)]"
      >
        Your year&rsquo;s vibe
      </motion.p>

      {theme ? (
        <motion.h2
          variants={childVariants}
          className="mt-3 text-5xl font-bold tracking-tight text-[var(--text)] sm:text-6xl"
        >
          {theme.name}
        </motion.h2>
      ) : (
        <motion.p
          variants={childVariants}
          className="mt-3 text-base text-[var(--text-dim)]"
        >
          Eclectic taste, no single theme.
        </motion.p>
      )}

      <p className="mt-8 max-w-md text-base text-[var(--text-dim)] sm:text-lg">
        {caption}
      </p>
    </motion.section>
  );
}
