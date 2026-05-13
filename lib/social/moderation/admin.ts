import "server-only";

import { env } from "@/lib/env";

/**
 * Admin allowlist. Beta-scale: 1-3 admins set via the comma-separated
 * `ADMIN_USER_IDS` env var (UUIDs). `env.ADMIN_USER_IDS` is parsed to
 * `string[]` in lib/env.ts.
 *
 * If beta grows, migrate to a `user_roles(user_id, role)` table and replace
 * the membership check with a DB lookup.
 */
export function isAdmin(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return env.ADMIN_USER_IDS.includes(userId);
}
