import "server-only";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { drift } from "@/lib/taste/vectors";
import { tierForUser } from "@/lib/taste/tier";

export type SimilarUser = {
  userId: string;
  username: string;
  displayName: string | null;
  profilePictureUrl: string | null;
  tierLogCount: number;
  similarity: number;
  /**
   * True when the viewer already follows this candidate. Powers the
   * Follow/Following CTA on /discover/people so the button reflects real
   * state on first paint instead of always reading "Follow" and only
   * correcting after a click + roundtrip.
   *
   * Computed via a single batched lookup against `follows` after the
   * candidate set is known — see `getSimilarUsers` for the shape.
   */
  viewerFollows: boolean;
  /**
   * True when this candidate follows the viewer. Drives the "Follows you"
   * indicator on SimilarUsersRow — surfaces the bidirectional context so
   * a viewer can prioritize following back over cold-following strangers.
   * Computed alongside `viewerFollows` in the same batched query.
   */
  followsViewer: boolean;
};

/**
 * Returns a ranked list of public users whose taste vectors are most similar
 * to the viewer's, computed on-demand via cosine distance (`1 - drift()`).
 *
 * Algorithm:
 * 1. Load the viewer's taste fingerprint. If no fingerprint exists, or if the
 *    viewer's tier is "empty" (zero logs), return [] immediately — there is no
 *    signal to compare against yet.
 * 2. Pull a 500-row candidate pool of public profiles that have a fingerprint
 *    with at least 10 logs (`total_logs_at_generation >= 10`, i.e., at or above
 *    the "sparse" tier boundary). The pool is ordered by `vectors_generated_at
 *    DESC` so the freshest taste data is selected first under the 500-row cap.
 * 3. Exclude at the SQL level: the viewer themselves and any mutual block
 *    edge (viewer→candidate OR candidate→viewer). Already-followed users
 *    are NOT excluded — the row carries a `viewerFollows` flag so the
 *    Follow/Following CTA renders honestly on first paint, and high-overlap
 *    accounts you already follow stay visible (useful for confirming taste
 *    matches and surfacing them in "people like you" contexts).
 * 4. Score each candidate as `1 - drift(viewerBundle, candidateBundle)`.
 *    `drift()` returns the max cosine distance across the three vector fields
 *    (genre, theme, mechanic), so `1 - drift` is effectively the min cosine
 *    similarity across all three — a conservative "at least this similar"
 *    measure.
 * 5. Sort descending by similarity score and slice to the top `limit`
 *    entries; then issue ONE OR'd `SELECT follower_id, followed_id FROM follows`
 *    that captures both directions (viewer→candidate AND candidate→viewer) in a
 *    single round-trip, and stamp `viewerFollows` + `followsViewer` per row.
 *
 * No cache: the candidate set is viewer-specific (block exclusion varies
 * per viewer, and the viewerFollows stamp depends on the live follows
 * table) and the drift math is O(500 × 3 vectors) — roughly 1 500 sparse
 * dot-products. This is fast enough for on-demand compute and the viewer's
 * social graph changes too frequently to make a 30-minute cache correct.
 *
 * Invariants:
 * - Similarity is clamped to [0, 1] — drift can theoretically produce
 *   values up to 2 (when cosine similarity hits -1 on an axis), but a
 *   negative "similarity" has no UI meaning, so we floor at 0 for the
 *   caller. 1.0 means identical, 0.0 means maximally dissimilar.
 * - `drift()` returns `Infinity` when the snapshot argument is null; that
 *   cannot occur here since all candidate rows have non-null jsonb vectors
 *   (Drizzle schema: `.notNull().default('{}'::jsonb)`).
 *
 * @param viewerId - The authenticated viewer's UUID.
 * @param limit    - Maximum number of similar users to return (default 12).
 * @returns Ranked list of `SimilarUser` objects, highest similarity first.
 */
export async function getSimilarUsers(
  viewerId: string,
  limit = 12,
): Promise<SimilarUser[]> {
  // Step 1: Load the viewer's fingerprint. Short-circuit on empty tier.
  const rawViewerFp = await db.execute<{
    genre_vector: Record<string, number>;
    theme_vector: Record<string, number>;
    mechanic_vector: Record<string, number>;
    total_logs_at_generation: number;
  }>(sql`
    SELECT genre_vector, theme_vector, mechanic_vector, total_logs_at_generation
    FROM taste_fingerprints
    WHERE user_id = ${viewerId}
    LIMIT 1
  `);
  // postgres-js RowList is array-like; cast through unknown to access rows directly.
  const viewerRows = rawViewerFp as unknown as Array<{
    genre_vector: Record<string, number>;
    theme_vector: Record<string, number>;
    mechanic_vector: Record<string, number>;
    total_logs_at_generation: number;
  }>;
  const fp = viewerRows[0];
  if (!fp || tierForUser(fp.total_logs_at_generation) === "empty") return [];

  // Step 2-3: Candidate pool — public profiles with >= 10 logs, not self,
  // and no block edge in either direction. Already-followed users stay in
  // the pool so the Follow/Following CTA can render with the correct label
  // on first paint (see step 6 below for the batched viewerFollows lookup).
  const rawCandidates = await db.execute<{
    user_id: string;
    username: string;
    display_name: string | null;
    profile_picture_url: string | null;
    genre_vector: Record<string, number>;
    theme_vector: Record<string, number>;
    mechanic_vector: Record<string, number>;
    total_logs_at_generation: number;
  }>(sql`
    SELECT tf.user_id, p.username, p.display_name, p.profile_picture_url,
           tf.genre_vector, tf.theme_vector, tf.mechanic_vector,
           tf.total_logs_at_generation
    FROM taste_fingerprints tf
    JOIN profiles p ON p.user_id = tf.user_id
    WHERE p.is_public = true
      AND p.deleted_at IS NULL
      AND tf.user_id != ${viewerId}
      AND tf.total_logs_at_generation >= 10
      AND NOT EXISTS (
        SELECT 1 FROM blocks WHERE
          (blocker_id = ${viewerId} AND blocked_id = tf.user_id) OR
          (blocker_id = tf.user_id AND blocked_id = ${viewerId})
      )
    -- TODO: when user count crosses ~10k, revisit candidate ordering —
    -- current ORDER BY vectors_generated_at biases toward recently-active
    -- users; a high-similarity user with a stale fingerprint could sink
    -- below the 500-row cap. Consider ORDER BY total_logs_at_generation
    -- DESC or a hybrid score.
    ORDER BY tf.vectors_generated_at DESC
    LIMIT 500
  `);
  // postgres-js RowList is array-like; cast through unknown to access rows directly.
  const candidates = rawCandidates as unknown as Array<{
    user_id: string;
    username: string;
    display_name: string | null;
    profile_picture_url: string | null;
    genre_vector: Record<string, number>;
    theme_vector: Record<string, number>;
    mechanic_vector: Record<string, number>;
    total_logs_at_generation: number;
  }>;

  // Steps 4-5: Score by 1 - drift, sort descending, slice to limit.
  const scored = candidates
    .map((c) => ({
      userId: c.user_id,
      username: c.username,
      displayName: c.display_name,
      profilePictureUrl: c.profile_picture_url,
      tierLogCount: c.total_logs_at_generation,
      similarity: Math.max(
        0,
        1 -
          drift(
            { genre: fp.genre_vector, theme: fp.theme_vector, mechanic: fp.mechanic_vector, gameMode: {}, playerPerspective: {} },
            { genre: c.genre_vector, theme: c.theme_vector, mechanic: c.mechanic_vector, gameMode: {}, playerPerspective: {} },
          ),
      ),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  // Step 6: Batched viewerFollows lookup. One round-trip against `follows`
  // for the surviving (top-`limit`) candidates only — N is bounded by the
  // page-level limit (24 on /discover/people, 4 on /discover), so the
  // ANY($candidate_ids) array is small even for the heaviest caller.
  // Skip the query entirely when no candidates survived to keep the empty
  // path roundtrip-free.
  if (scored.length === 0) return [];

  const candidateIds = scored.map((c) => c.userId);
  // Single OR'd lookup pulls both directions in one round-trip. Each returned
  // row carries the directed edge (follower_id → followed_id); we partition
  // into "viewer follows candidate" vs "candidate follows viewer" by checking
  // which side is the viewer.
  const rawFollows = await db.execute<{ follower_id: string; followed_id: string }>(sql`
    SELECT follower_id, followed_id
    FROM follows
    WHERE
      (follower_id = ${viewerId} AND followed_id = ANY(${candidateIds}::uuid[]))
      OR (followed_id = ${viewerId} AND follower_id = ANY(${candidateIds}::uuid[]))
  `);
  const followRows = rawFollows as unknown as Array<{ follower_id: string; followed_id: string }>;
  const viewerFollowsSet = new Set<string>();
  const followsViewerSet = new Set<string>();
  for (const row of followRows) {
    if (row.follower_id === viewerId) viewerFollowsSet.add(row.followed_id);
    if (row.followed_id === viewerId) followsViewerSet.add(row.follower_id);
  }

  return scored.map((c) => ({
    ...c,
    viewerFollows: viewerFollowsSet.has(c.userId),
    followsViewer: followsViewerSet.has(c.userId),
  }));
}
