import "server-only";
import { and, eq, inArray, or } from "drizzle-orm";

import { db, schema } from "@/lib/db";

const { follows, likes, listLikes, comments, reviews, lists } = schema;

/**
 * Block cascade — invoked after a fresh INSERT into blocks. Strips the
 * existing-interaction graph between blocker and blocked so the block has
 * teeth (not just future-content invisibility).
 *
 * Not transactional — if step N fails, steps 1..N-1 are already committed.
 * Re-block runs cascade again so partial failure self-heals on retry.
 */
export async function cascadeBlock(args: {
  blockerId: string;
  blockedId: string;
}): Promise<void> {
  const { blockerId, blockedId } = args;

  // (a) Drop mutual follows in both directions.
  await db
    .delete(follows)
    .where(
      or(
        and(eq(follows.followerId, blockerId), eq(follows.followedId, blockedId)),
        and(eq(follows.followerId, blockedId), eq(follows.followedId, blockerId)),
      ),
    );

  // (b) Blocked's likes on blocker's reviews.
  await db
    .delete(likes)
    .where(
      and(
        eq(likes.userId, blockedId),
        inArray(
          likes.reviewId,
          db.select({ id: reviews.id }).from(reviews).where(eq(reviews.userId, blockerId)),
        ),
      ),
    );

  // (c) Blocker's likes on blocked's reviews.
  await db
    .delete(likes)
    .where(
      and(
        eq(likes.userId, blockerId),
        inArray(
          likes.reviewId,
          db.select({ id: reviews.id }).from(reviews).where(eq(reviews.userId, blockedId)),
        ),
      ),
    );

  // (d) Blocked's comments on blocker's reviews — hard delete.
  await db
    .delete(comments)
    .where(
      and(
        eq(comments.userId, blockedId),
        inArray(
          comments.reviewId,
          db.select({ id: reviews.id }).from(reviews).where(eq(reviews.userId, blockerId)),
        ),
      ),
    );

  // (e) Blocked's list-likes on blocker's lists.
  await db
    .delete(listLikes)
    .where(
      and(
        eq(listLikes.userId, blockedId),
        inArray(
          listLikes.listId,
          db.select({ id: lists.id }).from(lists).where(eq(lists.userId, blockerId)),
        ),
      ),
    );

  // (f) Blocker's list-likes on blocked's lists.
  await db
    .delete(listLikes)
    .where(
      and(
        eq(listLikes.userId, blockerId),
        inArray(
          listLikes.listId,
          db.select({ id: lists.id }).from(lists).where(eq(lists.userId, blockedId)),
        ),
      ),
    );
}
