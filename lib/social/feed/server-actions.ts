"use server";
import { and, eq, inArray, or } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { buildFeedQuery, type FeedRow } from "./queries";
import { decodeCursor, encodeCursor } from "@/lib/social/_shared/cursors";

const { follows, blocks } = schema;

/**
 * Returns a cursor-paginated feed page for `viewerId`.
 *
 * NOTE: Identity is caller-supplied (not derived from session). Callers must
 * resolve the viewer from the session before calling; passing an empty string
 * or a wrong UUID produces an empty feed, not an error.
 *
 * Two DB round-trips: one for followee IDs, one for the bidirectional block
 * check. The block check uses `inArray` so both the blocks PK and the reverse
 * index from migration 0008 are used efficiently.
 *
 * `nextCursor` is non-null only when `items.length === limit`, which is the
 * standard "there may be more" heuristic. An exact match on `limit` doesn't
 * guarantee another page exists, but false-positives here are harmless.
 *
 * `hasFollowees` is true when the viewer follows at least one account (before
 * the block filter). Callers use this to distinguish two empty-feed cases:
 *   - `hasFollowees: false` → viewer follows nobody → show idle pose + Find people CTA
 *   - `hasFollowees: true, items: []` → followees exist but haven't posted → show
 *     thinking pose + "Quiet around here. Check back later."
 */
export async function getFeed(args: {
  viewerId: string;
  cursor?: string | null;
  limit?: number;
}): Promise<{ items: FeedRow[]; nextCursor: string | null; hasFollowees: boolean }> {
  const { viewerId, cursor: rawCursor, limit = 50 } = args;
  const cursor = decodeCursor(rawCursor);

  // Step 1: followee IDs.
  const followeeRows = await db
    .select({ id: follows.followedId })
    .from(follows)
    .where(eq(follows.followerId, viewerId));

  const hasFollowees = followeeRows.length > 0;

  if (!hasFollowees) {
    return { items: [], nextCursor: null, hasFollowees: false };
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
        and(eq(blocks.blockerId, viewerId), inArray(blocks.blockedId, followeeIds)),
        and(eq(blocks.blockedId, viewerId), inArray(blocks.blockerId, followeeIds)),
      ),
    );
  const blockedFolloweeIds = new Set(
    blockedRows.map((r) => (r.a === viewerId ? r.b : r.a)),
  );
  const visibleFolloweeIds = followeeIds.filter(
    (id) => !blockedFolloweeIds.has(id),
  );

  if (visibleFolloweeIds.length === 0) {
    return { items: [], nextCursor: null, hasFollowees: true };
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

  return { items, nextCursor, hasFollowees: true };
}
