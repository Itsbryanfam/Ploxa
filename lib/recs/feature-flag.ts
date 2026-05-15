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
 * NODE_ENV is intentionally not in the zod env schema — Next injects it
 * per-environment, so it is read from process.env directly here (do not
 * route it through @/lib/env). RECS_V2_ENABLED is an optionalString —
 * empty/unset is undefined, so the explicit "true"/"false" comparison
 * drives the override and undefined falls through to the default. The
 * value is trimmed + lowercased first so an operator flipping this under
 * pressure ("FALSE", " false ") still gets the state they intended.
 */
export function isRecsV2Enabled(userId: string): boolean {
  const canary = (env.RECS_V2_USERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (canary.includes(userId)) return true;
  const flag = env.RECS_V2_ENABLED?.trim().toLowerCase();
  if (flag === "true") return true;
  if (flag === "false") return false;
  return process.env.NODE_ENV !== "production";
}
