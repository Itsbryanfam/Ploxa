"use client";

/**
 * PageantProgressBar — Phase 6 T12.
 *
 * Horizontal segment bar pinned to the top of the Pageant viewport. One
 * segment per scene, mirroring Instagram Stories.
 *
 * Fill rules:
 * - Past scenes (i < currentIndex):  full (100% width)
 * - Current scene (i === currentIndex):
 *     - playing → animates 0% → 100% over `holdMs` via CSS keyframe
 *     - paused  → frozen mid-fill via `animation-play-state: paused`
 *     - reduced-motion → instant 100% (the auto-advance still fires from
 *       the parent's setTimeout; we just don't show the progress sweep)
 * - Future scenes (i > currentIndex): empty (0% width)
 *
 * Why a CSS keyframe instead of a width-transition: when the user taps
 * "forward" mid-fill, AnimatePresence remounts the next scene and the
 * progress sweep restarts from 0% cleanly. A transition would either
 * leave the bar visually stuck at its old width briefly or require an
 * intermediate reset render. The keyframe + `key={currentIndex}` reset
 * is the simplest correct behavior.
 *
 * The `data-testid` hooks are deliberately scoped to the segments so the
 * T22 Playwright smoke can assert "segment N filled, segment M empty"
 * without depending on the exact CSS animation timing.
 */
interface PageantProgressBarProps {
  currentIndex: number;
  total: number;
  isPaused: boolean;
  holdMs: number;
  reducedMotion: boolean;
}

export function PageantProgressBar({
  currentIndex,
  total,
  isPaused,
  holdMs,
  reducedMotion,
}: PageantProgressBarProps) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-2 z-20 flex gap-1 px-4"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total - 1}
      aria-valuenow={currentIndex}
      aria-label={`Scene ${currentIndex + 1} of ${total}`}
    >
      {Array.from({ length: total }).map((_, i) => {
        const status: "past" | "current" | "future" =
          i < currentIndex ? "past" : i === currentIndex ? "current" : "future";
        return (
          <div
            key={i}
            data-testid={`pageant-progress-${i}`}
            data-status={status}
            className="h-1 flex-1 overflow-hidden rounded-full bg-white/20"
          >
            <div
              // The CSS animation key (`${currentIndex}-${i}`) forces a
              // remount of the inner fill when the active scene changes,
              // which restarts the keyframe at 0% — no stale-width flash.
              key={`${currentIndex}-${i}`}
              className="h-full bg-white"
              style={getFillStyle({ status, holdMs, isPaused, reducedMotion })}
            />
          </div>
        );
      })}
      {/*
        Scoped keyframe. Lives next to the consumer so the bar is fully
        self-contained — no globals.css edit needed. styled-jsx is the
        Next-app-router-native option and ships with Next 16; it scopes
        the keyframe name to this component instance.
      */}
      <style jsx>{`
        @keyframes pageantFill {
          from {
            width: 0%;
          }
          to {
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}

function getFillStyle({
  status,
  holdMs,
  isPaused,
  reducedMotion,
}: {
  status: "past" | "current" | "future";
  holdMs: number;
  isPaused: boolean;
  reducedMotion: boolean;
}): React.CSSProperties {
  if (status === "past") return { width: "100%" };
  if (status === "future") return { width: "0%" };
  // current
  if (reducedMotion) {
    // No sweep — the auto-advance timer in the parent still fires after
    // holdMs; visually we just don't draw a moving fill.
    return { width: "0%" };
  }
  return {
    width: "0%",
    animation: `pageantFill ${holdMs}ms linear forwards`,
    animationPlayState: isPaused ? "paused" : "running",
  };
}
