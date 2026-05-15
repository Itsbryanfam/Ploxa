/**
 * og.test.tsx — Phase 6 T15.
 *
 * Pure-unit tests for the `RecapOgCard` JSX builder in `lib/recaps/og/card.tsx`.
 * We test the builder as a pure function using `renderToStaticMarkup`, the same
 * pattern used by `scenes-ai.test.tsx` (T14) and `scenes-data.test.tsx` (T13).
 *
 * We do NOT test the route handlers directly — those require the Next.js runtime
 * (ImageResponse / next/og) and live DB connections. The builder is the logic
 * surface; the routes are thin integration wrappers.
 *
 * Assertions:
 *   - Summary card renders goty title + stats
 *   - Each scene-id branch renders identifying content
 *   - Footer URL + "Ploxa" wordmark always present
 *   - No emoji codepoints (project memory rule)
 *   - No exclamation marks (calm copy rule)
 *   - Sparse-tier renders "Not enough data yet"
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { RecapOgCard } from "@/lib/recaps/og/card";
import type { RecapPayload, TopGameRef } from "@/lib/recaps/types";

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────

const sampleGame: TopGameRef = {
  gameId: "g1",
  rawgId: 1,
  title: "Hades II",
  coverUrl: "https://example.com/hades.jpg",
  rating: 5,
  status: "completed",
};

const sampleGame2: TopGameRef = {
  gameId: "g2",
  rawgId: 2,
  title: "Balatro",
  coverUrl: "https://example.com/balatro.jpg",
  rating: 4.5,
  status: "completed",
};

function buildPayload(overrides: Partial<RecapPayload> = {}): RecapPayload {
  return {
    tier: "ok",
    mode: "yearly",
    windowStart: "2026-01-01T00:00:00.000Z",
    windowEnd: "2027-01-01T00:00:00.000Z",
    scenes: [
      "opening",
      "stats_total",
      "top_games",
      "goty",
      "genre_dominance",
      "mechanic_love",
      "surprise",
      "taste_evolution",
      "longest_game",
      "reviews",
      "closing",
    ],
    totals: {
      totalGames: 47,
      totalHoursPlayed: 120,
      completedCount: 30,
      droppedCount: 5,
      replayingCount: 2,
      reviewCount: 4,
    },
    topGames: [sampleGame, sampleGame2],
    goty: sampleGame,
    topGenre: { name: "Action", pct: 42, secondName: "RPG", secondPct: 24 },
    topMechanic: { name: "Roguelite progression" },
    surprise: {
      game: sampleGame2,
      surpriseGenre: "Card battler",
      baselineAvg: 3.2,
    },
    tasteEvolution: { q1Vibe: "Comfort RPGs", q4Vibe: "Tense roguelikes" },
    completionRatio: { completedPct: 64, droppedPct: 11 },
    moodThemes: { themes: ["Atmospheric", "Story-rich", "Indie"] },
    longestGame: { game: sampleGame, hoursPlayed: 45.5 },
    mostReplayed: { game: sampleGame, replayCount: 3 },
    topTheme: { name: "Dark Fantasy" },
    captions: {},
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────
// Shared assertion helpers
// ─────────────────────────────────────────────────────────────

function expectNoExclamation(html: string) {
  expect(html).not.toMatch(/!/);
}

function expectNoEmoji(html: string) {
  expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  expect(html).not.toMatch(/[\u{1F600}-\u{1F64F}]/u);
  expect(html).not.toMatch(/[\u{2600}-\u{27BF}]/u);
}

function expectFooter(html: string, suffix: string) {
  expect(html).toContain(`ploxa.vercel.app/u/alice/${suffix}`);
  expect(html).toContain("Ploxa");
}

// ─────────────────────────────────────────────────────────────
// Summary card
// ─────────────────────────────────────────────────────────────

describe("RecapOgCard — summary (no sceneIndex)", () => {
  it("renders the goty title in the summary card", () => {
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={buildPayload()}
        username="alice"
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain("Hades II");
  });

  it("renders the stats tiles (games logged, top genre, hours played)", () => {
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={buildPayload()}
        username="alice"
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain("47");
    expect(html).toContain("Games logged");
    expect(html).toContain("Action");
    expect(html).toContain("Top genre");
    expect(html).toContain("120h");
    expect(html).toContain("Hours played");
  });

  it("falls back to game count when goty is absent", () => {
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={buildPayload({ goty: undefined })}
        username="alice"
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain("47 games");
  });

  it("renders footer URL and Ploxa wordmark", () => {
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={buildPayload()}
        username="alice"
        urlSuffix="year/2026"
      />,
    );
    expectFooter(html, "year/2026");
  });

  it("renders footer with monthly urlSuffix", () => {
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={buildPayload({ mode: "monthly" })}
        username="alice"
        urlSuffix="month/202605"
      />,
    );
    expectFooter(html, "month/202605");
  });

  it("emits no exclamation marks", () => {
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={buildPayload()}
        username="alice"
        urlSuffix="year/2026"
      />,
    );
    expectNoExclamation(html);
  });

  it("emits no emoji codepoints", () => {
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={buildPayload()}
        username="alice"
        urlSuffix="year/2026"
      />,
    );
    expectNoEmoji(html);
  });
});

// ─────────────────────────────────────────────────────────────
// Sparse-tier card
// ─────────────────────────────────────────────────────────────

describe("RecapOgCard — sparse tier", () => {
  it("renders 'Not enough data yet' for too_sparse payload", () => {
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={buildPayload({ tier: "too_sparse", scenes: [] })}
        username="alice"
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain("Not enough data yet");
  });

  it("still renders the footer on sparse card", () => {
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={buildPayload({ tier: "too_sparse", scenes: [] })}
        username="alice"
        urlSuffix="year/2026"
      />,
    );
    expectFooter(html, "year/2026");
  });

  it("emits no exclamation marks on sparse card", () => {
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={buildPayload({ tier: "too_sparse", scenes: [] })}
        username="alice"
        urlSuffix="year/2026"
      />,
    );
    expectNoExclamation(html);
  });
});

// ─────────────────────────────────────────────────────────────
// Per-scene: opening / stats_total / closing (big number)
// ─────────────────────────────────────────────────────────────

describe("RecapOgCard — scene: opening", () => {
  it("renders the total game count", () => {
    const payload = buildPayload();
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={payload.scenes.indexOf("opening")}
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain("47");
  });

  it("renders footer", () => {
    const payload = buildPayload();
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={payload.scenes.indexOf("opening")}
        urlSuffix="year/2026"
      />,
    );
    expectFooter(html, "year/2026");
  });

  it("emits no exclamation marks", () => {
    const payload = buildPayload();
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={payload.scenes.indexOf("opening")}
        urlSuffix="year/2026"
      />,
    );
    expectNoExclamation(html);
  });
});

describe("RecapOgCard — scene: stats_total", () => {
  it("renders the total game count", () => {
    const payload = buildPayload();
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={payload.scenes.indexOf("stats_total")}
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain("47");
  });
});

describe("RecapOgCard — scene: closing", () => {
  it("renders the game count and 'your yearly' label", () => {
    const payload = buildPayload();
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={payload.scenes.indexOf("closing")}
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain("47");
    expect(html).toContain("year");
  });

  it("says 'month' for monthly mode", () => {
    const payload = buildPayload({
      mode: "monthly",
      scenes: ["opening", "stats_total", "closing"],
    });
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={payload.scenes.indexOf("closing")}
        urlSuffix="month/202605"
      />,
    );
    expect(html).toContain("month");
  });
});

// ─────────────────────────────────────────────────────────────
// Per-scene: top_games
// ─────────────────────────────────────────────────────────────

describe("RecapOgCard — scene: top_games", () => {
  it("renders the 'Your top games' section label", () => {
    const payload = buildPayload();
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={payload.scenes.indexOf("top_games")}
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain("Your top games");
  });

  it("renders cover images", () => {
    const payload = buildPayload();
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={payload.scenes.indexOf("top_games")}
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain("https://example.com/hades.jpg");
  });

  it("renders footer", () => {
    const payload = buildPayload();
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={payload.scenes.indexOf("top_games")}
        urlSuffix="year/2026"
      />,
    );
    expectFooter(html, "year/2026");
  });
});

// ─────────────────────────────────────────────────────────────
// Per-scene: goty
// ─────────────────────────────────────────────────────────────

describe("RecapOgCard — scene: goty", () => {
  it("renders goty title and rating", () => {
    const payload = buildPayload();
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={payload.scenes.indexOf("goty")}
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain("Hades II");
    expect(html).toContain("5/5");
  });

  it("renders cover image when present", () => {
    const payload = buildPayload();
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={payload.scenes.indexOf("goty")}
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain("https://example.com/hades.jpg");
  });

  it("renders fallback when goty is absent", () => {
    const payload = buildPayload({ goty: undefined });
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={payload.scenes.indexOf("goty")}
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain("Top-rated game");
  });

  it("emits no exclamation marks", () => {
    const payload = buildPayload();
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={payload.scenes.indexOf("goty")}
        urlSuffix="year/2026"
      />,
    );
    expectNoExclamation(html);
  });
});

// ─────────────────────────────────────────────────────────────
// Per-scene: genre_dominance
// ─────────────────────────────────────────────────────────────

describe("RecapOgCard — scene: genre_dominance", () => {
  it("renders genre name and flat percent label", () => {
    const payload = buildPayload();
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={payload.scenes.indexOf("genre_dominance")}
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain("Action");
    expect(html).toContain("42%");
  });

  it("renders fallback when topGenre is absent", () => {
    const payload = buildPayload({ topGenre: undefined });
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={payload.scenes.indexOf("genre_dominance")}
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain("Balanced tastes");
  });

  it("emits no exclamation marks", () => {
    const payload = buildPayload();
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={payload.scenes.indexOf("genre_dominance")}
        urlSuffix="year/2026"
      />,
    );
    expectNoExclamation(html);
  });
});

// ─────────────────────────────────────────────────────────────
// Per-scene: mechanic_love
// ─────────────────────────────────────────────────────────────

describe("RecapOgCard — scene: mechanic_love", () => {
  it("renders mechanic name", () => {
    const payload = buildPayload();
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={payload.scenes.indexOf("mechanic_love")}
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain("Roguelite progression");
  });

  it("renders fallback when topMechanic is absent", () => {
    const payload = buildPayload({ topMechanic: undefined });
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={payload.scenes.indexOf("mechanic_love")}
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain("Many mechanics");
  });
});

// ─────────────────────────────────────────────────────────────
// Per-scene: surprise
// ─────────────────────────────────────────────────────────────

describe("RecapOgCard — scene: surprise", () => {
  it("renders surprise game title and genre", () => {
    const payload = buildPayload();
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={payload.scenes.indexOf("surprise")}
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain("Balatro");
    expect(html).toContain("Card battler");
  });

  it("renders baseline avg rating", () => {
    const payload = buildPayload();
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={payload.scenes.indexOf("surprise")}
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain("3.2/5");
  });

  it("renders fallback when surprise is absent", () => {
    const payload = buildPayload({ surprise: undefined });
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={payload.scenes.indexOf("surprise")}
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain("No standout surprises");
  });

  it("emits no exclamation marks", () => {
    const payload = buildPayload();
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={payload.scenes.indexOf("surprise")}
        urlSuffix="year/2026"
      />,
    );
    expectNoExclamation(html);
  });
});

// ─────────────────────────────────────────────────────────────
// Per-scene: taste_evolution
// ─────────────────────────────────────────────────────────────

describe("RecapOgCard — scene: taste_evolution", () => {
  it("renders Q1 and Q4 vibe labels", () => {
    const payload = buildPayload();
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={payload.scenes.indexOf("taste_evolution")}
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain("Comfort RPGs");
    expect(html).toContain("Tense roguelikes");
    expect(html).toContain("Q1");
    expect(html).toContain("Q4");
  });

  it("renders fallback when tasteEvolution is absent", () => {
    const payload = buildPayload({ tasteEvolution: undefined });
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={payload.scenes.indexOf("taste_evolution")}
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain("Steady taste");
  });
});

// ─────────────────────────────────────────────────────────────
// Per-scene: longest_game
// ─────────────────────────────────────────────────────────────

describe("RecapOgCard — scene: longest_game", () => {
  it("renders game title and hours", () => {
    const payload = buildPayload();
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={payload.scenes.indexOf("longest_game")}
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain("Hades II");
    expect(html).toContain("45.5h");
  });

  it("renders fallback when longestGame is absent", () => {
    const payload = buildPayload({ longestGame: undefined });
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={payload.scenes.indexOf("longest_game")}
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain("Brief sessions");
  });
});

// ─────────────────────────────────────────────────────────────
// Per-scene: most_replayed (substitute)
// ─────────────────────────────────────────────────────────────

describe("RecapOgCard — scene: most_replayed", () => {
  it("renders game title and replay count with plural label", () => {
    const payload = buildPayload({
      scenes: [...buildPayload().scenes, "most_replayed"],
    });
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={payload.scenes.indexOf("most_replayed")}
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain("Hades II");
    expect(html).toContain("3");
    expect(html).toContain("times replayed");
  });

  it("uses singular label when replayCount === 1", () => {
    const payload = buildPayload({
      scenes: ["most_replayed"],
      mostReplayed: { game: sampleGame, replayCount: 1 },
    });
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={0}
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain("time replayed");
    expect(html).not.toMatch(/\b1 times replayed\b/);
  });

  it("renders fallback when mostReplayed is absent", () => {
    const payload = buildPayload({
      scenes: ["most_replayed"],
      mostReplayed: undefined,
    });
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={0}
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain("No standout replays");
  });
});

// ─────────────────────────────────────────────────────────────
// Per-scene: top_theme (substitute)
// ─────────────────────────────────────────────────────────────

describe("RecapOgCard — scene: top_theme", () => {
  it("renders theme name in big type", () => {
    const payload = buildPayload({ scenes: ["top_theme"] });
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={0}
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain("Dark Fantasy");
  });

  it("renders fallback when topTheme is absent", () => {
    const payload = buildPayload({ scenes: ["top_theme"], topTheme: undefined });
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={0}
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain("Eclectic taste");
  });
});

// ─────────────────────────────────────────────────────────────
// Per-scene: completion_ratio (substitute)
// ─────────────────────────────────────────────────────────────

describe("RecapOgCard — scene: completion_ratio", () => {
  it("renders completed and dropped percentages", () => {
    const payload = buildPayload({ scenes: ["completion_ratio"] });
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={0}
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain("64%");
    expect(html).toContain("11%");
    expect(html).toContain("Completed");
    expect(html).toContain("Dropped");
  });

  it("renders fallback when completionRatio is absent", () => {
    const payload = buildPayload({
      scenes: ["completion_ratio"],
      completionRatio: undefined,
    });
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={0}
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain("hard to pin down");
  });
});

// ─────────────────────────────────────────────────────────────
// Per-scene: mood_themes (substitute)
// ─────────────────────────────────────────────────────────────

describe("RecapOgCard — scene: mood_themes", () => {
  it("renders up to 3 mood theme names", () => {
    const payload = buildPayload({ scenes: ["mood_themes"] });
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={0}
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain("Atmospheric");
    expect(html).toContain("Story-rich");
    expect(html).toContain("Indie");
  });

  it("caps at 3 themes", () => {
    const payload = buildPayload({
      scenes: ["mood_themes"],
      moodThemes: { themes: ["A", "B", "C", "D", "E"] },
    });
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={0}
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain(">A<");
    expect(html).toContain(">B<");
    expect(html).toContain(">C<");
    expect(html).not.toContain(">D<");
    expect(html).not.toContain(">E<");
  });

  it("renders fallback when moodThemes is absent", () => {
    const payload = buildPayload({
      scenes: ["mood_themes"],
      moodThemes: undefined,
    });
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={0}
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain("Many moods");
  });

  it("emits no emoji codepoints", () => {
    const payload = buildPayload({ scenes: ["mood_themes"] });
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={0}
        urlSuffix="year/2026"
      />,
    );
    expectNoEmoji(html);
  });
});

// ─────────────────────────────────────────────────────────────
// Per-scene: reviews
// ─────────────────────────────────────────────────────────────

describe("RecapOgCard — scene: reviews", () => {
  it("renders review count", () => {
    const payload = buildPayload();
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={payload.scenes.indexOf("reviews")}
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain("4");
    expect(html).toContain("reviews written");
  });

  it("uses singular when reviewCount === 1", () => {
    const payload = buildPayload({
      totals: {
        totalGames: 10,
        totalHoursPlayed: null,
        completedCount: 5,
        droppedCount: 1,
        replayingCount: 0,
        reviewCount: 1,
      },
    });
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={payload.scenes.indexOf("reviews")}
        urlSuffix="year/2026"
      />,
    );
    expect(html).toContain("review written");
    expect(html).not.toMatch(/\b1 reviews written\b/);
  });
});

// ─────────────────────────────────────────────────────────────
// Footer always present — across multiple scene types
// ─────────────────────────────────────────────────────────────

describe("Footer always present", () => {
  const scenes: Array<{ sceneId: string; sceneIndex: number }> = [
    { sceneId: "opening", sceneIndex: 0 },
    { sceneId: "goty", sceneIndex: 3 },
    { sceneId: "genre_dominance", sceneIndex: 4 },
    { sceneId: "mechanic_love", sceneIndex: 5 },
    { sceneId: "surprise", sceneIndex: 6 },
    { sceneId: "taste_evolution", sceneIndex: 7 },
    { sceneId: "longest_game", sceneIndex: 8 },
    { sceneId: "reviews", sceneIndex: 9 },
    { sceneId: "closing", sceneIndex: 10 },
  ];

  for (const { sceneId, sceneIndex } of scenes) {
    it(`footer present on scene=${sceneId}`, () => {
      const payload = buildPayload();
      const html = renderToStaticMarkup(
        <RecapOgCard
          payload={payload}
          username="alice"
          sceneIndex={sceneIndex}
          urlSuffix="year/2026"
        />,
      );
      expectFooter(html, "year/2026");
    });
  }
});

// ─────────────────────────────────────────────────────────────
// Out-of-range sceneIndex falls back to summary card
// ─────────────────────────────────────────────────────────────

describe("RecapOgCard — out-of-range sceneIndex", () => {
  it("falls back to summary card when sceneIndex exceeds scenes.length", () => {
    const payload = buildPayload();
    const html = renderToStaticMarkup(
      <RecapOgCard
        payload={payload}
        username="alice"
        sceneIndex={999}
        urlSuffix="year/2026"
      />,
    );
    // Summary card shows the top game cover and stats tiles.
    expect(html).toContain("Hades II");
    expect(html).toContain("Games logged");
  });
});

// ─────────────────────────────────────────────────────────────
// Calm copy across all scenes
// ─────────────────────────────────────────────────────────────

describe("Calm copy — no exclamation marks on any scene", () => {
  const allSceneIds = [
    "opening",
    "stats_total",
    "top_games",
    "goty",
    "genre_dominance",
    "mechanic_love",
    "surprise",
    "taste_evolution",
    "longest_game",
    "reviews",
    "closing",
  ] as const;

  for (const sid of allSceneIds) {
    it(`no exclamation mark on scene=${sid}`, () => {
      const payload = buildPayload();
      const idx = payload.scenes.indexOf(sid);
      const html = renderToStaticMarkup(
        <RecapOgCard
          payload={payload}
          username="alice"
          sceneIndex={idx}
          urlSuffix="year/2026"
        />,
      );
      expectNoExclamation(html);
    });
  }
});
