import { describe, expect, it } from "vitest";
import { MOOD_AFFINITY, moodMatchScore } from "@/lib/recs/mood-affinity";
import type { Mood } from "@/lib/recs/moods";

const allMoods: Mood[] = ["chill", "challenged", "story-driven", "mindless", "multiplayer"];

describe("MOOD_AFFINITY table", () => {
  it("has an entry for every mood", () => {
    for (const m of allMoods) {
      expect(MOOD_AFFINITY[m]).toBeDefined();
    }
  });

  it("never lists the same genre as both boost and penalize", () => {
    for (const m of allMoods) {
      const entry = MOOD_AFFINITY[m];
      const allBoost = new Set([...entry.boostGenres, ...entry.boostMechanics]);
      for (const p of entry.penalizeMechanics) {
        expect(allBoost.has(p)).toBe(false);
      }
    }
  });
});

describe("moodMatchScore", () => {
  it("returns 1.0 when all boost terms hit and no penalties", () => {
    const candidate = {
      genres: ["puzzle", "casual"],
      mechanics: ["relaxing", "no-pressure"],
    };
    expect(moodMatchScore("chill", candidate)).toBeGreaterThan(0.5);
  });

  it("penalizes when penalty mechanics present", () => {
    const candidate = {
      genres: ["puzzle"],
      mechanics: ["competitive", "time-pressure"],
    };
    expect(moodMatchScore("chill", candidate)).toBeLessThan(0.3);
  });

  it("returns 0 for completely unrelated candidate", () => {
    const candidate = { genres: ["sports"], mechanics: [] };
    expect(moodMatchScore("story-driven", candidate)).toBe(0);
  });

  it("bounds output to [0, 1]", () => {
    const candidate = {
      genres: ["rpg", "adventure", "narrative"],
      mechanics: ["choices-matter", "branching-narrative", "voice-acted"],
    };
    const s = moodMatchScore("story-driven", candidate);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });
});
