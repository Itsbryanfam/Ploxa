import { describe, expect, it } from "vitest";
import { computeSocialScore, sigmoid } from "@/lib/recs/social-score";

describe("sigmoid", () => {
  it("returns 0.5 at 0", () => {
    expect(sigmoid(0)).toBeCloseTo(0.5, 3);
  });

  it("bounds to (0, 1)", () => {
    expect(sigmoid(-10)).toBeGreaterThan(0);
    expect(sigmoid(10)).toBeLessThan(1);
  });
});

describe("computeSocialScore", () => {
  it("returns 0 when no friends played or liked", () => {
    expect(computeSocialScore({ friendsPlayed: 0, friendsLiked: 0 })).toBe(0);
  });

  it("weights likes more than plays", () => {
    const playOnly = computeSocialScore({ friendsPlayed: 2, friendsLiked: 0 });
    const likeOnly = computeSocialScore({ friendsPlayed: 0, friendsLiked: 2 });
    expect(likeOnly).toBeGreaterThan(playOnly);
  });

  it("bounds to (0, 1)", () => {
    const high = computeSocialScore({ friendsPlayed: 100, friendsLiked: 100 });
    expect(high).toBeGreaterThan(0.9);
    expect(high).toBeLessThan(1);
  });

  it("monotonically increases with more friends", () => {
    const a = computeSocialScore({ friendsPlayed: 1, friendsLiked: 0 });
    const b = computeSocialScore({ friendsPlayed: 5, friendsLiked: 0 });
    expect(b).toBeGreaterThan(a);
  });
});
