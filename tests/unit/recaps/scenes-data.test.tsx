import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { LongestGameScene } from "@/components/recaps/scenes/LongestGameScene";
import { OpeningScene } from "@/components/recaps/scenes/OpeningScene";
import { ReviewsScene } from "@/components/recaps/scenes/ReviewsScene";
import { StatsTotalScene } from "@/components/recaps/scenes/StatsTotalScene";
import { TopGamesScene } from "@/components/recaps/scenes/TopGamesScene";
import type { RecapPayload, TopGameRef } from "@/lib/recaps/types";

/**
 * scenes-data.test.tsx — Phase 6 T13.
 *
 * Static-markup tests for the five non-AI data scene components. Same
 * `react-dom/server.renderToStaticMarkup` style as the other T9/T10
 * recap tests — Node environment, no DOM, no Testing Library dep.
 *
 * Each scene gets:
 *  - data appears: the key fields (counts, titles, hours) render
 *  - caption appears: the caption prop always renders into the markup
 *  - no exclamation marks: project memory rule (calm copy)
 *  - no emoji codepoints: project memory rule (custom assets, no emojis)
 *
 * Framer Motion's `motion.div` renders as a plain `<div>` in
 * server-side static markup (no animation runtime present), so the
 * markup is the same final-state HTML the browser would settle on.
 */

const sampleGames: TopGameRef[] = [
  {
    gameId: "g1",
    rawgId: 1,
    title: "Hades II",
    coverUrl: "https://example.com/hades.jpg",
    rating: 5,
    status: "completed",
  },
  {
    gameId: "g2",
    rawgId: 2,
    title: "Balatro",
    coverUrl: "https://example.com/balatro.jpg",
    rating: 4.5,
    status: "completed",
  },
  {
    gameId: "g3",
    rawgId: null,
    title: "Manor Lords",
    coverUrl: null, // null cover → placeholder branch
    rating: 4,
    status: "playing",
  },
  {
    gameId: "g4",
    rawgId: 4,
    title: "Dragon's Dogma 2",
    coverUrl: "https://example.com/dd2.jpg",
    rating: 4,
    status: "completed",
  },
  {
    gameId: "g5",
    rawgId: 5,
    title: "Helldivers 2",
    coverUrl: "https://example.com/helldivers.jpg",
    rating: 3.5,
    status: "playing",
  },
];

function buildPayload(overrides: Partial<RecapPayload> = {}): RecapPayload {
  return {
    tier: "ok",
    mode: "yearly",
    windowStart: "2026-01-01T00:00:00.000Z",
    windowEnd: "2027-01-01T00:00:00.000Z",
    scenes: ["opening", "stats_total", "top_games", "longest_game", "reviews"],
    totals: {
      totalGames: 47,
      totalHoursPlayed: 120,
      completedCount: 30,
      droppedCount: 5,
      replayingCount: 2,
      reviewCount: 4,
    },
    topGames: sampleGames,
    goty: sampleGames[0],
    longestGame: { game: sampleGames[0], hoursPlayed: 45.5 },
    favoriteReviewSnippet: {
      reviewId: "r1",
      gameTitle: "Hades II",
      snippet: "Owned my year.",
    },
    captions: {},
    ...overrides,
  };
}

// Shared assertion helpers: every scene must satisfy the calm-copy and
// no-emoji rules with the test captions we pass in.
function expectNoExclamation(html: string) {
  expect(html).not.toMatch(/!/);
}
function expectNoEmoji(html: string) {
  expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  expect(html).not.toMatch(/[\u{1F600}-\u{1F64F}]/u);
  expect(html).not.toMatch(/[\u{2600}-\u{27BF}]/u);
}

// =======================================================================
// OpeningScene
// =======================================================================

describe("OpeningScene", () => {
  it("renders the caption text", () => {
    const html = renderToStaticMarkup(
      <OpeningScene
        payload={buildPayload()}
        caption="Welcome to your year in games."
        isActive
      />,
    );
    expect(html).toContain("Welcome to your year in games.");
  });

  it("renders the year for yearly mode", () => {
    const html = renderToStaticMarkup(
      <OpeningScene
        payload={buildPayload()}
        caption="A look back."
        isActive
      />,
    );
    expect(html).toContain("2026");
  });

  it("renders month + year for monthly mode", () => {
    const html = renderToStaticMarkup(
      <OpeningScene
        payload={buildPayload({
          mode: "monthly",
          windowStart: "2026-05-01T00:00:00.000Z",
          windowEnd: "2026-06-01T00:00:00.000Z",
        })}
        caption="A look back."
        isActive
      />,
    );
    expect(html).toContain("May 2026");
  });

  it("renders the mascot wrapper (sprite path)", () => {
    const html = renderToStaticMarkup(
      <OpeningScene payload={buildPayload()} caption="x" isActive />,
    );
    // Mascot renders next/image with src=/mascot/waving.png in markup.
    expect(html).toContain("/mascot/waving.png");
  });

  it("emits no exclamation marks", () => {
    const html = renderToStaticMarkup(
      <OpeningScene
        payload={buildPayload()}
        caption="A calm and observational opening."
        isActive
      />,
    );
    expectNoExclamation(html);
  });

  it("emits no emoji codepoints", () => {
    const html = renderToStaticMarkup(
      <OpeningScene
        payload={buildPayload()}
        caption="A look back at the year."
        isActive
      />,
    );
    expectNoEmoji(html);
  });
});

// =======================================================================
// StatsTotalScene
// =======================================================================

describe("StatsTotalScene", () => {
  it("renders the total games count", () => {
    const html = renderToStaticMarkup(
      <StatsTotalScene
        payload={buildPayload()}
        caption="Solid year of play."
        isActive
      />,
    );
    expect(html).toContain("47");
    expect(html).toContain("games logged");
  });

  it("renders the hours played count", () => {
    const html = renderToStaticMarkup(
      <StatsTotalScene
        payload={buildPayload()}
        caption="x"
        isActive
      />,
    );
    expect(html).toContain("120");
    expect(html).toContain("hours played");
  });

  it("renders an em-dash when totalHoursPlayed is null", () => {
    const html = renderToStaticMarkup(
      <StatsTotalScene
        payload={buildPayload({
          totals: {
            totalGames: 47,
            totalHoursPlayed: null,
            completedCount: 30,
            droppedCount: 5,
            replayingCount: 2,
            reviewCount: 4,
          },
        })}
        caption="x"
        isActive
      />,
    );
    expect(html).toContain("—");
  });

  it("renders the completed count", () => {
    const html = renderToStaticMarkup(
      <StatsTotalScene
        payload={buildPayload()}
        caption="x"
        isActive
      />,
    );
    expect(html).toContain("30");
    expect(html).toContain("completed");
  });

  it("uses singular 'game logged' when totalGames === 1", () => {
    const html = renderToStaticMarkup(
      <StatsTotalScene
        payload={buildPayload({
          totals: {
            totalGames: 1,
            totalHoursPlayed: 5,
            completedCount: 1,
            droppedCount: 0,
            replayingCount: 0,
            reviewCount: 0,
          },
        })}
        caption="A quiet year."
        isActive
      />,
    );
    expect(html).toContain("game logged");
    expect(html).not.toMatch(/\b1 games logged\b/);
  });

  it("renders the caption", () => {
    const html = renderToStaticMarkup(
      <StatsTotalScene
        payload={buildPayload()}
        caption="A solid stretch of play."
        isActive
      />,
    );
    expect(html).toContain("A solid stretch of play.");
  });

  it("emits no exclamation marks", () => {
    const html = renderToStaticMarkup(
      <StatsTotalScene
        payload={buildPayload()}
        caption="Calm summary copy."
        isActive
      />,
    );
    expectNoExclamation(html);
  });

  it("emits no emoji codepoints", () => {
    const html = renderToStaticMarkup(
      <StatsTotalScene
        payload={buildPayload()}
        caption="A look at the totals."
        isActive
      />,
    );
    expectNoEmoji(html);
  });
});

// =======================================================================
// TopGamesScene
// =======================================================================

describe("TopGamesScene", () => {
  it("renders up to 5 game titles for yearly mode", () => {
    const html = renderToStaticMarkup(
      <TopGamesScene
        payload={buildPayload()}
        caption="The best of your year."
        isActive
      />,
    );
    expect(html).toContain("Hades II");
    expect(html).toContain("Balatro");
    expect(html).toContain("Manor Lords");
    expect(html).toContain("Dragon&#x27;s Dogma 2");
    expect(html).toContain("Helldivers 2");
  });

  it("caps at 3 games for monthly mode", () => {
    const html = renderToStaticMarkup(
      <TopGamesScene
        payload={buildPayload({ mode: "monthly" })}
        caption="x"
        isActive
      />,
    );
    expect(html).toContain("Hades II");
    expect(html).toContain("Balatro");
    expect(html).toContain("Manor Lords");
    // 4th + 5th should be clipped under monthly mode.
    expect(html).not.toContain("Dragon&#x27;s Dogma 2");
    expect(html).not.toContain("Helldivers 2");
  });

  it("renders the rating chip for each game", () => {
    const html = renderToStaticMarkup(
      <TopGamesScene
        payload={buildPayload()}
        caption="x"
        isActive
      />,
    );
    expect(html).toContain("5/5");
    expect(html).toContain("4.5/5");
  });

  it("renders a placeholder div instead of <img> when coverUrl is null", () => {
    const html = renderToStaticMarkup(
      <TopGamesScene
        payload={buildPayload({
          topGames: [
            { ...sampleGames[0], coverUrl: null },
            { ...sampleGames[1], coverUrl: null },
          ],
        })}
        caption="x"
        isActive
      />,
    );
    // No real <img> tags expected because both games have null covers.
    expect(html).not.toMatch(/<img\b/);
  });

  it("uses real <img> tags for games with a coverUrl", () => {
    const html = renderToStaticMarkup(
      <TopGamesScene
        payload={buildPayload({
          topGames: [sampleGames[0], sampleGames[1]],
        })}
        caption="x"
        isActive
      />,
    );
    expect(html).toContain('src="https://example.com/hades.jpg"');
    expect(html).toContain('src="https://example.com/balatro.jpg"');
  });

  it("renders the caption", () => {
    const html = renderToStaticMarkup(
      <TopGamesScene
        payload={buildPayload()}
        caption="The top picks of your year."
        isActive
      />,
    );
    expect(html).toContain("The top picks of your year.");
  });

  it("emits no exclamation marks", () => {
    const html = renderToStaticMarkup(
      <TopGamesScene
        payload={buildPayload()}
        caption="Calm top-5 copy."
        isActive
      />,
    );
    expectNoExclamation(html);
  });

  it("emits no emoji codepoints", () => {
    const html = renderToStaticMarkup(
      <TopGamesScene
        payload={buildPayload()}
        caption="Plain text summary."
        isActive
      />,
    );
    expectNoEmoji(html);
  });
});

// =======================================================================
// LongestGameScene
// =======================================================================

describe("LongestGameScene", () => {
  it("renders the hours played number", () => {
    const html = renderToStaticMarkup(
      <LongestGameScene
        payload={buildPayload()}
        caption="One game ate your year."
        isActive
      />,
    );
    expect(html).toContain("45.5");
    expect(html).toContain("hours played");
  });

  it("renders an integer hours value without trailing decimal", () => {
    const html = renderToStaticMarkup(
      <LongestGameScene
        payload={buildPayload({
          longestGame: { game: sampleGames[0], hoursPlayed: 60 },
        })}
        caption="x"
        isActive
      />,
    );
    expect(html).toContain("60");
    expect(html).not.toContain("60.0");
  });

  it("renders the game title", () => {
    const html = renderToStaticMarkup(
      <LongestGameScene
        payload={buildPayload()}
        caption="x"
        isActive
      />,
    );
    expect(html).toContain("Hades II");
  });

  it("renders the cover image when available", () => {
    const html = renderToStaticMarkup(
      <LongestGameScene
        payload={buildPayload()}
        caption="x"
        isActive
      />,
    );
    expect(html).toContain('src="https://example.com/hades.jpg"');
  });

  it("falls back to a placeholder when the cover is null", () => {
    const html = renderToStaticMarkup(
      <LongestGameScene
        payload={buildPayload({
          longestGame: {
            game: { ...sampleGames[0], coverUrl: null },
            hoursPlayed: 30,
          },
        })}
        caption="x"
        isActive
      />,
    );
    expect(html).not.toMatch(/<img\b/);
  });

  it("renders a calm fallback when longestGame is missing", () => {
    const html = renderToStaticMarkup(
      <LongestGameScene
        payload={buildPayload({ longestGame: undefined })}
        caption="x"
        isActive
      />,
    );
    expect(html).toContain("No playtime data");
  });

  it("renders the caption", () => {
    const html = renderToStaticMarkup(
      <LongestGameScene
        payload={buildPayload()}
        caption="The one that owned you."
        isActive
      />,
    );
    expect(html).toContain("The one that owned you.");
  });

  it("emits no exclamation marks", () => {
    const html = renderToStaticMarkup(
      <LongestGameScene
        payload={buildPayload()}
        caption="Calm hours-played copy."
        isActive
      />,
    );
    expectNoExclamation(html);
  });

  it("emits no emoji codepoints", () => {
    const html = renderToStaticMarkup(
      <LongestGameScene
        payload={buildPayload()}
        caption="Plain text summary.."
        isActive
      />,
    );
    expectNoEmoji(html);
  });
});

// =======================================================================
// ReviewsScene
// =======================================================================

describe("ReviewsScene", () => {
  it("renders the review count", () => {
    const html = renderToStaticMarkup(
      <ReviewsScene
        payload={buildPayload()}
        caption="A few keepers this year."
        isActive
      />,
    );
    expect(html).toContain("4");
    expect(html).toContain("reviews written");
  });

  it("uses singular label when reviewCount === 1", () => {
    const html = renderToStaticMarkup(
      <ReviewsScene
        payload={buildPayload({
          totals: {
            totalGames: 47,
            totalHoursPlayed: 120,
            completedCount: 30,
            droppedCount: 5,
            replayingCount: 2,
            reviewCount: 1,
          },
        })}
        caption="One keeper this year."
        isActive
      />,
    );
    expect(html).toContain("review written");
    expect(html).not.toMatch(/\b1 reviews written\b/);
  });

  it("renders the favorite review snippet when present", () => {
    const html = renderToStaticMarkup(
      <ReviewsScene
        payload={buildPayload()}
        caption="x"
        isActive
      />,
    );
    expect(html).toContain("Owned my year.");
    expect(html).toContain("Hades II");
  });

  it("omits the blockquote when favoriteReviewSnippet is absent", () => {
    const html = renderToStaticMarkup(
      <ReviewsScene
        payload={buildPayload({ favoriteReviewSnippet: undefined })}
        caption="Few words this year."
        isActive
      />,
    );
    expect(html).not.toMatch(/<blockquote\b/);
  });

  it("renders the caption", () => {
    const html = renderToStaticMarkup(
      <ReviewsScene
        payload={buildPayload()}
        caption="A handful of reviews to look back on."
        isActive
      />,
    );
    expect(html).toContain("A handful of reviews to look back on.");
  });

  it("emits no exclamation marks", () => {
    const html = renderToStaticMarkup(
      <ReviewsScene
        payload={buildPayload()}
        caption="Calm reviews copy."
        isActive
      />,
    );
    expectNoExclamation(html);
  });

  it("emits no emoji codepoints", () => {
    const html = renderToStaticMarkup(
      <ReviewsScene
        payload={buildPayload()}
        caption="Plain text summary."
        isActive
      />,
    );
    expectNoEmoji(html);
  });
});

// =======================================================================
// isActive flag — caption always rendered regardless of active state.
// =======================================================================

describe("caption renders regardless of isActive flag", () => {
  it("OpeningScene caption renders when isActive=false", () => {
    const html = renderToStaticMarkup(
      <OpeningScene
        payload={buildPayload()}
        caption="caption-text-OS"
        isActive={false}
      />,
    );
    expect(html).toContain("caption-text-OS");
  });

  it("StatsTotalScene caption renders when isActive=false", () => {
    const html = renderToStaticMarkup(
      <StatsTotalScene
        payload={buildPayload()}
        caption="caption-text-ST"
        isActive={false}
      />,
    );
    expect(html).toContain("caption-text-ST");
  });

  it("TopGamesScene caption renders when isActive=false", () => {
    const html = renderToStaticMarkup(
      <TopGamesScene
        payload={buildPayload()}
        caption="caption-text-TG"
        isActive={false}
      />,
    );
    expect(html).toContain("caption-text-TG");
  });

  it("LongestGameScene caption renders when isActive=false", () => {
    const html = renderToStaticMarkup(
      <LongestGameScene
        payload={buildPayload()}
        caption="caption-text-LG"
        isActive={false}
      />,
    );
    expect(html).toContain("caption-text-LG");
  });

  it("ReviewsScene caption renders when isActive=false", () => {
    const html = renderToStaticMarkup(
      <ReviewsScene
        payload={buildPayload()}
        caption="caption-text-RV"
        isActive={false}
      />,
    );
    expect(html).toContain("caption-text-RV");
  });
});
