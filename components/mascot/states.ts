/**
 * Mascot state machine.
 *
 * The mascot has a discrete set of "moods" that drive sprite + animation.
 * Phase 0 ships a CSS-drawn placeholder; Phase 5+ swaps in commissioned art.
 *
 * Design rule: mascot is OPT-OUT for chat-style interruptions. Default
 * behavior is celebratory + state-indicator only — no Clippy syndrome.
 */

export type MascotMood =
  | "idle" // resting, gentle bob — default
  | "waving" // greeting (onboarding, login)
  | "thinking" // AI is working (review draft, recs generating)
  | "celebrating" // milestone hit (first log, review published, year recap)
  | "confused" // something went wrong
  | "pointing" // calling attention to something (empty state, CTA)
  | "asleep"; // long idle / inactive tab

export interface MascotState {
  mood: MascotMood;
  message?: string; // Optional speech bubble text
  durationMs?: number; // Optional auto-revert duration (else manual)
}

export const DEFAULT_MASCOT_STATE: MascotState = { mood: "idle" };

/** Animation timings per mood (CSS animation duration) */
export const MOOD_TIMINGS: Record<MascotMood, { animation: string; duration: string }> = {
  idle: { animation: "mascot-bob", duration: "3s" },
  waving: { animation: "mascot-wave", duration: "1.5s" },
  thinking: { animation: "mascot-think", duration: "1.2s" },
  celebrating: { animation: "mascot-celebrate", duration: "0.8s" },
  confused: { animation: "mascot-confused", duration: "1.5s" },
  pointing: { animation: "mascot-point", duration: "2s" },
  asleep: { animation: "mascot-sleep", duration: "4s" },
};
