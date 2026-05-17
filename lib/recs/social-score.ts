import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { follows, logs } from "@/lib/db/schema";

export type SocialSignals = { friendsPlayed: number; friendsLiked: number };

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

// Largest sigmoid argument that still yields sigmoid(x) < 1 in IEEE-754
// float64. Past ≈36.74, Math.exp(-x) underflows so 1/(1+x) rounds to
// exactly 1.0 and the 2*(sigmoid(x)-0.5) wrapper would equal exactly 1.0,
// breaking the strict [0,1) axis contract. We clamp the ARGUMENT (not the
// output) to 36 so the spec 0.3/0.5 coefficients govern the score verbatim
// for every realistic friend count (identical to the unclamped formula
// through friendsLiked≈72 / friendsPlayed≈120 and well beyond — where the
// score is already ≈1 = "maximally friend-endorsed"), while the < 1
// guarantee holds for arbitrarily large inputs. 36 leaves headroom below
// the 36.74 saturation point.
const MAX_SIGMOID_ARG = 36;

export function computeSocialScore(input: SocialSignals): number {
  if (input.friendsPlayed === 0 && input.friendsLiked === 0) return 0;
  // Spec (docs/.../2026-05-15-play-next-redesign-design.md ~:181):
  //   socialScore = sigmoid(0.3*friendsPlayed + 0.5*friendsLiked)
  // wrapped in this zero-anchoring rescale: shift by 0.5 so zero-input maps
  // to 0; ×2 expands toward the [0,1) the axis contract wants. The prior
  // 0.03/0.05 coeffs were a 10×-below-spec shrink (a since-replaced
  // saturation guard); MAX_SIGMOID_ARG now provides the strict-<1 guarantee
  // explicitly, so the spec coefficients are restored.
  const arg = Math.min(
    MAX_SIGMOID_ARG,
    0.3 * input.friendsPlayed + 0.5 * input.friendsLiked,
  );
  return 2 * (sigmoid(arg) - 0.5);
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
