const HALF_LIFE_DAYS = 14;

export type DismissalState = {
  dismissedAt: Date | null;
  snoozedUntil: Date | null;
  neverAgain: boolean;
};

export function softNegativePenalty(state: DismissalState, now: Date = new Date()): number {
  if (state.neverAgain) return 0;
  if (state.snoozedUntil !== null && state.snoozedUntil.getTime() > now.getTime()) return 0;
  if (state.dismissedAt === null) return 1.0;

  const days = (now.getTime() - state.dismissedAt.getTime()) / (24 * 60 * 60 * 1000);
  if (days < 0) return 1.0; // dismissedAt in future = data glitch, ignore

  const penalty = 1 - Math.exp(-days / HALF_LIFE_DAYS);
  return Math.max(0, Math.min(1, penalty));
}
