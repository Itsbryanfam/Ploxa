import { describe, expect, it } from "vitest";
import { assignBuckets, type ScoredCandidate } from "@/lib/recs/buckets";

const mkCand = (
  id: number,
  composite: number,
  opts: Partial<Omit<ScoredCandidate, "gameId" | "composite">> = {},
): ScoredCandidate => ({
  gameId: id,
  composite,
  inLibrary: false,
  socialScore: 0,
  genres: ["puzzle"],
  ...opts,
});

describe("assignBuckets", () => {
  it("fills all four slot types when sources are rich", () => {
    const cands = [
      mkCand(1, 0.9), // comfort
      mkCand(2, 0.85), // comfort
      mkCand(3, 0.8), // comfort
      mkCand(4, 0.7, { inLibrary: true }), // backlog
      mkCand(5, 0.65, { socialScore: 0.4 }), // friends
      mkCand(6, 0.5, { genres: ["roguelike"] }), // wildcard
      mkCand(7, 0.4),
    ];
    const out = assignBuckets(cands, {
      exploredGenres: new Set(["puzzle"]),
      seed: 1,
    });
    expect(out.length).toBe(6);
    const slots = out.map((c) => c.slot).sort();
    expect(slots).toEqual(["backlog", "comfort", "comfort", "comfort", "friends", "wildcard"]);
  });

  it("demotes backlog slot to extra comfort when no library candidates", () => {
    const cands = [
      mkCand(1, 0.9),
      mkCand(2, 0.85),
      mkCand(3, 0.8),
      mkCand(4, 0.75),
      mkCand(5, 0.65, { socialScore: 0.4 }),
      mkCand(6, 0.5, { genres: ["roguelike"] }),
    ];
    const out = assignBuckets(cands, {
      exploredGenres: new Set(["puzzle"]),
      seed: 1,
    });
    const comforts = out.filter((c) => c.slot === "comfort");
    expect(comforts.length).toBe(4);
    expect(out.some((c) => c.slot === "backlog")).toBe(false);
  });

  it("demotes friends slot when no social candidates", () => {
    const cands = [
      mkCand(1, 0.9),
      mkCand(2, 0.85),
      mkCand(3, 0.8),
      mkCand(4, 0.75),
      mkCand(5, 0.7, { inLibrary: true }),
      mkCand(6, 0.5, { genres: ["roguelike"] }),
    ];
    const out = assignBuckets(cands, {
      exploredGenres: new Set(["puzzle"]),
      seed: 1,
    });
    expect(out.some((c) => c.slot === "friends")).toBe(false);
  });

  it("never duplicates a candidate across slots", () => {
    const cands = [
      mkCand(1, 0.9, { inLibrary: true, socialScore: 0.4 }), // could match all 3 buckets
      mkCand(2, 0.85),
      mkCand(3, 0.8),
      mkCand(4, 0.75),
      mkCand(5, 0.7),
      mkCand(6, 0.5, { genres: ["roguelike"] }),
    ];
    const out = assignBuckets(cands, {
      exploredGenres: new Set(["puzzle"]),
      seed: 1,
    });
    const ids = out.map((c) => c.gameId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns fewer than 6 when input is short", () => {
    const cands = [mkCand(1, 0.9), mkCand(2, 0.8)];
    const out = assignBuckets(cands, { exploredGenres: new Set(), seed: 1 });
    expect(out.length).toBe(2);
  });
});
