import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { follows, logs } from "@/lib/db/schema";

export type SocialSignals = { friendsPlayed: number; friendsLiked: number };

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function computeSocialScore(input: SocialSignals): number {
  if (input.friendsPlayed === 0 && input.friendsLiked === 0) return 0;
  // Shift by 0.5 so zero-input anchors at 0; ×2 expands to the [0,1) the
  // axis contract wants. Coeffs (0.03/0.05) keep the sigmoid arg well below
  // float64 saturation so the strict <1 bound holds at realistic counts.
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
): Promise<Map<number, SocialSignals>> {
  if (gameIds.length === 0) return new Map();

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

  const out = new Map<number, SocialSignals>();
  for (const r of rows) {
    out.set(r.gameId, { friendsPlayed: r.friendsPlayed, friendsLiked: r.friendsLiked });
  }
  return out;
}
