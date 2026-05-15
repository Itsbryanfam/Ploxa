import { describe, expect, it, beforeEach, vi } from "vitest";

/**
 * Aggregator tests. We mock `@/lib/db` so the tests don't need a real
 * Postgres — instead each `mockResolvedValueOnce` primes one query's
 * return value. The aggregator runs queries in a known order:
 *
 *   1. count (sparse-data gate)
 *   2. totals
 *   3. top_games
 *   4. top_genre
 *   5. top_mechanic
 *   6. longest_game
 *   7. favorite_review
 *
 * Queries 2-7 run in Promise.all; we still feed them sequentially because
 * Promise.all preserves argument order when awaiting on a mock fn.
 */

// Mock db before importing aggregator. vi.mock is hoisted to the top.
vi.mock("@/lib/db", () => {
  const mockSql = vi.fn();
  return {
    db: { execute: mockSql },
    schema: {},
  };
});

import { db } from "@/lib/db";
import { buildRecap } from "@/lib/recaps/aggregate";
import { yearWindow } from "@/lib/recaps/window";

const mockExecute = vi.mocked(db.execute);

// Walk a drizzle SQL object's static chunks to recover the literal SQL
// skeleton (param values omitted) so we can assert on predicates without a
// real DB. drizzle-orm is NOT mocked in this file, so db.execute receives a
// real SQL instance whose `queryChunks` carry the cooked string parts.
function sqlText(arg: unknown): string {
  const chunks = (arg as { queryChunks?: unknown[] })?.queryChunks ?? [];
  let out = "";
  for (const c of chunks) {
    const v = (c as { value?: unknown }).value;
    if (Array.isArray(v)) out += v.join(" ");
    else if (typeof v === "string") out += v;
  }
  return out.replace(/\s+/g, " ");
}

beforeEach(() => {
  mockExecute.mockReset();
});

describe("buildRecap", () => {
  it("returns too_sparse for <10 logs in window", async () => {
    // First query: count of logs in window
    mockExecute.mockResolvedValueOnce([{ count: "9" }] as never);
    const { start, end } = yearWindow(2026);
    const result = await buildRecap({
      userId: "u-1",
      windowStart: start,
      windowEnd: end,
      mode: "yearly",
    });
    expect(result.tier).toBe("too_sparse");
    // Sparse short-circuits, no further queries fired
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("produces full payload for >=10 logs", async () => {
    // Sequence: count → totals → top_games → top_genre → top_mechanic → longest_game → favorite_review
    mockExecute
      .mockResolvedValueOnce([{ count: "15" }] as never)
      .mockResolvedValueOnce([
        {
          total_games: 15,
          total_hours: "120.5",
          completed: 8,
          dropped: 2,
          replaying: 1,
          reviews: 4,
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          game_id: "1",
          rawg_id: 100,
          title: "Game A",
          cover_url: "https://example/g.jpg",
          rating: "5.0",
          status: "completed",
        },
        {
          game_id: "2",
          rawg_id: 101,
          title: "Game B",
          cover_url: null,
          rating: "4.5",
          status: "completed",
        },
      ] as never)
      .mockResolvedValueOnce([
        { genre: "Action", count: "8" },
        { genre: "RPG", count: "5" },
      ] as never)
      .mockResolvedValueOnce([{ mechanic: "Roguelite", count: "6" }] as never)
      .mockResolvedValueOnce([
        {
          game_id: "1",
          title: "Game A",
          cover_url: "https://example/g.jpg",
          rating: "5.0",
          status: "completed",
          hours_played: "45.5",
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          review_id: "r-1",
          game_title: "Game A",
          body: "This game owned my year, full stop. Highly recommended.",
        },
      ] as never)
      // T4 substitutions: longestGame + topMechanic both present → only the
      // yearly mood_themes substitution fires (taste_evolution → completion_ratio
      // is pure math, no DB query). One extra DB call.
      .mockResolvedValueOnce([{ theme: "Atmospheric" }] as never);

    const { start, end } = yearWindow(2026);
    const result = await buildRecap({
      userId: "u-1",
      windowStart: start,
      windowEnd: end,
      mode: "yearly",
    });
    expect(result.tier).toBe("ok");
    expect(result.totals.totalGames).toBe(15);
    expect(result.totals.totalHoursPlayed).toBe(120.5);
    expect(result.totals.completedCount).toBe(8);
    expect(result.totals.droppedCount).toBe(2);
    expect(result.totals.replayingCount).toBe(1);
    expect(result.totals.reviewCount).toBe(4);
    expect(result.topGames).toHaveLength(2);
    expect(result.topGames[0]?.title).toBe("Game A");
    expect(result.topGames[0]?.coverUrl).toBe("https://example/g.jpg");
    expect(result.topGames[1]?.coverUrl).toBeNull();
    expect(result.goty?.title).toBe("Game A");
    // goty is exactly the same reference as topGames[0]
    expect(result.goty).toBe(result.topGames[0]);
    expect(result.topGenre?.name).toBe("Action");
    expect(result.topGenre?.secondName).toBe("RPG");
    expect(result.topMechanic?.name).toBe("Roguelite");
    expect(result.longestGame?.hoursPlayed).toBe(45.5);
    expect(result.longestGame?.game.title).toBe("Game A");
    expect(result.favoriteReviewSnippet?.snippet.length).toBeLessThanOrEqual(60);
    expect(result.favoriteReviewSnippet?.gameTitle).toBe("Game A");
    // Sparse-gate query + 6 parallel queries + 1 mood_themes substitution query
    expect(mockExecute).toHaveBeenCalledTimes(8);
  });

  it("handles empty optional sections gracefully", async () => {
    // 10 logs (≥ threshold) but no rated games, no genres, no mechanics, no
    // long sessions, no reviews. The aggregator should still produce a
    // payload with `tier: 'ok'` and undefined optional fields.
    mockExecute
      .mockResolvedValueOnce([{ count: "10" }] as never)
      .mockResolvedValueOnce([
        {
          total_games: 10,
          total_hours: null,
          completed: 0,
          dropped: 0,
          replaying: 0,
          reviews: 0,
        },
      ] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      // T4: longestGame empty → most_replayed query (returns empty → scene dropped);
      // topMechanic empty → top_theme query (returns empty → scene dropped);
      // mood_themes query (returns empty → surprise scene dropped).
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    const { start, end } = yearWindow(2026);
    const result = await buildRecap({
      userId: "u-1",
      windowStart: start,
      windowEnd: end,
      mode: "yearly",
    });
    expect(result.tier).toBe("ok");
    expect(result.totals.totalGames).toBe(10);
    expect(result.totals.totalHoursPlayed).toBeNull();
    expect(result.topGames).toEqual([]);
    expect(result.goty).toBeUndefined();
    expect(result.topGenre).toBeUndefined();
    expect(result.topMechanic).toBeUndefined();
    expect(result.longestGame).toBeUndefined();
    expect(result.favoriteReviewSnippet).toBeUndefined();
  });

  it("clamps review snippets to 60 chars and preserves longer bodies upstream", async () => {
    const longBody = "x".repeat(200);
    mockExecute
      .mockResolvedValueOnce([{ count: "12" }] as never)
      .mockResolvedValueOnce([
        {
          total_games: 12,
          total_hours: "30",
          completed: 3,
          dropped: 0,
          replaying: 0,
          reviews: 1,
        },
      ] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([
        { review_id: "r-2", game_title: "Long Game", body: longBody },
      ] as never)
      // T4 substitutions: same as the empty-sections test — no longestGame /
      // topMechanic / surprise → all three DB-backed sub queries fire.
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    const { start, end } = yearWindow(2026);
    const result = await buildRecap({
      userId: "u-1",
      windowStart: start,
      windowEnd: end,
      mode: "yearly",
    });
    expect(result.favoriteReviewSnippet?.snippet).toHaveLength(60);
    expect(result.favoriteReviewSnippet?.snippet).toBe("x".repeat(60));
  });

  it("excludes private logs from every logs aggregate (F-001)", async () => {
    // Prime enough rows to run past the sparse gate and through the parallel
    // block + substitution queries. We assert on emitted SQL, not results.
    mockExecute
      .mockResolvedValueOnce([{ count: "15" }] as never) // count gate
      .mockResolvedValueOnce([
        {
          total_games: 15,
          total_hours: "1",
          completed: 0,
          dropped: 0,
          replaying: 0,
          reviews: 0,
        },
      ] as never) // totals
      .mockResolvedValueOnce([] as never) // top_games
      .mockResolvedValueOnce([] as never) // top_genre
      .mockResolvedValueOnce([] as never) // top_mechanic
      .mockResolvedValueOnce([] as never) // longest_game
      .mockResolvedValueOnce([] as never) // favorite_review
      .mockResolvedValueOnce([] as never) // most_replayed sub
      .mockResolvedValueOnce([] as never) // top_theme sub
      .mockResolvedValueOnce([] as never); // mood_themes sub

    const { start, end } = yearWindow(2026);
    await buildRecap({
      userId: "u-1",
      windowStart: start,
      windowEnd: end,
      mode: "yearly",
    });

    const calls = mockExecute.mock.calls.map((c) => sqlText(c[0]));
    const countSql = calls[0];
    const totalsSql = calls[1];
    const topGamesSql = calls[2];
    const topGenreSql = calls[3];
    const topMechanicSql = calls[4];
    const longestSql = calls[5];

    // Unaliased logs queries
    expect(countSql).toContain("is_private = false");
    expect(totalsSql).toContain("is_private = false");
    // logs joined as `l`
    expect(topGamesSql).toContain("l.is_private = false");
    expect(topGenreSql).toContain("l.is_private = false");
    expect(topMechanicSql).toContain("l.is_private = false");
    expect(longestSql).toContain("l.is_private = false");
  });
});
