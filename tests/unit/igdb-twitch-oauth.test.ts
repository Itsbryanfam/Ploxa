import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub the db module BEFORE importing the helper. Pattern matches other
// unit tests that need to fake the database (see tests/unit/recs-cache.test.ts
// for precedent if it exists; otherwise this is the canonical pattern).
const dbState = new Map<string, { value: string; expiresAt: Date }>();
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => {
            const row = dbState.get("igdb_app_token");
            return row ? [{ value: row.value, expiresAt: row.expiresAt }] : [];
          }),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((row: { key: string; value: string; expiresAt: Date }) => ({
        onConflictDoUpdate: vi.fn(async () => {
          dbState.set(row.key, { value: row.value, expiresAt: row.expiresAt });
        }),
      })),
    })),
  },
}));

beforeEach(() => {
  dbState.clear();
  vi.stubEnv("IGDB_CLIENT_ID", "test_client_id");
  vi.stubEnv("IGDB_CLIENT_SECRET", "test_secret");
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    new Response(
      JSON.stringify({ access_token: "fresh_token_xyz", expires_in: 5_184_000, token_type: "bearer" }),
      { status: 200 },
    ),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getAppAccessToken", () => {
  it("fetches a new token when cache is empty", async () => {
    const { getAppAccessToken } = await import("@/lib/igdb/twitch-oauth");
    const token = await getAppAccessToken();
    expect(token).toBe("fresh_token_xyz");
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(dbState.get("igdb_app_token")?.value).toBe("fresh_token_xyz");
  });

  it("returns the cached token when not near expiry", async () => {
    dbState.set("igdb_app_token", {
      value: "cached_token",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour out
    });
    const { getAppAccessToken } = await import("@/lib/igdb/twitch-oauth");
    const token = await getAppAccessToken();
    expect(token).toBe("cached_token");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("refreshes when within 5 minutes of expiry", async () => {
    dbState.set("igdb_app_token", {
      value: "stale_token",
      expiresAt: new Date(Date.now() + 4 * 60 * 1000), // 4 min out
    });
    const { getAppAccessToken } = await import("@/lib/igdb/twitch-oauth");
    const token = await getAppAccessToken();
    expect(token).toBe("fresh_token_xyz");
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it("throws TwitchTokenUnavailableError after retry on Twitch 5xx", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response("server error", { status: 500 }),
    );
    const { getAppAccessToken, TwitchTokenUnavailableError } = await import("@/lib/igdb/twitch-oauth");
    await expect(getAppAccessToken()).rejects.toBeInstanceOf(TwitchTokenUnavailableError);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2); // initial + 1 retry
  });
});
