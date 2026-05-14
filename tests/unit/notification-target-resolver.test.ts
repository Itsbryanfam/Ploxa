import { describe, expect, it } from "vitest";

import {
  buildTargetHref,
  type ReviewLookup,
  type ListLookup,
  type CommentLookup,
} from "@/lib/social/notifications/target-resolver";

/**
 * Pure-function tests for the per-row href builder. The batched DB lookups in
 * getInbox are exercised by the integration path (page renders + Playwright);
 * here we lock down the URL shapes per notification type so a stray edit can't
 * silently re-break the routing dead-end T26-deferral comment claimed.
 *
 * Lookup contracts:
 *   - reviews: reviewId → { authorUsername, gameSlug }
 *   - lists:   listId   → { authorUsername, slug }
 *   - comments:commentId → { authorUsername, gameSlug } (via review.gameId)
 *
 * `null` from any lookup means the target was hard-deleted (cascade) or the
 * author was soft-deleted (`profiles.deletedAt IS NOT NULL`); we never link
 * to a dead URL — buildTargetHref returns null instead.
 */

const reviews: ReviewLookup = new Map([
  ["review-1", { authorUsername: "alice", gameSlug: "outer-wilds" }],
  // review-2 deliberately absent → simulates hard-delete (cascade) or
  // soft-deleted author whose username was masked to null in the join.
]);

const lists: ListLookup = new Map([
  ["list-1", { authorUsername: "bob", slug: "goty-2024" }],
]);

const comments: CommentLookup = new Map([
  ["comment-1", { authorUsername: "carol", gameSlug: "disco-elysium" }],
]);

describe("buildTargetHref", () => {
  it("new_follower → /u/{actorUsername} when actorUsername is set", () => {
    const href = buildTargetHref(
      {
        type: "new_follower",
        targetId: "actor-uuid",
        actorUsername: "dave",
      },
      { reviews, lists, comments },
    );
    expect(href).toBe("/u/dave");
  });

  it("new_follower → null when actorUsername is null (soft-deleted actor)", () => {
    const href = buildTargetHref(
      {
        type: "new_follower",
        targetId: "actor-uuid",
        actorUsername: null,
      },
      { reviews, lists, comments },
    );
    expect(href).toBeNull();
  });

  it("review_liked → /u/{author}/reviews/{gameSlug}", () => {
    const href = buildTargetHref(
      {
        type: "review_liked",
        targetId: "review-1",
        actorUsername: "ignored",
      },
      { reviews, lists, comments },
    );
    expect(href).toBe("/u/alice/reviews/outer-wilds");
  });

  it("review_commented → /u/{author}/reviews/{gameSlug}", () => {
    const href = buildTargetHref(
      {
        type: "review_commented",
        targetId: "review-1",
        actorUsername: "ignored",
      },
      { reviews, lists, comments },
    );
    expect(href).toBe("/u/alice/reviews/outer-wilds");
  });

  it("review_liked / review_commented → null when review row is missing", () => {
    expect(
      buildTargetHref(
        { type: "review_liked", targetId: "review-2", actorUsername: "x" },
        { reviews, lists, comments },
      ),
    ).toBeNull();
    expect(
      buildTargetHref(
        { type: "review_commented", targetId: "review-2", actorUsername: "x" },
        { reviews, lists, comments },
      ),
    ).toBeNull();
  });

  it("list_liked → /u/{author}/lists/{listSlug}", () => {
    const href = buildTargetHref(
      {
        type: "list_liked",
        targetId: "list-1",
        actorUsername: "ignored",
      },
      { reviews, lists, comments },
    );
    expect(href).toBe("/u/bob/lists/goty-2024");
  });

  it("list_liked → null when list row is missing", () => {
    const href = buildTargetHref(
      { type: "list_liked", targetId: "list-missing", actorUsername: "x" },
      { reviews, lists, comments },
    );
    expect(href).toBeNull();
  });

  it("comment_replied → /u/{author}/reviews/{gameSlug}#comment-{commentId}", () => {
    const href = buildTargetHref(
      {
        type: "comment_replied",
        targetId: "comment-1",
        actorUsername: "ignored",
      },
      { reviews, lists, comments },
    );
    // targetId IS the parent comment id (per emit() in lib/social/comments/triggers.ts);
    // we anchor-link to it so the reader lands on the thread context.
    expect(href).toBe("/u/carol/reviews/disco-elysium#comment-comment-1");
  });

  it("comment_replied → null when comment row is missing", () => {
    const href = buildTargetHref(
      {
        type: "comment_replied",
        targetId: "comment-missing",
        actorUsername: "x",
      },
      { reviews, lists, comments },
    );
    expect(href).toBeNull();
  });

  it("wishlist_logged_by_friend → null (no emit path yet — type is forward-looking)", () => {
    // The enum exists but lib/ never emits this notification today (see
    // digest.ts JSDoc). Until the emit path lands and pins a targetId
    // convention, the safest behavior is null — better than linking to
    // /home/feed which was the silent dead-end this task is removing.
    const href = buildTargetHref(
      {
        type: "wishlist_logged_by_friend",
        targetId: "any",
        actorUsername: "x",
      },
      { reviews, lists, comments },
    );
    expect(href).toBeNull();
  });

  it("returns null when targetId is null (legacy column nullability)", () => {
    // notifications.target_id is a nullable column for legacy reasons even
    // though emit() always supplies one. Defensive null-out so we never
    // construct "/u/.../reviews/null" type URLs.
    const href = buildTargetHref(
      {
        type: "review_liked",
        targetId: null,
        actorUsername: "x",
      },
      { reviews, lists, comments },
    );
    expect(href).toBeNull();
  });
});
