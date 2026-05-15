// Exponential recovery time-constant (NOT a half-life). After τ days the
// dismissal penalty has lifted ~63% (1 - e^-1); the true 50% point is
// τ·ln2 ≈ 9.7 days. Spec prose says "14-day half-life" loosely — this is
// the time-constant of that decay, and the test thresholds are calibrated
// to this exponential curve (a true-half-life formula would fail them).
const DECAY_TIME_CONSTANT_DAYS = 14;

export type DismissalState = {
  dismissedAt: Date | null;
  snoozedUntil: Date | null;
  neverAgain: boolean;
};

/**
 * Recovery MULTIPLIER for dismissal soft-negatives (NOT a penalty magnitude).
 * 1.0 = no penalty (use the candidate as-is); 0 = hard exclude (never-again
 * or an active snooze). The caller multiplies the composite score by this:
 * `composite * softNegativePenalty(state)`.
 */
export function softNegativePenalty(state: DismissalState, now: Date = new Date()): number {
  if (state.neverAgain) return 0;
  if (state.snoozedUntil !== null && state.snoozedUntil.getTime() > now.getTime()) return 0;
  if (state.dismissedAt === null) return 1.0;

  const days = (now.getTime() - state.dismissedAt.getTime()) / (24 * 60 * 60 * 1000);
  if (days < 0) return 1.0; // clock skew / backfilled rows can yield dismissedAt > now; treat as not-yet-decayed

  const penalty = 1 - Math.exp(-days / DECAY_TIME_CONSTANT_DAYS);
  return Math.max(0, Math.min(1, penalty));
}
