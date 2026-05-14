import type { schema } from "@/lib/db";

/**
 * Per-row content URL resolver for the admin reports queue.
 *
 * Background:
 *   reports.target_id is polymorphic — what it points at depends on
 *   reports.target_type (a 4-value pgEnum). Without a real link to the
 *   reported content, mods saw raw UUIDs and rubber-stamped resolutions
 *   without ever seeing what they were resolving (T10 of the
 *   2026-05-14 audit).
 *
 *     target_type | target_id meaning              | URL shape
 *     ────────────┼────────────────────────────────┼────────────────────────────────────────────────
 *     comment     | comments.id                    | /u/{reviewAuthor}/reviews/{gameSlug}#comment-{id}
 *     review      | reviews.id                     | /u/{reviewAuthor}/reviews/{gameSlug}
 *     list        | lists.id                       | /u/{listAuthor}/lists/{listSlug}
 *     profile     | auth.users.id (the user_id)    | /u/{username}
 *
 * Mirrors lib/social/notifications/target-resolver.ts both in structure
 * (pure function + injected lookups) and in URL conventions (canonical
 * routes match the rest of the app exactly).
 *
 * This module is split out of queue.ts so the per-row href shape is unit-
 * testable as a pure function (lookups injected) without touching db.
 * getReportQueue does the batched IN-array lookups and feeds the resulting
 * maps in.
 */

export type ReportTargetType =
  (typeof schema.reportTargetTypeEnum)["enumValues"][number];

export type ReviewTargetLookup = Map<
  string,
  { authorUsername: string | null; gameSlug: string }
>;
export type ListTargetLookup = Map<
  string,
  { authorUsername: string | null; slug: string }
>;
export type CommentTargetLookup = Map<
  string,
  { authorUsername: string | null; gameSlug: string }
>;
export type ProfileTargetLookup = Map<string, { username: string | null }>;

export type ReportResolverLookups = {
  reviews: ReviewTargetLookup;
  lists: ListTargetLookup;
  comments: CommentTargetLookup;
  profiles: ProfileTargetLookup;
};

export type ReportResolveInput = {
  targetType: ReportTargetType;
  targetId: string;
};

/**
 * Pure function: given a report row's (targetType, targetId) and a set of
 * pre-batched target lookups, return the canonical URL the mod should
 * navigate to before deciding hide/keep — or null when:
 *   - the target was hard-deleted (cascade) since the report was filed
 *   - the target's author was soft-deleted (no username to slot into URL)
 *
 * Returning null is the explicit signal to the UI to surface a "(deleted)"
 * placeholder instead of an anchor tag pointing nowhere.
 */
export function buildReportTargetUrl(
  row: ReportResolveInput,
  lookups: ReportResolverLookups,
): string | null {
  switch (row.targetType) {
    case "review": {
      const review = lookups.reviews.get(row.targetId);
      if (!review || !review.authorUsername) return null;
      return `/u/${review.authorUsername}/reviews/${review.gameSlug}`;
    }
    case "list": {
      const list = lookups.lists.get(row.targetId);
      if (!list || !list.authorUsername) return null;
      return `/u/${list.authorUsername}/lists/${list.slug}`;
    }
    case "comment": {
      // Comments live under the review's canonical URL, anchor-linked so the
      // mod lands directly on the reported comment. Authoring user for the URL
      // is the REVIEW author (whose page hosts the thread), not the comment
      // author — same convention as the comment_replied notification href.
      const comment = lookups.comments.get(row.targetId);
      if (!comment || !comment.authorUsername) return null;
      return `/u/${comment.authorUsername}/reviews/${comment.gameSlug}#comment-${row.targetId}`;
    }
    case "profile": {
      // target_id is the reported user's user_id; we resolve to their username
      // (null when the profile row was soft-deleted between report + review).
      const profile = lookups.profiles.get(row.targetId);
      if (!profile || !profile.username) return null;
      return `/u/${profile.username}`;
    }
  }
}
