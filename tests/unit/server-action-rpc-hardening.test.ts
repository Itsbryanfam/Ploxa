import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Server-action RPC hardening (T01 / 2026-05-14 audit).
 *
 * Every `"use server"` export is a public RPC: any authenticated network
 * caller can invoke it with arbitrary args. Four exports were trusting
 * caller-supplied identity:
 *   1. ensureLog({ userId, gameId, ... }) — accepted attacker's userId
 *   2. getFingerprint(userId)              — bypassed page-level visibility gate
 *   3. getProfileByUsername / ByUserId     — leaked bio + displayName for private profiles
 *   4. getFeed({ viewerId, ... })          — let probe-by-viewerId enumerate blocks
 *
 * These tests pin the new contracts:
 *   - ensureLog derives userId from session; no longer accepts userId arg
 *   - getFingerprint enforces owner-or-public visibility
 *   - getProfileBy* redacts bio + displayName for non-owner viewers of private profiles
 *   - getFeed derives viewerId from session; no longer accepts viewerId arg
 *
 * Mock strategy:
 *   - `@/lib/db` is a thenable-chainable mock (compatible with both await
 *     and promise terminators).
 *   - `@/lib/supabase/auth-cache::getCachedUser` is overridable per test.
 *   - `vi.resetModules()` in beforeEach so `vi.mocked(getCachedUser)`
 *     overrides are honored on the next dynamic import.
 */

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

// Chainable + thenable mock for the broad `db.select().from().where()` chain.
// Each per-test test wires `selectImpl` for the final terminator.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let selectImpl: (...args: any[]) => any = () => Promise.resolve([]);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let findFirstImpl: (...args: any[]) => any = () => Promise.resolve(undefined);
const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();
// `insert(...).values(arg)` — captures the row passed to values() so tests can
// assert the actual userId column came from the session, not a caller arg.
const insertValuesSpy = vi.fn();
// `select(...).from(...).where(arg)` — captures the where-clause input. With
// the drizzle-orm mock below, `eq(col, val)` returns `[col, val]`, so each
// where-call's first arg is shape `[col, val]` (or for `and(...)`, an array
// of those tuples). Tests can walk this to find the userId argument.
const selectWhereSpy = vi.fn();

vi.mock("@/lib/db", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function chainable(): any {
    const c: Record<string, unknown> = {};
    const wrap = (fn: () => unknown) => fn;
    c.select = vi.fn(() => c);
    c.from = vi.fn(() => c);
    c.innerJoin = vi.fn(() => c);
    c.leftJoin = vi.fn(() => c);
    // `where` returns a thenable that ALSO has further chain methods —
    // some callers do `.where()` then await; others do `.where().limit()`.
    c.where = vi.fn((whereArg: unknown) => {
      // Capture the where-clause input so tests can verify the userId
      // passed to e.g. `where(eq(follows.followerId, viewerId))` came from
      // the session, not a caller-supplied arg.
      selectWhereSpy(whereArg);
      const result = selectImpl();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const obj: any = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        then(resolve: (v: any) => any, reject?: (e: unknown) => any) {
          return Promise.resolve(result).then(resolve, reject);
        },
        limit: vi.fn(() => Promise.resolve(result)),
        orderBy: vi.fn(() => Promise.resolve(result)),
      };
      return obj;
    });
    c.values = wrap(() => ({
      onConflictDoUpdate: vi.fn(() => Promise.resolve()),
      onConflictDoNothing: vi.fn(() => Promise.resolve()),
      returning: vi.fn(() => Promise.resolve([{ id: "log-1" }])),
    }));
    c.set = vi.fn(() => ({
      where: vi.fn(() => Promise.resolve()),
    }));
    c.insert = vi.fn(() => {
      insertMock();
      return {
        // Pipe through the shared `insertValuesSpy` so tests can assert the
        // actual row payload (and specifically that `userId` was the session
        // user, not a caller-supplied value).
        values: vi.fn((arg: unknown) => {
          insertValuesSpy(arg);
          return {
            onConflictDoUpdate: vi.fn(() => Promise.resolve()),
            onConflictDoNothing: vi.fn(() => Promise.resolve()),
            returning: vi.fn(() => Promise.resolve([{ id: "log-1" }])),
          };
        }),
      };
    });
    c.update = vi.fn(() => {
      updateMock();
      return {
        set: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve()),
        })),
      };
    });
    c.delete = vi.fn(() => {
      deleteMock();
      return {
        where: vi.fn(() => Promise.resolve()),
      };
    });
    return c;
  }

  return {
    db: {
      ...chainable(),
      query: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        profiles: { findFirst: (...a: any[]) => findFirstImpl(...a) },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        logs: { findFirst: (...a: any[]) => findFirstImpl(...a) },
      },
    },
    schema: {
      profiles: {
        userId: { name: "user_id" },
        username: { name: "username" },
        displayName: { name: "display_name" },
        bio: { name: "bio" },
        isPublic: { name: "is_public" },
        deletedAt: { name: "deleted_at" },
        profilePictureUrl: { name: "profile_picture_url" },
        profilePictureKind: { name: "profile_picture_kind" },
      },
      logs: {
        id: { name: "id" },
        userId: { name: "user_id" },
        gameId: { name: "game_id" },
        status: { name: "status" },
        platforms: { name: "platforms" },
        isReplay: { name: "is_replay" },
      },
      games: {},
      reviews: {},
      tasteFingerprints: { userId: { name: "user_id" } },
      follows: {},
      blocks: {},
    },
  };
});

// Stub drizzle operators — they're called with mock schema fields (plain
// strings) and primitive userIds; we just need to reflect both args back so
// `selectWhereSpy` can recover the userId from `eq(col, val)` calls.
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  asc: (a: unknown) => a,
  desc: (a: unknown) => a,
  eq: (a: unknown, b: unknown) => [a, b],
  inArray: (a: unknown, b: unknown) => [a, b],
  isNotNull: (a: unknown) => a,
  isNull: (a: unknown) => a,
  or: (...args: unknown[]) => args,
  sql: Object.assign((s: TemplateStringsArray) => s[0], {}),
}));

// Re-importable from anywhere via a single mock object.
const getCachedUserMock = vi.fn();
vi.mock("@/lib/supabase/auth-cache", () => ({
  getCachedUser: getCachedUserMock,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/security/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  clientIpForRateLimit: vi.fn().mockResolvedValue("127.0.0.1"),
  RateLimitedError: class RateLimitedError extends Error {},
}));

// Indirect dependencies pulled in by the modules under test.
vi.mock("@/lib/games/server-actions", () => ({
  getGameDetail: vi.fn(),
}));

vi.mock("@/lib/taste/triggers", () => ({
  triggerOnLogWrite: vi.fn(),
}));

vi.mock("@/lib/taste/aggregate", () => ({
  aggregateFingerprint: vi.fn(() => ({
    genre: {},
    theme: {},
    mechanic: {},
    gameMode: {},
    playerPerspective: {},
    lengthPreference: {},
  })),
}));

vi.mock("@/lib/taste/tier", () => ({
  tierForUser: vi.fn(() => "empty"),
}));

vi.mock("@/lib/social/feed/queries", () => ({
  buildFeedQuery: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/social/_shared/cursors", () => ({
  decodeCursor: vi.fn(() => null),
  encodeCursor: vi.fn(() => "cursor"),
}));

beforeEach(() => {
  insertMock.mockReset();
  updateMock.mockReset();
  deleteMock.mockReset();
  insertValuesSpy.mockReset();
  selectWhereSpy.mockReset();
  getCachedUserMock.mockReset();
  selectImpl = () => Promise.resolve([]);
  findFirstImpl = () => Promise.resolve(undefined);
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// ensureLog — derives userId from session; no longer accepts userId
// ---------------------------------------------------------------------------

describe("ensureLog (lib/logs/server-actions)", () => {
  it("returns ok:false 'not-signed-in' when no session", async () => {
    getCachedUserMock.mockResolvedValue(null);
    const { ensureLog } = await import("@/lib/logs/server-actions");
    const result = await ensureLog({ gameId: 42, status: "backlog" });
    expect(result).toEqual({ ok: false, error: "not-signed-in" });
    // Critically: nothing inserted, even though gameId/status were valid.
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("uses session.id, not any caller-supplied userId-like field", async () => {
    // The post-hardening signature does not accept userId. Call with the
    // documented args; insert should still fire and the row passed to
    // values() must carry the SESSION userId, not any caller-supplied one.
    // This is the regression bar: a refactor that re-introduced `userId` as
    // a caller arg (or trusted a prop on `input`) would land a row with the
    // attacker's id here.
    getCachedUserMock.mockResolvedValue({ id: "session-user", email: "u@e.com" });
    const { ensureLog } = await import("@/lib/logs/server-actions");
    const result = await ensureLog({ gameId: 42, status: "backlog" });
    expect(result).toEqual({ ok: true });
    expect(insertMock).toHaveBeenCalled();
    expect(insertValuesSpy).toHaveBeenCalled();
    expect(insertValuesSpy.mock.calls[0][0]).toMatchObject({
      userId: "session-user",
      gameId: 42,
      status: "backlog",
    });
  });
});

// ---------------------------------------------------------------------------
// getFingerprint — owner-or-public visibility check
// ---------------------------------------------------------------------------

describe("getFingerprint (lib/taste/server-actions)", () => {
  it("returns null when caller is not signed in and target profile is private", async () => {
    getCachedUserMock.mockResolvedValue(null);
    findFirstImpl = () =>
      Promise.resolve({
        userId: "target-user",
        isPublic: false,
        deletedAt: null,
      });
    const { getFingerprint } = await import("@/lib/taste/server-actions");
    const result = await getFingerprint("target-user");
    expect(result).toBeNull();
  });

  it("returns null when caller is not the target AND target profile is private", async () => {
    getCachedUserMock.mockResolvedValue({ id: "viewer", email: "v@e.com" });
    findFirstImpl = () =>
      Promise.resolve({
        userId: "target-user",
        isPublic: false,
        deletedAt: null,
      });
    const { getFingerprint } = await import("@/lib/taste/server-actions");
    const result = await getFingerprint("target-user");
    expect(result).toBeNull();
  });

  it("returns null when target profile is soft-deleted (even if public)", async () => {
    getCachedUserMock.mockResolvedValue({ id: "viewer", email: "v@e.com" });
    findFirstImpl = () =>
      Promise.resolve({
        userId: "target-user",
        isPublic: true,
        deletedAt: new Date(),
      });
    const { getFingerprint } = await import("@/lib/taste/server-actions");
    const result = await getFingerprint("target-user");
    expect(result).toBeNull();
  });

  it("returns null when owner views their own soft-deleted profile (during 30-day grace)", async () => {
    // viewer = target = u1 AND target is soft-deleted. The intentional
    // contract is "soft-deleted profiles surface in NO read path during the
    // grace window" — even for the owner. A regression flipping the gate to
    // `!isOwner && deletedAt !== null` would let the owner still see their
    // own data here; this test pins the current "always null when deleted".
    getCachedUserMock.mockResolvedValue({ id: "u1", email: "u@e.com" });
    findFirstImpl = () =>
      Promise.resolve({
        userId: "u1",
        isPublic: true,
        deletedAt: new Date(),
      });
    const { getFingerprint } = await import("@/lib/taste/server-actions");
    const result = await getFingerprint("u1");
    expect(result).toBeNull();
  });

  it("returns null when target profile does not exist", async () => {
    getCachedUserMock.mockResolvedValue({ id: "viewer", email: "v@e.com" });
    findFirstImpl = () => Promise.resolve(undefined);
    const { getFingerprint } = await import("@/lib/taste/server-actions");
    const result = await getFingerprint("nonexistent-user");
    expect(result).toBeNull();
  });

  it("returns snapshot when caller IS the target user (owner path)", async () => {
    getCachedUserMock.mockResolvedValue({ id: "u1", email: "u@e.com" });
    findFirstImpl = () =>
      Promise.resolve({ userId: "u1", isPublic: false, deletedAt: null });
    // Aggregation rows
    selectImpl = () => Promise.resolve([]);
    const { getFingerprint } = await import("@/lib/taste/server-actions");
    const result = await getFingerprint("u1");
    expect(result).not.toBeNull();
    expect(result?.tier).toBe("empty");
  });

  it("returns snapshot when target profile is public (non-owner path)", async () => {
    getCachedUserMock.mockResolvedValue({ id: "viewer", email: "v@e.com" });
    findFirstImpl = () =>
      Promise.resolve({
        userId: "target-user",
        isPublic: true,
        deletedAt: null,
      });
    selectImpl = () => Promise.resolve([]);
    const { getFingerprint } = await import("@/lib/taste/server-actions");
    const result = await getFingerprint("target-user");
    expect(result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getProfileBy* — redact bio + displayName for non-owner viewers of private
// profiles
// ---------------------------------------------------------------------------

describe("getProfileByUsername (lib/profile/server-actions)", () => {
  it("returns null when profile not found", async () => {
    getCachedUserMock.mockResolvedValue(null);
    findFirstImpl = () => Promise.resolve(undefined);
    const { getProfileByUsername } = await import("@/lib/profile/server-actions");
    const result = await getProfileByUsername("nope");
    expect(result).toBeNull();
  });

  it("redacts bio + displayName when viewer is unauthed and profile is private", async () => {
    getCachedUserMock.mockResolvedValue(null);
    findFirstImpl = () =>
      Promise.resolve({
        userId: "u1",
        username: "alice",
        displayName: "Alice Real Name",
        bio: "secret bio",
        isPublic: false,
      });
    const { getProfileByUsername } = await import("@/lib/profile/server-actions");
    const result = await getProfileByUsername("alice");
    expect(result?.username).toBe("alice"); // username always public — already in URL
    expect(result?.displayName).toBeNull();
    expect(result?.bio).toBeNull();
    expect(result?.isPublic).toBe(false);
  });

  it("redacts bio + displayName when non-owner viewer queries a private profile", async () => {
    getCachedUserMock.mockResolvedValue({ id: "other-viewer", email: "x@e.com" });
    findFirstImpl = () =>
      Promise.resolve({
        userId: "u1",
        username: "alice",
        displayName: "Alice Real Name",
        bio: "secret bio",
        isPublic: false,
      });
    const { getProfileByUsername } = await import("@/lib/profile/server-actions");
    const result = await getProfileByUsername("alice");
    expect(result?.displayName).toBeNull();
    expect(result?.bio).toBeNull();
  });

  it("returns full data when viewer IS the owner of a private profile", async () => {
    getCachedUserMock.mockResolvedValue({ id: "u1", email: "u@e.com" });
    findFirstImpl = () =>
      Promise.resolve({
        userId: "u1",
        username: "alice",
        displayName: "Alice Real Name",
        bio: "secret bio",
        isPublic: false,
      });
    const { getProfileByUsername } = await import("@/lib/profile/server-actions");
    const result = await getProfileByUsername("alice");
    expect(result?.displayName).toBe("Alice Real Name");
    expect(result?.bio).toBe("secret bio");
  });

  it("returns full data when profile is public regardless of viewer", async () => {
    getCachedUserMock.mockResolvedValue(null);
    findFirstImpl = () =>
      Promise.resolve({
        userId: "u1",
        username: "alice",
        displayName: "Alice Public",
        bio: "open bio",
        isPublic: true,
      });
    const { getProfileByUsername } = await import("@/lib/profile/server-actions");
    const result = await getProfileByUsername("alice");
    expect(result?.displayName).toBe("Alice Public");
    expect(result?.bio).toBe("open bio");
  });

  it("returns null for a soft-deleted profile (deletedAt filter in WHERE)", async () => {
    // The SUT filters `isNull(profiles.deletedAt)` in the WHERE clause, so
    // findFirst returns undefined for soft-deleted rows and the function
    // returns null. Pins the gate so a refactor that moves the deletedAt
    // check into `redactPrivateProfile` (where it could leak the row shape
    // even after redaction) gets caught here.
    getCachedUserMock.mockResolvedValue({ id: "viewer", email: "v@e.com" });
    findFirstImpl = () => Promise.resolve(undefined);
    const { getProfileByUsername } = await import("@/lib/profile/server-actions");
    const result = await getProfileByUsername("alice-deleted");
    expect(result).toBeNull();
  });
});

describe("getProfileByUserId (lib/profile/server-actions)", () => {
  it("redacts bio + displayName for non-owner viewers of private profiles", async () => {
    getCachedUserMock.mockResolvedValue({ id: "viewer", email: "v@e.com" });
    findFirstImpl = () =>
      Promise.resolve({
        userId: "u1",
        username: "alice",
        displayName: "Alice Real Name",
        bio: "secret bio",
        isPublic: false,
      });
    const { getProfileByUserId } = await import("@/lib/profile/server-actions");
    const result = await getProfileByUserId("u1");
    expect(result?.displayName).toBeNull();
    expect(result?.bio).toBeNull();
  });

  it("returns full data when viewer IS the target user", async () => {
    getCachedUserMock.mockResolvedValue({ id: "u1", email: "u@e.com" });
    findFirstImpl = () =>
      Promise.resolve({
        userId: "u1",
        username: "alice",
        displayName: "Alice Real Name",
        bio: "secret bio",
        isPublic: false,
      });
    const { getProfileByUserId } = await import("@/lib/profile/server-actions");
    const result = await getProfileByUserId("u1");
    expect(result?.displayName).toBe("Alice Real Name");
    expect(result?.bio).toBe("secret bio");
  });

  it("returns null for a soft-deleted profile (deletedAt filter in WHERE)", async () => {
    // Same regression bar as the username variant: the SUT filters
    // `isNull(profiles.deletedAt)` in the WHERE clause; findFirst returns
    // undefined for soft-deleted rows and the function returns null.
    getCachedUserMock.mockResolvedValue({ id: "viewer", email: "v@e.com" });
    findFirstImpl = () => Promise.resolve(undefined);
    const { getProfileByUserId } = await import("@/lib/profile/server-actions");
    const result = await getProfileByUserId("u1-deleted");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getFeed — derives viewerId from session; no longer accepts viewerId
// ---------------------------------------------------------------------------

describe("getFeed (lib/social/feed/server-actions)", () => {
  it("returns empty feed (hasFollowees:false) when caller is not signed in", async () => {
    getCachedUserMock.mockResolvedValue(null);
    const { getFeed } = await import("@/lib/social/feed/server-actions");
    const result = await getFeed({});
    expect(result).toEqual({
      items: [],
      nextCursor: null,
      hasFollowees: false,
    });
  });

  it("uses session viewerId for the followee lookup", async () => {
    getCachedUserMock.mockResolvedValue({ id: "session-viewer", email: "s@e.com" });
    // No followees → empty feed, but the followee-lookup WHERE clause must
    // have used the SESSION viewerId. With the drizzle-orm mock above,
    // `eq(follows.followerId, viewerId)` reflects back as `[col, val]`, so
    // the captured where-arg's second slot is the userId we want to verify.
    // Regression bar: a refactor that re-accepts a `viewerId` arg from the
    // caller (or trusts an option) would land the attacker's id here.
    selectImpl = () => Promise.resolve([]);
    const { getFeed } = await import("@/lib/social/feed/server-actions");
    const result = await getFeed({});
    expect(result.hasFollowees).toBe(false);
    expect(selectWhereSpy).toHaveBeenCalled();
    // First select chain in getFeed is the followee lookup:
    //   db.select({id: follows.followedId}).from(follows).where(eq(follows.followerId, viewerId))
    const firstWhereArg = selectWhereSpy.mock.calls[0][0] as unknown[];
    expect(firstWhereArg[1]).toBe("session-viewer");
  });
});
