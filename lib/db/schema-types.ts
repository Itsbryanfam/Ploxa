// Drizzle pgEnum doesn't directly export the union — these literal unions
// must stay in sync with lib/db/schema.ts enum definitions.
export type LogStatus = "backlog" | "playing" | "completed" | "dropped" | "on_hold" | "wishlist";
export type PlatformKind = "steam" | "xbox" | "psn";
export type ImportStatus = "queued" | "running" | "completed" | "failed";

export const LOG_STATUSES: LogStatus[] = [
  "backlog", "playing", "completed", "dropped", "on_hold", "wishlist",
];

export const STATUS_LABELS: Record<LogStatus, string> = {
  backlog: "Backlog",
  playing: "Playing",
  completed: "Completed",
  dropped: "Dropped",
  on_hold: "On Hold",
  wishlist: "Wishlist",
};
