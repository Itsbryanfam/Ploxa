import { describe, expect, it } from "vitest";
import { playstyleFromMechanics } from "@/lib/taste/playstyle";

/**
 * Maps a user's mechanic vector to a single playstyle label for the
 * share card. Tiny function but user-facing (the label is on every
 * shared taste card). Test the three behaviors the spec promises:
 * highest score wins, ties break by declaration order, fallback to
 * "Curator" when nothing maps positive.
 */

describe("playstyleFromMechanics — highest score wins", () => {
  it("picks the label tied to the highest-scoring mechanic", () => {
    expect(playstyleFromMechanics({ Stealth: 0.9, Puzzle: 0.2 })).toBe("Operative");
  });

  it("ignores mechanics not in the PLAYSTYLE_MAP", () => {
    // "Bullet Hell" isn't a labeled style; a high score there shouldn't
    // override a lower-but-mapped score on a labeled mechanic.
    expect(
      playstyleFromMechanics({ "Bullet Hell": 0.95, Stealth: 0.2 }),
    ).toBe("Operative");
  });

  it("handles missing mechanics as zero", () => {
    // Only one labeled mechanic is present — it wins.
    expect(playstyleFromMechanics({ "Open World": 0.5 })).toBe("Wanderer");
  });
});

describe("playstyleFromMechanics — fallback to Curator", () => {
  it("returns Curator when no mechanics score positive (brand-new user)", () => {
    expect(playstyleFromMechanics({})).toBe("Curator");
  });

  it("returns Curator when all positive mechanics are unmapped", () => {
    expect(playstyleFromMechanics({ "Bullet Hell": 0.9, MOBA: 0.4 })).toBe("Curator");
  });

  it("returns Curator when mapped mechanics all score zero or negative", () => {
    expect(
      playstyleFromMechanics({ Stealth: 0, Puzzle: -0.3, "Open World": 0 }),
    ).toBe("Curator");
  });
});

describe("playstyleFromMechanics — tie-break", () => {
  it("breaks ties by declaration order in PLAYSTYLE_MAP", () => {
    // Turn-based is declared first in PLAYSTYLE_MAP — it wins ties.
    // (The implementation uses a strict-greater compare, so ties go to
    // whichever entry was scanned first → declaration order.)
    expect(
      playstyleFromMechanics({ "Turn-based": 0.5, "Real-Time Strategy": 0.5 }),
    ).toBe("Tactician");
  });

  it("collapses synonyms that map to the same label (Survivor)", () => {
    // PLAYSTYLE_MAP has both Permadeath and Roguelike → "Survivor".
    // Either should produce "Survivor" if it's the top score.
    expect(playstyleFromMechanics({ Permadeath: 0.7 })).toBe("Survivor");
    expect(playstyleFromMechanics({ Roguelike: 0.7 })).toBe("Survivor");
  });
});
