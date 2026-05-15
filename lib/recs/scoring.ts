export const SCORE_WEIGHTS = {
  taste: 0.35,
  mood: 0.25,
  timeFit: 0.2,
  social: 0.1,
  libraryBonus: 0.1,
} as const;

// composeScore relies on the weights forming a convex combination (sum = 1)
// so the weighted blend stays in [0,1]. These weights are a product decision
// that WILL be re-tuned (see design spec) — guard the invariant at module
// load so an unbalanced re-tune fails `next build`, not silently in prod.
if (
  Math.abs(
    SCORE_WEIGHTS.taste +
      SCORE_WEIGHTS.mood +
      SCORE_WEIGHTS.timeFit +
      SCORE_WEIGHTS.social +
      SCORE_WEIGHTS.libraryBonus -
      1,
  ) > 1e-9
) {
  throw new Error("SCORE_WEIGHTS must sum to 1.0");
}

export type ScoreInputs = {
  taste: number;
  mood: number;
  timeFit: number;
  social: number;
  libraryBonus: number;
  softNegPenalty: number;
};

// All axes are assumed finite and in [0,1] (each upstream module self-clamps
// per its own contract). NaN/Inf propagate by design — fix the upstream
// source, don't sanitize here.
export function composeScore(i: ScoreInputs): number {
  const weighted =
    SCORE_WEIGHTS.taste * clamp01(i.taste) +
    SCORE_WEIGHTS.mood * clamp01(i.mood) +
    SCORE_WEIGHTS.timeFit * clamp01(i.timeFit) +
    SCORE_WEIGHTS.social * clamp01(i.social) +
    SCORE_WEIGHTS.libraryBonus * clamp01(i.libraryBonus);
  // softNegPenalty is a multiplicative retention gate, NOT a 6th weighted
  // axis: a 0 penalty (never-again / active snooze) must hard-zero the score
  // regardless of how strong the other axes are. Do not fold into the sum.
  return clamp01(weighted * clamp01(i.softNegPenalty));
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
