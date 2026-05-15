import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { LogStatus } from "@/lib/db/schema-types";
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
 * PRIVACY INVARIANT (F-001): every `logs` aggregate filters
 * `is_private = false`. The recap is a shareable artifact — the page, the
 * OG image, and the persisted cache row all read this one payload — so
 * private logs never appear, even in the owner's own view.
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
      AND is_private = false
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
        AND is_private = false
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
        AND l.is_private = false
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
        AND l.is_private = false
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
        AND l.is_private = false
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
        AND l.is_private = false
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
    status: r.status as LogStatus,
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
          status: longestRaw[0].status as LogStatus,
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

  // Base scene list. filterScenes drops yearOnly entries when mode ===
  // 'monthly'. T4's applySubstitutions then rewrites the array in place
  // (and possibly populates substitute payload fields).
  const baseScenes = filterScenes(SCENE_CATALOG, mode).map((s) => s.id);

  const payload: RecapPayload = {
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
    // === (e.g. tests asserting goty === topGames[0]) rely on this. The
    // substitution pass below mutates `payload.scenes` in place and adds
    // optional fields, but never reassigns topGames or goty, so this
    // reference identity survives substitution.
    goty: topGames[0],
    topGenre,
    topMechanic,
    longestGame,
    favoriteReviewSnippet,
    captions: {},
  };

  await applySubstitutions(payload, userId, startIso, endIso);
  return payload;
}

/**
 * applySubstitutions — rewrites `payload.scenes` and populates
 * substitute payload fields in place. Five rules:
 *
 *   1. !longestGame             → most_replayed (if user has any replays)
 *   2. !topMechanic             → top_theme (if any themes in window)
 *   3. yearly + !tasteEvolution → completion_ratio (math only, no DB)
 *   4. yearly + !surprise       → mood_themes (if any themes in window)
 *   5. reviewCount === 0        → drop reviews scene (no substitute)
 *
 * Mutates payload in place. We return void rather than a fresh object so
 * `topGames` / `goty` reference identity is trivially preserved (see
 * T3's test asserting `r.goty === r.topGames[0]`).
 *
 * Schema corrections vs. plan (T3 carried these forward to T4):
 *   - `g.background_image` → `g.cover_url`
 *   - `l.played_at`        → COALESCE(started_at, last_event_at)
 *   - `status = 'replaying'` → `is_replay = true` (no log_events table)
 *   - status cast → `as LogStatus`
 *
 * `tasteEvolution` and `surprise` aggregator computation is a stretch
 * goal not implemented in T3, so substitutions 3 + 4 always fire in
 * yearly mode — by design for the soft-launch path.
 */
async function applySubstitutions(
  payload: RecapPayload,
  userId: string,
  startIso: string,
  endIso: string,
): Promise<void> {
  const scenes = payload.scenes;

  // 1. longest_game → most_replayed. Plan's spec used a log_events table
  // that doesn't exist in our schema; we count rows in `logs` where
  // is_replay = true grouped by game.
  if (!payload.longestGame) {
    const idx = scenes.indexOf("longest_game");
    if (idx >= 0) {
      const rows = (await db.execute<{
        game_id: string;
        rawg_id: number | null;
        title: string;
        cover_url: string | null;
        rating: string | null;
        status: string;
        replay_count: string;
      }>(sql`
        SELECT
          l.game_id::text as game_id,
          g.id as rawg_id,
          g.title,
          g.cover_url,
          l.rating::text as rating,
          l.status::text as status,
          (
            SELECT COUNT(*)::text
            FROM logs l2
            WHERE l2.user_id = ${userId}
              AND l2.is_private = false
              AND l2.game_id = l.game_id
              AND l2.is_replay = true
              AND COALESCE(l2.started_at, l2.last_event_at) >= ${startIso}
              AND COALESCE(l2.started_at, l2.last_event_at) <  ${endIso}
          ) as replay_count
        FROM logs l JOIN games g ON g.id = l.game_id
        WHERE l.user_id = ${userId}
          AND l.is_private = false
          AND l.is_replay = true
          AND COALESCE(l.started_at, l.last_event_at) >= ${startIso}
          AND COALESCE(l.started_at, l.last_event_at) <  ${endIso}
        ORDER BY replay_count DESC NULLS LAST, l.last_event_at DESC NULLS LAST
        LIMIT 1
      `)) as unknown as Array<{
        game_id: string;
        rawg_id: number | null;
        title: string;
        cover_url: string | null;
        rating: string | null;
        status: string;
        replay_count: string;
      }>;
      const row = rows[0];
      if (row && parseInt(row.replay_count, 10) > 0) {
        scenes[idx] = "most_replayed";
        payload.mostReplayed = {
          game: {
            gameId: row.game_id,
            rawgId: row.rawg_id,
            title: row.title,
            coverUrl: row.cover_url,
            rating: row.rating !== null ? parseFloat(row.rating) : 0,
            status: row.status as LogStatus,
          },
          replayCount: parseInt(row.replay_count, 10),
        };
      } else {
        scenes.splice(idx, 1);
      }
    }
  }

  // 2. mechanic_love → top_theme. games.themes is text[] (confirmed in
  // schema.ts L173 + GIN index on L209).
  if (!payload.topMechanic) {
    const idx = scenes.indexOf("mechanic_love");
    if (idx >= 0) {
      const rows = (await db.execute<{ theme: string; count: string }>(sql`
        SELECT unnest(g.themes) as theme, COUNT(*)::text as count
        FROM logs l JOIN games g ON g.id = l.game_id
        WHERE l.user_id = ${userId}
          AND l.is_private = false
          AND COALESCE(l.started_at, l.last_event_at) >= ${startIso}
          AND COALESCE(l.started_at, l.last_event_at) <  ${endIso}
          AND g.themes IS NOT NULL
        GROUP BY theme
        ORDER BY count DESC
        LIMIT 1
      `)) as unknown as Array<{ theme: string; count: string }>;
      if (rows[0]) {
        scenes[idx] = "top_theme";
        payload.topTheme = { name: rows[0].theme };
      } else {
        scenes.splice(idx, 1);
      }
    }
  }

  // 3. taste_evolution → completion_ratio. Pure math from totals; no DB.
  // Yearly-only since taste_evolution is yearOnly in the catalog.
  if (payload.mode === "yearly" && !payload.tasteEvolution) {
    const idx = scenes.indexOf("taste_evolution");
    if (idx >= 0) {
      scenes[idx] = "completion_ratio";
      const total = Math.max(payload.totals.totalGames, 1);
      payload.completionRatio = {
        completedPct: Math.round((payload.totals.completedCount / total) * 100),
        droppedPct: Math.round((payload.totals.droppedCount / total) * 100),
      };
    }
  }

  // 4. surprise → mood_themes. Same themes column as top_theme but
  // returns up to 3 distinct themes (no count needed in payload).
  if (payload.mode === "yearly" && !payload.surprise) {
    const idx = scenes.indexOf("surprise");
    if (idx >= 0) {
      const rows = (await db.execute<{ theme: string }>(sql`
        SELECT unnest(g.themes) as theme
        FROM logs l JOIN games g ON g.id = l.game_id
        WHERE l.user_id = ${userId}
          AND l.is_private = false
          AND COALESCE(l.started_at, l.last_event_at) >= ${startIso}
          AND COALESCE(l.started_at, l.last_event_at) <  ${endIso}
          AND g.themes IS NOT NULL
        GROUP BY theme
        ORDER BY COUNT(*) DESC
        LIMIT 3
      `)) as unknown as Array<{ theme: string }>;
      if (rows.length > 0) {
        scenes[idx] = "mood_themes";
        payload.moodThemes = { themes: rows.map((r) => r.theme) };
      } else {
        scenes.splice(idx, 1);
      }
    }
  }

  // 5. reviews → drop if 0 (no substitute). In monthly mode, reviews is
  // yearOnly so filterScenes already removed it — indexOf returns -1 and
  // the splice is a no-op.
  if (payload.totals.reviewCount === 0) {
    const idx = scenes.indexOf("reviews");
    if (idx >= 0) scenes.splice(idx, 1);
  }
}
