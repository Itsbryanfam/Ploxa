import "server-only";
import type { schema } from "@/lib/db";

/**
 * STUB — full implementation lands in T18 with ON CONFLICT dedupe.
 * Locking the signature here so T6-T17 callers don't need to change.
 *
 * Real semantics (T18):
 *  - Self-notify silenced
 *  - Blocked-pair silenced
 *  - ON CONFLICT (user_id, type, target_id, actor_id) DO UPDATE bumps
 *    created_at and clears read_at
 */
export async function emit(_args: {
  type: (typeof schema.notificationTypeEnum)["enumValues"][number];
  recipientUserId: string;
  actorUserId: string;
  targetId: string;
}): Promise<void> {
  // Intentional no-op; T18 wires the real INSERT.
}
