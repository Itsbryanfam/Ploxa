import { describe, expect, it } from "vitest";
import { cosineSim, drift, type VectorBundle } from "@/lib/taste/vectors";

/**
 * Vector math behind the daily-drift cron's "re-narrate?" decision. If
 * this regresses, the cron either fires too often (paid AI calls for no
 * change) or too rarely (stale narratives that don't reflect a user's
 * shifted taste). Both are silent failure modes — pinning the math.
 */

describe("cosineSim — direction-only similarity", () => {
  it("returns 1.0 for identical vectors", () => {
    const v = { rpg: 0.5, action: 0.3 };
    expect(cosineSim(v, v)).toBeCloseTo(1, 6);
  });

  it("returns 1.0 for vectors that differ only by scale (direction-only)", () => {
    // Cosine similarity is invariant to magnitude — that's the whole
    // point. A user logging 2x as many games in the same genre mix
    // should have drift = 0, not "OMG taste shifted."
    const a = { rpg: 1.0, action: 0.5 };
    const b = { rpg: 2.0, action: 1.0 };
    expect(cosineSim(a, b)).toBeCloseTo(1, 6);
  });

  it("returns -1.0 for opposite-sign vectors", () => {
    expect(cosineSim({ rpg: 1.0 }, { rpg: -1.0 })).toBeCloseTo(-1, 6);
  });

  it("returns 0 for orthogonal vectors (no shared dimension)", () => {
    expect(cosineSim({ rpg: 1.0 }, { puzzle: 1.0 })).toBeCloseTo(0, 6);
  });

  it("returns 0 when either vector is empty (no shared signal)", () => {
    expect(cosineSim({}, { rpg: 1 })).toBe(0);
    expect(cosineSim({ rpg: 1 }, {})).toBe(0);
    expect(cosineSim({}, {})).toBe(0);
  });

  it("treats missing keys as zero (sparse semantics)", () => {
    // Vector b has no "action" entry — that's the same as action=0.
    const a = { rpg: 1.0, action: 0.0 };
    const b = { rpg: 1.0 };
    expect(cosineSim(a, b)).toBeCloseTo(1, 6);
  });
});

describe("drift — max distance across genre + theme + mechanic", () => {
  // gameMode and playerPerspective are given identical non-empty values so
  // their axes contribute 0 cosine distance in these tests, keeping the
  // assertions focused on genre/theme/mechanic semantics.
  const allOnes: VectorBundle = {
    genre: { rpg: 1 },
    theme: { fantasy: 1 },
    mechanic: { turn_based: 1 },
    gameMode: { single_player: 1 },
    playerPerspective: { third_person: 1 },
  };

  it("returns 0 when current and snapshot are identical", () => {
    expect(drift(allOnes, allOnes)).toBeCloseTo(0, 6);
  });

  it("returns Infinity when no snapshot exists (forces a regen)", () => {
    expect(drift(allOnes, null)).toBe(Infinity);
  });

  it("returns the MAX distance across the three fields", () => {
    // Identical genre + theme + gameMode + playerPerspective; orthogonal mechanic → max distance = 1.
    const snapshot: VectorBundle = {
      genre: { rpg: 1 },
      theme: { fantasy: 1 },
      mechanic: { realtime: 1 },
      gameMode: { single_player: 1 },
      playerPerspective: { third_person: 1 },
    };
    expect(drift(allOnes, snapshot)).toBeCloseTo(1, 6);
  });

  it("captures the worst-shifted field, ignoring stable ones", () => {
    // genre drifted slightly; other axes untouched. The result
    // should reflect the genre drift, not be diluted by averaging.
    const snapshot: VectorBundle = {
      genre: { rpg: 1, action: 1 }, // 2D vector, drifted
      theme: { fantasy: 1 },
      mechanic: { turn_based: 1 },
      gameMode: { single_player: 1 },
      playerPerspective: { third_person: 1 },
    };
    const d = drift(allOnes, snapshot);
    // 1 - cosine of (1,0) and (1,1) = 1 - (1/√2) ≈ 0.293
    expect(d).toBeGreaterThan(0.1);
    expect(d).toBeLessThan(0.5);
  });
});
