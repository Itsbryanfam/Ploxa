import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/igdb/vocabulary", () => ({
  IGDB_GAME_MODES: new Set(["Single player", "Multiplayer", "Co-operative"]),
  IGDB_PLAYER_PERSPECTIVES: new Set(["First person", "Third person"]),
  IGDB_THEMES: new Set(["Action", "Stealth"]),
  IGDB_MECHANICS: new Set(
    Array.from({ length: 25 }, (_, i) => `mechanic-${i}`),
  ),
}));

describe("normalizeFacets", () => {
  it("drops values not in the allow-list", async () => {
    const { normalizeFacets } = await import("@/lib/igdb/normalize");
    const out = normalizeFacets({
      game_modes: ["Single player", "Made-up Mode"],
      player_perspectives: ["First person", "Some Random"],
      themes: ["Action", "NotInList"],
      keywords: ["mechanic-0", "indie", "Linux"],
    });
    expect(out.gameModes).toEqual(["Single player"]);
    expect(out.playerPerspectives).toEqual(["First person"]);
    expect(out.themes).toEqual(["Action"]);
    expect(out.mechanics).toEqual(["mechanic-0"]);
  });

  it("dedupes case-insensitively, preserving canonical case", async () => {
    // Note: gameModes assertions provide the canonical-case-wins coverage
    // (canonical "Single player" beats input "SINGLE PLAYER"). The mechanics
    // mock is all-lowercase by construction (so the cap test can use 25
    // distinct entries), so the mechanics assertion below tests dedup only.
    const { normalizeFacets } = await import("@/lib/igdb/normalize");
    const out = normalizeFacets({
      game_modes: ["Single player", "single player", "SINGLE PLAYER"],
      player_perspectives: [],
      themes: [],
      keywords: ["mechanic-0", "MECHANIC-0", "mechanic-0"],
    });
    expect(out.gameModes).toEqual(["Single player"]);
    expect(out.mechanics).toEqual(["mechanic-0"]);
  });

  it("caps each facet at 20 entries", async () => {
    const { normalizeFacets } = await import("@/lib/igdb/normalize");
    // 25 distinct allow-listed mechanics — the cap should drop us to 20.
    const all25 = Array.from({ length: 25 }, (_, i) => `mechanic-${i}`);
    const out = normalizeFacets({
      game_modes: [],
      player_perspectives: [],
      themes: [],
      keywords: all25,
    });
    expect(out.mechanics).toHaveLength(20);
    // Order-preserving cap: should keep the FIRST 20 from input order.
    expect(out.mechanics).toEqual(all25.slice(0, 20));
  });

  it("trims whitespace before allow-list comparison", async () => {
    const { normalizeFacets } = await import("@/lib/igdb/normalize");
    const out = normalizeFacets({
      game_modes: ["  Single player  "],
      player_perspectives: [],
      themes: [],
      keywords: [],
    });
    expect(out.gameModes).toEqual(["Single player"]);
  });

  it("trims whitespace in allow-list entries (defensive against hand-curated padding)", async () => {
    vi.resetModules();
    vi.doMock("@/lib/igdb/vocabulary", () => ({
      IGDB_GAME_MODES: new Set(["  Single player  "]),
      IGDB_PLAYER_PERSPECTIVES: new Set<string>(),
      IGDB_THEMES: new Set<string>(),
      IGDB_MECHANICS: new Set<string>(),
    }));
    const { normalizeFacets } = await import("@/lib/igdb/normalize");
    const out = normalizeFacets({
      game_modes: ["Single player"],
      player_perspectives: [],
      themes: [],
      keywords: [],
    });
    // Vocabulary entry had padding; normalized output is the trimmed canonical.
    expect(out.gameModes).toEqual(["Single player"]);
    vi.doUnmock("@/lib/igdb/vocabulary");
    vi.resetModules();
  });
});
