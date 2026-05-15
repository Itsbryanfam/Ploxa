import "server-only";

import { env } from "@/lib/env";

/**
 * Whether to serve the v2 /play-next pipeline.
 *
 * Resolution:
 *  1. user in RECS_V2_USERS canary list → true
 *  2. RECS_V2_ENABLED === "true"  → true
 *  3. RECS_V2_ENABLED === "false" → false
 *  4. unset → dev/test default: true off-prod, false in production
 *
 * (env has no NODE_ENV; read process.env.NODE_ENV directly. RECS_V2_ENABLED
 * is an optionalString — empty/unset is undefined, so the explicit "true"/
 * "false" comparison drives the override and undefined falls to the default.)
 */
export function isRecsV2Enabled(userId: string): boolean {
  const canary = (env.RECS_V2_USERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (canary.includes(userId)) return true;
  if (env.RECS_V2_ENABLED === "true") return true;
  if (env.RECS_V2_ENABLED === "false") return false;
  return process.env.NODE_ENV !== "production";
}
