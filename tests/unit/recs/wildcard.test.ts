import { describe, expect, it } from "vitest";
import { pickWildcard, type WildcardCandidate } from "@/lib/recs/wildcard";

const mkCand = (id: number, score: number, genres: string[]): WildcardCandidate => ({
  gameId: id,
  composite: score,
  genres,
});

describe("pickWildcard", () => {
  it("returns null for empty candidate list", () => {
    expect(pickWildcard([], { exploredGenres: new Set(["puzzle"]), seed: 42 })).toBeNull();
  });

  it("picks from an unexplored genre when one exists", () => {
    const cands = [
      mkCand(1, 0.8, ["puzzle"]),
      mkCand(2, 0.7, ["puzzle"]),
      mkCand(3, 0.5, ["roguelike"]),
    ];
    const pick = pickWildcard(cands, { exploredGenres: new Set(["puzzle"]), seed: 42 });
    expect(pick?.gameId).toBe(3);
  });

  it("respects minimum confidence threshold", () => {
    const cands = [mkCand(1, 0.2, ["roguelike"])];
    const pick = pickWildcard(cands, {
      exploredGenres: new Set(["puzzle"]),
      seed: 42,
      minScore: 0.4,
    });
    expect(pick).toBeNull();
  });

  it("falls back to least-explored when all explored", () => {
    const cands = [
      mkCand(1, 0.6, ["puzzle"]),
      mkCand(2, 0.6, ["roguelike"]),
    ];
    // User has 10 puzzle logs, 1 roguelike log → wildcard should prefer roguelike
    const pick = pickWildcard(cands, {
      exploredGenres: new Set(["puzzle", "roguelike"]),
      genreFrequency: new Map([["puzzle", 10], ["roguelike", 1]]),
      seed: 42,
    });
    expect(pick?.gameId).toBe(2);
  });

  it("is deterministic with the same seed", () => {
    const cands = [
      mkCand(1, 0.5, ["a"]),
      mkCand(2, 0.5, ["b"]),
      mkCand(3, 0.5, ["c"]),
    ];
    const a = pickWildcard(cands, { exploredGenres: new Set(), seed: 7 });
    const b = pickWildcard(cands, { exploredGenres: new Set(), seed: 7 });
    expect(a?.gameId).toBe(b?.gameId);
  });
});
