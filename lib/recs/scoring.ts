export const SCORE_WEIGHTS = {
  taste: 0.35,
  mood: 0.25,
  timeFit: 0.2,
  social: 0.1,
  libraryBonus: 0.1,
} as const;

export type ScoreInputs = {
  taste: number;
  mood: number;
  timeFit: number;
  social: number;
  libraryBonus: number;
  softNegPenalty: number;
};

export function composeScore(i: ScoreInputs): number {
  const weighted =
    SCORE_WEIGHTS.taste * clamp01(i.taste) +
    SCORE_WEIGHTS.mood * clamp01(i.mood) +
    SCORE_WEIGHTS.timeFit * clamp01(i.timeFit) +
    SCORE_WEIGHTS.social * clamp01(i.social) +
    SCORE_WEIGHTS.libraryBonus * clamp01(i.libraryBonus);
  return clamp01(weighted * clamp01(i.softNegPenalty));
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
