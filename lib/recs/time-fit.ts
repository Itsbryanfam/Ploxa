import type { TimeBudget } from "@/lib/recs/moods";

type Profile = {
  peak: number; // hours
  sigma: number; // hours
  upperCap: number | null; // hard exclusion above this; null = no upper cap
  lowerCap: number | null; // hard exclusion below; null = no lower cap
};

// Time-fit tuning table. peak = the session length (hours) that best fits
// this budget; sigma = how forgiving the Gaussian is around peak (wider for
// longer budgets, which carry looser length expectations). upperCap/lowerCap
// are hard exclusions: a game outside them can't sensibly fill the budget and
// is scored 0 before the Gaussian. Hand-tuned heuristics — adjust here to
// reshape fit behavior; no other code depends on the exact numbers.
const PROFILES: Record<TimeBudget, Profile> = {
  "15min": { peak: 0.25, sigma: 0.17, upperCap: 2.0, lowerCap: null },
  "1hr": { peak: 1.0, sigma: 0.5, upperCap: 8.0, lowerCap: null },
  "3hr+": { peak: 5.0, sigma: 2.0, upperCap: null, lowerCap: 2.0 },
  "multi-session": { peak: 20.0, sigma: 10.0, upperCap: null, lowerCap: 4.0 },
};

export function isTimeFeasible(gameHours: number | null, budget: TimeBudget): boolean {
  if (gameHours === null) return true;
  const p = PROFILES[budget];
  if (p.upperCap !== null && gameHours > p.upperCap) return false;
  if (p.lowerCap !== null && gameHours < p.lowerCap) return false;
  return true;
}

export function timeFitScore(gameHours: number | null, budget: TimeBudget): number {
  if (gameHours === null) return 0.5;
  if (!isTimeFeasible(gameHours, budget)) return 0;
  const p = PROFILES[budget];
  const diff = gameHours - p.peak;
  const score = Math.exp(-(diff * diff) / (2 * p.sigma * p.sigma));
  return Math.max(0, Math.min(1, score));
}
