"use client";

import { Heart } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";

import type { RecapPayload } from "@/lib/recaps/types";

/**
 * MechanicLoveScene — Phase 6 T14.
 *
 * The "your favorite mechanic" beat. Big mechanic name in display type
 * (e.g. "Roguelite progression"), a small heart icon as the visual hook,
 * and the AI caption beneath.
 *
 * Per the plan: "small mechanic icon if available". For v1 we use a
 * single shared Heart icon — keeping the visual language consistent.
 * A future task could map mechanic categories to per-mechanic icons.
 *
 * Defensive: `payload.topMechanic` is optional. When absent the
 * substitution pass swaps this scene for `top_theme`, so we shouldn't
 * normally render with it missing — but we defensively render a calm
 * fallback if the field arrives undefined.
 */
interface MechanicLoveSceneProps {
  payload: RecapPayload;
  caption: string;
  isActive: boolean;
}

export function MechanicLoveScene({
  payload,
  caption,
  isActive,
}: MechanicLoveSceneProps) {
  const prefersReducedMotion = useReducedMotion();
  const mechanic = payload.topMechanic;

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
      aria-label="Favorite mechanic"
    >
      <motion.div
        variants={childVariants}
        className="text-[var(--accent)]"
        aria-hidden="true"
      >
        <Heart size={56} strokeWidth={1.5} />
      </motion.div>

      <motion.p
        variants={childVariants}
        className="mt-4 text-xs uppercase tracking-[0.2em] text-[var(--text-dim)]"
      >
        Your love language
      </motion.p>

      {mechanic ? (
        <motion.h2
          variants={childVariants}
          className="mt-3 text-5xl font-bold tracking-tight text-[var(--text)] sm:text-6xl"
        >
          {mechanic.name}
        </motion.h2>
      ) : (
        <motion.p
          variants={childVariants}
          className="mt-3 text-base text-[var(--text-dim)]"
        >
          Many mechanics, no clear favorite.
        </motion.p>
      )}

      <p className="mt-8 max-w-md text-base text-[var(--text-dim)] sm:text-lg">
        {caption}
      </p>
    </motion.section>
  );
}
