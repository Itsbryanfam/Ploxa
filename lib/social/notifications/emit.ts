import "server-only";
import { sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { isBlockedBetween } from "@/lib/social/_shared/visibility";

const { notifications } = schema;

/**
 * Single chokepoint for emitting in-app notifications. ALL Phase 5
 * notification side-effects route through here — never INSERT into
 * notifications directly from a server action.
 *
 * Semantics:
 *  - Self-notify silenced (recipient === actor)
 *  - Blocked-pair silenced (either direction)
 *  - Idempotent dedupe: ON CONFLICT (user_id, type, target_id, actor_id)
 *    bumps created_at and clears read_at — repeat actions resurface the
 *    notification in the inbox instead of stacking N rows
 *
 * Dedupe unique index landed in migration 0008 as notifications_dedupe_uniq.
 *
 * Note: actorId is non-null in our domain (every Phase 5 notification has
 * a human or system actor). The notifications.actorId column allows null
 * for legacy schema reasons (system-of-record events from an earlier
 * design), but emit() requires it.
 */
export type EmitArgs = {
  type: (typeof schema.notificationTypeEnum)["enumValues"][number];
  recipientUserId: string;
  actorUserId: string;
  targetId: string;
};

export async function emit(args: EmitArgs): Promise<void> {
  // Silently skip self-notify. Don't reveal the predicate by throwing.
  if (args.recipientUserId === args.actorUserId) return;

  // Silently skip blocked pairs. The check is sub-ms on the blocks PK +
  // reverse index from migration 0008.
  if (await isBlockedBetween(args.recipientUserId, args.actorUserId)) return;

  // Best-effort INSERT: a rare race (actor row deleted mid-flight → ON DELETE
  // SET NULL cascades on notifications.actor_id) propagates to the caller.
  // Callers treat notification emission as fire-and-forget, so a thrown error
  // would surface as a failed mutation. T19's inbox polling will paper over
  // any dropped rows by re-fetching on focus.
  await db
    .insert(notifications)
    .values({
      userId: args.recipientUserId,
      type: args.type,
      targetId: args.targetId,
      actorId: args.actorUserId,
    })
    .onConflictDoUpdate({
      target: [
        notifications.userId,
        notifications.type,
        notifications.targetId,
        notifications.actorId,
      ],
      set: {
        // `excluded` refers to the would-be-inserted row in ON CONFLICT clauses.
        // We bump the timestamp to the new attempt's time so the inbox sorts
        // the row to the top again, and clear read_at so the user sees the
        // re-surfaced notification as unread.
        createdAt: sql`excluded.created_at`,
        readAt: null,
      },
    });
}
