import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { RecapMode, RecapPayload, TopGameRef } from "./types";
import { SCENE_CATALOG, filterScenes } from "./scenes";

/**
 * buildRecap — pure data-layer aggregator for Phase 6 recaps.
 *
 * Pulls logs / reviews / game catalog data for a half-open window
 * [windowStart, windowEnd) and shapes it into a RecapPayload. Two
 * tiers:
 *
 *   - `too_sparse`  — fewer than SPARSE_THRESHOLD (10) logs in the
 *                     window. Short-circuits after the count query so
 *                     we don't fire the 6 follow-up queries needlessly.
 *   - `ok`          — full payload, no substitutions (T4) and no AI
 *                     captions (T6) — those overlay later.
 *
 * Window membership uses `COALESCE(started_at, last_event_at)`:
 *   - started_at is what the user explicitly set as their start date
 *     (or what import-platform filled in for time-stamped events).
 *   - last_event_at is the fallback for logs whose started_at is null
 *     (most pre-Phase-3 records).
 *
 * Replays come from `is_replay = true` (the logs.status enum has no
 * 'replaying' value — that's a UI affordance, not a DB state).
 *
 * Review like-count comes from the `likes` table (one row per
 * user×review). We aggregate via LEFT JOIN + COUNT in the
 * favorite-review query rather than maintaining a denormalized
 * counter.
 *
 * Column shapes that bite if you don't watch them:
 *   - games.cover_url, NOT games.background_image
 *   - logs.rating, logs.hours_played are numeric → arrive as strings
 *     from postgres-js. We cast ::text on the wire and parseFloat in TS.
 *   - logs.game_id is integer; TopGameRef.gameId is typed as string,
 *     so we cast ::text on the wire.
 */
interface BuildRecapInput {
  userId: string;
  windowStart: Date;
  windowEnd: Date;
  mode: RecapMode;
}

const SPARSE_THRESHOLD = 10;

export async function buildRecap(input: BuildRecapInput): Promise<RecapPayload> {
  const { userId, windowStart, windowEnd, mode } = input;
  const startIso = windowStart.toISOString();
  const endIso = windowEnd.toISOString();

  // Step 1: count logs in window — sparse-data gate. Short-circuits the
  // 6 follow-up queries if the user has <10 logs in window.
  const countRows = (await db.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text as count FROM logs
    WHERE user_id = ${userId}
      AND COALESCE(started_at, last_event_at) >= ${startIso}
      AND COALESCE(started_at, last_event_at) <  ${endIso}
  `)) as unknown as Array<{ count: string }>;
  const logCount = parseInt(countRows[0]?.count ?? "0", 10);

  if (logCount < SPARSE_THRESHOLD) {
    return {
      tier: "too_sparse",
      mode,
      windowStart: startIso,
      windowEnd: endIso,
      scenes: [],
      totals: {
        totalGames: logCount,
        totalHoursPlayed: null,
        completedCount: 0,
        droppedCount: 0,
        replayingCount: 0,
        reviewCount: 0,
      },
      topGames: [],
      captions: {},
    };
  }

  // Step 2: remaining 6 queries run in parallel — they're independent and
  // each one already filters by user_id, so the planner can pick its own
  // index per query.
  const [
    totalsRows,
    topGamesRows,
    topGenreRows,
    topMechanicRows,
    longestRows,
    favoriteReviewRows,
  ] = await Promise.all([
    // Totals. replayingCount comes from is_replay = true (the logs.status
    // enum has no 'replaying' value). reviewCount is a scalar subquery so
    // we don't have to fan out a 7th query.
    db.execute<{
      total_games: number;
      total_hours: string | null;
      completed: number;
      dropped: number;
      replaying: number;
      reviews: number;
    }>(sql`
      SELECT
        COUNT(*)::int as total_games,
        SUM(hours_played)::text as total_hours,
        (COUNT(*) FILTER (WHERE status = 'completed'))::int as completed,
        (COUNT(*) FILTER (WHERE status = 'dropped'))::int as dropped,
        (COUNT(*) FILTER (WHERE is_replay = true))::int as replaying,
        (
          SELECT COUNT(*)::int FROM reviews
          WHERE user_id = ${userId}
            AND created_at >= ${startIso}
            AND created_at <  ${endIso}
        ) as reviews
      FROM logs
      WHERE user_id = ${userId}
        AND COALESCE(started_at, last_event_at) >= ${startIso}
        AND COALESCE(started_at, last_event_at) <  ${endIso}
    `),
    // Top 5 rated games in window. Ties broken by last_event_at DESC.
    db.execute<{
      game_id: string;
      rawg_id: number | null;
      title: string;
      cover_url: string | null;
      rating: string;
      status: string;
    }>(sql`
      SELECT
        l.game_id::text as game_id,
        g.id as rawg_id,
        g.title,
        g.cover_url,
        l.rating::text as rating,
        l.status::text as status
      FROM logs l JOIN games g ON g.id = l.game_id
      WHERE l.user_id = ${userId}
        AND COALESCE(l.started_at, l.last_event_at) >= ${startIso}
        AND COALESCE(l.started_at, l.last_event_at) <  ${endIso}
        AND l.rating IS NOT NULL
      ORDER BY l.rating DESC, l.last_event_at DESC NULLS LAST
      LIMIT 5
    `),
    // Top 2 genres. games.genres is text[] so unnest() is fine.
    db.execute<{ genre: string; count: string }>(sql`
      SELECT unnest(g.genres) as genre, COUNT(*)::text as count
      FROM logs l JOIN games g ON g.id = l.game_id
      WHERE l.user_id = ${userId}
        AND COALESCE(l.started_at, l.last_event_at) >= ${startIso}
        AND COALESCE(l.started_at, l.last_event_at) <  ${endIso}
        AND g.genres IS NOT NULL
      GROUP BY genre
      ORDER BY count DESC
      LIMIT 2
    `),
    // Top mechanic. Same shape as genres.
    db.execute<{ mechanic: string; count: string }>(sql`
      SELECT unnest(g.mechanics) as mechanic, COUNT(*)::text as count
      FROM logs l JOIN games g ON g.id = l.game_id
      WHERE l.user_id = ${userId}
        AND COALESCE(l.started_at, l.last_event_at) >= ${startIso}
        AND COALESCE(l.started_at, l.last_event_at) <  ${endIso}
        AND g.mechanics IS NOT NULL
      GROUP BY mechanic
      ORDER BY count DESC
      LIMIT 1
    `),
    // Longest game (most hours_played) in window.
    db.execute<{
      game_id: string;
      title: string;
      cover_url: string | null;
      rating: string | null;
      status: string;
      hours_played: string;
    }>(sql`
      SELECT
        l.game_id::text as game_id,
        g.title,
        g.cover_url,
        l.rating::text as rating,
        l.status::text as status,
        l.hours_played::text as hours_played
      FROM logs l JOIN games g ON g.id = l.game_id
      WHERE l.user_id = ${userId}
        AND COALESCE(l.started_at, l.last_event_at) >= ${startIso}
        AND COALESCE(l.started_at, l.last_event_at) <  ${endIso}
        AND l.hours_played IS NOT NULL
        AND l.hours_played > 0
      ORDER BY l.hours_played DESC NULLS LAST
      LIMIT 1
    `),
    // Favorite review: most-liked published review in window. We compute
    // like_count inline from the likes table (no denormalized counter).
    // Ties broken by created_at DESC (most recent wins). is_public AND
    // published_at IS NOT NULL filter out drafts and private reviews.
    db.execute<{ review_id: string; game_title: string; body: string }>(sql`
      SELECT
        r.id as review_id,
        g.title as game_title,
        r.body
      FROM reviews r
        JOIN games g ON g.id = r.game_id
        LEFT JOIN likes lk ON lk.review_id = r.id
      WHERE r.user_id = ${userId}
        AND r.created_at >= ${startIso}
        AND r.created_at <  ${endIso}
        AND r.is_public = true
        AND r.published_at IS NOT NULL
      GROUP BY r.id, g.title, r.body, r.created_at
      ORDER BY COUNT(lk.user_id) DESC, r.created_at DESC
      LIMIT 1
    `),
  ]);

  // postgres-js RowList isn't directly typed as Array — cast through
  // unknown so we can iterate. Matches the pattern in
  // lib/social/discovery/similar-users.ts.
  const totals = (totalsRows as unknown as Array<{
    total_games: number;
    total_hours: string | null;
    completed: number;
    dropped: number;
    replaying: number;
    reviews: number;
  }>)[0];
  const topGamesRaw = topGamesRows as unknown as Array<{
    game_id: string;
    rawg_id: number | null;
    title: string;
    cover_url: string | null;
    rating: string;
    status: string;
  }>;
  const topGenreRaw = topGenreRows as unknown as Array<{ genre: string; count: string }>;
  const topMechanicRaw = topMechanicRows as unknown as Array<{ mechanic: string; count: string }>;
  const longestRaw = longestRows as unknown as Array<{
    game_id: string;
    title: string;
    cover_url: string | null;
    rating: string | null;
    status: string;
    hours_played: string;
  }>;
  const reviewRaw = favoriteReviewRows as unknown as Array<{
    review_id: string;
    game_title: string;
    body: string;
  }>;

  const topGames: TopGameRef[] = topGamesRaw.map((r) => ({
    gameId: r.game_id,
    rawgId: r.rawg_id,
    title: r.title,
    coverUrl: r.cover_url,
    rating: parseFloat(r.rating),
    status: r.status as TopGameRef["status"],
  }));

  // Genre percentages are taken against the sum of unnested genre
  // occurrences (so two-genre game contributes to both). pct rounds to
  // int; secondPct stays 0 when there's only one genre present.
  const totalGenreInWindow = topGenreRaw.reduce((acc, g) => acc + parseInt(g.count, 10), 0);
  const topGenre = topGenreRaw[0]
    ? {
        name: topGenreRaw[0].genre,
        pct: Math.round((parseInt(topGenreRaw[0].count, 10) / Math.max(totalGenreInWindow, 1)) * 100),
        secondName: topGenreRaw[1]?.genre ?? null,
        secondPct: topGenreRaw[1]
          ? Math.round((parseInt(topGenreRaw[1].count, 10) / totalGenreInWindow) * 100)
          : 0,
      }
    : undefined;

  const topMechanic = topMechanicRaw[0] ? { name: topMechanicRaw[0].mechanic } : undefined;

  const longestGame = longestRaw[0]
    ? {
        game: {
          gameId: longestRaw[0].game_id,
          rawgId: null,
          title: longestRaw[0].title,
          coverUrl: longestRaw[0].cover_url,
          // rating may be null when the user logged hours but never
          // rated the game — coerce to 0 since TopGameRef.rating is not
          // nullable.
          rating: longestRaw[0].rating !== null ? parseFloat(longestRaw[0].rating) : 0,
          status: longestRaw[0].status as TopGameRef["status"],
        },
        hoursPlayed: parseFloat(longestRaw[0].hours_played),
      }
    : undefined;

  const favoriteReviewSnippet = reviewRaw[0]
    ? {
        reviewId: reviewRaw[0].review_id,
        gameTitle: reviewRaw[0].game_title,
        snippet: reviewRaw[0].body.slice(0, 60),
      }
    : undefined;

  // Base scene list (no substitution yet — that's T4). filterScenes drops
  // yearOnly entries when mode === 'monthly'.
  const baseScenes = filterScenes(SCENE_CATALOG, mode).map((s) => s.id);

  return {
    tier: "ok",
    mode,
    windowStart: startIso,
    windowEnd: endIso,
    scenes: baseScenes,
    totals: {
      totalGames: totals.total_games,
      totalHoursPlayed: totals.total_hours !== null ? parseFloat(totals.total_hours) : null,
      completedCount: totals.completed,
      droppedCount: totals.dropped,
      replayingCount: totals.replaying,
      reviewCount: totals.reviews,
    },
    topGames,
    // Same reference, not a copy. Aggregator consumers that compare via
    // === (e.g. the scene catalog substitution check in T4) rely on this.
    goty: topGames[0],
    topGenre,
    topMechanic,
    longestGame,
    favoriteReviewSnippet,
    captions: {},
  };
}
