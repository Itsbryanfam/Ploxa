import { describe, expect, it } from "vitest";
import { isAtLeast, tierForUser } from "@/lib/taste/tier";

describe("tierForUser — boundary values", () => {
  it("returns 'empty' at zero logs", () => {
    expect(tierForUser(0)).toBe("empty");
  });

  it("returns 'empty' at negative log counts (defensive)", () => {
    expect(tierForUser(-1)).toBe("empty");
  });

  it("returns 'sparse' from 1 through 9 logs", () => {
    expect(tierForUser(1)).toBe("sparse");
    expect(tierForUser(5)).toBe("sparse");
    expect(tierForUser(9)).toBe("sparse");
  });

  it("crosses into 'sharpening' at exactly 10 logs", () => {
    expect(tierForUser(9)).toBe("sparse");
    expect(tierForUser(10)).toBe("sharpening");
  });

  it("returns 'sharpening' from 10 through 29 logs", () => {
    expect(tierForUser(10)).toBe("sharpening");
    expect(tierForUser(20)).toBe("sharpening");
    expect(tierForUser(29)).toBe("sharpening");
  });

  it("crosses into 'full' at exactly 30 logs", () => {
    expect(tierForUser(29)).toBe("sharpening");
    expect(tierForUser(30)).toBe("full");
  });

  it("stays 'full' for arbitrarily large counts", () => {
    expect(tierForUser(1_000_000)).toBe("full");
  });
});

describe("isAtLeast — tier ordering", () => {
  it("each tier is at least itself", () => {
    expect(isAtLeast("empty", "empty")).toBe(true);
    expect(isAtLeast("full", "full")).toBe(true);
  });

  it("higher tiers are at least lower ones", () => {
    expect(isAtLeast("full", "empty")).toBe(true);
    expect(isAtLeast("sharpening", "sparse")).toBe(true);
  });

  it("lower tiers are NOT at least higher ones", () => {
    expect(isAtLeast("empty", "sparse")).toBe(false);
    expect(isAtLeast("sparse", "full")).toBe(false);
  });
});
