"use server";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { isBlockedBetween, withBlockedFilter } from "@/lib/social/_shared/visibility";
import { FOLLOWS_PAGE_SIZE, type FollowsPage } from "./pagination";
import { onFollow } from "./triggers";

const { follows, profiles } = schema;

// Shared by follow() and unfollow(). "self-follow" and "blocked" are only
// reachable from follow() — unfollow() returns { ok: true } even when no
// row exists (DELETE is idempotent). Callers pattern-matching unfollow()
// against those reasons will never hit them.
export type FollowResult =
  | { ok: true }
  | { ok: false; reason: "not-authenticated" | "self-follow" | "blocked" };

export async function follow(targetUserId: string): Promise<FollowResult> {
  const user = await getCachedUser();
  if (!user) return { ok: false, reason: "not-authenticated" };
  if (user.id === targetUserId) return { ok: false, reason: "self-follow" };

  // Bidirectional block prevents the follow row from ever being created.
  if (await isBlockedBetween(user.id, targetUserId)) {
    return { ok: false, reason: "blocked" };
  }

  // INSERT ... ON CONFLICT DO NOTHING; rowsAffected tells us if it was fresh.
  const inserted = await db
    .insert(follows)
    .values({ followerId: user.id, followedId: targetUserId })
    .onConflictDoNothing()
    .returning({ followerId: follows.followerId });

  // Only emit notification on a fresh follow (avoid re-emitting on rapid
  // follow→unfollow→follow toggles).
  if (inserted.length > 0) {
    await onFollow({ followerId: user.id, followedId: targetUserId });
  }

  // Revalidate the followed user's profile page so the server-rendered
  // follower count refreshes on next visit.
  const followedProfile = await db.query.profiles.findFirst({
    where: eq(profiles.userId, targetUserId),
    columns: { username: true },
  });
  if (followedProfile) {
    revalidatePath(`/u/${followedProfile.username}`);
  }

  return { ok: true };
}

export async function unfollow(targetUserId: string): Promise<FollowResult> {
  const user = await getCachedUser();
  if (!user) return { ok: false, reason: "not-authenticated" };
  await db
    .delete(follows)
    .where(
      and(eq(follows.followerId, user.id), eq(follows.followedId, targetUserId)),
    );

  // Revalidate the unfollowed user's profile page so the server-rendered
  // follower count refreshes on next visit.
  const unfollowedProfile = await db.query.profiles.findFirst({
    where: eq(profiles.userId, targetUserId),
    columns: { username: true },
  });
  if (unfollowedProfile) {
    revalidatePath(`/u/${unfollowedProfile.username}`);
  }

  return { ok: true };
}

/**
 * Users who follow `userId`, filtered by the viewer's block graph.
 * Pass `viewerId: null` for logged-out callers — block filter skipped
 * (matches the logged-out exception in visibility.ts).
 *
 * `viewerId` is caller-supplied rather than session-derived because these
 * are read helpers called from Server Components / route handlers that
 * already resolved the viewer for their own purposes. Same convention as
 * getProfileSummary(username, viewerId) in profile-summary.ts.
 *
 * Pagination: defaults to 100 per page (audit T12). A 1000-follower user
 * was previously serializing the entire list on every profile-page load.
 *
 * Backed by the follows_followed_id_idx (migration 0009) for sub-ms
 * lookup despite followed_id not being the PK leading column.
 */
export async function getFollowers(
  userId: string,
  viewerId: string | null,
  page: FollowsPage = {},
): Promise<
  Array<{
    userId: string;
    username: string;
    displayName: string | null;
    profilePictureUrl: string | null;
  }>
> {
  const limit = Math.min(Math.max(1, page.limit ?? FOLLOWS_PAGE_SIZE), FOLLOWS_PAGE_SIZE);
  const offset = Math.max(0, page.offset ?? 0);

  const base = db
    .select({
      userId: profiles.userId,
      username: profiles.username,
      displayName: profiles.displayName,
      profilePictureUrl: profiles.profilePictureUrl,
    })
    .from(follows)
    .innerJoin(profiles, eq(profiles.userId, follows.followerId))
    .where(and(eq(follows.followedId, userId), isNull(profiles.deletedAt)))
    .$dynamic();

  // Block filter is in-WHERE (notExists subqueries on `blocks`), so
  // LIMIT/OFFSET apply to the post-filter rows. Each returned page
  // contains up to FOLLOWS_PAGE_SIZE rows that are visible to the
  // viewer (not "100 raw follow rows that may shrink to N visible").
  return await withBlockedFilter(viewerId, base, profiles.userId)
    .limit(limit)
    .offset(offset);
}

/**
 * Users that `userId` follows, filtered by the viewer's block graph.
 * Pass `viewerId: null` for logged-out callers.
 *
 * `viewerId` is caller-supplied rather than session-derived — same
 * convention as getProfileSummary(username, viewerId) in profile-summary.ts.
 *
 * Pagination: defaults to 100 per page (audit T12).
 *
 * Backed by the follows PK (follower_id leading column) — no extra
 * index needed.
 */
export async function getFollowing(
  userId: string,
  viewerId: string | null,
  page: FollowsPage = {},
): Promise<
  Array<{
    userId: string;
    username: string;
    displayName: string | null;
    profilePictureUrl: string | null;
  }>
> {
  const limit = Math.min(Math.max(1, page.limit ?? FOLLOWS_PAGE_SIZE), FOLLOWS_PAGE_SIZE);
  const offset = Math.max(0, page.offset ?? 0);

  const base = db
    .select({
      userId: profiles.userId,
      username: profiles.username,
      displayName: profiles.displayName,
      profilePictureUrl: profiles.profilePictureUrl,
    })
    .from(follows)
    .innerJoin(profiles, eq(profiles.userId, follows.followedId))
    .where(and(eq(follows.followerId, userId), isNull(profiles.deletedAt)))
    .$dynamic();

  return await withBlockedFilter(viewerId, base, profiles.userId)
    .limit(limit)
    .offset(offset);
}
