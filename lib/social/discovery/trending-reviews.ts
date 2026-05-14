import "server-only";
import { sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";

import { db } from "@/lib/db";
import { isBlockedBetween } from "@/lib/social/_shared/visibility";

const CACHE_TTL_SECONDS = 1800; // 30 minutes

export type TrendingReview = {
  id: string;
  body: string;
  rating: number | null;
  publishedAt: Date;
  authorUserId: string;
  authorUsername: string;
  authorDisplayName: string | null;
  gameSlug: string;
  gameTitle: string;
  gameCoverUrl: string | null;
  likeCount: number;
};

/**
 * Fetches the unfiltered trending reviews from the database — top reviews
 * ranked by like count within the last 7-day window.
 *
 * Invariants:
 * - Only published reviews (`published_at IS NOT NULL`) on public profiles
 *   (`p.is_public = true`) with the public flag set (`r.is_public = true`)
 *   are eligible.
 * - Soft-deleted authors (`p.deleted_at IS NOT NULL`) are excluded so reviews
 *   from users in their 30-day grace window stop appearing on Discover.
 * - Like recency (not review recency) drives ranking: a highly-liked older
 *   review whose likes spiked in the last 7 days will surface.
 * - The unfiltered result is shared across ALL callers and cached at this
 *   level. Viewer-specific block filtering is applied post-cache in the
 *   exported `getTrendingReviews` wrapper so the cached set is maximally
 *   reused.
 */
async function _getTrendingReviewsUncached(limit: number): Promise<TrendingReview[]> {
  const rawRows = await db.execute<{
    id: string;
    body: string;
    rating: number | null;
    published_at: string;
    user_id: string;
    username: string;
    display_name: string | null;
    slug: string;
    title: string;
    cover_url: string | null;
    like_count: number | string;
  }>(sql`
    SELECT r.id, r.body, r.rating, r.published_at, r.user_id,
           p.username, p.display_name,
           g.slug, g.title, g.cover_url,
           count(lk.user_id)::int AS like_count
    FROM likes lk
    JOIN reviews r ON r.id = lk.review_id
    JOIN games g ON g.id = r.game_id
    JOIN profiles p ON p.user_id = r.user_id
    WHERE lk.created_at > now() - interval '7 days'
      AND r.is_public = true
      AND r.published_at IS NOT NULL
      AND p.is_public = true
      AND p.deleted_at IS NULL
    GROUP BY r.id, p.username, p.display_name, g.slug, g.title, g.cover_url
    ORDER BY like_count DESC
    LIMIT ${limit}
  `);
  // postgres-js RowList is array-like; cast through unknown to access rows directly.
  const rows = rawRows as unknown as Array<{
    id: string;
    body: string;
    rating: number | null;
    published_at: string;
    user_id: string;
    username: string;
    display_name: string | null;
    slug: string;
    title: string;
    cover_url: string | null;
    like_count: number | string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    rating: r.rating,
    publishedAt: new Date(r.published_at),
    authorUserId: r.user_id,
    authorUsername: r.username,
    authorDisplayName: r.display_name,
    gameSlug: r.slug,
    gameTitle: r.title,
    gameCoverUrl: r.cover_url,
    likeCount: Number(r.like_count),
  }));
}

const _getTrendingReviewsCached = unstable_cache(
  async (limit = 24) => _getTrendingReviewsUncached(limit),
  ["discovery-trending-reviews"],
  { revalidate: CACHE_TTL_SECONDS, tags: ["discovery"] },
);

/**
 * Trending reviews with viewer-aware block filter applied post-cache.
 *
 * Architecture: the unfiltered cached set is shared across all logged-out and
 * logged-in visitors alike. The viewer-specific block check — O(n) where n ≤
 * limit — runs after the cache hit and is sub-millisecond per row because
 * `isBlockedBetween` does a single-row primary-key lookup each call.
 *
 * Logged-out callers (`viewerId = null`) receive the full unfiltered list;
 * this matches the spec's "no block-gating for anonymous traffic" decision
 * (see `visibility.ts` docblock).
 *
 * Invariants:
 * - The unfiltered result is always cached; the per-viewer filter is never
 *   cached (it is viewer-specific and intentionally short-circuits on hot
 *   paths via early termination).
 * - Block filtering is bidirectional: a review is hidden if EITHER the viewer
 *   blocked the author OR the author blocked the viewer.
 *
 * @param viewerId - Authenticated user's UUID, or null for anonymous callers.
 * @param limit    - Maximum number of trending reviews to return (default 24).
 * @returns Filtered list of `TrendingReview` objects, most-liked first.
 */
export async function getTrendingReviews(
  viewerId: string | null,
  limit = 24,
): Promise<TrendingReview[]> {
  const all = await _getTrendingReviewsCached(limit);
  if (!viewerId) return all;
  const filtered: TrendingReview[] = [];
  for (const review of all) {
    if (await isBlockedBetween(viewerId, review.authorUserId)) continue; // bounded by limit (≤ 24); block check is sub-ms PK lookup
    filtered.push(review);
  }
  return filtered;
}
