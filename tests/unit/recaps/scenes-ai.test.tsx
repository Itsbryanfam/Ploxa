import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ClosingScene } from "@/components/recaps/scenes/ClosingScene";
import { CompletionRatioScene } from "@/components/recaps/scenes/CompletionRatioScene";
import { GenreDominanceScene } from "@/components/recaps/scenes/GenreDominanceScene";
import { GotyScene } from "@/components/recaps/scenes/GotyScene";
import { MechanicLoveScene } from "@/components/recaps/scenes/MechanicLoveScene";
import { MoodThemesScene } from "@/components/recaps/scenes/MoodThemesScene";
import { MostReplayedScene } from "@/components/recaps/scenes/MostReplayedScene";
import { SurpriseScene } from "@/components/recaps/scenes/SurpriseScene";
import { TasteEvolutionScene } from "@/components/recaps/scenes/TasteEvolutionScene";
import { TopThemeScene } from "@/components/recaps/scenes/TopThemeScene";
import type { RecapPayload, TopGameRef } from "@/lib/recaps/types";

/**
 * scenes-ai.test.tsx — Phase 6 T14.
 *
 * Static-markup tests for the six AI-captioned scenes (goty,
 * genre_dominance, mechanic_love, surprise, taste_evolution, closing)
 * and the four substitute scenes (most_replayed, top_theme,
 * completion_ratio, mood_themes).
 *
 * Same `react-dom/server.renderToStaticMarkup` style as T13's
 * `scenes-data.test.tsx`. Each scene gets:
 *  - data appears: the key fields render
 *  - caption appears: the caption prop always renders into the markup
 *  - no exclamation marks: project memory rule (calm copy)
 *  - no emoji codepoints: project memory rule (custom assets, no emojis)
 *  - graceful fallback: optional payload fields can be absent
 *
 * Framer Motion's `motion.div` renders as a plain `<div>` in server-side
 * static markup, so the markup is the same final-state HTML the browser
 * would settle on under reduced-motion.
 */

const sampleGame: TopGameRef = {
  gameId: "g1",
  rawgId: 1,
  title: "Hades II",
  coverUrl: "https://example.com/hades.jpg",
  rating: 5,
  status: "completed",
};

const sampleGames: TopGameRef[] = [
  sampleGame,
  {
    gameId: "g2",
    rawgId: 2,
    title: "Balatro",
    coverUrl: "https://example.com/balatro.jpg",
    rating: 4.5,
    status: "completed",
  },
];

function buildPayload(overrides: Partial<RecapPayload> = {}): RecapPayload {
  return {
    tier: "ok",
    mode: "yearly",
    windowStart: "2026-01-01T00:00:00.000Z",
    windowEnd: "2027-01-01T00:00:00.000Z",
    scenes: [],
    totals: {
      totalGames: 47,
      totalHoursPlayed: 120,
      completedCount: 30,
      droppedCount: 5,
      replayingCount: 2,
      reviewCount: 4,
    },
    topGames: sampleGames,
    goty: sampleGame,
    topGenre: { name: "Action", pct: 42, secondName: "RPG", secondPct: 24 },
    topMechanic: { name: "Roguelite progression" },
    surprise: {
      game: sampleGames[1],
      surpriseGenre: "Card battler",
      baselineAvg: 3.2,
    },
    tasteEvolution: {
      q1Vibe: "Comfort RPGs",
      q4Vibe: "Tense roguelikes",
    },
    completionRatio: { completedPct: 64, droppedPct: 11 },
    moodThemes: { themes: ["Atmospheric", "Story-rich", "Indie"] },
    longestGame: { game: sampleGame, hoursPlayed: 45.5 },
    mostReplayed: { game: sampleGame, replayCount: 3 },
    topTheme: { name: "Dark Fantasy" },
    favoriteReviewSnippet: {
      reviewId: "r1",
      gameTitle: "Hades II",
      snippet: "Owned my year.",
    },
    captions: {},
    ...overrides,
  };
}

// Shared assertion helpers — every scene must satisfy the calm-copy +
// no-emoji rules. We deliberately pass captions that contain no `!` so
// the assertion catches any internal scene copy that uses one.
function expectNoExclamation(html: string) {
  expect(html).not.toMatch(/!/);
}
function expectNoEmoji(html: string) {
  expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  expect(html).not.toMatch(/[\u{1F600}-\u{1F64F}]/u);
  expect(html).not.toMatch(/[\u{2600}-\u{27BF}]/u);
}

// =======================================================================
// GotyScene
// =======================================================================

describe("GotyScene", () => {
  it("renders the game title", () => {
    const html = renderToStaticMarkup(
      <GotyScene
        payload={buildPayload()}
        caption="A clear standout this year."
        isActive
      />,
    );
    expect(html).toContain("Hades II");
  });

  it("renders the rating chip", () => {
    const html = renderToStaticMarkup(
      <GotyScene
        payload={buildPayload()}
        caption="x"
        isActive
      />,
    );
    expect(html).toContain("5/5");
  });

  it("renders the cover image when available", () => {
    const html = renderToStaticMarkup(
      <GotyScene
        payload={buildPayload()}
        caption="x"
        isActive
      />,
    );
    expect(html).toContain('src="https://example.com/hades.jpg"');
  });

  it("renders a gradient panel (no cover img) when goty.coverUrl is null", () => {
    const html = renderToStaticMarkup(
      <GotyScene
        payload={buildPayload({
          goty: { ...sampleGame, coverUrl: null },
        })}
        caption="x"
        isActive
      />,
    );
    // The mascot sprite uses <img> internally — the goty cover should NOT
    // appear as an <img>, but the mascot's still does. Look specifically
    // for the example.com cover URL absence.
    expect(html).not.toContain("https://example.com/hades.jpg");
  });

  it("renders a calm fallback when goty is missing", () => {
    const html = renderToStaticMarkup(
      <GotyScene
        payload={buildPayload({ goty: undefined })}
        caption="A varied year."
        isActive
      />,
    );
    expect(html).toContain("Top-rated game");
    expect(html).toContain("A varied year.");
  });

  it("renders the caption", () => {
    const html = renderToStaticMarkup(
      <GotyScene
        payload={buildPayload()}
        caption="The game of your year."
        isActive
      />,
    );
    expect(html).toContain("The game of your year.");
  });

  it("renders the celebrating mascot", () => {
    const html = renderToStaticMarkup(
      <GotyScene payload={buildPayload()} caption="x" isActive />,
    );
    expect(html).toContain("/mascot/celebrating.png");
  });

  it("emits no exclamation marks", () => {
    const html = renderToStaticMarkup(
      <GotyScene
        payload={buildPayload()}
        caption="Calm goty copy."
        isActive
      />,
    );
    expectNoExclamation(html);
  });

  it("emits no emoji codepoints", () => {
    const html = renderToStaticMarkup(
      <GotyScene
        payload={buildPayload()}
        caption="Plain text summary."
        isActive
      />,
    );
    expectNoEmoji(html);
  });
});

// =======================================================================
// GenreDominanceScene
// =======================================================================

describe("GenreDominanceScene", () => {
  it("renders the genre name in big type", () => {
    const html = renderToStaticMarkup(
      <GenreDominanceScene
        payload={buildPayload()}
        caption="Your year was action."
        isActive
      />,
    );
    expect(html).toContain("Action");
  });

  it("renders the genre percentage in the donut", () => {
    const html = renderToStaticMarkup(
      <GenreDominanceScene
        payload={buildPayload()}
        caption="x"
        isActive
      />,
    );
    expect(html).toContain("42%");
  });

  it("renders the secondary genre name and percentage", () => {
    const html = renderToStaticMarkup(
      <GenreDominanceScene
        payload={buildPayload()}
        caption="x"
        isActive
      />,
    );
    expect(html).toContain("RPG");
    expect(html).toContain("24%");
  });

  it("renders an SVG donut chart", () => {
    const html = renderToStaticMarkup(
      <GenreDominanceScene
        payload={buildPayload()}
        caption="x"
        isActive
      />,
    );
    expect(html).toContain("<svg");
    expect(html).toContain("<circle");
  });

  it("clamps a percentage above 100 to 100", () => {
    const html = renderToStaticMarkup(
      <GenreDominanceScene
        payload={buildPayload({
          topGenre: { name: "Action", pct: 150, secondName: null, secondPct: 0 },
        })}
        caption="x"
        isActive
      />,
    );
    expect(html).toContain("100%");
    expect(html).not.toContain("150%");
  });

  it("omits the secondary line when secondName is null", () => {
    const html = renderToStaticMarkup(
      <GenreDominanceScene
        payload={buildPayload({
          topGenre: { name: "Action", pct: 70, secondName: null, secondPct: 0 },
        })}
        caption="x"
        isActive
      />,
    );
    expect(html).not.toContain("RPG");
  });

  it("renders a calm fallback when topGenre is missing", () => {
    const html = renderToStaticMarkup(
      <GenreDominanceScene
        payload={buildPayload({ topGenre: undefined })}
        caption="Balanced tastes."
        isActive
      />,
    );
    expect(html).toContain("Balanced tastes.");
    expect(html).not.toContain("<svg");
  });

  it("renders the caption", () => {
    const html = renderToStaticMarkup(
      <GenreDominanceScene
        payload={buildPayload()}
        caption="Action owned your year."
        isActive
      />,
    );
    expect(html).toContain("Action owned your year.");
  });

  it("emits no exclamation marks", () => {
    const html = renderToStaticMarkup(
      <GenreDominanceScene
        payload={buildPayload()}
        caption="Calm dominance copy."
        isActive
      />,
    );
    expectNoExclamation(html);
  });

  it("emits no emoji codepoints", () => {
    const html = renderToStaticMarkup(
      <GenreDominanceScene
        payload={buildPayload()}
        caption="Plain text summary."
        isActive
      />,
    );
    expectNoEmoji(html);
  });
});

// =======================================================================
// MechanicLoveScene
// =======================================================================

describe("MechanicLoveScene", () => {
  it("renders the mechanic name in big type", () => {
    const html = renderToStaticMarkup(
      <MechanicLoveScene
        payload={buildPayload()}
        caption="The systems you came back for."
        isActive
      />,
    );
    expect(html).toContain("Roguelite progression");
  });

  it("renders a calm fallback when topMechanic is missing", () => {
    const html = renderToStaticMarkup(
      <MechanicLoveScene
        payload={buildPayload({ topMechanic: undefined })}
        caption="A varied year."
        isActive
      />,
    );
    expect(html).toContain("Many mechanics");
    expect(html).toContain("A varied year.");
  });

  it("renders the caption", () => {
    const html = renderToStaticMarkup(
      <MechanicLoveScene
        payload={buildPayload()}
        caption="Your love language was systems."
        isActive
      />,
    );
    expect(html).toContain("Your love language was systems.");
  });

  it("emits no exclamation marks", () => {
    const html = renderToStaticMarkup(
      <MechanicLoveScene
        payload={buildPayload()}
        caption="Calm mechanic copy."
        isActive
      />,
    );
    expectNoExclamation(html);
  });

  it("emits no emoji codepoints", () => {
    const html = renderToStaticMarkup(
      <MechanicLoveScene
        payload={buildPayload()}
        caption="Plain text summary."
        isActive
      />,
    );
    expectNoEmoji(html);
  });
});

// =======================================================================
// SurpriseScene
// =======================================================================

describe("SurpriseScene", () => {
  it("renders the surprise game title", () => {
    const html = renderToStaticMarkup(
      <SurpriseScene
        payload={buildPayload()}
        caption="The one you didn't see coming."
        isActive
      />,
    );
    expect(html).toContain("Balatro");
  });

  it("renders the surprise genre and rating delta", () => {
    const html = renderToStaticMarkup(
      <SurpriseScene
        payload={buildPayload()}
        caption="x"
        isActive
      />,
    );
    expect(html).toContain("Card battler");
    expect(html).toContain("4.5/5");
    expect(html).toContain("3.2/5");
  });

  it("renders the cover image when available", () => {
    const html = renderToStaticMarkup(
      <SurpriseScene
        payload={buildPayload()}
        caption="x"
        isActive
      />,
    );
    expect(html).toContain('src="https://example.com/balatro.jpg"');
  });

  it("renders a calm fallback when surprise is missing", () => {
    const html = renderToStaticMarkup(
      <SurpriseScene
        payload={buildPayload({ surprise: undefined })}
        caption="A consistent year."
        isActive
      />,
    );
    expect(html).toContain("No standout surprises");
    expect(html).toContain("A consistent year.");
  });

  it("renders the caption", () => {
    const html = renderToStaticMarkup(
      <SurpriseScene
        payload={buildPayload()}
        caption="The one you didn't expect."
        isActive
      />,
    );
    expect(html).toContain("The one you didn&#x27;t expect.");
  });

  it("emits no exclamation marks", () => {
    const html = renderToStaticMarkup(
      <SurpriseScene
        payload={buildPayload()}
        caption="Calm surprise copy."
        isActive
      />,
    );
    expectNoExclamation(html);
  });

  it("emits no emoji codepoints", () => {
    const html = renderToStaticMarkup(
      <SurpriseScene
        payload={buildPayload()}
        caption="Plain text summary."
        isActive
      />,
    );
    expectNoEmoji(html);
  });
});

// =======================================================================
// TasteEvolutionScene
// =======================================================================

describe("TasteEvolutionScene", () => {
  it("renders both Q1 and Q4 vibes", () => {
    const html = renderToStaticMarkup(
      <TasteEvolutionScene
        payload={buildPayload()}
        caption="From cozy to crunchy."
        isActive
      />,
    );
    expect(html).toContain("Comfort RPGs");
    expect(html).toContain("Tense roguelikes");
  });

  it("renders the Q1 and Q4 column labels", () => {
    const html = renderToStaticMarkup(
      <TasteEvolutionScene
        payload={buildPayload()}
        caption="x"
        isActive
      />,
    );
    expect(html).toContain("Q1");
    expect(html).toContain("Q4");
  });

  it("renders a calm fallback when tasteEvolution is missing", () => {
    const html = renderToStaticMarkup(
      <TasteEvolutionScene
        payload={buildPayload({ tasteEvolution: undefined })}
        caption="Steady year."
        isActive
      />,
    );
    expect(html).toContain("Your taste held steady");
    expect(html).toContain("Steady year.");
  });

  it("renders the caption", () => {
    const html = renderToStaticMarkup(
      <TasteEvolutionScene
        payload={buildPayload()}
        caption="A drift from one shore to another."
        isActive
      />,
    );
    expect(html).toContain("A drift from one shore to another.");
  });

  it("emits no exclamation marks", () => {
    const html = renderToStaticMarkup(
      <TasteEvolutionScene
        payload={buildPayload()}
        caption="Calm evolution copy."
        isActive
      />,
    );
    expectNoExclamation(html);
  });

  it("emits no emoji codepoints", () => {
    const html = renderToStaticMarkup(
      <TasteEvolutionScene
        payload={buildPayload()}
        caption="Plain text summary."
        isActive
      />,
    );
    expectNoEmoji(html);
  });
});

// =======================================================================
// ClosingScene
// =======================================================================

describe("ClosingScene", () => {
  it("renders the stats grid with key totals", () => {
    const html = renderToStaticMarkup(
      <ClosingScene
        payload={buildPayload()}
        caption="That was your year."
        isActive
      />,
    );
    expect(html).toContain("47");
    expect(html).toContain("Games logged");
    expect(html).toContain("Action");
    expect(html).toContain("Top genre");
    expect(html).toContain("Hades II");
    expect(html).toContain("Top game");
    expect(html).toContain("120");
    expect(html).toContain("Hours played");
  });

  it("renders 'year' for yearly mode", () => {
    const html = renderToStaticMarkup(
      <ClosingScene
        payload={buildPayload()}
        caption="x"
        isActive
      />,
    );
    expect(html).toContain("Your year in games");
  });

  it("renders 'month' for monthly mode", () => {
    const html = renderToStaticMarkup(
      <ClosingScene
        payload={buildPayload({ mode: "monthly" })}
        caption="x"
        isActive
      />,
    );
    expect(html).toContain("Your month in games");
  });

  it("falls back to em-dash when hours is null", () => {
    const html = renderToStaticMarkup(
      <ClosingScene
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

  it("falls back to 'varied' when topGenre is missing", () => {
    const html = renderToStaticMarkup(
      <ClosingScene
        payload={buildPayload({ topGenre: undefined })}
        caption="x"
        isActive
      />,
    );
    expect(html).toContain("varied");
  });

  it("renders the celebrating mascot", () => {
    const html = renderToStaticMarkup(
      <ClosingScene payload={buildPayload()} caption="x" isActive />,
    );
    expect(html).toContain("/mascot/celebrating.png");
  });

  it("renders the caption", () => {
    const html = renderToStaticMarkup(
      <ClosingScene
        payload={buildPayload()}
        caption="That was your year. Share it."
        isActive
      />,
    );
    expect(html).toContain("That was your year. Share it.");
  });

  it("emits no exclamation marks", () => {
    const html = renderToStaticMarkup(
      <ClosingScene
        payload={buildPayload()}
        caption="Calm closing copy."
        isActive
      />,
    );
    expectNoExclamation(html);
  });

  it("emits no emoji codepoints", () => {
    const html = renderToStaticMarkup(
      <ClosingScene
        payload={buildPayload()}
        caption="Plain text summary."
        isActive
      />,
    );
    expectNoEmoji(html);
  });
});

// =======================================================================
// MostReplayedScene (substitute for longest_game)
// =======================================================================

describe("MostReplayedScene", () => {
  it("renders the replay count", () => {
    const html = renderToStaticMarkup(
      <MostReplayedScene
        payload={buildPayload()}
        caption="The one you kept coming back to."
        isActive
      />,
    );
    expect(html).toContain("3");
    expect(html).toContain("times replayed");
  });

  it("uses singular 'time replayed' when replayCount === 1", () => {
    const html = renderToStaticMarkup(
      <MostReplayedScene
        payload={buildPayload({
          mostReplayed: { game: sampleGame, replayCount: 1 },
        })}
        caption="x"
        isActive
      />,
    );
    expect(html).toContain("time replayed");
    expect(html).not.toMatch(/\b1 times replayed\b/);
  });

  it("renders the game title and cover", () => {
    const html = renderToStaticMarkup(
      <MostReplayedScene
        payload={buildPayload()}
        caption="x"
        isActive
      />,
    );
    expect(html).toContain("Hades II");
    expect(html).toContain('src="https://example.com/hades.jpg"');
  });

  it("renders a placeholder div when cover is null", () => {
    const html = renderToStaticMarkup(
      <MostReplayedScene
        payload={buildPayload({
          mostReplayed: {
            game: { ...sampleGame, coverUrl: null },
            replayCount: 2,
          },
        })}
        caption="x"
        isActive
      />,
    );
    expect(html).not.toMatch(/<img\b/);
  });

  it("renders a calm fallback when mostReplayed is missing", () => {
    const html = renderToStaticMarkup(
      <MostReplayedScene
        payload={buildPayload({ mostReplayed: undefined })}
        caption="A varied year."
        isActive
      />,
    );
    expect(html).toContain("No standout replays");
    expect(html).toContain("A varied year.");
  });

  it("renders the caption", () => {
    const html = renderToStaticMarkup(
      <MostReplayedScene
        payload={buildPayload()}
        caption="The one you kept going back to."
        isActive
      />,
    );
    expect(html).toContain("The one you kept going back to.");
  });

  it("emits no exclamation marks", () => {
    const html = renderToStaticMarkup(
      <MostReplayedScene
        payload={buildPayload()}
        caption="Calm replay copy."
        isActive
      />,
    );
    expectNoExclamation(html);
  });

  it("emits no emoji codepoints", () => {
    const html = renderToStaticMarkup(
      <MostReplayedScene
        payload={buildPayload()}
        caption="Plain text summary."
        isActive
      />,
    );
    expectNoEmoji(html);
  });
});

// =======================================================================
// TopThemeScene (substitute for mechanic_love)
// =======================================================================

describe("TopThemeScene", () => {
  it("renders the theme name in big type", () => {
    const html = renderToStaticMarkup(
      <TopThemeScene
        payload={buildPayload()}
        caption="Dark fantasies were your year."
        isActive
      />,
    );
    expect(html).toContain("Dark Fantasy");
  });

  it("renders a calm fallback when topTheme is missing", () => {
    const html = renderToStaticMarkup(
      <TopThemeScene
        payload={buildPayload({ topTheme: undefined })}
        caption="An eclectic year."
        isActive
      />,
    );
    expect(html).toContain("Eclectic taste");
    expect(html).toContain("An eclectic year.");
  });

  it("renders the caption", () => {
    const html = renderToStaticMarkup(
      <TopThemeScene
        payload={buildPayload()}
        caption="A mood for the year."
        isActive
      />,
    );
    expect(html).toContain("A mood for the year.");
  });

  it("emits no exclamation marks", () => {
    const html = renderToStaticMarkup(
      <TopThemeScene
        payload={buildPayload()}
        caption="Calm theme copy."
        isActive
      />,
    );
    expectNoExclamation(html);
  });

  it("emits no emoji codepoints", () => {
    const html = renderToStaticMarkup(
      <TopThemeScene
        payload={buildPayload()}
        caption="Plain text summary."
        isActive
      />,
    );
    expectNoEmoji(html);
  });
});

// =======================================================================
// CompletionRatioScene (substitute for taste_evolution)
// =======================================================================

describe("CompletionRatioScene", () => {
  it("renders the completed and dropped percentages", () => {
    const html = renderToStaticMarkup(
      <CompletionRatioScene
        payload={buildPayload()}
        caption="You finished most of what you started."
        isActive
      />,
    );
    expect(html).toContain("64%");
    expect(html).toContain("11%");
    expect(html).toContain("Completed");
    expect(html).toContain("Dropped");
  });

  it("renders a calm fallback when completionRatio is missing", () => {
    const html = renderToStaticMarkup(
      <CompletionRatioScene
        payload={buildPayload({ completionRatio: undefined })}
        caption="Hard to say."
        isActive
      />,
    );
    expect(html).toContain("hard to pin down");
    expect(html).toContain("Hard to say.");
  });

  it("renders the caption", () => {
    const html = renderToStaticMarkup(
      <CompletionRatioScene
        payload={buildPayload()}
        caption="A solid finishing year."
        isActive
      />,
    );
    expect(html).toContain("A solid finishing year.");
  });

  it("emits no exclamation marks", () => {
    const html = renderToStaticMarkup(
      <CompletionRatioScene
        payload={buildPayload()}
        caption="Calm ratio copy."
        isActive
      />,
    );
    expectNoExclamation(html);
  });

  it("emits no emoji codepoints", () => {
    const html = renderToStaticMarkup(
      <CompletionRatioScene
        payload={buildPayload()}
        caption="Plain text summary."
        isActive
      />,
    );
    expectNoEmoji(html);
  });
});

// =======================================================================
// MoodThemesScene (substitute for surprise)
// =======================================================================

describe("MoodThemesScene", () => {
  it("renders the three mood themes", () => {
    const html = renderToStaticMarkup(
      <MoodThemesScene
        payload={buildPayload()}
        caption="A year of moods."
        isActive
      />,
    );
    expect(html).toContain("Atmospheric");
    expect(html).toContain("Story-rich");
    expect(html).toContain("Indie");
  });

  it("caps at 3 themes when more are supplied", () => {
    const html = renderToStaticMarkup(
      <MoodThemesScene
        payload={buildPayload({
          moodThemes: {
            themes: ["A", "B", "C", "D", "E"],
          },
        })}
        caption="x"
        isActive
      />,
    );
    expect(html).toContain(">A<");
    expect(html).toContain(">B<");
    expect(html).toContain(">C<");
    expect(html).not.toContain(">D<");
    expect(html).not.toContain(">E<");
  });

  it("renders a calm fallback when moodThemes is missing", () => {
    const html = renderToStaticMarkup(
      <MoodThemesScene
        payload={buildPayload({ moodThemes: undefined })}
        caption="A varied year."
        isActive
      />,
    );
    expect(html).toContain("Many moods");
    expect(html).toContain("A varied year.");
  });

  it("renders a calm fallback when themes array is empty", () => {
    const html = renderToStaticMarkup(
      <MoodThemesScene
        payload={buildPayload({ moodThemes: { themes: [] } })}
        caption="A varied year."
        isActive
      />,
    );
    expect(html).toContain("Many moods");
  });

  it("renders the caption", () => {
    const html = renderToStaticMarkup(
      <MoodThemesScene
        payload={buildPayload()}
        caption="A spread of moods this year."
        isActive
      />,
    );
    expect(html).toContain("A spread of moods this year.");
  });

  it("emits no exclamation marks", () => {
    const html = renderToStaticMarkup(
      <MoodThemesScene
        payload={buildPayload()}
        caption="Calm mood copy."
        isActive
      />,
    );
    expectNoExclamation(html);
  });

  it("emits no emoji codepoints", () => {
    const html = renderToStaticMarkup(
      <MoodThemesScene
        payload={buildPayload()}
        caption="Plain text summary."
        isActive
      />,
    );
    expectNoEmoji(html);
  });
});

// =======================================================================
// caption renders regardless of isActive flag
// =======================================================================

describe("caption renders regardless of isActive flag", () => {
  it("GotyScene caption renders when isActive=false", () => {
    const html = renderToStaticMarkup(
      <GotyScene
        payload={buildPayload()}
        caption="caption-text-GOTY"
        isActive={false}
      />,
    );
    expect(html).toContain("caption-text-GOTY");
  });

  it("GenreDominanceScene caption renders when isActive=false", () => {
    const html = renderToStaticMarkup(
      <GenreDominanceScene
        payload={buildPayload()}
        caption="caption-text-GD"
        isActive={false}
      />,
    );
    expect(html).toContain("caption-text-GD");
  });

  it("MechanicLoveScene caption renders when isActive=false", () => {
    const html = renderToStaticMarkup(
      <MechanicLoveScene
        payload={buildPayload()}
        caption="caption-text-ML"
        isActive={false}
      />,
    );
    expect(html).toContain("caption-text-ML");
  });

  it("SurpriseScene caption renders when isActive=false", () => {
    const html = renderToStaticMarkup(
      <SurpriseScene
        payload={buildPayload()}
        caption="caption-text-SP"
        isActive={false}
      />,
    );
    expect(html).toContain("caption-text-SP");
  });

  it("TasteEvolutionScene caption renders when isActive=false", () => {
    const html = renderToStaticMarkup(
      <TasteEvolutionScene
        payload={buildPayload()}
        caption="caption-text-TE"
        isActive={false}
      />,
    );
    expect(html).toContain("caption-text-TE");
  });

  it("ClosingScene caption renders when isActive=false", () => {
    const html = renderToStaticMarkup(
      <ClosingScene
        payload={buildPayload()}
        caption="caption-text-CL"
        isActive={false}
      />,
    );
    expect(html).toContain("caption-text-CL");
  });

  it("MostReplayedScene caption renders when isActive=false", () => {
    const html = renderToStaticMarkup(
      <MostReplayedScene
        payload={buildPayload()}
        caption="caption-text-MR"
        isActive={false}
      />,
    );
    expect(html).toContain("caption-text-MR");
  });

  it("TopThemeScene caption renders when isActive=false", () => {
    const html = renderToStaticMarkup(
      <TopThemeScene
        payload={buildPayload()}
        caption="caption-text-TT"
        isActive={false}
      />,
    );
    expect(html).toContain("caption-text-TT");
  });

  it("CompletionRatioScene caption renders when isActive=false", () => {
    const html = renderToStaticMarkup(
      <CompletionRatioScene
        payload={buildPayload()}
        caption="caption-text-CR"
        isActive={false}
      />,
    );
    expect(html).toContain("caption-text-CR");
  });

  it("MoodThemesScene caption renders when isActive=false", () => {
    const html = renderToStaticMarkup(
      <MoodThemesScene
        payload={buildPayload()}
        caption="caption-text-MT"
        isActive={false}
      />,
    );
    expect(html).toContain("caption-text-MT");
  });
});
