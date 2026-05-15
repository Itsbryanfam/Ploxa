import { describe, expect, it, beforeEach, vi } from "vitest";

/**
 * Substitution-map tests. Mocks `@/lib/db` so we can prime each query
 * return value in order. Query order:
 *
 *   Base aggregator (T3):
 *     1. count (sparse-data gate)
 *     2. totals
 *     3. top_games
 *     4. top_genre
 *     5. top_mechanic
 *     6. longest_game
 *     7. favorite_review
 *
 *   T4 substitutions (sequential, in this order):
 *     8a. most_replayed         (only if !longestGame)
 *     8b. top_theme             (only if !topMechanic)
 *     8c. (no DB) completion_ratio  (yearly + !tasteEvolution — always fires for now)
 *     8d. mood_themes           (yearly + !surprise — always fires for now)
 *     8e. (no DB) reviews drop  (reviewCount === 0)
 *
 * Because tasteEvolution + surprise computation is a stretch goal not
 * implemented in T3, the yearly path always fires the completion_ratio
 * (no DB) + mood_themes (1 DB query) substitutions.
 */

vi.mock("@/lib/db", () => {
  const mockSql = vi.fn();
  return {
    db: { execute: mockSql },
    schema: {},
  };
});

import { db } from "@/lib/db";
import { buildRecap } from "@/lib/recaps/aggregate";
import { yearWindow, monthWindow } from "@/lib/recaps/window";

const mockExecute = vi.mocked(db.execute);

beforeEach(() => {
  mockExecute.mockReset();
});

// Helpers to build a "normal" base aggregator response. Each helper
// returns the rows for a single query.
function countRow(n: number) {
  return [{ count: String(n) }];
}
function totalsRow(o: {
  totalGames?: number;
  totalHours?: string | null;
  completed?: number;
  dropped?: number;
  replaying?: number;
  reviews?: number;
} = {}) {
  return [
    {
      total_games: o.totalGames ?? 15,
      total_hours: o.totalHours ?? "120.5",
      completed: o.completed ?? 8,
      dropped: o.dropped ?? 2,
      replaying: o.replaying ?? 1,
      reviews: o.reviews ?? 4,
    },
  ];
}
const TOP_GAMES_DEFAULT = [
  {
    game_id: "1",
    rawg_id: 100,
    title: "Game A",
    cover_url: "https://example/a.jpg",
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
];
const TOP_GENRE_DEFAULT = [
  { genre: "Action", count: "8" },
  { genre: "RPG", count: "5" },
];
const TOP_MECHANIC_DEFAULT = [{ mechanic: "Roguelite", count: "6" }];
const LONGEST_DEFAULT = [
  {
    game_id: "1",
    title: "Game A",
    cover_url: "https://example/a.jpg",
    rating: "5.0",
    status: "completed",
    hours_played: "45.5",
  },
];
const REVIEW_DEFAULT = [
  {
    review_id: "r-1",
    game_title: "Game A",
    body: "This game owned my year, full stop. Highly recommended.",
  },
];

describe("substitution map", () => {
  it("no longestGame (no Steam playtime) → most_replayed substitutes longest_game", async () => {
    mockExecute
      // base queries
      .mockResolvedValueOnce(countRow(15) as never)
      .mockResolvedValueOnce(totalsRow({ replaying: 3 }) as never)
      .mockResolvedValueOnce(TOP_GAMES_DEFAULT as never)
      .mockResolvedValueOnce(TOP_GENRE_DEFAULT as never)
      .mockResolvedValueOnce(TOP_MECHANIC_DEFAULT as never)
      .mockResolvedValueOnce([] as never) // longest_game empty → triggers substitution
      .mockResolvedValueOnce(REVIEW_DEFAULT as never)
      // T4 substitutions (in order):
      //   most_replayed (longestGame is undefined → fires)
      .mockResolvedValueOnce([
        {
          game_id: "1",
          rawg_id: 100,
          title: "Game A",
          cover_url: "https://example/a.jpg",
          rating: "5.0",
          status: "completed",
          replay_count: "3",
        },
      ] as never)
      //   top_theme (topMechanic present → does NOT fire, no mock needed)
      //   completion_ratio (no DB)
      //   mood_themes (yearly + !surprise → fires)
      .mockResolvedValueOnce([
        { theme: "Open World" },
        { theme: "Story Rich" },
        { theme: "Atmospheric" },
      ] as never);

    const { start, end } = yearWindow(2026);
    const r = await buildRecap({
      userId: "u-1",
      windowStart: start,
      windowEnd: end,
      mode: "yearly",
    });

    expect(r.scenes).toContain("most_replayed");
    expect(r.scenes).not.toContain("longest_game");
    expect(r.mostReplayed?.replayCount).toBe(3);
    expect(r.mostReplayed?.game.title).toBe("Game A");
  });

  it("no longestGame AND no replays → longest_game removed (no substitute)", async () => {
    mockExecute
      .mockResolvedValueOnce(countRow(15) as never)
      .mockResolvedValueOnce(totalsRow() as never)
      .mockResolvedValueOnce(TOP_GAMES_DEFAULT as never)
      .mockResolvedValueOnce(TOP_GENRE_DEFAULT as never)
      .mockResolvedValueOnce(TOP_MECHANIC_DEFAULT as never)
      .mockResolvedValueOnce([] as never) // longest_game empty
      .mockResolvedValueOnce(REVIEW_DEFAULT as never)
      // most_replayed query: empty rows (no replays) → scene removed
      .mockResolvedValueOnce([] as never)
      // mood_themes still fires (yearly)
      .mockResolvedValueOnce([{ theme: "Atmospheric" }] as never);

    const { start, end } = yearWindow(2026);
    const r = await buildRecap({
      userId: "u-1",
      windowStart: start,
      windowEnd: end,
      mode: "yearly",
    });

    expect(r.scenes).not.toContain("longest_game");
    expect(r.scenes).not.toContain("most_replayed");
    expect(r.mostReplayed).toBeUndefined();
  });

  it("no topMechanic (<3 mechanics) → top_theme substitutes mechanic_love", async () => {
    mockExecute
      .mockResolvedValueOnce(countRow(15) as never)
      .mockResolvedValueOnce(totalsRow() as never)
      .mockResolvedValueOnce(TOP_GAMES_DEFAULT as never)
      .mockResolvedValueOnce(TOP_GENRE_DEFAULT as never)
      .mockResolvedValueOnce([] as never) // top_mechanic empty
      .mockResolvedValueOnce(LONGEST_DEFAULT as never)
      .mockResolvedValueOnce(REVIEW_DEFAULT as never)
      // T4: longestGame present → most_replayed does NOT fire
      // top_theme fires (no mechanic)
      .mockResolvedValueOnce([{ theme: "Dark Fantasy", count: "4" }] as never)
      // completion_ratio (no DB)
      // mood_themes fires
      .mockResolvedValueOnce([
        { theme: "Dark Fantasy" },
        { theme: "Atmospheric" },
      ] as never);

    const { start, end } = yearWindow(2026);
    const r = await buildRecap({
      userId: "u-1",
      windowStart: start,
      windowEnd: end,
      mode: "yearly",
    });

    expect(r.scenes).toContain("top_theme");
    expect(r.scenes).not.toContain("mechanic_love");
    expect(r.topTheme?.name).toBe("Dark Fantasy");
  });

  it("no topMechanic AND no themes → mechanic_love removed (no substitute)", async () => {
    mockExecute
      .mockResolvedValueOnce(countRow(15) as never)
      .mockResolvedValueOnce(totalsRow() as never)
      .mockResolvedValueOnce(TOP_GAMES_DEFAULT as never)
      .mockResolvedValueOnce(TOP_GENRE_DEFAULT as never)
      .mockResolvedValueOnce([] as never) // top_mechanic empty
      .mockResolvedValueOnce(LONGEST_DEFAULT as never)
      .mockResolvedValueOnce(REVIEW_DEFAULT as never)
      // top_theme: empty → scene removed
      .mockResolvedValueOnce([] as never)
      // mood_themes still fires
      .mockResolvedValueOnce([] as never);

    const { start, end } = yearWindow(2026);
    const r = await buildRecap({
      userId: "u-1",
      windowStart: start,
      windowEnd: end,
      mode: "yearly",
    });

    expect(r.scenes).not.toContain("mechanic_love");
    expect(r.scenes).not.toContain("top_theme");
    expect(r.topTheme).toBeUndefined();
  });

  it("yearly + !tasteEvolution → completion_ratio substitutes (math only, no DB)", async () => {
    mockExecute
      .mockResolvedValueOnce(countRow(20) as never)
      .mockResolvedValueOnce(
        totalsRow({ totalGames: 20, completed: 10, dropped: 4 }) as never,
      )
      .mockResolvedValueOnce(TOP_GAMES_DEFAULT as never)
      .mockResolvedValueOnce(TOP_GENRE_DEFAULT as never)
      .mockResolvedValueOnce(TOP_MECHANIC_DEFAULT as never)
      .mockResolvedValueOnce(LONGEST_DEFAULT as never)
      .mockResolvedValueOnce(REVIEW_DEFAULT as never)
      // T4: no most_replayed (longest present), no top_theme (mechanic present),
      // completion_ratio fires (no DB), mood_themes fires (DB)
      .mockResolvedValueOnce([{ theme: "Atmospheric" }] as never);

    const { start, end } = yearWindow(2026);
    const r = await buildRecap({
      userId: "u-1",
      windowStart: start,
      windowEnd: end,
      mode: "yearly",
    });

    expect(r.scenes).toContain("completion_ratio");
    expect(r.scenes).not.toContain("taste_evolution");
    expect(r.completionRatio?.completedPct).toBe(50); // 10/20
    expect(r.completionRatio?.droppedPct).toBe(20); // 4/20
  });

  it("yearly + !surprise → mood_themes substitutes surprise", async () => {
    mockExecute
      .mockResolvedValueOnce(countRow(15) as never)
      .mockResolvedValueOnce(totalsRow() as never)
      .mockResolvedValueOnce(TOP_GAMES_DEFAULT as never)
      .mockResolvedValueOnce(TOP_GENRE_DEFAULT as never)
      .mockResolvedValueOnce(TOP_MECHANIC_DEFAULT as never)
      .mockResolvedValueOnce(LONGEST_DEFAULT as never)
      .mockResolvedValueOnce(REVIEW_DEFAULT as never)
      // mood_themes query
      .mockResolvedValueOnce([
        { theme: "Sci-Fi" },
        { theme: "Cyberpunk" },
        { theme: "Story Rich" },
      ] as never);

    const { start, end } = yearWindow(2026);
    const r = await buildRecap({
      userId: "u-1",
      windowStart: start,
      windowEnd: end,
      mode: "yearly",
    });

    expect(r.scenes).toContain("mood_themes");
    expect(r.scenes).not.toContain("surprise");
    expect(r.moodThemes?.themes).toEqual(["Sci-Fi", "Cyberpunk", "Story Rich"]);
  });

  it("yearly + !surprise + no themes anywhere → surprise removed (no substitute)", async () => {
    mockExecute
      .mockResolvedValueOnce(countRow(15) as never)
      .mockResolvedValueOnce(totalsRow() as never)
      .mockResolvedValueOnce(TOP_GAMES_DEFAULT as never)
      .mockResolvedValueOnce(TOP_GENRE_DEFAULT as never)
      .mockResolvedValueOnce(TOP_MECHANIC_DEFAULT as never)
      .mockResolvedValueOnce(LONGEST_DEFAULT as never)
      .mockResolvedValueOnce(REVIEW_DEFAULT as never)
      // mood_themes query: empty
      .mockResolvedValueOnce([] as never);

    const { start, end } = yearWindow(2026);
    const r = await buildRecap({
      userId: "u-1",
      windowStart: start,
      windowEnd: end,
      mode: "yearly",
    });

    expect(r.scenes).not.toContain("surprise");
    expect(r.scenes).not.toContain("mood_themes");
    expect(r.moodThemes).toBeUndefined();
  });

  it("0 reviews → reviews scene removed (no substitute)", async () => {
    mockExecute
      .mockResolvedValueOnce(countRow(15) as never)
      .mockResolvedValueOnce(totalsRow({ reviews: 0 }) as never)
      .mockResolvedValueOnce(TOP_GAMES_DEFAULT as never)
      .mockResolvedValueOnce(TOP_GENRE_DEFAULT as never)
      .mockResolvedValueOnce(TOP_MECHANIC_DEFAULT as never)
      .mockResolvedValueOnce(LONGEST_DEFAULT as never)
      .mockResolvedValueOnce([] as never) // no review found
      // mood_themes still fires
      .mockResolvedValueOnce([{ theme: "Atmospheric" }] as never);

    const { start, end } = yearWindow(2026);
    const r = await buildRecap({
      userId: "u-1",
      windowStart: start,
      windowEnd: end,
      mode: "yearly",
    });

    expect(r.scenes).not.toContain("reviews");
    expect(r.totals.reviewCount).toBe(0);
  });

  it("monthly mode + 0 reviews is a no-op (reviews already filtered out as yearOnly)", async () => {
    mockExecute
      .mockResolvedValueOnce(countRow(12) as never)
      .mockResolvedValueOnce(totalsRow({ reviews: 0 }) as never)
      .mockResolvedValueOnce(TOP_GAMES_DEFAULT as never)
      .mockResolvedValueOnce(TOP_GENRE_DEFAULT as never)
      .mockResolvedValueOnce(TOP_MECHANIC_DEFAULT as never)
      .mockResolvedValueOnce(LONGEST_DEFAULT as never)
      .mockResolvedValueOnce([] as never);
    // No T4 DB queries fire in monthly mode (no most_replayed needed because
    // longestGame present; no top_theme needed because topMechanic present;
    // surprise + taste_evolution scenes are filtered out as yearOnly).

    const { start, end } = monthWindow(2026, 3);
    const r = await buildRecap({
      userId: "u-1",
      windowStart: start,
      windowEnd: end,
      mode: "monthly",
    });

    expect(r.scenes).not.toContain("reviews");
    expect(r.scenes).not.toContain("surprise");
    expect(r.scenes).not.toContain("taste_evolution");
    expect(r.scenes).not.toContain("mood_themes");
    expect(r.scenes).not.toContain("completion_ratio");
  });

  it("yearly scene count floor: ≥10 logs yields ≥8 scenes even with maximum substitutions", async () => {
    // Worst case: longest empty, mechanic empty, taste/surprise always undefined,
    // 0 reviews → reviews scene drops. Every other scene present.
    // The replay/theme/mood substitutes must fire (with data) to keep scene
    // count high; if they DON'T fire (no data), scenes drop without replacement.
    mockExecute
      .mockResolvedValueOnce(countRow(15) as never)
      .mockResolvedValueOnce(totalsRow({ reviews: 0 }) as never)
      .mockResolvedValueOnce(TOP_GAMES_DEFAULT as never)
      .mockResolvedValueOnce(TOP_GENRE_DEFAULT as never)
      .mockResolvedValueOnce([] as never) // no mechanic
      .mockResolvedValueOnce([] as never) // no longest
      .mockResolvedValueOnce([] as never) // no review
      // T4 substitutes — each with data so they fire:
      .mockResolvedValueOnce([
        {
          game_id: "1",
          rawg_id: 100,
          title: "Game A",
          cover_url: "https://example/a.jpg",
          rating: "5.0",
          status: "completed",
          replay_count: "2",
        },
      ] as never)
      .mockResolvedValueOnce([{ theme: "Cyberpunk", count: "5" }] as never)
      .mockResolvedValueOnce([{ theme: "Cyberpunk" }, { theme: "Atmospheric" }] as never);

    const { start, end } = yearWindow(2026);
    const r = await buildRecap({
      userId: "u-1",
      windowStart: start,
      windowEnd: end,
      mode: "yearly",
    });

    // 11 base scenes (yearly) − 1 (reviews drop) = 10 minimum.
    // Each of {most_replayed, top_theme, completion_ratio, mood_themes}
    // REPLACES rather than removes when its substitute has data, so total
    // stays at 10.
    expect(r.scenes.length).toBeGreaterThanOrEqual(8);
    expect(r.scenes.length).toBe(10); // tighter assertion: confirms exact count
  });

  it("monthly scene count floor: ≥10 logs in monthly window yields ≥6 scenes", async () => {
    // Monthly base = 7 scenes (yearly 11 − 4 yearOnly).
    // 0 reviews subs out reviews? No — reviews is yearOnly too. So in
    // monthly, the only sub paths that fire are most_replayed + top_theme.
    mockExecute
      .mockResolvedValueOnce(countRow(12) as never)
      .mockResolvedValueOnce(totalsRow({ reviews: 0 }) as never)
      .mockResolvedValueOnce(TOP_GAMES_DEFAULT as never)
      .mockResolvedValueOnce(TOP_GENRE_DEFAULT as never)
      .mockResolvedValueOnce([] as never) // no mechanic → top_theme sub
      .mockResolvedValueOnce([] as never) // no longest → most_replayed sub
      .mockResolvedValueOnce([] as never) // no review
      // T4: most_replayed
      .mockResolvedValueOnce([
        {
          game_id: "1",
          rawg_id: 100,
          title: "Game A",
          cover_url: "https://example/a.jpg",
          rating: "5.0",
          status: "completed",
          replay_count: "2",
        },
      ] as never)
      // top_theme
      .mockResolvedValueOnce([{ theme: "Cyberpunk", count: "5" }] as never);

    const { start, end } = monthWindow(2026, 3);
    const r = await buildRecap({
      userId: "u-1",
      windowStart: start,
      windowEnd: end,
      mode: "monthly",
    });

    // Monthly has 7 base scenes (no surprise/taste/mood/reviews — all yearOnly).
    expect(r.scenes.length).toBeGreaterThanOrEqual(6);
    expect(r.scenes).toContain("most_replayed");
    expect(r.scenes).toContain("top_theme");
  });

  it("goty === topGames[0] reference identity preserved after substitution", async () => {
    mockExecute
      .mockResolvedValueOnce(countRow(15) as never)
      .mockResolvedValueOnce(totalsRow() as never)
      .mockResolvedValueOnce(TOP_GAMES_DEFAULT as never)
      .mockResolvedValueOnce(TOP_GENRE_DEFAULT as never)
      .mockResolvedValueOnce(TOP_MECHANIC_DEFAULT as never)
      .mockResolvedValueOnce(LONGEST_DEFAULT as never)
      .mockResolvedValueOnce(REVIEW_DEFAULT as never)
      // mood_themes (yearly substitution always fires)
      .mockResolvedValueOnce([{ theme: "Atmospheric" }] as never);

    const { start, end } = yearWindow(2026);
    const r = await buildRecap({
      userId: "u-1",
      windowStart: start,
      windowEnd: end,
      mode: "yearly",
    });

    expect(r.goty).toBe(r.topGames[0]);
  });
});
