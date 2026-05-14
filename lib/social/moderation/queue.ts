import "server-only";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import {
  buildReportTargetUrl,
  type CommentTargetLookup,
  type ListTargetLookup,
  type ProfileTargetLookup,
  type ReviewTargetLookup,
} from "./target-resolver";

const { reports, reviews, lists, comments, games, profiles } = schema;

export type ReportQueueRow = {
  id: string;
  reporterId: string | null;
  targetType: (typeof schema.reportTargetTypeEnum)["enumValues"][number];
  targetId: string;
  reason: string;
  details: string | null;
  status: (typeof schema.reportStatusEnum)["enumValues"][number];
  createdAt: Date;
  /**
   * Resolved canonical URL for the reported content. Null when the target was
   * hard-deleted (cascade) or its author was soft-deleted (no username to slot
   * into the URL). The UI renders null as a "(deleted)" placeholder rather
   * than an anchor — see components/moderation/reports-queue.tsx.
   */
  targetUrl: string | null;
};

/**
 * Fetch the admin moderation queue (pending + auto_flagged reports), ordered
 * newest first, with each row enriched with `targetUrl` so mods can review
 * the actual content before resolving.
 *
 * URL resolution is BATCHED — at most one query per `target_type` regardless
 * of how many rows reference that type (no N+1). Empty id-sets short-circuit
 * to `Promise.resolve([])` so we don't waste a round-trip.
 *
 * Soft-delete-aware: author lookups go through a leftJoin on profiles with
 * `deleted_at IS NULL`, so a freshly soft-deleted account yields a null
 * username and the resolver returns null (UI renders "(deleted)") instead
 * of constructing a dead URL.
 *
 * Kept out of `server-actions.ts` deliberately: this is a server-side data
 * loader called from the `/admin/reports` server component, not a client-
 * invoked action. Mixing it into a `"use server"` file would expose it as a
 * public Server Action endpoint, which is unnecessary surface area. Use
 * `"server-only"` instead to enforce server-only consumption.
 */
export async function getReportQueue(
  opts: { limit?: number; offset?: number } = {},
): Promise<ReportQueueRow[]> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const baseRows = await db
    .select({
      id: reports.id,
      reporterId: reports.reporterId,
      targetType: reports.targetType,
      targetId: reports.targetId,
      reason: reports.reason,
      details: reports.details,
      status: reports.status,
      createdAt: reports.createdAt,
    })
    .from(reports)
    .where(or(eq(reports.status, "pending"), eq(reports.status, "auto_flagged")))
    .orderBy(desc(reports.createdAt))
    .limit(limit)
    .offset(offset);

  // Group target ids by what kind of content they reference, then do at most
  // ONE batched IN-array lookup per kind. With the 50-row default cap each
  // kind's id-list is bounded; an empty id-list short-circuits to a resolved
  // promise so we don't waste a round-trip.
  const reviewIds = new Set<string>();
  const listIds = new Set<string>();
  const commentIds = new Set<string>();
  const profileIds = new Set<string>();
  for (const r of baseRows) {
    if (r.targetType === "review") reviewIds.add(r.targetId);
    else if (r.targetType === "list") listIds.add(r.targetId);
    else if (r.targetType === "comment") commentIds.add(r.targetId);
    else if (r.targetType === "profile") profileIds.add(r.targetId);
  }

  const [reviewRows, listRows, commentRows, profileRows] = await Promise.all([
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
          // Author of the URL is the REVIEW author (whose page hosts the
          // comment thread), not the comment author. Soft-delete filter on
          // the join predicate so a soft-deleted review author yields a null
          // username and the resolver short-circuits to null.
          .leftJoin(
            profiles,
            and(eq(profiles.userId, reviews.userId), isNull(profiles.deletedAt)),
          )
          .where(inArray(comments.id, Array.from(commentIds)))
      : Promise.resolve(
          [] as { id: string; authorUsername: string | null; gameSlug: string }[],
        ),
    profileIds.size > 0
      ? db
          .select({
            userId: profiles.userId,
            username: profiles.username,
          })
          .from(profiles)
          .where(
            and(
              inArray(profiles.userId, Array.from(profileIds)),
              isNull(profiles.deletedAt),
            ),
          )
      : Promise.resolve([] as { userId: string; username: string | null }[]),
  ]);

  const reviewMap: ReviewTargetLookup = new Map(
    reviewRows.map((r) => [
      r.id,
      { authorUsername: r.authorUsername, gameSlug: r.gameSlug },
    ]),
  );
  const listMap: ListTargetLookup = new Map(
    listRows.map((r) => [r.id, { authorUsername: r.authorUsername, slug: r.slug }]),
  );
  const commentMap: CommentTargetLookup = new Map(
    commentRows.map((r) => [
      r.id,
      { authorUsername: r.authorUsername, gameSlug: r.gameSlug },
    ]),
  );
  const profileMap: ProfileTargetLookup = new Map(
    profileRows.map((p) => [p.userId, { username: p.username }]),
  );

  const lookups = {
    reviews: reviewMap,
    lists: listMap,
    comments: commentMap,
    profiles: profileMap,
  };

  return baseRows.map((r) => ({
    ...r,
    targetUrl: buildReportTargetUrl(
      { targetType: r.targetType, targetId: r.targetId },
      lookups,
    ),
  }));
}
