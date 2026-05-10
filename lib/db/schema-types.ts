// Type-only imports — fully erased at compile time, so this file stays
// safe to import from client components without dragging Drizzle/postgres
// into the client bundle.
import type { logStatusEnum, platformEnum, importStatusEnum } from "./schema";

export type LogStatus = (typeof logStatusEnum.enumValues)[number];
export type PlatformKind = (typeof platformEnum.enumValues)[number];
export type ImportStatus = (typeof importStatusEnum.enumValues)[number];

// Hardcoded runtime array (kept hardcoded rather than reading
// `logStatusEnum.enumValues` so this file remains client-bundle clean).
// Order matters — used to render UI lists.
export const LOG_STATUSES: readonly LogStatus[] = [
  "backlog", "playing", "completed", "dropped", "on_hold", "wishlist",
] as const;

export const STATUS_LABELS: Record<LogStatus, string> = {
  backlog: "Backlog",
  playing: "Playing",
  completed: "Completed",
  dropped: "Dropped",
  on_hold: "On Hold",
  wishlist: "Wishlist",
};
