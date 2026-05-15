import "server-only";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { getBlockedPairs } from "@/lib/social/_shared/visibility";
import { compareFeedRows, type FeedCursor } from "@/lib/social/_shared/cursors";

export type FeedRow = {
  kind: "log" | "review" | "list";
  actorId: string;
  eventAt: Date;
  eventType: string | null;
  targetId: string;
  payload: Record<string, unknown>;
};

/**
 * Pull-on-read activity feed query. UNION ALL across logs (material status/
 * rating events), reviews (publish events), lists (publish events) filtered
 * to followees, with cursor predicate. Every branch additionally requires
 * the actor's profile to be public (F-006): going private hides activity
 * from existing followers, matching profile/library/recap. Enforced
 * read-side rather than severing follow edges on the privacy toggle.
 *
 * Why UNION ALL instead of three sequential queries: postgres plans this
 * as a single tree, hits each table's (user_id, event_at DESC) partial
 * index, and applies the ORDER BY + LIMIT once. Network round-trip and
 * sort cost are both lower.
 *
 * Block filter is post-hoc because UNION ALL doesn't compose cleanly with
 * notExists subqueries (we'd need 3 copies of the subquery, one per branch).
 * 50-row post-filter goes through `getBlockedPairs` — one batched query
 * returning the Set of blocked actor IDs, indexed via the blocks PK +
 * blocks_blocked_blocker_idx (migration 0008). Replaces 50 sequential
 * isBlockedBetween awaits that previously cost 250–750ms per /home/feed
 * render.
 */
export async function buildFeedQuery(args: {
  viewerId: string;
  followeeIds: string[];
  cursor: FeedCursor | null;
  limit?: number;
}): Promise<FeedRow[]> {
  const { viewerId, followeeIds, cursor, limit = 50 } = args;

  if (followeeIds.length === 0) return [];

  // Cursor predicate: rows strictly older than the cursor (or, on identical
  // eventAt, rows with lower kind+actor_id sort order than the cursor's).
  // Encoded into raw SQL because Drizzle's `lt` doesn't compose across
  // UNION branches cleanly.
  const cursorClause = cursor
    ? sql`AND (event_at, kind, actor_id) < (${cursor.eventAt.toISOString()}::timestamptz, ${cursor.kind}::text, ${cursor.actorId}::uuid)`
    : sql``;

  // sql.raw is intentional here: postgres-js doesn't bind a uuid[] array
  // across multiple UNION branches cleanly, and Postgres rejects any
  // non-UUID value at the ::uuid cast, making injection impossible.
  // followeeIds come from Supabase Auth JWTs (format-enforced to UUID v4).
  const followeeArray = sql.raw(
    `ARRAY[${followeeIds.map((id) => `'${id}'::uuid`).join(",")}]`,
  );

  // Raw SQL UNION ALL — Drizzle's union helper doesn't support the JSON
  // payload shape we need without 3 separate type definitions.
  const rawRows = await db.execute<{
    kind: "log" | "review" | "list";
    actor_id: string;
    event_at: string;
    event_type: string | null;
    target_id: string;
    payload: Record<string, unknown>;
  }>(sql`
    SELECT * FROM (
      (SELECT
        'log'::text AS kind,
        user_id AS actor_id,
        last_event_at AS event_at,
        last_event_type AS event_type,
        id::text AS target_id,
        jsonb_build_object(
          'gameId', game_id,
          'status', status,
          'rating', rating
        ) AS payload
       FROM logs
       WHERE user_id = ANY(${followeeArray})
         AND last_event_at IS NOT NULL
         AND is_private = false
         AND EXISTS (
           SELECT 1 FROM profiles WHERE user_id = logs.user_id AND deleted_at IS NULL AND is_public = true
         )
         ${cursorClause})
      UNION ALL
      (SELECT
        'review'::text,
        user_id,
        published_at,
        NULL,
        id::text,
        jsonb_build_object(
          'gameId', game_id,
          'rating', rating,
          'bodyHook', substring(body, 1, 200)
        )
       FROM reviews
       WHERE user_id = ANY(${followeeArray})
         AND published_at IS NOT NULL
         AND is_public = true
         AND EXISTS (
           SELECT 1 FROM profiles WHERE user_id = reviews.user_id AND deleted_at IS NULL AND is_public = true
         )
         ${cursorClause})
      UNION ALL
      (SELECT
        'list'::text,
        user_id,
        published_at,
        NULL,
        id::text,
        jsonb_build_object(
          'title', title,
          'slug', slug,
          'description', substring(coalesce(description, ''), 1, 200)
        )
       FROM lists
       WHERE user_id = ANY(${followeeArray})
         AND published_at IS NOT NULL
         AND is_public = true
         AND EXISTS (
           SELECT 1 FROM profiles WHERE user_id = lists.user_id AND deleted_at IS NULL AND is_public = true
         )
         ${cursorClause})
    ) AS feed
    ORDER BY event_at DESC, kind ASC, actor_id ASC
    LIMIT ${limit};
  `);

  // postgres-js RowList is array-like; cast through unknown to access rows.
  const rows = rawRows as unknown as Array<{
    kind: "log" | "review" | "list";
    actor_id: string;
    event_at: string;
    event_type: string | null;
    target_id: string;
    payload: Record<string, unknown>;
  }>;

  // Post-hoc block filter: drop rows where viewer and actor have a block
  // edge in either direction. One batched lookup returns the Set of
  // blocked actor IDs across all distinct actors in the rows; the filter
  // is then a pure in-memory Set.has() check.
  const blockedActorIds = await getBlockedPairs(
    viewerId,
    rows.map((r) => r.actor_id),
  );
  const filtered: FeedRow[] = rows
    .filter((r) => !blockedActorIds.has(r.actor_id))
    .map((r) => ({
      kind: r.kind,
      actorId: r.actor_id,
      eventAt: new Date(r.event_at),
      eventType: r.event_type,
      targetId: r.target_id,
      payload: r.payload,
    }));

  // Maintain canonical sort after filter (cheap; max 50 rows).
  return filtered.sort(compareFeedRows);
}
