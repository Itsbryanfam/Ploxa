import { describe, expect, it } from "vitest";

import { gamePlatformsMatchUserFilter } from "@/lib/recs/platform-match";

/**
 * Regression tests for the /play-next platform filter. Previously the filter
 * compared raw `games.platforms` strings (RAWG names like "PC",
 * "PlayStation 4") against the picker's platform_kind enum values
 * ("steam", "xbox", "psn") with `Set.has()` — never matched, every combo
 * returned no-candidates.
 */
describe("gamePlatformsMatchUserFilter", () => {
  it("matches PlayStation 4/5 against psn filter", () => {
    expect(gamePlatformsMatchUserFilter(["PlayStation 4"], ["psn"])).toBe(true);
    expect(gamePlatformsMatchUserFilter(["PlayStation 5"], ["psn"])).toBe(true);
  });

  it("matches Xbox One / Series S/X against xbox filter", () => {
    expect(gamePlatformsMatchUserFilter(["Xbox One"], ["xbox"])).toBe(true);
    expect(gamePlatformsMatchUserFilter(["Xbox Series S/X"], ["xbox"])).toBe(true);
  });

  it("matches PC against a steam filter (Steam ↔ PC bridge)", () => {
    expect(gamePlatformsMatchUserFilter(["PC"], ["steam"])).toBe(true);
  });

  it("matches when at least one of multiple game platforms overlaps", () => {
    expect(
      gamePlatformsMatchUserFilter(
        ["PC", "PlayStation 4", "Xbox One"],
        ["psn"],
      ),
    ).toBe(true);
  });

  it("rejects when no game platform satisfies the user filter", () => {
    // Switch-only game, user only has Steam connected.
    expect(
      gamePlatformsMatchUserFilter(["Nintendo Switch"], ["steam"]),
    ).toBe(false);
  });

  it("rejects PC games for an xbox-only filter (no Steam ↔ PC bridge for xbox)", () => {
    expect(gamePlatformsMatchUserFilter(["PC"], ["xbox"])).toBe(false);
  });

  it("keeps games with null or empty platforms (catalog metadata gap)", () => {
    expect(gamePlatformsMatchUserFilter(null, ["steam"])).toBe(true);
    expect(gamePlatformsMatchUserFilter([], ["steam", "psn"])).toBe(true);
  });

  it("rejects unmapped platforms (e.g. iOS, macOS, Linux) from the picker filter", () => {
    expect(gamePlatformsMatchUserFilter(["iOS"], ["steam", "xbox", "psn"])).toBe(
      false,
    );
    expect(gamePlatformsMatchUserFilter(["macOS"], ["steam", "xbox", "psn"])).toBe(
      false,
    );
  });

  it("multi-platform user filter — game on any selected platform passes", () => {
    expect(
      gamePlatformsMatchUserFilter(["Xbox One"], ["steam", "xbox", "psn"]),
    ).toBe(true);
  });
});
