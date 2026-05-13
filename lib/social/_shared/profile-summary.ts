import "server-only";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { LOG_GAME_SELECT } from "@/lib/logs/select";
import {
  type LibraryItem,
  computeUserStatsFromLibrary,
  mapRowToLibraryItem,
  type UserStats,
} from "@/lib/logs/library-item";
import { isBlockedBetween } from "./visibility";
import { tierForUser } from "@/lib/taste/tier";

const { profiles, logs, reviews, lists, follows, tasteFingerprints } = schema;

export type ProfileSummary = {
  profile: typeof profiles.$inferSelect;
  stats: UserStats;
  tasteSnippet: {
    tier: ReturnType<typeof tierForUser>;
    narrative: string | null;
  } | null;
  topLists: Array<{
    id: string;
    title: string;
    slug: string;
    description: string | null;
    publishedAt: Date | null;
  }>;
  recentReviews: Array<{
    id: string;
    body: string;
    rating: string | null; // Drizzle returns numeric columns as strings
    publishedAt: Date | null;
    gameTitle: string;
    gameSlug: string;
    gameCoverUrl: string | null;
  }>;
  libraryTruncated: LibraryItem[]; // first 12 most recently updated
  isOwner: boolean;
  isFollowing: boolean;
  isBlocked: boolean;
  followerCount: number;
  followingCount: number;
};

/**
 * Load all data the /u/[username] overview hub renders. One call site,
 * parallel internal fetches.
 *
 * Returns null when:
 *  - profile not found
 *  - profile is_public=false AND viewer is not owner
 *  - viewer is blocked (in either direction) and not owner
 *
 * Matches the "indistinguishable 404" contract from /u/[username]/page.tsx
 * audit pre-Phase-5 — don't leak existence of a private/blocked profile.
 */
export async function getProfileSummary(
  username: string,
  viewerId: string | null,
): Promise<ProfileSummary | null> {
  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.username, username),
  });
  if (!profile) return null;

  const isOwner = viewerId === profile.userId;

  // Privacy gate: non-owner sees nothing when profile.is_public=false.
  if (!profile.isPublic && !isOwner) return null;

  // Block gate: non-owner blocked-pair sees nothing (matches the 404 contract).
  if (viewerId && !isOwner) {
    if (await isBlockedBetween(viewerId, profile.userId)) return null;
  }

  // 7 parallel fetches — none depend on each other's results.
  const [
    rawLogs,
    rawReviews,
    rawTopLists,
    rawFingerprint,
    rawFollowerCount,
    rawFollowingCount,
    rawIsFollowing,
  ] = await Promise.all([
    // Library — own profile sees everything, public sees non-private. NOTE: no
    // .limit() here on purpose: computeUserStatsFromLibrary needs the full set
    // to compute totals/averages. libraryTruncated slices to 12 below, but the
    // full array stays in scope only inside this function. If stats ever moves
    // to SQL aggregates, this fetch should gain a LIMIT.
    db
      .select(LOG_GAME_SELECT)
      .from(logs)
      .innerJoin(schema.games, eq(logs.gameId, schema.games.id))
      .where(
        and(
          eq(logs.userId, profile.userId),
          isOwner ? undefined : eq(logs.isPrivate, false),
        ),
      )
      .orderBy(desc(logs.updatedAt)),

    // Recent reviews (top 3, must be published + public unless owner).
    db
      .select({
        id: reviews.id,
        body: reviews.body,
        rating: reviews.rating,
        publishedAt: reviews.publishedAt,
        gameTitle: schema.games.title,
        gameSlug: schema.games.slug,
        gameCoverUrl: schema.games.coverUrl,
      })
      .from(reviews)
      .innerJoin(schema.games, eq(reviews.gameId, schema.games.id))
      .where(
        and(
          eq(reviews.userId, profile.userId),
          isNotNull(reviews.publishedAt),
          isOwner ? undefined : eq(reviews.isPublic, true),
        ),
      )
      .orderBy(desc(reviews.publishedAt))
      .limit(3),

    // Top 3 most-recently-published lists.
    db
      .select({
        id: lists.id,
        title: lists.title,
        slug: lists.slug,
        description: lists.description,
        publishedAt: lists.publishedAt,
      })
      .from(lists)
      .where(
        and(
          eq(lists.userId, profile.userId),
          isNotNull(lists.publishedAt),
          isOwner ? undefined : eq(lists.isPublic, true),
        ),
      )
      .orderBy(desc(lists.publishedAt))
      .limit(3),

    // Taste fingerprint snippet (may be null for empty-tier users).
    db.query.tasteFingerprints.findFirst({
      where: eq(tasteFingerprints.userId, profile.userId),
      columns: {
        narrativeSummary: true,
        totalLogsAtGeneration: true,
      },
    }),

    // Follower count.
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(follows)
      .where(eq(follows.followedId, profile.userId)),

    // Following count.
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(follows)
      .where(eq(follows.followerId, profile.userId)),

    // Is the viewer following this profile? Skip when logged-out or owner.
    viewerId && !isOwner
      ? db.query.follows.findFirst({
          where: and(
            eq(follows.followerId, viewerId),
            eq(follows.followedId, profile.userId),
          ),
        })
      : Promise.resolve(undefined),
  ]);

  const allLibrary: LibraryItem[] = rawLogs.map((r) =>
    mapRowToLibraryItem(r.log, r.game),
  );
  const stats = computeUserStatsFromLibrary(allLibrary);

  return {
    profile,
    stats,
    tasteSnippet: rawFingerprint
      ? {
          tier: tierForUser(rawFingerprint.totalLogsAtGeneration),
          narrative: rawFingerprint.narrativeSummary,
        }
      : null,
    topLists: rawTopLists,
    recentReviews: rawReviews,
    libraryTruncated: allLibrary.slice(0, 12),
    isOwner,
    isFollowing: Boolean(rawIsFollowing),
    // isBlocked is always false on a returned result: blocked non-owners hit
    // the early null return above; owners are never blocked from themselves;
    // logged-out viewers skip the block check entirely (the visibility.ts
    // logged-out exception). Don't treat this as a "no edge exists" signal.
    isBlocked: false,
    followerCount: rawFollowerCount[0]?.value ?? 0,
    followingCount: rawFollowingCount[0]?.value ?? 0,
  };
}
