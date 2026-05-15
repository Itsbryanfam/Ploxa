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

  it("pins the PRNG: seed 7 selects a fixed index (golden value, guards Task 12 reproducibility)", () => {
    const cands = [
      mkCand(1, 0.5, ["a"]),
      mkCand(2, 0.5, ["b"]),
      mkCand(3, 0.5, ["c"]),
    ];
    const pick = pickWildcard(cands, { exploredGenres: new Set(), seed: 7 });
    // Golden value: empirically observed output of mulberry32(7) on a 3-item
    // pool. If this changes, the PRNG contract Task 12 depends on broke.
    expect(pick?.gameId).toBe(1);
  });

  it("falls back to the full filtered pool when all genres explored and no frequency map", () => {
    const cands = [mkCand(1, 0.6, ["puzzle"]), mkCand(2, 0.6, ["puzzle"])];
    const pick = pickWildcard(cands, { exploredGenres: new Set(["puzzle"]), seed: 42 });
    expect(pick).not.toBeNull();
    expect([1, 2]).toContain(pick?.gameId);
  });

  it("picks among multiple unexplored candidates and excludes explored ones", () => {
    const cands = [
      mkCand(1, 0.9, ["puzzle"]), // explored — must be excluded despite top score
      mkCand(2, 0.6, ["roguelike"]),
      mkCand(3, 0.6, ["metroidvania"]),
    ];
    const pick = pickWildcard(cands, { exploredGenres: new Set(["puzzle"]), seed: 42 });
    expect([2, 3]).toContain(pick?.gameId);
    expect(pick?.gameId).not.toBe(1);
  });
});
