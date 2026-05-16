import { describe, expect, it } from "vitest";
import { composeScore, SCORE_WEIGHTS } from "@/lib/recs/scoring";

const baseInput = {
  taste: 1.0,
  mood: 1.0,
  timeFit: 1.0,
  social: 1.0,
  libraryBonus: 1.0,
  recencyQuality: 1.0,
  softNegPenalty: 1.0,
};

describe("SCORE_WEIGHTS", () => {
  it("sums to 1.0", () => {
    const total =
      SCORE_WEIGHTS.taste +
      SCORE_WEIGHTS.mood +
      SCORE_WEIGHTS.timeFit +
      SCORE_WEIGHTS.social +
      SCORE_WEIGHTS.libraryBonus +
      SCORE_WEIGHTS.recencyQuality;
    expect(total).toBeCloseTo(1.0, 5);
  });
});

describe("composeScore", () => {
  it("returns 1.0 when all axes max and no penalty", () => {
    expect(composeScore(baseInput)).toBeCloseTo(1.0, 5);
  });

  it("returns 0 when all axes max but soft-neg penalty is 0", () => {
    expect(composeScore({ ...baseInput, softNegPenalty: 0 })).toBe(0);
  });

  it("applies taste at expected weight", () => {
    const onlyTaste = composeScore({
      ...baseInput,
      mood: 0,
      timeFit: 0,
      social: 0,
      libraryBonus: 0,
      recencyQuality: 0,
    });
    expect(onlyTaste).toBeCloseTo(SCORE_WEIGHTS.taste, 5);
  });

  it("applies mood at expected weight", () => {
    const onlyMood = composeScore({
      ...baseInput,
      taste: 0,
      timeFit: 0,
      social: 0,
      libraryBonus: 0,
      recencyQuality: 0,
    });
    expect(onlyMood).toBeCloseTo(SCORE_WEIGHTS.mood, 5);
  });

  it("clamps output to [0,1]", () => {
    // Inputs above 1.0 shouldn't break the bound
    const s = composeScore({ ...baseInput, taste: 5, mood: 5 });
    expect(s).toBeLessThanOrEqual(1);
  });

  it("multiplies penalty AFTER weighted sum", () => {
    const half = composeScore({ ...baseInput, softNegPenalty: 0.5 });
    const full = composeScore(baseInput);
    expect(half).toBeCloseTo(full * 0.5, 5);
  });
});

describe("composeScore axis weight isolation", () => {
  const zeroed = {
    taste: 0,
    mood: 0,
    timeFit: 0,
    social: 0,
    libraryBonus: 0,
    recencyQuality: 0,
    softNegPenalty: 1,
  };

  it.each([
    "taste",
    "mood",
    "timeFit",
    "social",
    "libraryBonus",
    "recencyQuality",
  ] as const)("applies %s at exactly its SCORE_WEIGHTS value", (axis) => {
    const only = composeScore({ ...zeroed, [axis]: 1 });
    expect(only).toBeCloseTo(SCORE_WEIGHTS[axis], 5);
  });

  it("clamps negative axis inputs to 0 (lower-bound clamp)", () => {
    // taste(-5) & mood(-10) floor to 0; timeFit+social+libraryBonus = 0.2+0.1+0.1
    const s = composeScore({
      taste: -5,
      mood: -10,
      timeFit: 1,
      social: 1,
      libraryBonus: 1,
      recencyQuality: 0,
      softNegPenalty: 1,
    });
    expect(s).toBeCloseTo(
      SCORE_WEIGHTS.timeFit + SCORE_WEIGHTS.social + SCORE_WEIGHTS.libraryBonus,
      5,
    );
  });
});
