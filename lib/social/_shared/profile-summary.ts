import "server-only";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import type { LogStatus } from "@/lib/db/schema-types";
import { LOG_GAME_SELECT } from "@/lib/logs/select";
import {
  type LibraryItem,
  mapRowToLibraryItem,
  type UserStats,
} from "@/lib/logs/library-item";
import { isBlockedBetween } from "./visibility";
import { tierForUser } from "@/lib/taste/tier";

const { profiles, logs, reviews, lists, follows, tasteFingerprints, platformConnections } = schema;

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
  // Active platform connections (Steam, Xbox) for connector-pill rendering.
  // Discord lives on profile.discordUsername (no OAuth, text-only).
  connections: Array<{
    platform: "steam" | "xbox" | "psn";
    externalId: string;
    displayName: string | null;
  }>;
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
    where: and(eq(profiles.username, username), isNull(profiles.deletedAt)),
  });
  if (!profile) return null;

  const isOwner = viewerId === profile.userId;

  // Privacy gate: non-owner sees nothing when profile.is_public=false.
  if (!profile.isPublic && !isOwner) return null;

  // Block gate: non-owner blocked-pair sees nothing (matches the 404 contract).
  if (viewerId && !isOwner) {
    if (await isBlockedBetween(viewerId, profile.userId)) return null;
  }

  // Visibility scope shared by both library queries below: own profile sees
  // everything; non-owner sees only is_private=false rows.
  const visibilityWhere = and(
    eq(logs.userId, profile.userId),
    isOwner ? undefined : eq(logs.isPrivate, false),
  );

  // 9 parallel fetches — none depend on each other's results.
  //
  // T13 (2026-05-14): split the old single "load every log + game join"
  // query into two bounded queries:
  //   1. Stats via SQL aggregates (count + count(*) FILTER per status + avg).
  //   2. libraryTruncated via LIMIT 12 (top-12 covers shown on the profile).
  // Pre-T13 a 1000-log user shipped 1000 cover URLs over the wire to render 12.
  const [
    rawStats,
    rawLibrary,
    rawReviews,
    rawTopLists,
    rawFingerprint,
    rawFollowerCount,
    rawFollowingCount,
    rawIsFollowing,
    rawConnections,
  ] = await Promise.all([
    // Stats aggregate — single row, no row hydration. PG `avg()` ignores NULL
    // ratings natively, so unrated logs don't drag the mean toward zero.
    // Casts return strings/numbers depending on the column; coerce below.
    db
      .select({
        total: sql<number>`count(*)::int`,
        backlog: sql<number>`count(*) FILTER (WHERE ${logs.status} = 'backlog')::int`,
        playing: sql<number>`count(*) FILTER (WHERE ${logs.status} = 'playing')::int`,
        completed: sql<number>`count(*) FILTER (WHERE ${logs.status} = 'completed')::int`,
        dropped: sql<number>`count(*) FILTER (WHERE ${logs.status} = 'dropped')::int`,
        on_hold: sql<number>`count(*) FILTER (WHERE ${logs.status} = 'on_hold')::int`,
        wishlist: sql<number>`count(*) FILTER (WHERE ${logs.status} = 'wishlist')::int`,
        // numeric returns as string from postgres-js; coerce below.
        averageRating: sql<string | null>`avg(${logs.rating})`,
      })
      .from(logs)
      .where(visibilityWhere),

    // Library top-12 (the most-recently-updated covers shown on the profile).
    // Ordered by updated_at DESC so it matches what the user just touched.
    db
      .select(LOG_GAME_SELECT)
      .from(logs)
      .innerJoin(schema.games, eq(logs.gameId, schema.games.id))
      .where(visibilityWhere)
      .orderBy(desc(logs.updatedAt))
      .limit(12),

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

    // Active platform connections for connector pills. Filter is_active so
    // a user who disconnected Steam doesn't leak a dead pill. Order is
    // platform-asc so render order is stable across page loads.
    db
      .select({
        platform: platformConnections.platform,
        externalId: platformConnections.externalId,
        displayName: platformConnections.displayName,
      })
      .from(platformConnections)
      .where(
        and(
          eq(platformConnections.userId, profile.userId),
          eq(platformConnections.isActive, true),
        ),
      )
      .orderBy(platformConnections.platform),
  ]);

  const libraryTruncated: LibraryItem[] = rawLibrary.map((r) =>
    mapRowToLibraryItem(r.log, r.game),
  );

  // Aggregate row is always present — count(*) returns 0 for an empty table
  // rather than no row at all. Defensive `?? 0` for safety.
  const aggregateRow = rawStats[0];
  const byStatus: Record<LogStatus, number> = {
    backlog: aggregateRow?.backlog ?? 0,
    playing: aggregateRow?.playing ?? 0,
    completed: aggregateRow?.completed ?? 0,
    dropped: aggregateRow?.dropped ?? 0,
    on_hold: aggregateRow?.on_hold ?? 0,
    wishlist: aggregateRow?.wishlist ?? 0,
  };
  // Mirror computeUserStatsFromLibrary's rounding: 1 decimal place. PG `avg()`
  // returns a high-precision numeric string (e.g. "8.4285714285714286"); we
  // coerce → number → round. Null when no rated logs (avg returns null).
  const avgRaw = aggregateRow?.averageRating;
  const averageRating =
    avgRaw == null ? null : Math.round(Number(avgRaw) * 10) / 10;
  const stats: UserStats = {
    total: aggregateRow?.total ?? 0,
    byStatus,
    averageRating,
  };

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
    libraryTruncated,
    connections: rawConnections,
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
