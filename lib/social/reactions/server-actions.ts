"use server";
import { and, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { isBlockedBetween } from "@/lib/social/_shared/visibility";
import { loadVisibleReview } from "@/lib/social/_shared/review-visibility";
import { emit } from "@/lib/social/notifications/emit";

const { likes, listLikes, lists } = schema;

/**
 * Reaction server actions for reviews and lists. Each like is idempotent via
 * the composite PK (user, target) + ON CONFLICT DO NOTHING — re-liking the
 * same target is a no-op, not an error.
 *
 * Notification semantics:
 *  - emit() only fires when .returning() actually inserted a row. A re-like
 *    (already in the table) returns 0 rows and we skip notify. T18's emit
 *    will additionally dedupe by (recipient, type, target, actor) so even
 *    if a duplicate slipped through, the inbox row is bumped not duplicated.
 *
 * Block + self-like behavior:
 *  - Both return ok:true (NOT ok:false) to avoid leaking the block edge or
 *    revealing "you can't like your own review" as a discrete error. Caller
 *    UI optimistically toggles either way; the row simply doesn't exist
 *    server-side, so the next page refresh self-corrects.
 *
 * Cache invalidation:
 *  - Unlike comments/follows/blocks, reactions do NOT call revalidatePath.
 *    Like counts are denormalized client-side via T17's optimistic toggle;
 *    the SSR fallback updates on the natural feed/profile revalidation
 *    cadence rather than burning a cache miss per click. Revisit if the
 *    canonical review page ever renders authoritative counts without an
 *    optimistic client wrapper.
 *
 * TOCTOU window:
 *  - The findFirst → isBlockedBetween → INSERT chain is not transactional;
 *    a block edge appearing in the ~50ms window leaves a like visible until
 *    the post-hoc filter in feed/queries.ts strips it on the next read.
 *    feed/queries.ts is the source of truth for read-side visibility.
 */

export async function likeReview(reviewId: string): Promise<{ ok: boolean }> {
  const user = await getCachedUser();
  if (!user) return { ok: false };

  // F-007: only like a review the caller may see (owner, or a published
  // public review by a public author) — parity with likeList's gate.
  const review = await loadVisibleReview(reviewId, user.id);
  if (!review) return { ok: false };

  // Self-like + blocked-pair both succeed silently (don't reveal predicate).
  if (review.userId === user.id) return { ok: true };
  if (await isBlockedBetween(user.id, review.userId)) return { ok: true };

  const inserted = await db
    .insert(likes)
    .values({ userId: user.id, reviewId })
    .onConflictDoNothing()
    .returning({ userId: likes.userId });

  if (inserted.length > 0) {
    await emit({
      type: "review_liked",
      recipientUserId: review.userId,
      actorUserId: user.id,
      targetId: reviewId,
    });
  }
  return { ok: true };
}

export async function unlikeReview(reviewId: string): Promise<{ ok: boolean }> {
  const user = await getCachedUser();
  if (!user) return { ok: false };
  // Idempotent: 0 rows is success — re-unlike or unliking a deleted review
  // both reach the same final state.
  await db
    .delete(likes)
    .where(and(eq(likes.userId, user.id), eq(likes.reviewId, reviewId)));
  return { ok: true };
}

export async function likeList(listId: string): Promise<{ ok: boolean }> {
  const user = await getCachedUser();
  if (!user) return { ok: false };

  const list = await db.query.lists.findFirst({
    where: eq(lists.id, listId),
    columns: { userId: true, isPublic: true, publishedAt: true },
  });
  if (!list) return { ok: false };
  // Can't like an unpublished or private list. ok:false (not silent) because
  // these are configuration states the UI should reflect, not auth/block
  // predicates we're protecting.
  if (!list.isPublic || !list.publishedAt) return { ok: false };
  if (list.userId === user.id) return { ok: true };
  if (await isBlockedBetween(user.id, list.userId)) return { ok: true };

  const inserted = await db
    .insert(listLikes)
    .values({ userId: user.id, listId })
    .onConflictDoNothing()
    .returning({ userId: listLikes.userId });

  if (inserted.length > 0) {
    await emit({
      type: "list_liked",
      recipientUserId: list.userId,
      actorUserId: user.id,
      targetId: listId,
    });
  }
  return { ok: true };
}

export async function unlikeList(listId: string): Promise<{ ok: boolean }> {
  const user = await getCachedUser();
  if (!user) return { ok: false };
  // Idempotent: 0 rows is success.
  await db
    .delete(listLikes)
    .where(and(eq(listLikes.userId, user.id), eq(listLikes.listId, listId)));
  return { ok: true };
}
