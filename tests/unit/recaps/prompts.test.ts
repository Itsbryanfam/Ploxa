import { describe, expect, it } from "vitest";
import {
  buildOpeningPrompt,
  buildGotyPrompt,
  buildGenreDominancePrompt,
  buildMechanicLovePrompt,
  buildSurprisePrompt,
  buildTasteEvolutionPrompt,
  buildClosingPrompt,
} from "@/lib/recaps/prompts";

const sharedAssertions = (output: { system: string; user: string }) => {
  expect(output.system).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u); // no emoji
  expect(output.user).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  expect(output.system).not.toMatch(/!/);
  expect(output.user).not.toMatch(/!/);
  expect(output.system).toMatch(/no emojis/i);
};

describe("recap prompts", () => {
  it("opening prompt renders with totals", () => {
    const out = buildOpeningPrompt({
      totalGames: 47,
      year: 2026,
      reviewCount: 5,
      topGenre: "Action",
    });
    expect(out.user).toContain("47");
    expect(out.user).toContain("2026");
    expect(out.user).toContain("Action");
    sharedAssertions(out);
  });

  it("opening prompt substitutes 'varied' when topGenre is null", () => {
    const out = buildOpeningPrompt({
      totalGames: 12,
      year: 2026,
      reviewCount: 0,
      topGenre: null,
    });
    expect(out.user).toContain("varied");
    sharedAssertions(out);
  });

  it("goty prompt renders with title, rating, and status", () => {
    const out = buildGotyPrompt({
      title: "Hades II",
      rating: 5,
      status: "completed",
    });
    expect(out.user).toContain("Hades II");
    expect(out.user).toContain("5/5");
    expect(out.user).toContain("completed");
    sharedAssertions(out);
  });

  it("genre dominance prompt renders with top and second genre", () => {
    const out = buildGenreDominancePrompt({
      topGenre: "Action",
      topGenrePct: 42,
      secondGenre: "RPG",
      secondGenrePct: 23,
    });
    expect(out.user).toContain("Action");
    expect(out.user).toContain("42%");
    expect(out.user).toContain("RPG");
    expect(out.user).toContain("23%");
    sharedAssertions(out);
  });

  it("genre dominance prompt substitutes 'none' when second genre is null", () => {
    const out = buildGenreDominancePrompt({
      topGenre: "Strategy",
      topGenrePct: 80,
      secondGenre: null,
      secondGenrePct: 0,
    });
    expect(out.user).toContain("none");
    sharedAssertions(out);
  });

  it("mechanic love prompt renders with top mechanic", () => {
    const out = buildMechanicLovePrompt({ topMechanic: "Roguelite progression" });
    expect(out.user).toContain("Roguelite progression");
    sharedAssertions(out);
  });

  it("surprise prompt renders with game, genre, rating, and baseline", () => {
    const out = buildSurprisePrompt({
      game: "Stardew Valley",
      surpriseGenre: "Simulation",
      rating: 5,
      baselineAvg: 2.7,
    });
    expect(out.user).toContain("Stardew Valley");
    expect(out.user).toContain("Simulation");
    expect(out.user).toContain("5/5");
    expect(out.user).toContain("2.7/5");
    sharedAssertions(out);
  });

  it("taste evolution prompt renders with q1 and q4 vibes", () => {
    const out = buildTasteEvolutionPrompt({
      q1Vibe: "fast-paced shooters",
      q4Vibe: "cozy farm sims",
    });
    expect(out.user).toContain("fast-paced shooters");
    expect(out.user).toContain("cozy farm sims");
    sharedAssertions(out);
  });

  it("closing prompt renders with yearly window", () => {
    const out = buildClosingPrompt({
      topGame: "Hades II",
      topGenre: "Action",
      surpriseGame: "Stardew Valley",
      year: 2026,
      mode: "yearly",
    });
    expect(out.user).toContain("Hades II");
    expect(out.user).toContain("Action");
    expect(out.user).toContain("Stardew Valley");
    expect(out.user).toContain("2026");
    sharedAssertions(out);
  });

  it("closing prompt renders with monthly window and 'none' surprise", () => {
    const out = buildClosingPrompt({
      topGame: "Balatro",
      topGenre: "Card",
      surpriseGame: null,
      year: 2026,
      mode: "monthly",
    });
    expect(out.user).toContain("monthly recap");
    expect(out.user).toContain("none");
    sharedAssertions(out);
  });
});
