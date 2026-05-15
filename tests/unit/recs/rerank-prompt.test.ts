import { describe, expect, it } from "vitest";
import {
  buildRerankPrompt,
  RERANK_PROMPT_VERSION,
  type RerankPromptInput,
} from "@/lib/taste/prompts";

const baseInput: RerankPromptInput = {
  narrative: "loves tight combat games",
  vectors: {
    genre: { roguelike: 0.8 },
    theme: {},
    mechanic: { permadeath: 0.6 },
    gameMode: {},
    playerPerspective: {},
  },
  filters: { moods: ["challenged"], time: "1hr", platforms: ["steam"] },
  candidates: [
    { id: 1, title: "Hades", genres: ["roguelike"], themes: [], mechanics: ["permadeath"], playtimeAvgHours: 20, description: null },
    { id: 2, title: "Slay the Spire", genres: ["roguelike"], themes: [], mechanics: ["deck-building"], playtimeAvgHours: 25, description: null },
  ],
  dismissedGames: [],
  currentlyPlaying: [],
  libraryTitles: ["Hollow Knight", "Celeste"],
};

describe("buildRerankPrompt — v2 additions", () => {
  it("RERANK_PROMPT_VERSION bumped to v2 (string)", () => {
    expect(RERANK_PROMPT_VERSION).toBe("v2");
  });

  it("includes user refinements block when non-empty", () => {
    const { user } = buildRerankPrompt({ ...baseInput, userRefinements: ["less grindy", "shorter please"] });
    expect(user).toMatch(/ADDITIONAL USER REQUESTS/);
    expect(user).toMatch(/less grindy/);
    expect(user).toMatch(/shorter please/);
  });

  it("omits refinements block when empty", () => {
    const { user } = buildRerankPrompt({ ...baseInput, userRefinements: [] });
    expect(user).not.toMatch(/ADDITIONAL USER REQUESTS/);
  });

  it("includes library titles for grounding when provided", () => {
    const { user } = buildRerankPrompt({ ...baseInput, libraryTitles: ["Stardew Valley"] });
    expect(user).toMatch(/Stardew Valley/);
    expect(user).toMatch(/cite specific games/i);
  });

  it("clamps refinements to 140 chars each and 5 entries max", () => {
    const long = "x".repeat(200);
    const many = ["a", "b", "c", "d", "e", "f", "g"];
    const { user } = buildRerankPrompt({ ...baseInput, userRefinements: [long, ...many] });
    const lines = user.split("\n").filter((l) => l.startsWith("- "));
    expect(lines.length).toBe(5); // 8 entries → clamped to REFINEMENT_MAX
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(143); // "- " + 140
  });
});
