import { describe, expect, it, vi } from "vitest";

// slug.ts imports @/lib/db at module level (for uniqueSlugForUser).
// Mock it so the module loads in the Vitest (plain Node) environment without
// a real DATABASE_URL. Only slugifyTitle (pure function) is tested here;
// uniqueSlugForUser is covered by Playwright integration in T24.
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
  },
  schema: {
    lists: {
      userId: { name: "user_id" },
      slug: { name: "slug" },
    },
  },
}));

const { slugifyTitle } = await import("@/lib/social/lists/slug");

describe("slugifyTitle", () => {
  it("simple title", () => {
    expect(slugifyTitle("My Favorite Games")).toBe("my-favorite-games");
  });

  it("collapses runs of non-alphanumeric", () => {
    expect(slugifyTitle("Hello!!! World???")).toBe("hello-world");
  });

  it("trims leading and trailing dashes", () => {
    expect(slugifyTitle("---hello---")).toBe("hello");
  });

  it("caps at 60 characters", () => {
    const long = "a".repeat(100);
    expect(slugifyTitle(long).length).toBe(60);
  });

  it("returns 'untitled' for empty after normalization", () => {
    expect(slugifyTitle("!!!")).toBe("untitled");
    expect(slugifyTitle("")).toBe("untitled");
    expect(slugifyTitle("   ")).toBe("untitled");
  });

  it("strips Unicode that isn't a-z0-9", () => {
    expect(slugifyTitle("Café 🎮 Games")).toBe("caf-games");
  });

  it("lowercases", () => {
    expect(slugifyTitle("UPPERCASE")).toBe("uppercase");
  });

  it("numbers are preserved", () => {
    expect(slugifyTitle("Best of 2026")).toBe("best-of-2026");
  });
});
