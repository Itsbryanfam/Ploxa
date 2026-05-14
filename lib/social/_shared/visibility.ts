import "server-only";
import { and, eq, inArray, notExists, or, sql } from "drizzle-orm";
import type { AnyPgColumn, PgSelect } from "drizzle-orm/pg-core";

import { db, schema } from "@/lib/db";

const { blocks } = schema;

/**
 * Block-filter chokepoint. Every social read query — feed pull, comment
 * thread, profile views, notifications, discovery — passes through here.
 *
 * Bidirectional semantics: a row authored by `authorIdColumn` is excluded
 * when EITHER (viewer blocked author) OR (author blocked viewer). Matches
 * the Q4 brainstorm decision (Twitter-style mutual invisibility).
 *
 * Logged-out exception: when viewerId is null we can't gate cookieless
 * traffic by IP/fingerprint reliably, so we don't try. A determined
 * blocked user can always log out to see public content — that's
 * accepted in the spec.
 *
 * Implementation detail: notExists against the blocks table avoids the
 * left-join + null-check pattern. Postgres plans this cleanly with the
 * (blocker_id, blocked_id) primary key + the reverse-direction
 * blocks_blocked_blocker_idx from migration 0008.
 */
export function withBlockedFilter<Q extends PgSelect>(
  viewerId: string | null,
  query: Q,
  authorIdColumn: AnyPgColumn,
): Q {
  if (!viewerId) return query;
  return query.where(
    and(
      // Viewer hasn't blocked the author.
      notExists(
        db
          .select({ x: sql`1` })
          .from(blocks)
          .where(
            and(
              eq(blocks.blockerId, viewerId),
              eq(blocks.blockedId, authorIdColumn),
            ),
          ),
      ),
      // Author hasn't blocked the viewer.
      notExists(
        db
          .select({ x: sql`1` })
          .from(blocks)
          .where(
            and(
              eq(blocks.blockerId, authorIdColumn),
              eq(blocks.blockedId, viewerId),
            ),
          ),
      ),
    ),
  ) as Q;
}

/**
 * Predicate form for post-hoc filters (used by the feed UNION ALL where
 * notExists doesn't compose cleanly across the three source queries).
 * Returns true if EITHER direction of the block edge exists.
 *
 * Indexed: PK lookup on (blocker_id, blocked_id) for one direction;
 * blocks_blocked_blocker_idx for the reverse. Both are sub-ms.
 *
 * Prefer `getBlockedPairs` for any callsite that filters more than one
 * candidate against the same viewer — this single-row form costs one
 * round-trip per call and degenerates into N+1 fast.
 */
export async function isBlockedBetween(a: string, b: string): Promise<boolean> {
  const rows = await db
    .select({ x: sql<number>`1` })
    .from(blocks)
    .where(
      or(
        and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)),
        and(eq(blocks.blockerId, b), eq(blocks.blockedId, a)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Batched form: returns the Set of candidate IDs that the viewer is
 * block-related to in EITHER direction. Replaces N sequential
 * `isBlockedBetween` calls with a single round-trip — used by the feed
 * (50 actor IDs per render) and trending-reviews (≤24 author IDs per
 * cache miss).
 *
 * Returns an empty Set when `viewerId` is null (logged-out exception
 * matches `withBlockedFilter`) or `candidateIds` is empty (no rows to
 * filter).
 *
 * Implementation: one SELECT with two OR'd predicates — the (blocker,
 * blocked = ANY) branch hits the (blocker_id, blocked_id) PK; the
 * reverse (blocker = ANY, blocked) branch hits
 * blocks_blocked_blocker_idx from migration 0008. Drizzle's `inArray`
 * compiles to `IN ($1, $2, ...)` on postgres-js — equivalent plan to a
 * `= ANY(...)` array bind.
 *
 * Caller pattern:
 *   const blocked = await getBlockedPairs(viewerId, rows.map(r => r.actorId));
 *   const visible = rows.filter(r => !blocked.has(r.actorId));
 */
export async function getBlockedPairs(
  viewerId: string | null,
  candidateIds: string[],
): Promise<Set<string>> {
  if (!viewerId || candidateIds.length === 0) return new Set();

  // De-dup: a UNION-ALL feed can repeat the same actor across
  // log/review/list rows. One IN list, no duplicate parameters.
  const unique = Array.from(new Set(candidateIds));

  const rows = await db
    .select({
      blockerId: blocks.blockerId,
      blockedId: blocks.blockedId,
    })
    .from(blocks)
    .where(
      or(
        // Viewer blocked one of the candidates.
        and(eq(blocks.blockerId, viewerId), inArray(blocks.blockedId, unique)),
        // One of the candidates blocked the viewer.
        and(eq(blocks.blockedId, viewerId), inArray(blocks.blockerId, unique)),
      ),
    );

  // Project the "other side" of each edge into the result Set: the
  // blocked candidate from a viewer-side block, the blocker candidate
  // from a candidate-side block. Either way the row is hidden from
  // the viewer.
  const blocked = new Set<string>();
  for (const r of rows) {
    blocked.add(r.blockerId === viewerId ? r.blockedId : r.blockerId);
  }
  return blocked;
}
