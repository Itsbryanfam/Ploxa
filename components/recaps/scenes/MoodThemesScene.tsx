"use client";

import { Sparkles } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";

import type { RecapPayload } from "@/lib/recaps/types";

/**
 * MoodThemesScene — Phase 6 T14.
 *
 * Substitute for `surprise` when there's no clear outlier in the user's
 * ratings. Shows up to three "mood" themes as stacked chips — a chip cloud
 * but in a centered vertical stack so the eye reads top-to-bottom.
 *
 * Uses `payload.moodThemes.themes`. The substitution pass always fires for
 * yearly mode (since surprise is rare), so this field is reliably set when
 * this scene is in `payload.scenes`. We defensively render a calm fallback
 * if it's absent.
 */
interface MoodThemesSceneProps {
  payload: RecapPayload;
  caption: string;
  isActive: boolean;
}

export function MoodThemesScene({
  payload,
  caption,
  isActive,
}: MoodThemesSceneProps) {
  const prefersReducedMotion = useReducedMotion();
  const themes = payload.moodThemes?.themes ?? [];

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
      aria-label="Mood themes"
    >
      <motion.div
        variants={childVariants}
        className="text-[var(--accent)]"
        aria-hidden="true"
      >
        <Sparkles size={48} strokeWidth={1.5} />
      </motion.div>

      <motion.p
        variants={childVariants}
        className="mt-4 text-xs uppercase tracking-[0.2em] text-[var(--text-dim)]"
      >
        Your year&rsquo;s moods
      </motion.p>

      {themes.length > 0 ? (
        <motion.ul
          variants={childVariants}
          className="mt-6 flex flex-col items-center gap-3"
        >
          {themes.slice(0, 3).map((theme, i) => (
            <motion.li
              key={theme}
              variants={childVariants}
              className="rounded-full border border-[var(--border)] bg-[var(--bg-card)] px-5 py-2 text-lg font-medium text-[var(--text)] sm:text-xl"
              style={{
                // First theme reads as the headline; others step down slightly
                // so the eye reads top-to-bottom without feeling identical.
                opacity: 1 - i * 0.15,
              }}
            >
              {theme}
            </motion.li>
          ))}
        </motion.ul>
      ) : (
        <p className="mt-8 text-base text-[var(--text-dim)]">
          Many moods, no single throughline.
        </p>
      )}

      <p className="mt-8 max-w-md text-base text-[var(--text-dim)] sm:text-lg">
        {caption}
      </p>
    </motion.section>
  );
}
