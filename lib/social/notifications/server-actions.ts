"use server";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";

const { notifications } = schema;

export type InboxFilter = "all" | "follows" | "reactions" | "comments" | "wishlist";

const FILTER_TYPE_MAP: Record<
  InboxFilter,
  (typeof schema.notificationTypeEnum)["enumValues"][number][] | null
> = {
  all: null,
  follows: ["new_follower"],
  reactions: ["review_liked", "list_liked"],
  comments: ["review_commented", "comment_replied"],
  wishlist: ["wishlist_logged_by_friend"],
};

export type InboxRow = {
  id: string;
  type: (typeof schema.notificationTypeEnum)["enumValues"][number];
  targetId: string | null;
  actorId: string | null;
  readAt: Date | null;
  createdAt: Date;
  actorUsername: string | null;
  actorDisplayName: string | null;
  actorAvatarUrl: string | null;
};

/**
 * Pull-on-read inbox. Viewer fetched internally via getCachedUser so callers
 * cannot read someone else's inbox by spoofing the userId arg (same pattern
 * as T16's reactions and T14's comments).
 *
 * Order: unread first (read_at IS NULL), then created_at DESC. Backed by
 * notifications_user_unread_idx (user_id, read_at, created_at DESC) from
 * migration 0008.
 */
export async function getInbox(
  opts: { filter?: InboxFilter; limit?: number; offset?: number } = {},
): Promise<InboxRow[]> {
  const user = await getCachedUser();
  if (!user) return [];

  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const filter = opts.filter ?? "all";
  const types = FILTER_TYPE_MAP[filter];

  return await db
    .select({
      id: notifications.id,
      type: notifications.type,
      targetId: notifications.targetId,
      actorId: notifications.actorId,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
      actorUsername: schema.profiles.username,
      actorDisplayName: schema.profiles.displayName,
      actorAvatarUrl: schema.profiles.avatarUrl,
    })
    .from(notifications)
    .leftJoin(schema.profiles, eq(schema.profiles.userId, notifications.actorId))
    .where(
      and(
        eq(notifications.userId, user.id),
        types ? inArray(notifications.type, types) : undefined,
      ),
    )
    .orderBy(sql`(${notifications.readAt} IS NULL) DESC`, desc(notifications.createdAt))
    .limit(limit)
    .offset(offset);
}

/**
 * Returns the single COUNT(*) of unread notifications for the current viewer.
 * Returns 0 for logged-out callers (NotificationBell polls this every 60s
 * regardless of session state — null user is the steady-state for the
 * sign-out window).
 */
export async function getUnreadCount(): Promise<number> {
  const user = await getCachedUser();
  if (!user) return 0;
  const rows = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
  return rows[0]?.value ?? 0;
}

/**
 * Mark a single notification read. The WHERE clause restricts to the caller's
 * own rows — a hostile call passing someone else's notification id is a
 * silent no-op (0 rows updated). revalidatePath refreshes /notifications so
 * the unread-first ordering re-sorts the freshly-read row to the bottom.
 */
export async function markRead(notificationId: string): Promise<void> {
  const user = await getCachedUser();
  if (!user) return;
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, user.id)));
  revalidatePath("/notifications");
}

/**
 * Bulk mark all of the viewer's unread rows as read. Idempotent (a second
 * call after all rows are already read is a no-op zero-row UPDATE).
 */
export async function markAllRead(): Promise<void> {
  const user = await getCachedUser();
  if (!user) return;
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
  revalidatePath("/notifications");
}
