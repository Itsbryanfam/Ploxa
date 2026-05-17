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

  it("rejects a library candidate below the backing floor from the backlog slot", () => {
    const cands = [
      mkCand(1, 0.9),
      mkCand(2, 0.85),
      mkCand(3, 0.8),
      mkCand(4, 0.45, { inLibrary: true }), // inLibrary but BELOW 0.5 floor
      mkCand(5, 0.6, { socialScore: 0.4 }),
      mkCand(6, 0.5, { genres: ["roguelike"] }),
    ];
    const out = assignBuckets(cands, { exploredGenres: new Set(["puzzle"]), seed: 1 });
    // floor clause must exclude id4 from backlog; deleting `&& composite>=floor`
    // would make this fail (id4 would take the backlog slot).
    expect(out.some((c) => c.slot === "backlog")).toBe(false);
    expect(out.find((c) => c.gameId === 4)?.slot).not.toBe("backlog");
  });

  it("assigns an inLibrary+social candidate to backlog (Step 2 precedes Step 3)", () => {
    const cands = [
      mkCand(1, 0.9),
      mkCand(2, 0.85),
      mkCand(3, 0.8),
      mkCand(4, 0.7, { inLibrary: true, socialScore: 0.5 }), // eligible for BOTH
      mkCand(5, 0.6, { genres: ["roguelike"] }),
    ];
    const out = assignBuckets(cands, { exploredGenres: new Set(["puzzle"]), seed: 1 });
    expect(out.find((c) => c.gameId === 4)?.slot).toBe("backlog");
    expect(out.some((c) => c.slot === "friends")).toBe(false);
  });

  it("surfaces a high-scoring backlog-lane candidate (inLibrary) in slot:'backlog' over a discovery-only mix", () => {
    // Models the post-merge candidate array (play-next Backlog-bucket
    // revival): discovery candidates are all inLibrary:false; exactly one
    // backlog-lane candidate is inLibrary:true and clears the 0.5 floor.
    // It must NOT be consumed by the top-3 Comfort tier (lower composite
    // than the discovery leaders) and must land in the Backlog slot —
    // proving the rail is reachable once a real inLibrary member exists.
    const cands = [
      mkCand(1, 0.92), // discovery → comfort
      mkCand(2, 0.88), // discovery → comfort
      mkCand(3, 0.81), // discovery → comfort
      mkCand(4, 0.7, { inLibrary: true }), // backlog lane → BACKLOG
      mkCand(5, 0.6, { socialScore: 0.5 }), // discovery → friends
      mkCand(6, 0.55, { genres: ["roguelike"] }), // discovery → wildcard
    ];
    const out = assignBuckets(cands, {
      exploredGenres: new Set(["puzzle"]),
      seed: 7,
    });
    const backlogCard = out.find((c) => c.slot === "backlog");
    expect(backlogCard).toBeDefined();
    expect(backlogCard?.gameId).toBe(4);
    expect(backlogCard?.inLibrary).toBe(true);
    // No inLibrary:false (discovery) candidate ever took the backlog slot.
    expect(out.filter((c) => c.slot === "backlog")).toHaveLength(1);
  });

  it("is deterministic: identical input + seed yields an identical grid", () => {
    const cands = [
      mkCand(1, 0.9),
      mkCand(2, 0.85),
      mkCand(3, 0.8),
      mkCand(4, 0.7, { inLibrary: true }),
      mkCand(5, 0.65, { socialScore: 0.4 }),
      mkCand(6, 0.5, { genres: ["roguelike"] }),
      mkCand(7, 0.45, { genres: ["metroidvania"] }),
    ];
    const opts = { exploredGenres: new Set(["puzzle"]), seed: 99 };
    const a = assignBuckets(cands, opts);
    const b = assignBuckets(cands, opts);
    expect(a.map((c) => `${c.gameId}:${c.slot}`)).toEqual(b.map((c) => `${c.gameId}:${c.slot}`));
  });

  // Task 4: Friends-in-top-3 — the #1 overall game has socialScore>0.
  // Pre-Task-4 it was labeled "comfort"; post-fix it MUST be "friends".
  it("assigns slot:'friends' when the #1 composite game is socialScore>0 (friends-in-top-3 fix)", () => {
    const cands = [
      mkCand(1, 0.95, { socialScore: 0.8 }), // #1 overall, Friends-eligible → must get slot:"friends"
      mkCand(2, 0.88), // comfort
      mkCand(3, 0.82), // comfort
      mkCand(4, 0.76), // comfort (no specials compete here)
      mkCand(5, 0.65, { genres: ["roguelike"] }), // wildcard candidate
      mkCand(6, 0.55),
    ];
    const out = assignBuckets(cands, { exploredGenres: new Set(["puzzle"]), seed: 1 });
    expect(out.length).toBe(6);
    // The top-scoring game must be labeled "friends", not "comfort"
    const topGame = out.find((c) => c.gameId === 1);
    expect(topGame?.slot).toBe("friends");
    // Exactly one friends slot
    expect(out.filter((c) => c.slot === "friends")).toHaveLength(1);
    // No duplicates
    const ids = out.map((c) => c.gameId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Task 4: no-special regression pin — when NO special-eligible game is in
  // the top-3, the returned 6 games AND their slot labels must be byte-identical
  // to the pre-Task-4 output. This pins the exact membership+slots for the
  // no-special path, proving the reorder is a no-op in that case.
  it("no-special regression pin: output is byte-identical when no special-eligible game is in top-3", () => {
    // Specials are all ranked below the top-3 comfort tier, so reordering
    // Backlog/Friends/Wildcard before Comfort should produce the same result.
    const cands = [
      mkCand(10, 0.91), // comfort #1
      mkCand(20, 0.87), // comfort #2
      mkCand(30, 0.83), // comfort #3
      mkCand(40, 0.72, { inLibrary: true }), // backlog (#4 overall — not in top-3)
      mkCand(50, 0.64, { socialScore: 0.6 }), // friends (#5 overall — not in top-3)
      mkCand(60, 0.52, { genres: ["roguelike"] }), // wildcard (#6 overall)
      mkCand(70, 0.41), // spare
    ];
    const opts = { exploredGenres: new Set(["puzzle"]), seed: 42 };
    const out = assignBuckets(cands, opts);
    expect(out.length).toBe(6);
    // Exact membership + slot labels pinned
    const summary = out.map((c) => `${c.gameId}:${c.slot}`);
    expect(summary).toContain("10:comfort");
    expect(summary).toContain("20:comfort");
    expect(summary).toContain("30:comfort");
    expect(summary).toContain("40:backlog");
    expect(summary).toContain("50:friends");
    expect(summary).toContain("60:wildcard");
  });
});
