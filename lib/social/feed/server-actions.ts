"use server";
import { and, eq, or } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { buildFeedQuery, type FeedRow } from "./queries";
import { decodeCursor, encodeCursor } from "@/lib/social/_shared/cursors";

const { follows, blocks } = schema;

/**
 * Server action returning a feed page + next cursor.
 *
 * Followee IDs are computed once per call (not cached across calls — the
 * follow graph changes frequently enough that we don't memoize). Blocked-
 * followee stripping happens at this layer so buildFeedQuery doesn't need
 * to know about the blocks graph for the followee-set scope.
 */
export async function getFeed(args: {
  viewerId: string;
  cursor?: string | null;
  limit?: number;
}): Promise<{ items: FeedRow[]; nextCursor: string | null }> {
  const { viewerId, cursor: rawCursor, limit = 50 } = args;
  const cursor = decodeCursor(rawCursor);

  // Step 1: followee IDs.
  const followeeRows = await db
    .select({ id: follows.followedId })
    .from(follows)
    .where(eq(follows.followerId, viewerId));

  if (followeeRows.length === 0) {
    return { items: [], nextCursor: null };
  }
  const followeeIds = followeeRows.map((r) => r.id);

  // Step 2: strip followees with whom viewer has a block in either direction.
  // (In practice cascadeBlock should have already deleted the follows row,
  // but the cascade isn't transactional — be defensive.)
  const blockedRows = await db
    .select({ a: blocks.blockerId, b: blocks.blockedId })
    .from(blocks)
    .where(
      or(
        and(
          eq(blocks.blockerId, viewerId),
          or(...followeeIds.map((id) => eq(blocks.blockedId, id))),
        ),
        and(
          eq(blocks.blockedId, viewerId),
          or(...followeeIds.map((id) => eq(blocks.blockerId, id))),
        ),
      ),
    );
  const blockedSet = new Set(blockedRows.flatMap((r) => [r.a, r.b]));
  const visibleFolloweeIds = followeeIds.filter((id) => !blockedSet.has(id));

  if (visibleFolloweeIds.length === 0) {
    return { items: [], nextCursor: null };
  }

  // Step 3: the actual feed query.
  const items = await buildFeedQuery({
    viewerId,
    followeeIds: visibleFolloweeIds,
    cursor,
    limit,
  });

  const nextCursor =
    items.length === limit
      ? encodeCursor({
          eventAt: items[items.length - 1].eventAt,
          kind: items[items.length - 1].kind,
          actorId: items[items.length - 1].actorId,
        })
      : null;

  return { items, nextCursor };
}
