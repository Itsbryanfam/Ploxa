import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { follows, logs } from "@/lib/db/schema";

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function computeSocialScore(input: {
  friendsPlayed: number;
  friendsLiked: number;
}): number {
  if (input.friendsPlayed === 0 && input.friendsLiked === 0) return 0;
  // ×2 maps the shifted sigmoid to the full [0,1) the axis contract wants.
  // Coefficients are scaled down (0.03/0.05, same 3:5 play:like ratio as the
  // plan's original 0.3/0.5) so the argument stays well below float64 sigmoid
  // saturation (~36) even at large friend counts — otherwise high inputs
  // collapse to exactly 1.0 and the strict (0,1) bound breaks.
  return 2 * (sigmoid(0.03 * input.friendsPlayed + 0.05 * input.friendsLiked) - 0.5);
}

/**
 * Bulk-fetch social signals for many games at once.
 * Returns a Map keyed by gameId. Games with no friend activity are absent
 * (consumer should treat absence as score=0).
 */
export async function fetchSocialSignals(
  userId: string,
  gameIds: number[],
): Promise<Map<number, { friendsPlayed: number; friendsLiked: number }>> {
  if (gameIds.length === 0) return new Map();

  // db is dynamically imported so the pure exports (sigmoid /
  // computeSocialScore) stay unit-testable: eagerly importing @/lib/db
  // instantiates a postgres-js client that throws under Vitest (no db mock).
  const { db } = await import("@/lib/db");

  // Step 1: get followed user IDs
  const followedRows = await db
    .select({ followedId: follows.followedId })
    .from(follows)
    .where(eq(follows.followerId, userId));
  const followed = followedRows.map((r) => r.followedId);
  if (followed.length === 0) return new Map();

  // Step 2: bulk aggregate plays + likes per gameId
  const rows = await db
    .select({
      gameId: logs.gameId,
      friendsPlayed: sql<number>`COUNT(DISTINCT CASE WHEN ${logs.status} IN ('playing', 'completed') THEN ${logs.userId} END)::int`,
      friendsLiked: sql<number>`COUNT(DISTINCT CASE WHEN ${logs.rating} >= 7 THEN ${logs.userId} END)::int`,
    })
    .from(logs)
    .where(and(inArray(logs.userId, followed), inArray(logs.gameId, gameIds)))
    .groupBy(logs.gameId);

  const out = new Map<number, { friendsPlayed: number; friendsLiked: number }>();
  for (const r of rows) {
    out.set(r.gameId, { friendsPlayed: r.friendsPlayed, friendsLiked: r.friendsLiked });
  }
  return out;
}
