export const SCORE_WEIGHTS = {
  taste: 0.3,
  mood: 0.22,
  timeFit: 0.18,
  social: 0.08,
  libraryBonus: 0.07,
  // 2026-05-15: recommendations skewed to old/original entries because the
  // scorer had no recency or quality signal — an original and its sequel
  // have near-identical taste vectors, so the tiebreak fell to arbitrary
  // DB scan order (≈ ascending id ≈ older) and "Risk of Rain" beat the
  // higher-rated "Risk of Rain 2". `recencyQuality` is a blended
  // released-year + rawg_rating axis. Weight is "moderate" per product
  // call: noticeable but taste stays the single largest axis.
  recencyQuality: 0.15,
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
      SCORE_WEIGHTS.libraryBonus +
      SCORE_WEIGHTS.recencyQuality -
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
  // Blended recency (released year) + quality (rawg_rating), [0,1]. Callers
  // that lack the signal should pass a neutral 0.5, not 0.
  recencyQuality: number;
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
    SCORE_WEIGHTS.libraryBonus * clamp01(i.libraryBonus) +
    SCORE_WEIGHTS.recencyQuality * clamp01(i.recencyQuality);
  // softNegPenalty is a multiplicative retention gate, NOT a 6th weighted
  // axis: a 0 penalty (never-again / active snooze) must hard-zero the score
  // regardless of how strong the other axes are. Do not fold into the sum.
  return clamp01(weighted * clamp01(i.softNegPenalty));
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
