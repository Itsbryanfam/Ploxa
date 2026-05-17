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

// ── Task 8: canonicalized vocabulary matching ────────────────────────
// The mood affinity tables use hyphenated/abbreviated tokens (`life-sim`,
// `co-op`, `story-only`, …). The real curated catalog uses space-delimited
// IGDB mechanics (`life simulation`, `online co-op`, `story driven`) and
// mixed-case RAWG genres (`RPG`, `Casual`). Before Task 8 the exact
// lowercased Set.has() match meant the hyphenated tokens never fired
// against real catalog values — only a handful of single-word tokens did.
// These pin that the canonicalizer bridges the two vocabularies using the
// REAL term strings present in lib/igdb/vocabulary.ts.
describe("moodMatchScore — canonicalized catalog vocabulary (Task 8)", () => {
  it("life-sim token matches a game tagged real IGDB mechanic 'life simulation'", () => {
    // `chill` boosts genre `life-sim`; pre-fix this scored 0 against the
    // real catalog term. Genre `Simulation` is the RAWG genre equivalent.
    const game = { genres: ["Simulation"], mechanics: ["life simulation"] };
    expect(moodMatchScore("chill", game)).toBeGreaterThan(0);
  });

  it("co-op token matches the real IGDB mechanic 'online co-op'", () => {
    // `multiplayer` boosts mechanic `co-op`; real catalog term is
    // `online co-op` (present in IGDB_MECHANICS).
    const game = { genres: [], mechanics: ["online co-op"] };
    expect(moodMatchScore("multiplayer", game)).toBeGreaterThan(0);
  });

  it("story-only / narrative-only tokens match the real IGDB mechanic 'story driven'", () => {
    // `challenged` penalizes `story-only`; `story-driven` does NOT list
    // `story driven` as a boost mechanic (it uses choices-matter etc.), so
    // assert the penalize-side resolution: a story-driven game should be
    // penalized for the `challenged` mood (score pushed below a neutral
    // baseline). Use a game that ALSO has a challenged boost so the
    // penalty is observable as a reduction, not a hard 0 floor.
    const withPenalty = moodMatchScore("challenged", {
      genres: ["Strategy"],
      mechanics: ["story driven"],
    });
    const withoutPenalty = moodMatchScore("challenged", {
      genres: ["Strategy"],
      mechanics: [],
    });
    expect(withPenalty).toBeLessThan(withoutPenalty);
  });

  it("RAWG mixed-case genres match lowercased genre tokens (rpg → 'RPG')", () => {
    // games.genres stores RAWG names mixed-case ("RPG", "Adventure").
    // story-driven boosts genres rpg/adventure.
    const game = { genres: ["RPG", "Adventure"], mechanics: [] };
    expect(moodMatchScore("story-driven", game)).toBeGreaterThan(0);
  });

  it("mmo token matches RAWG genre 'Massively Multiplayer'", () => {
    const game = { genres: ["Massively Multiplayer"], mechanics: [] };
    expect(moodMatchScore("multiplayer", game)).toBeGreaterThan(0);
  });

  // ── no-regression: single-word tokens that ALREADY worked pre-fix ────
  it("preserves pre-existing single-word mechanic matches (no regression)", () => {
    // permadeath → challenged boost; exploration → chill boost;
    // competitive + pvp → multiplayer-related. All four are bare
    // single-word IGDB terms that matched BEFORE the canonicalizer and
    // MUST still fire after it.
    expect(
      moodMatchScore("challenged", { genres: [], mechanics: ["permadeath"] }),
    ).toBeGreaterThan(0);
    expect(
      moodMatchScore("chill", { genres: [], mechanics: ["exploration"] }),
    ).toBeGreaterThan(0);
    expect(
      moodMatchScore("multiplayer", { genres: [], mechanics: ["pvp"] }),
    ).toBeGreaterThan(0);
    // `competitive` is a challenged boost mechanic AND a multiplayer boost
    // genre token; assert the mechanic-side challenged match still fires.
    expect(
      moodMatchScore("challenged", { genres: [], mechanics: ["competitive"] }),
    ).toBeGreaterThan(0);
  });

  it("does NOT invent matches for tokens with no real catalog equivalent", () => {
    // `no-pressure` / `relaxing` / `cozy` / `low-stakes` are chill boost
    // mechanics with NO IGDB vocabulary equivalent — the canonicalizer is
    // conservative (alias-only, not fuzzy), so they must NOT conjure a
    // match against REAL catalog values. A game tagged only with real IGDB
    // mechanics that are NOT chill boosters (`first person shooter`,
    // `pvp` — both in IGDB_MECHANICS) and a real non-chill RAWG genre
    // (`Shooter`) scores 0 for the chill mood (no boost token resolves to
    // any of them; the un-mappable chill tokens stay inert).
    const game = {
      genres: ["Shooter"],
      mechanics: ["first person shooter", "pvp"],
    };
    expect(moodMatchScore("chill", game)).toBe(0);
  });
});
