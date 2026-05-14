import type { schema } from "@/lib/db";

/**
 * Per-row target href resolver for the notifications inbox.
 *
 * Background:
 *   notifications.target_id is polymorphic — what it points at depends on
 *   notifications.type. The emit chokepoint (lib/social/notifications/emit.ts
 *   plus the per-feature trigger files) sets it as follows:
 *
 *     type                      | target_id meaning
 *     ──────────────────────────┼──────────────────────────────────────
 *     new_follower              | actor user_id (= the new follower)
 *     review_liked              | reviews.id
 *     review_commented          | reviews.id
 *     comment_replied           | comments.id  (the PARENT comment)
 *     list_liked                | lists.id
 *     wishlist_logged_by_friend | (no emit path yet — convention TBD)
 *
 * This module is split out of server-actions.ts so the per-row href shape is
 * unit-testable as a pure function (lookups injected) without touching db.
 * getInbox does the batched IN-array lookups and feeds the resulting maps in.
 */

export type NotificationType =
  (typeof schema.notificationTypeEnum)["enumValues"][number];

export type ReviewLookup = Map<
  string,
  { authorUsername: string | null; gameSlug: string }
>;
export type ListLookup = Map<
  string,
  { authorUsername: string | null; slug: string }
>;
export type CommentLookup = Map<
  string,
  { authorUsername: string | null; gameSlug: string }
>;

export type ResolverLookups = {
  reviews: ReviewLookup;
  lists: ListLookup;
  comments: CommentLookup;
};

export type ResolveInput = {
  type: NotificationType;
  targetId: string | null;
  actorUsername: string | null;
};

/**
 * Pure function: given a notification row's (type, targetId, actorUsername)
 * and a set of pre-batched target lookups, return the canonical URL the row
 * should navigate to — or null when the target was hard-deleted, the actor
 * was soft-deleted (so we have no username to slot into the URL), or the
 * notification type has no resolved route yet.
 *
 * Returning null is the explicit signal to the UI to render the row as a
 * non-interactive list item (no anchor, no click handler) rather than dead-
 * ending on /home/feed (the previous behavior, which the T26 TODO papered
 * over).
 */
export function buildTargetHref(
  row: ResolveInput,
  lookups: ResolverLookups,
): string | null {
  if (row.targetId === null) return null;

  switch (row.type) {
    case "new_follower":
      // Profile URLs are username-only; if the actor's profile is soft-
      // deleted the leftJoin in getInbox returned null actorUsername.
      return row.actorUsername ? `/u/${row.actorUsername}` : null;

    case "review_liked":
    case "review_commented": {
      const review = lookups.reviews.get(row.targetId);
      if (!review || !review.authorUsername) return null;
      return `/u/${review.authorUsername}/reviews/${review.gameSlug}`;
    }

    case "list_liked": {
      const list = lookups.lists.get(row.targetId);
      if (!list || !list.authorUsername) return null;
      return `/u/${list.authorUsername}/lists/${list.slug}`;
    }

    case "comment_replied": {
      // targetId is the PARENT comment id (per onComment in
      // lib/social/comments/triggers.ts). We resolve the comment back to
      // its containing review/game, then anchor-link to the comment so
      // the reader lands directly in the thread context.
      const comment = lookups.comments.get(row.targetId);
      if (!comment || !comment.authorUsername) return null;
      return `/u/${comment.authorUsername}/reviews/${comment.gameSlug}#comment-${row.targetId}`;
    }

    case "wishlist_logged_by_friend":
      // Forward-looking type: emit path is not yet implemented (see
      // digest.ts JSDoc on wishlistTriggers). Returning null keeps us
      // honest — we'd rather render a non-interactive row than link to
      // /home/feed silently. When the emit path lands and pins a
      // targetId convention, add the case here in lock-step.
      return null;
  }
}
