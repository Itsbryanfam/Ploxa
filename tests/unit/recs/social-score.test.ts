import { describe, expect, it, vi } from "vitest";

// social-score.ts eagerly does `import { db } from "@/lib/db"` (same
// convention as its sibling candidate-pool.ts). Importing the real module
// would instantiate a postgres-js client. Mock @/lib/db to a minimal stub
// so the eager import resolves — these tests only exercise the pure
// computeSocialScore/sigmoid exports, so the stub's methods are never
// called. `server-only` is already aliased to a no-op by vitest.config.ts.
vi.mock("@/lib/db", () => {
  return {
    db: {
      select: vi.fn(),
    },
  };
});

const { computeSocialScore, sigmoid } = await import("@/lib/recs/social-score");

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

  it("is a small positive for a single weak signal (sign guard at the contract boundary)", () => {
    // Task 8: coefficients restored to the spec 0.3/0.5 (were 10× shrunk to
    // 0.03/0.05 as a now-replaced float64-saturation guard). 1 play →
    // 2*(sigmoid(0.3)-0.5) ≈ 0.149. The PRE-Task-8 `< 0.1` bound encoded the
    // shrunk-coefficient bug (it asserted the ~0.015 the 10×-low coeffs gave)
    // — corrected here to the spec contract value.
    const s = computeSocialScore({ friendsPlayed: 1, friendsLiked: 0 });
    expect(s).toBeGreaterThan(0);
    expect(s).toBeCloseTo(2 * (sigmoid(0.3) - 0.5), 6); // ≈ 0.1489
  });

  it("matches the spec value for a single like (0.3/0.5 coeffs restored)", () => {
    // Spec (2026-05-15-play-next-redesign-design.md ~:181):
    //   socialScore = sigmoid(0.3*friendsPlayed + 0.5*friendsLiked)
    // wrapped in the existing 2*(sigmoid(x)-0.5) zero-anchor rescale.
    // 1 like → 2*(sigmoid(0.5)-0.5) ≈ 0.2449.
    const s = computeSocialScore({ friendsPlayed: 0, friendsLiked: 1 });
    expect(s).toBeCloseTo(2 * (sigmoid(0.5) - 0.5), 6);
    expect(s).toBeCloseTo(0.2449, 3);
  });

  it("stays strictly below 1 even at extreme counts (guards the saturation fix)", () => {
    // The spec coeffs push the sigmoid arg into float64 saturation
    // (sigmoid(250) === 1.0 exactly → naked wrapper === 1.0). The restored
    // implementation must keep the strict < 1 contract for ARBITRARILY
    // large inputs, not just the realistic range.
    expect(computeSocialScore({ friendsPlayed: 0, friendsLiked: 500 })).toBeLessThan(1);
    expect(computeSocialScore({ friendsPlayed: 100, friendsLiked: 100 })).toBeLessThan(1);
    expect(
      computeSocialScore({ friendsPlayed: 1e9, friendsLiked: 1e9 }),
    ).toBeLessThan(1);
  });

  it("keeps the spec ranking exact for realistic friend counts", () => {
    // The < 1 saturation guard must NOT perturb the score at any realistic
    // count — the spec 0.3/0.5 formula governs ranking verbatim here.
    const expected = (p: number, l: number) =>
      2 * (sigmoid(0.3 * p + 0.5 * l) - 0.5);
    for (const [p, l] of [
      [2, 0],
      [0, 2],
      [5, 0],
      [3, 2],
      [1, 4],
      [10, 10],
      [40, 0],
      [0, 72],
    ] as const) {
      expect(computeSocialScore({ friendsPlayed: p, friendsLiked: l })).toBe(
        expected(p, l),
      );
    }
  });
});
