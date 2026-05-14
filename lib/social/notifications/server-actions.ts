"use server";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import {
  buildTargetHref,
  type CommentLookup,
  type ListLookup,
  type ReviewLookup,
} from "@/lib/social/notifications/target-resolver";

const { notifications, reviews, lists, comments, games, profiles } = schema;

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
  /**
   * Resolved canonical URL for this notification's target. Null when:
   *   - the target was hard-deleted (cascade)
   *   - the target's author was soft-deleted (no username to slot in)
   *   - the type has no resolved route yet (wishlist_logged_by_friend)
   *
   * The UI renders null-href rows as non-interactive list items rather than
   * dead-ending on /home/feed (the pre-T05 fallback).
   */
  targetHref: string | null;
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

  const baseRows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      targetId: notifications.targetId,
      actorId: notifications.actorId,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
      actorUsername: profiles.username,
      actorDisplayName: profiles.displayName,
      actorAvatarUrl: profiles.avatarUrl,
    })
    .from(notifications)
    // Soft-delete filter on the join predicate, not the WHERE: we keep the
    // notification row visible (so the receiver still sees the activity) but
    // null out the actor identity. The notification-row UI renders null
    // actorUsername as "someone" with no profile link — same UX as an actor
    // whose row was hard-deleted via cascade.
    .leftJoin(
      profiles,
      and(eq(profiles.userId, notifications.actorId), isNull(profiles.deletedAt)),
    )
    .where(
      and(
        eq(notifications.userId, user.id),
        types ? inArray(notifications.type, types) : undefined,
      ),
    )
    .orderBy(sql`(${notifications.readAt} IS NULL) DESC`, desc(notifications.createdAt))
    .limit(limit)
    .offset(offset);

  // Group target ids by what kind of row they reference, then do at most
  // ONE batched IN-array lookup per kind. The 50-row default limit means
  // each kind's id-list is bounded; an empty id-list short-circuits to a
  // resolved promise so we don't waste a round-trip.
  const reviewIds = new Set<string>();
  const listIds = new Set<string>();
  const commentIds = new Set<string>();
  for (const r of baseRows) {
    if (!r.targetId) continue;
    if (r.type === "review_liked" || r.type === "review_commented") {
      reviewIds.add(r.targetId);
    } else if (r.type === "list_liked") {
      listIds.add(r.targetId);
    } else if (r.type === "comment_replied") {
      commentIds.add(r.targetId);
    }
    // new_follower needs no extra lookup — actorUsername already comes from
    // the leftJoin above. wishlist_logged_by_friend has no resolver yet.
  }

  // Author username comes via a leftJoin so a soft-deleted author yields a
  // null username — buildTargetHref then returns null for the row, which the
  // UI renders as non-interactive (no dead URL).
  const [reviewRows, listRows, commentRows] = await Promise.all([
    reviewIds.size > 0
      ? db
          .select({
            id: reviews.id,
            authorUsername: profiles.username,
            gameSlug: games.slug,
          })
          .from(reviews)
          .innerJoin(games, eq(games.id, reviews.gameId))
          .leftJoin(
            profiles,
            and(eq(profiles.userId, reviews.userId), isNull(profiles.deletedAt)),
          )
          .where(inArray(reviews.id, Array.from(reviewIds)))
      : Promise.resolve(
          [] as { id: string; authorUsername: string | null; gameSlug: string }[],
        ),
    listIds.size > 0
      ? db
          .select({
            id: lists.id,
            authorUsername: profiles.username,
            slug: lists.slug,
          })
          .from(lists)
          .leftJoin(
            profiles,
            and(eq(profiles.userId, lists.userId), isNull(profiles.deletedAt)),
          )
          .where(inArray(lists.id, Array.from(listIds)))
      : Promise.resolve(
          [] as { id: string; authorUsername: string | null; slug: string }[],
        ),
    commentIds.size > 0
      ? db
          .select({
            id: comments.id,
            authorUsername: profiles.username,
            gameSlug: games.slug,
          })
          .from(comments)
          .innerJoin(reviews, eq(reviews.id, comments.reviewId))
          .innerJoin(games, eq(games.id, reviews.gameId))
          // For comment_replied, the link points to the parent comment's
          // containing thread — the AUTHOR of the URL is the review's author
          // (whose page hosts the thread), not the parent comment's author.
          .leftJoin(
            profiles,
            and(eq(profiles.userId, reviews.userId), isNull(profiles.deletedAt)),
          )
          .where(inArray(comments.id, Array.from(commentIds)))
      : Promise.resolve(
          [] as { id: string; authorUsername: string | null; gameSlug: string }[],
        ),
  ]);

  const reviewMap: ReviewLookup = new Map(
    reviewRows.map((r) => [
      r.id,
      { authorUsername: r.authorUsername, gameSlug: r.gameSlug },
    ]),
  );
  const listMap: ListLookup = new Map(
    listRows.map((r) => [
      r.id,
      { authorUsername: r.authorUsername, slug: r.slug },
    ]),
  );
  const commentMap: CommentLookup = new Map(
    commentRows.map((r) => [
      r.id,
      { authorUsername: r.authorUsername, gameSlug: r.gameSlug },
    ]),
  );

  const lookups = { reviews: reviewMap, lists: listMap, comments: commentMap };

  return baseRows.map((r) => ({
    ...r,
    targetHref: buildTargetHref(
      { type: r.type, targetId: r.targetId, actorUsername: r.actorUsername },
      lookups,
    ),
  }));
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
