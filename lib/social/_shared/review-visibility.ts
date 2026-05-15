import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

const { reviews, profiles } = schema;

/**
 * Returns the review iff the viewer may act on it (comment / like): the
 * owner sees their own review in any state; everyone else only a
 * published + public review by a public, non-deleted author. Mirrors
 * `likeList`'s gate and the indistinguishable not-found contract.
 *
 * The `db` connection is service-role (bypasses RLS), so this app-level
 * check is the enforcement point — RLS will not save a caller who hits the
 * action endpoint directly with a known review UUID (F-007).
 */
export async function loadVisibleReview(
  reviewId: string,
  viewerId: string,
): Promise<{ id: string; userId: string } | null> {
  const review = await db.query.reviews.findFirst({
    where: eq(reviews.id, reviewId),
    columns: { id: true, userId: true, isPublic: true, publishedAt: true },
  });
  if (!review) return null;
  if (review.userId === viewerId) {
    return { id: review.id, userId: review.userId };
  }
  if (!review.isPublic || review.publishedAt == null) return null;

  const author = await db.query.profiles.findFirst({
    where: and(eq(profiles.userId, review.userId)),
    columns: { isPublic: true, deletedAt: true },
  });
  if (!author || author.deletedAt != null || !author.isPublic) return null;

  return { id: review.id, userId: review.userId };
}
