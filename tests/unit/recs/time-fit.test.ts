import { describe, expect, it } from "vitest";
import { timeFitScore, isTimeFeasible } from "@/lib/recs/time-fit";

describe("timeFitScore", () => {
  it("peaks at the sweet spot for 15min budget", () => {
    expect(timeFitScore(0.25, "15min")).toBeGreaterThan(0.95);
  });

  it("peaks at the sweet spot for 1hr budget", () => {
    expect(timeFitScore(1, "1hr")).toBeGreaterThan(0.95);
  });

  it("peaks at the sweet spot for 3hr+ budget", () => {
    expect(timeFitScore(5, "3hr+")).toBeGreaterThan(0.95);
  });

  it("decays away from peak", () => {
    expect(timeFitScore(2, "1hr")).toBeLessThan(timeFitScore(1, "1hr"));
  });

  it("returns 0.5 for NULL gameHours (neutral)", () => {
    expect(timeFitScore(null, "1hr")).toBe(0.5);
  });

  it("returns 0 for games above the hard cap", () => {
    expect(timeFitScore(3, "15min")).toBe(0); // cap 2.0
    expect(timeFitScore(10, "1hr")).toBe(0); // cap 8.0
  });

  it("bounds output to [0,1]", () => {
    for (const h of [0.1, 0.5, 1, 2, 5, 10, 20, 50, 100]) {
      for (const b of ["15min", "1hr", "3hr+", "multi-session"] as const) {
        const s = timeFitScore(h, b);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
      }
    }
  });

  it("returns 0 below the lower cap (regression guard for the feasibility delegation)", () => {
    expect(timeFitScore(1, "3hr+")).toBe(0); // below 2.0 lowerCap
    expect(timeFitScore(2, "multi-session")).toBe(0); // below 4.0 lowerCap
  });

  it("scores a game exactly at the upper cap as feasible (strict > boundary)", () => {
    // 2.0 === upperCap for 15min; strict `>` means the boundary is still
    // feasible, so the Gaussian (not 0) must apply. A >→>= change would break this.
    expect(timeFitScore(2.0, "15min")).toBeGreaterThan(0);
  });
});

describe("isTimeFeasible", () => {
  it("rejects 15min budget for >2h games", () => {
    expect(isTimeFeasible(3, "15min")).toBe(false);
    expect(isTimeFeasible(1.5, "15min")).toBe(true);
  });

  it("rejects 1hr budget for >8h games", () => {
    expect(isTimeFeasible(10, "1hr")).toBe(false);
    expect(isTimeFeasible(6, "1hr")).toBe(true);
  });

  it("requires >=2h for 3hr+ budget", () => {
    expect(isTimeFeasible(1, "3hr+")).toBe(false);
    expect(isTimeFeasible(5, "3hr+")).toBe(true);
  });

  it("requires >=4h for multi-session budget", () => {
    expect(isTimeFeasible(2, "multi-session")).toBe(false);
    expect(isTimeFeasible(20, "multi-session")).toBe(true);
  });

  it("treats NULL hours as feasible (neutral)", () => {
    expect(isTimeFeasible(null, "1hr")).toBe(true);
  });

  it("treats the exact cap boundary as feasible (strict inequality)", () => {
    expect(isTimeFeasible(2.0, "15min")).toBe(true); // === upperCap, > is strict
    expect(isTimeFeasible(2.0, "3hr+")).toBe(true); // === lowerCap, < is strict
  });

  // Task 7 acceptance-criteria regression guards — v2 hard time-filter contract.
  // These cases were wrong with the old loose timeWindow() approach:
  //   - timeWindow("1hr") returned [0,12] → 12h games passed.
  //   - timeWindow("multi-session") returned [10,Infinity] → 6h games were dropped.
  it("v2 filter contract: 12h game is EXCLUDED for '1hr' budget (upperCap 8.0)", () => {
    expect(isTimeFeasible(12, "1hr")).toBe(false);
  });

  it("v2 filter contract: 6h game is INCLUDED for 'multi-session' budget (lowerCap 4.0)", () => {
    expect(isTimeFeasible(6, "multi-session")).toBe(true);
  });

  it("v2 filter contract: null playtime stays ELIGIBLE for every budget (null-passthrough)", () => {
    for (const b of ["15min", "1hr", "3hr+", "multi-session"] as const) {
      expect(isTimeFeasible(null, b)).toBe(true);
    }
  });
});
