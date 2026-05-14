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
 * 3. Exclude at the SQL level: the viewer themselves, profiles the viewer
 *    already follows, and any mutual block edge (viewer→candidate OR
 *    candidate→viewer).
 * 4. Score each candidate as `1 - drift(viewerBundle, candidateBundle)`.
 *    `drift()` returns the max cosine distance across the three vector fields
 *    (genre, theme, mechanic), so `1 - drift` is effectively the min cosine
 *    similarity across all three — a conservative "at least this similar"
 *    measure.
 * 5. Sort descending by similarity score and return the top `limit` entries.
 *
 * No cache: the candidate set is viewer-specific (follow/block exclusion varies
 * per viewer) and the drift math is O(500 × 3 vectors) — roughly 1 500 sparse
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
  // not already followed, and no block edge in either direction.
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
        SELECT 1 FROM follows WHERE follower_id = ${viewerId} AND followed_id = tf.user_id
      )
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
  const scored = candidates.map((c) => ({
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
  }));

  return scored.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}
