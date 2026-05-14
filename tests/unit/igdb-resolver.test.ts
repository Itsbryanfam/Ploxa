import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
vi.mock("@/lib/igdb/client", () => ({
  igdbQuery: (...args: unknown[]) => queryMock(...args),
}));

beforeEach(() => {
  queryMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveIgdbIds", () => {
  it("resolves Steam-appid games via external_games in one batched call", async () => {
    queryMock.mockImplementation(async (endpoint: string, body: string) => {
      if (endpoint === "external_games") {
        return [
          { game: 9999, uid: "730", category: 1 },  // Half-Life via Steam appid
          { game: 8888, uid: "440", category: 1 },  // TF2
        ];
      }
      throw new Error("unexpected endpoint: " + endpoint);
    });
    const { resolveIgdbIds } = await import("@/lib/igdb/resolver");
    const result = await resolveIgdbIds([
      { id: 1, title: "Half-Life", releaseYear: 1998, steamAppid: 730 },
      { id: 2, title: "TF2", releaseYear: 2007, steamAppid: 440 },
    ]);
    expect(result.get(1)?.igdbId).toBe(9999);
    expect(result.get(1)?.steamAppid).toBe(730);
    expect(result.get(2)?.igdbId).toBe(8888);
    expect(queryMock).toHaveBeenCalledTimes(1); // single batched call
  });

  it("falls back to name+year for non-Steam games", async () => {
    queryMock.mockImplementation(async (endpoint: string) => {
      if (endpoint === "games") return [{ id: 7777 }]; // name+year match
      return [];
    });
    const { resolveIgdbIds } = await import("@/lib/igdb/resolver");
    const result = await resolveIgdbIds([
      { id: 3, title: "Halo Infinite", releaseYear: 2021, steamAppid: null },
    ]);
    expect(result.get(3)?.igdbId).toBe(7777);
    expect(result.get(3)?.steamAppid).toBeNull();
    // Verify fallbackByNameYear constructed the expected query: name match
    // + epoch-second release-date window.
    expect(queryMock).toHaveBeenCalledWith(
      "games",
      expect.stringContaining('name = "Halo Infinite"'),
    );
    expect(queryMock).toHaveBeenCalledWith(
      "games",
      expect.stringMatching(/first_release_date > \d+ & first_release_date < \d+/),
    );
  });

  it("records null for unresolved games", async () => {
    queryMock.mockResolvedValue([]);
    const { resolveIgdbIds } = await import("@/lib/igdb/resolver");
    const result = await resolveIgdbIds([
      { id: 4, title: "Unknown Game", releaseYear: null, steamAppid: null },
    ]);
    expect(result.get(4)?.igdbId).toBeNull();
  });
});
