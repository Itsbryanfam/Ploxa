/**
 * Tier classification for a user's taste data maturity.
 *
 * Drives:
 * - Which mascot pose renders on /u/{name}/taste
 * - Whether the narrative section is shown
 * - Whether AI rec rerank runs (sparse tier falls back to metadata-only)
 * - Which copy appears in onboarding nudges
 *
 * Thresholds chosen so a brand-new user crosses 'sparse' fast (any log),
 * unlocks the AI narrative at the 10-log milestone, and earns the "no
 * sharpening banner" full state at 30 logs (the master plan gate point).
 */
export type TasteTier = "empty" | "sparse" | "sharpening" | "full";

export function tierForUser(logCount: number): TasteTier {
  if (logCount <= 0) return "empty";
  if (logCount < 10) return "sparse";
  if (logCount < 30) return "sharpening";
  return "full";
}

/** Convenience — predicate forms. */
export function isAtLeast(tier: TasteTier, minimum: TasteTier): boolean {
  const order: TasteTier[] = ["empty", "sparse", "sharpening", "full"];
  return order.indexOf(tier) >= order.indexOf(minimum);
}
