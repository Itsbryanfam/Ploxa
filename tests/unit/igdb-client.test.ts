import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/igdb/twitch-oauth", () => ({
  getAppAccessToken: vi.fn(async () => "tok_xyz"),
}));

beforeEach(() => {
  vi.stubEnv("IGDB_CLIENT_ID", "test_client_id");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("igdbQuery", () => {
  it("POSTs to api.igdb.com/v4/<endpoint> with bearer + client-id headers", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify([{ id: 1, name: "Half-Life" }]), { status: 200 }),
    );
    const { igdbQuery } = await import("@/lib/igdb/client");
    const result = await igdbQuery<Array<{ id: number; name: string }>>(
      "games",
      "fields name; where id = 1;",
    );
    expect(result).toEqual([{ id: 1, name: "Half-Life" }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.igdb.com/v4/games");
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["Client-ID"]).toBe("test_client_id");
    expect(headers.Authorization).toBe("Bearer tok_xyz");
    expect((init as RequestInit).body).toBe("fields name; where id = 1;");
  });

  it("throws IgdbApiError on non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response("bad query", { status: 400 }),
    );
    const { igdbQuery, IgdbApiError } = await import("@/lib/igdb/client");
    await expect(igdbQuery("games", "bad")).rejects.toBeInstanceOf(IgdbApiError);
  });

  it("throws IgdbApiError when IGDB_CLIENT_ID is missing", async () => {
    vi.unstubAllEnvs();
    // Works because client.ts reads process.env.IGDB_CLIENT_ID at call time,
    // not at module evaluation time. If that read is ever moved to module
    // scope, this test must switch to vi.resetModules() + re-import.
    const { igdbQuery, IgdbApiError } = await import("@/lib/igdb/client");
    await expect(igdbQuery("games", "")).rejects.toBeInstanceOf(IgdbApiError);
  });
});
