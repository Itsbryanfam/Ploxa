import { describe, expect, it } from "vitest";
import { mergeImportedGame } from "@/lib/imports/merge";
import type { ImportedGame } from "@/lib/imports/adapters/types";

// Helper: build a minimal ImportedGame; tests override what they care about.
function game(overrides: Partial<ImportedGame> & { gameId: number }): ImportedGame & {
  gameId: number;
} {
  return {
    externalId: "ext-1",
    title: "Test Game",
    hoursPlayed: null,
    lastPlayedAt: null,
    releaseYear: null,
    ...overrides,
  };
}

describe("mergeImportedGame", () => {
  it("inserts a new log when no existing log is found", () => {
    const result = mergeImportedGame(
      game({ gameId: 42, hoursPlayed: 12 }),
      null,
      "steam",
    );
    expect(result).toEqual({
      action: "insert",
      row: {
        gameId: 42,
        status: "backlog",
        platforms: ["steam"],
        platformPlayedOn: "steam",
        hoursPlayed: 12,
      },
    });
  });

  it("unions platforms when an existing log is found", () => {
    const result = mergeImportedGame(
      game({ gameId: 42 }),
      { id: "log-1", platforms: ["xbox"], platformPlayedOn: "xbox", hoursPlayed: null },
      "steam",
    );
    if (result.action !== "update") throw new Error("expected update");
    expect(result.set.platforms.sort()).toEqual(["steam", "xbox"]);
  });

  it("falls back to platformPlayedOn when platforms array is null", () => {
    // Legacy logs predate the platforms[] column — verify the fallback.
    const result = mergeImportedGame(
      game({ gameId: 42 }),
      { id: "log-1", platforms: null, platformPlayedOn: "psn", hoursPlayed: null },
      "steam",
    );
    if (result.action !== "update") throw new Error("expected update");
    expect(result.set.platforms.sort()).toEqual(["psn", "steam"]);
  });

  it("deduplicates when re-importing from the same platform", () => {
    const result = mergeImportedGame(
      game({ gameId: 42 }),
      { id: "log-1", platforms: ["steam"], platformPlayedOn: "steam", hoursPlayed: 5 },
      "steam",
    );
    if (result.action !== "update") throw new Error("expected update");
    expect(result.set.platforms).toEqual(["steam"]);
  });

  it("takes max(existing, imported) hoursPlayed", () => {
    const result = mergeImportedGame(
      game({ gameId: 42, hoursPlayed: 5 }),
      { id: "log-1", platforms: ["xbox"], platformPlayedOn: "xbox", hoursPlayed: 12 },
      "steam",
    );
    if (result.action !== "update") throw new Error("expected update");
    expect(result.set.hoursPlayed).toBe(12);
  });

  it("preserves null hoursPlayed when both sides are null (no false zero)", () => {
    // Earlier bug: Math.max(null ?? 0, null ?? 0) returned 0, masking
    // "we don't know the playtime" as "0 hours played". Fix in merge.ts
    // returns null when both are null.
    const result = mergeImportedGame(
      game({ gameId: 42, hoursPlayed: null }),
      { id: "log-1", platforms: ["xbox"], platformPlayedOn: "xbox", hoursPlayed: null },
      "steam",
    );
    if (result.action !== "update") throw new Error("expected update");
    expect(result.set.hoursPlayed).toBeNull();
  });

  it("treats one-side-null as the known value (not zero)", () => {
    const a = mergeImportedGame(
      game({ gameId: 42, hoursPlayed: null }),
      { id: "log-1", platforms: ["xbox"], platformPlayedOn: "xbox", hoursPlayed: 8 },
      "steam",
    );
    if (a.action !== "update") throw new Error("expected update");
    expect(a.set.hoursPlayed).toBe(8);

    const b = mergeImportedGame(
      game({ gameId: 42, hoursPlayed: 8 }),
      { id: "log-1", platforms: ["xbox"], platformPlayedOn: "xbox", hoursPlayed: null },
      "steam",
    );
    if (b.action !== "update") throw new Error("expected update");
    expect(b.set.hoursPlayed).toBe(8);
  });

  it("tags update result with the platform_merge conflict rule", () => {
    const result = mergeImportedGame(
      game({ gameId: 42 }),
      { id: "log-1", platforms: ["xbox"], platformPlayedOn: "xbox", hoursPlayed: null },
      "steam",
    );
    if (result.action !== "update") throw new Error("expected update");
    expect(result.rule).toBe("platform_merge");
  });
});
