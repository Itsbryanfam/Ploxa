import { describe, expect, it } from "vitest";

import {
  buildReportTargetUrl,
  type CommentTargetLookup,
  type ListTargetLookup,
  type ProfileTargetLookup,
  type ReviewTargetLookup,
} from "@/lib/social/moderation/target-resolver";

/**
 * Pure-function tests for the per-row content URL builder used by the admin
 * reports queue (T10 of audit-fixes-2026-05-14). The batched DB lookups in
 * getReportQueue are exercised by the integration path (page renders + manual
 * QA); here we lock down the URL shape per `report_target_type` enum value
 * so a stray edit can't silently re-break the link-to-content fix.
 *
 * Lookup contracts:
 *   - reviews:  reviewId  → { authorUsername, gameSlug }
 *   - lists:    listId    → { authorUsername, slug }
 *   - comments: commentId → { authorUsername, gameSlug } (via review.gameId,
 *                          where authorUsername is the REVIEW author whose
 *                          page hosts the thread)
 *   - profiles: userId    → { username }
 *
 * `null` (or a missing map entry) means the target was hard-deleted (cascade
 * since the report was filed) or the author was soft-deleted
 * (`profiles.deletedAt IS NOT NULL`); we never link to a dead URL —
 * buildReportTargetUrl returns null and the UI renders "(deleted)".
 */

const reviews: ReviewTargetLookup = new Map([
  ["review-1", { authorUsername: "alice", gameSlug: "outer-wilds" }],
  // review-2 deliberately absent → simulates hard-delete (cascade) or
  // soft-deleted author whose username was masked to null in the join.
  ["review-3", { authorUsername: null, gameSlug: "tunic" }],
]);

const lists: ListTargetLookup = new Map([
  ["list-1", { authorUsername: "bob", slug: "goty-2024" }],
  ["list-2", { authorUsername: null, slug: "deleted-author-list" }],
]);

const comments: CommentTargetLookup = new Map([
  ["comment-1", { authorUsername: "carol", gameSlug: "disco-elysium" }],
  ["comment-2", { authorUsername: null, gameSlug: "celeste" }],
]);

const profiles: ProfileTargetLookup = new Map([
  ["user-1", { username: "dave" }],
  ["user-2", { username: null }],
]);

const lookups = { reviews, lists, comments, profiles };

describe("buildReportTargetUrl", () => {
  describe("review", () => {
    it("→ /u/{author}/reviews/{gameSlug}", () => {
      expect(
        buildReportTargetUrl({ targetType: "review", targetId: "review-1" }, lookups),
      ).toBe("/u/alice/reviews/outer-wilds");
    });

    it("→ null when review row is missing (hard-deleted via cascade)", () => {
      expect(
        buildReportTargetUrl({ targetType: "review", targetId: "review-2" }, lookups),
      ).toBeNull();
    });

    it("→ null when author is soft-deleted (authorUsername is null)", () => {
      expect(
        buildReportTargetUrl({ targetType: "review", targetId: "review-3" }, lookups),
      ).toBeNull();
    });
  });

  describe("list", () => {
    it("→ /u/{author}/lists/{listSlug}", () => {
      expect(
        buildReportTargetUrl({ targetType: "list", targetId: "list-1" }, lookups),
      ).toBe("/u/bob/lists/goty-2024");
    });

    it("→ null when list row is missing", () => {
      expect(
        buildReportTargetUrl({ targetType: "list", targetId: "list-missing" }, lookups),
      ).toBeNull();
    });

    it("→ null when list author is soft-deleted", () => {
      expect(
        buildReportTargetUrl({ targetType: "list", targetId: "list-2" }, lookups),
      ).toBeNull();
    });
  });

  describe("comment", () => {
    it("→ /u/{reviewAuthor}/reviews/{gameSlug}#comment-{commentId}", () => {
      // The URL author segment is the REVIEW author (the page hosts the
      // thread), not the comment author — same convention as the
      // comment_replied notification href in target-resolver.ts.
      expect(
        buildReportTargetUrl({ targetType: "comment", targetId: "comment-1" }, lookups),
      ).toBe("/u/carol/reviews/disco-elysium#comment-comment-1");
    });

    it("→ null when comment row is missing", () => {
      expect(
        buildReportTargetUrl(
          { targetType: "comment", targetId: "comment-missing" },
          lookups,
        ),
      ).toBeNull();
    });

    it("→ null when the containing review's author is soft-deleted", () => {
      expect(
        buildReportTargetUrl({ targetType: "comment", targetId: "comment-2" }, lookups),
      ).toBeNull();
    });
  });

  describe("profile", () => {
    it("→ /u/{username}", () => {
      expect(
        buildReportTargetUrl({ targetType: "profile", targetId: "user-1" }, lookups),
      ).toBe("/u/dave");
    });

    it("→ null when profile row is missing (user hard-deleted)", () => {
      expect(
        buildReportTargetUrl({ targetType: "profile", targetId: "user-missing" }, lookups),
      ).toBeNull();
    });

    it("→ null when profile is soft-deleted (username is null)", () => {
      expect(
        buildReportTargetUrl({ targetType: "profile", targetId: "user-2" }, lookups),
      ).toBeNull();
    });
  });
});
