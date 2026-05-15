"use client";

import { useEffect, useReducer } from "react";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type PanInfo,
} from "framer-motion";

import type { RecapMode, RecapPayload, SceneId } from "@/lib/recaps/types";
import { getScene } from "@/lib/recaps/scenes";

import { PageantControls } from "./PageantControls";
import { PageantProgressBar } from "./PageantProgressBar";

/**
 * Pageant — Phase 6 T12.
 *
 * Stories-style scene sequencer for the year-in-review / monthly recap.
 * Replaces the T11 stub. Three inputs (auto-timer, gestures, keyboard)
 * funnel through a pure reducer (`pageantReducer`, exported for tests).
 *
 * Controls:
 *   - Auto-advance: setTimeout(holdMs), cleared on every transition/pause.
 *     `holdMs` is per-scene via `Scene.holdDurationMs`, defaulting to 8s.
 *   - Tap zones (three columns over the scene area, behind the controls):
 *       left third  → BACK
 *       middle third → PAUSE/RESUME toggle
 *       right third → ADVANCE
 *   - Swipe: Framer Motion `drag="x"` with a 50px threshold on dragEnd.
 *   - Keyboard: ← BACK · → ADVANCE · space PAUSE/RESUME · Esc → JUMP 0.
 *
 * Pause semantics: sticky. Once paused (by tap, space, or pause button)
 * the timer does not resume until the user explicitly resumes (or skips,
 * which acts as an advance). This matches the plan's "manual resume
 * required (no auto-resume)" requirement.
 *
 * prefers-reduced-motion: scene cross-fade duration drops to 0, the
 * progress bar fill is a static empty-then-full toggle (no sweep), and
 * the swipe drag is disabled (we keep keyboard + tap so the recap is
 * still navigable). The auto-advance timer still fires normally so users
 * with reduced-motion preferences still get the auto-paced sequence.
 *
 * Scene rendering: T12 ships a placeholder `<SceneRenderer>` that just
 * shows the scene id + caption. T13/T14 swap this for real components
 * (one per scene id) without touching the sequencer.
 */

// -----------------------------------------------------------------------
// State machine — exported so `pageant-state.test.ts` can test in pure JS.
// -----------------------------------------------------------------------

export type PageantAction =
  | { type: "ADVANCE" }
  | { type: "BACK" }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "JUMP"; index: number };

export interface PageantState {
  index: number;
  isPaused: boolean;
  total: number;
}

export function pageantReducer(
  state: PageantState,
  action: PageantAction,
): PageantState {
  switch (action.type) {
    case "ADVANCE":
      return state.index >= state.total - 1
        ? state
        : { ...state, index: state.index + 1 };
    case "BACK":
      return state.index <= 0 ? state : { ...state, index: state.index - 1 };
    case "PAUSE":
      return { ...state, isPaused: true };
    case "RESUME":
      return { ...state, isPaused: false };
    case "JUMP":
      return {
        ...state,
        index: Math.max(0, Math.min(action.index, state.total - 1)),
      };
  }
}

// -----------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------

const DEFAULT_HOLD_MS = 8_000;
const SWIPE_THRESHOLD_PX = 50;
const SCENE_TRANSITION_MS = 400;

interface PageantProps {
  payload: RecapPayload;
  mode: RecapMode;
  initialSceneIndex?: number;
}

export function Pageant({ payload, mode, initialSceneIndex = 0 }: PageantProps) {
  const prefersReducedMotion = useReducedMotion();

  // Clamp the initial index in case the deep-link `?scene=N` overshoots.
  const safeInitial = Math.max(
    0,
    Math.min(initialSceneIndex, payload.scenes.length - 1),
  );

  const [state, dispatch] = useReducer(pageantReducer, {
    index: safeInitial,
    isPaused: false,
    total: payload.scenes.length,
  });

  const currentSceneId = payload.scenes[state.index];
  const currentScene = currentSceneId ? getScene(currentSceneId) : undefined;
  const holdMs = currentScene?.holdDurationMs ?? DEFAULT_HOLD_MS;
  const isClosingScene = currentSceneId === "closing";
  const isLastScene = state.index >= state.total - 1;

  // Auto-advance timer. The effect re-fires (and clears the prior timer)
  // every time the scene changes, the pause flag flips, or the holdMs
  // changes — which covers every case that should reset the countdown.
  //
  // We deliberately do NOT auto-advance off the last scene; the closing
  // scene holds indefinitely so the user has time to interact with the
  // share buttons.
  useEffect(() => {
    if (state.isPaused) return;
    if (isLastScene) return;

    const timer = setTimeout(() => {
      dispatch({ type: "ADVANCE" });
    }, holdMs);

    return () => clearTimeout(timer);
  }, [state.index, state.isPaused, holdMs, isLastScene]);

  // Keyboard controls. Listen on window so it works regardless of focus.
  // We intentionally don't dispatch RESUME for arrow keys — skipping
  // forward/back while paused keeps the pause sticky.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore key events when the user is typing into an input. Recap
      // pages currently have no inputs, but the share-button copy state
      // might add one later, and we don't want to hijack typing.
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      if (e.key === "ArrowLeft") {
        dispatch({ type: "BACK" });
      } else if (e.key === "ArrowRight") {
        dispatch({ type: "ADVANCE" });
      } else if (e.key === " " || e.key === "Spacebar") {
        // Spacebar pauses without scrolling the page.
        e.preventDefault();
        dispatch({ type: state.isPaused ? "RESUME" : "PAUSE" });
      } else if (e.key === "Escape") {
        dispatch({ type: "JUMP", index: 0 });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [state.isPaused]);

  // Swipe drag-end handler. We reach the 50px threshold in either
  // direction → fire the corresponding dispatch. Below threshold = no-op
  // (the dragConstraints + dragElastic snap it back visually).
  const handleDragEnd = (
    _: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) => {
    if (info.offset.x < -SWIPE_THRESHOLD_PX) {
      dispatch({ type: "ADVANCE" });
    } else if (info.offset.x > SWIPE_THRESHOLD_PX) {
      dispatch({ type: "BACK" });
    }
  };

  // Tap-third-zone handlers. These live on three absolutely-positioned
  // divs layered above the scene but *below* the control strip
  // (z-index: tap=10, controls=20, progress=20) so the visible buttons
  // always win over the tap zone they overlap.
  const onLeftTap = () => dispatch({ type: "BACK" });
  const onRightTap = () => dispatch({ type: "ADVANCE" });
  const onMiddleTap = () =>
    dispatch({ type: state.isPaused ? "RESUME" : "PAUSE" });

  // Reduced motion: the framer-motion `drag` prop still works, but we
  // disable it so the screen doesn't move at all. Keyboard + tap zones
  // remain functional.
  const dragEnabled = !prefersReducedMotion;

  // Compute the share pitch passed into PageantControls. The closing
  // scene gets a personalized pitch when possible; otherwise a generic
  // line keeps the share affordance functional.
  const sharePitch = buildSharePitch(payload, mode);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      <PageantProgressBar
        currentIndex={state.index}
        total={state.total}
        isPaused={state.isPaused}
        holdMs={holdMs}
        reducedMotion={!!prefersReducedMotion}
      />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={currentSceneId ?? state.index}
          initial={
            prefersReducedMotion ? { opacity: 1 } : { opacity: 0, x: 0 }
          }
          animate={{ opacity: 1, x: 0 }}
          exit={prefersReducedMotion ? { opacity: 1 } : { opacity: 0 }}
          transition={{
            duration: prefersReducedMotion ? 0 : SCENE_TRANSITION_MS / 1000,
          }}
          drag={dragEnabled ? "x" : false}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.2}
          onDragEnd={handleDragEnd}
          className="flex min-h-screen w-full items-center justify-center px-6 py-16"
        >
          {currentSceneId ? (
            <SceneRenderer
              sceneId={currentSceneId}
              payload={payload}
              caption={payload.captions[currentSceneId] ?? ""}
              isActive
            />
          ) : (
            // Defensive: payload.scenes is empty. Shouldn't happen — the
            // sparse-tier branch in the page route already filters this
            // out — but rather than crash, render a calm fallback.
            <div className="text-center text-sm text-[var(--text-dim)]">
              No scenes to show.
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Tap-third zones. Pointer-events on; z-10 sits between the scene
          content (z-auto) and the controls (z-20). */}
      <div className="absolute inset-0 z-10 grid grid-cols-3" aria-hidden="true">
        <button
          type="button"
          onClick={onLeftTap}
          aria-label="Previous scene"
          className="h-full w-full focus:outline-none"
          tabIndex={-1}
        />
        <button
          type="button"
          onClick={onMiddleTap}
          aria-label={state.isPaused ? "Resume" : "Pause"}
          className="h-full w-full focus:outline-none"
          tabIndex={-1}
        />
        <button
          type="button"
          onClick={onRightTap}
          aria-label="Next scene"
          className="h-full w-full focus:outline-none"
          tabIndex={-1}
        />
      </div>

      <PageantControls
        onBack={() => dispatch({ type: "BACK" })}
        onForward={() => dispatch({ type: "ADVANCE" })}
        onPauseToggle={() =>
          dispatch({ type: state.isPaused ? "RESUME" : "PAUSE" })
        }
        isPaused={state.isPaused}
        canBack={state.index > 0}
        canForward={state.index < state.total - 1}
        isClosingScene={isClosingScene}
        sharePitch={sharePitch}
      />
    </div>
  );
}

// -----------------------------------------------------------------------
// Placeholder SceneRenderer — T13/T14 will replace this with per-scene
// components. We keep it minimal so the page renders end-to-end and the
// state machine + gestures can be smoke-tested before scenes exist.
// -----------------------------------------------------------------------

interface SceneRendererProps {
  sceneId: SceneId;
  payload: RecapPayload;
  caption: string;
  isActive: boolean;
}

function SceneRenderer({ sceneId, caption }: SceneRendererProps) {
  return (
    <div className="max-w-xl text-center">
      <p className="text-xs uppercase tracking-[0.2em] text-[var(--text-dim)]">
        {sceneId.replace(/_/g, " ")}
      </p>
      <p className="mt-6 text-2xl font-medium text-[var(--text)]">
        {caption || `[scene ${sceneId} placeholder]`}
      </p>
      <p className="mt-4 text-xs text-[var(--text-dim)]">
        T13/T14 will render the actual scene UI for this beat.
      </p>
    </div>
  );
}

/**
 * Build a short pitch line for the share intent text. Kept here (rather
 * than in PageantControls) because it needs the typed payload — the
 * control strip just needs the string.
 */
function buildSharePitch(payload: RecapPayload, mode: RecapMode): string {
  const window =
    mode === "monthly" ? "month in games" : "year in games";
  const total = payload.totals.totalGames;
  return total > 0 ? `My ${window}: ${total} games logged.` : `My ${window}.`;
}
