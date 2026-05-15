"use server";

import { z } from "zod";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";

export type UserSearchResult = {
  userId: string;
  username: string;
  displayName: string | null;
  profilePictureUrl: string | null;
};

const searchInput = z.object({ query: z.string().min(1).max(50) });

/**
 * Server-action for the command palette's `@username` user search.
 *
 * Auth-gated like `searchGames` — the action endpoint is reachable by anyone
 * who extracts its id from the bundle, so without this gate a scraper could
 * enumerate public profiles via the typo-tolerant ILIKE matcher one
 * keystroke at a time.
 *
 * Privacy:
 *   - Returns only `is_public = true` profiles. Private profiles never
 *     appear in search results regardless of the viewer.
 *   - Excludes profiles soft-deleted in the grace window (`deleted_at`).
 *   - Excludes the viewer themselves (no point linking to your own profile
 *     from a discovery surface).
 *   - Excludes blocked-pairs in either direction — the same invariant
 *     enforced by `getSimilarUsers`.
 *
 * Ranking:
 *   - Exact `username` prefix match ranks first (most direct intent).
 *   - Then `username` ILIKE substring.
 *   - Then `display_name` ILIKE substring (fuzzier — covers people who
 *     remember the display name but not the handle).
 *   - Ties broken by `username` ascending so results are deterministic.
 *
 * The query is short-circuited at <1 char (zod). We allow single-character
 * queries so users can type one letter and see the prefix list — matches
 * the snappy feel of game search.
 */
export async function searchUsers(query: string): Promise<UserSearchResult[]> {
  const parsed = searchInput.safeParse({ query });
  if (!parsed.success) return [];
  const viewer = await getCachedUser();
  if (!viewer) return [];

  const q = parsed.data.query.trim();
  if (q.length === 0) return [];

  // ILIKE patterns. Postgres escapes are handled by the parameter binding
  // (postgres-js / Drizzle), so we don't need to manually escape % or _.
  // We DO want literal % wildcards on both sides of the substring match,
  // and a separate prefix pattern for the top-ranked exact-prefix bucket.
  const prefixPattern = `${q}%`;
  const substringPattern = `%${q}%`;

  // Single query with a CASE-derived rank column. Three buckets:
  //   1 → username starts with q
  //   2 → username contains q (but doesn't start)
  //   3 → display_name contains q (catches name-only matches)
  // ORDER BY rank ASC then username ASC gives deterministic, intent-ordered
  // results. LIMIT 12 mirrors the game search cap.
  const rows = (await db.execute<{
    user_id: string;
    username: string;
    display_name: string | null;
    profile_picture_url: string | null;
  }>(sql`
    SELECT user_id, username, display_name, profile_picture_url
    FROM profiles
    WHERE is_public = true
      AND deleted_at IS NULL
      AND user_id != ${viewer.id}
      AND NOT EXISTS (
        SELECT 1 FROM blocks WHERE
          (blocker_id = ${viewer.id} AND blocked_id = profiles.user_id) OR
          (blocker_id = profiles.user_id AND blocked_id = ${viewer.id})
      )
      AND (
        username ILIKE ${prefixPattern}
        OR username ILIKE ${substringPattern}
        OR (display_name IS NOT NULL AND display_name ILIKE ${substringPattern})
      )
    ORDER BY
      CASE
        WHEN username ILIKE ${prefixPattern} THEN 1
        WHEN username ILIKE ${substringPattern} THEN 2
        ELSE 3
      END,
      username ASC
    LIMIT 12
  `)) as unknown as Array<{
    user_id: string;
    username: string;
    display_name: string | null;
    profile_picture_url: string | null;
  }>;

  return rows.map((r) => ({
    userId: r.user_id,
    username: r.username,
    displayName: r.display_name,
    profilePictureUrl: r.profile_picture_url,
  }));
}
