import type { LogStatus } from "@/lib/db/schema-types";

const NON_MATERIAL_STATUSES = new Set<LogStatus>(["backlog", "wishlist"]);

/**
 * Determines whether a log mutation produces a material event for the
 * activity feed. Material events: status change to any non-backlog/
 * non-wishlist target, rating set, rating changed (NOT cleared).
 *
 * Status change wins when both fire in one mutation (e.g. backlog → completed
 * with rating 9 in the same update) — status is the bigger signal.
 *
 * NOT material: backlog adds (would spam imports into followers' feeds),
 * wishlist adds, rating cleared, notes/platform/date edits.
 */
export function materialEventFromMutation(args: {
  prevStatus: LogStatus | null;
  newStatus: LogStatus;
  prevRating: number | null;
  newRating: number | null;
}): { eventType: "status_change" | "rating_set" } | null {
  // Status change to a material status.
  if (
    args.prevStatus !== args.newStatus &&
    !NON_MATERIAL_STATUSES.has(args.newStatus)
  ) {
    return { eventType: "status_change" };
  }
  // Rating set or changed (not cleared).
  if (args.newRating !== null && args.newRating !== args.prevRating) {
    return { eventType: "rating_set" };
  }
  return null;
}
