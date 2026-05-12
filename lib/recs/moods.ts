import { z } from "zod";

import { platformEnum } from "@/lib/db/schema";

/**
 * Allowed mood tokens. App-level allowlist (not pgEnum) so we can add
 * "atmospheric" / "narrative-light" / etc. via code change, no migration.
 */
export const MOODS = ["chill", "challenged", "story-driven", "mindless", "multiplayer"] as const;
export type Mood = (typeof MOODS)[number];

/** Time budget for the next session. */
export const TIMES = ["15min", "1hr", "3hr+", "multi-session"] as const;
export type TimeBudget = (typeof TIMES)[number];

/** Multi-select up to 2 — see Q7 in the spec. */
export const moodArraySchema = z
  .array(z.enum(MOODS))
  .min(1, "pick at least one mood")
  .max(2, "pick up to two moods");

export const timeSchema = z.enum(TIMES);

/**
 * Platform values mirror the platform_kind pgEnum from Phase 0. Sourced from
 * `platformEnum.enumValues` so this stays in sync if the DB enum ever grows
 * (e.g. adding "nintendo"). Drizzle's enumValues is typed as a readonly
 * tuple literal, which Zod 4's `z.enum` accepts directly.
 */
export const platformArraySchema = z
  .array(z.enum(platformEnum.enumValues))
  .min(1, "pick at least one platform");

export const filterSchema = z.object({
  moods: moodArraySchema,
  time: timeSchema,
  platforms: platformArraySchema,
});

export type FilterParams = z.infer<typeof filterSchema>;
