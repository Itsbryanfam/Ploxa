import { describe, expect, it } from "vitest";
import {
  aggregateFingerprint,
  sign,
  weight,
  type AggregateInputRow,
} from "@/lib/taste/aggregate";

// Helper: build an aggregate input row with sensible defaults; tests
// override only the fields they care about.
function row(overrides: Partial<AggregateInputRow> = {}): AggregateInputRow {
  return {
    status: "backlog",
    rating: null,
    hasPublishedReview: false,
    genres: [],
    themes: [],
    mechanics: [],
    gameModes: [],
    playerPerspectives: [],
    playtimeAvgHours: null,
    ...overrides,
  };
}

describe("sign — directional signal", () => {
  it("returns -1 for ratings below 4", () => {
    expect(sign(row({ rating: 1 }))).toBe(-1);
    expect(sign(row({ rating: 3.9 }))).toBe(-1);
  });

  it("returns 0 for ratings in the neutral band [4, 6]", () => {
    expect(sign(row({ rating: 4 }))).toBe(0);
    expect(sign(row({ rating: 5 }))).toBe(0);
    expect(sign(row({ rating: 6 }))).toBe(0);
  });

  it("returns 1 for ratings above 6", () => {
    expect(sign(row({ rating: 6.5 }))).toBe(1);
    expect(sign(row({ rating: 10 }))).toBe(1);
  });

  it("returns -1 for dropped status without a rating (implicit dislike)", () => {
    expect(sign(row({ status: "dropped", rating: null }))).toBe(-1);
  });

  it("returns 1 for any other unrated status (weak positive interest)", () => {
    expect(sign(row({ status: "playing" }))).toBe(1);
    expect(sign(row({ status: "completed" }))).toBe(1);
    expect(sign(row({ status: "backlog" }))).toBe(1);
    expect(sign(row({ status: "wishlist" }))).toBe(1);
    expect(sign(row({ status: "on_hold" }))).toBe(1);
  });
});

describe("weight — intensity and status weights", () => {
  it("rated entries weigh more than unrated engaged ones", () => {
    const rated = weight(row({ rating: 8 }));
    const playing = weight(row({ status: "playing", rating: null }));
    expect(rated).toBeGreaterThan(playing);
  });

  it("ratings near the extremes weigh more than middling ones", () => {
    const extreme = weight(row({ rating: 10 }));
    const mid = weight(row({ rating: 5 }));
    expect(extreme).toBeGreaterThan(mid);
  });

  it("backlog/wishlist weigh less than engaged statuses", () => {
    const wishlist = weight(row({ status: "wishlist", rating: null }));
    const playing = weight(row({ status: "playing", rating: null }));
    expect(wishlist).toBeLessThan(playing);
  });

  it("published-review bonus is multiplicative (×1.15)", () => {
    const base = weight(row({ rating: 8, hasPublishedReview: false }));
    const reviewed = weight(row({ rating: 8, hasPublishedReview: true }));
    expect(reviewed).toBeCloseTo(base * 1.15, 6);
  });
});

describe("aggregateFingerprint — vector normalization", () => {
  it("returns empty vectors for empty input", () => {
    const r = aggregateFingerprint({ rows: [] });
    expect(r.genre).toEqual({});
    expect(r.theme).toEqual({});
    expect(r.mechanic).toEqual({});
    expect(r.totalLogsAtGeneration).toBe(0);
  });

  it("genre scores fall in [-1, 1] after normalization", () => {
    const r = aggregateFingerprint({
      rows: [
        row({ status: "completed", rating: 10, genres: ["roguelike"] }),
        row({ status: "completed", rating: 9, genres: ["roguelike"] }),
        row({ status: "dropped", rating: 1, genres: ["jrpg"] }),
      ],
    });
    for (const score of Object.values(r.genre)) {
      expect(score).toBeGreaterThanOrEqual(-1);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it("a strong like pushes the genre score positive; a strong dislike pulls it negative", () => {
    const r = aggregateFingerprint({
      rows: [
        row({ rating: 10, genres: ["roguelike"] }),
        row({ rating: 1, genres: ["jrpg"] }),
      ],
    });
    expect(r.genre.roguelike).toBeGreaterThan(0);
    expect(r.genre.jrpg).toBeLessThan(0);
  });

  it("neutral-rated logs (4-6) do not push the vector either direction", () => {
    const r = aggregateFingerprint({
      rows: [
        row({ rating: 5, genres: ["puzzle"] }), // sign=0
      ],
    });
    expect(r.genre.puzzle ?? 0).toBe(0);
  });

  it("lengthPreference sums to 1.0 when any row contributes hours", () => {
    const r = aggregateFingerprint({
      rows: [
        row({ rating: 8, playtimeAvgHours: 7 }),  // 5-10h bucket
        row({ rating: 8, playtimeAvgHours: 40 }), // 30-60h bucket
      ],
    });
    const total = Object.values(r.lengthPreference).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1.0, 6);
  });

  it("lengthPreference stays all-zero when no row contributes hours", () => {
    const r = aggregateFingerprint({
      rows: [row({ rating: 8, playtimeAvgHours: null })],
    });
    const total = Object.values(r.lengthPreference).reduce((a, b) => a + b, 0);
    expect(total).toBe(0);
  });

  it("reports the row count via totalLogsAtGeneration", () => {
    const r = aggregateFingerprint({
      rows: [row({}), row({}), row({})],
    });
    expect(r.totalLogsAtGeneration).toBe(3);
  });
});

describe("aggregateFingerprint — modes and perspectives", () => {
  it("aggregates game_modes weighted by sign", () => {
    const result = aggregateFingerprint({
      rows: [
        row({ rating: 9, gameModes: ["Multiplayer", "Co-operative"] }),
        row({ rating: 9, gameModes: ["Multiplayer"] }),
      ],
    });
    expect(result.gameMode["Multiplayer"]).toBeGreaterThan(result.gameMode["Co-operative"]);
  });

  it("aggregates player_perspectives weighted by sign", () => {
    const result = aggregateFingerprint({
      rows: [
        row({ rating: 9, playerPerspectives: ["First person"] }),
        row({ rating: 2, playerPerspectives: ["Side view"] }),
      ],
    });
    expect(result.playerPerspective["First person"]).toBeGreaterThan(0);
    expect(result.playerPerspective["Side view"]).toBeLessThan(0);
  });
});
