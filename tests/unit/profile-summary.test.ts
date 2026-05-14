import { describe, expect, it, vi } from "vitest";

/**
 * getProfileSummary is the one-stop loader for the redesigned profile page.
 * Tests pin the early-return contract:
 *  - profile not found → null (don't leak existence)
 *  - private + non-owner → null
 *  - blocked pair + non-owner → null
 *  - owner sees everything regardless of privacy/blocks
 *
 * Mocks db + isBlockedBetween. We're testing the orchestration shape,
 * not the SQL.
 */

vi.mock("@/lib/db", () => {
  // Mock design rationale:
  // The 7 parallel queries in getProfileSummary end their chains at different
  // points:
  //   - count queries:  .select().from().where()           → ends at where
  //   - logs query:     .select().from().innerJoin().where().orderBy()  → ends at orderBy
  //   - reviews/lists:  .select().from().innerJoin().where().orderBy().limit(n) → ends at limit
  //
  // Solution: make EVERY terminal method return a "thenable chainable" — an
  // object that is both awaitable (Promise<[]>) AND has the next chainable
  // methods on it. This way Promise.all can await whatever the chain ends on.
  const findFirst = vi.fn();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function makeThenableChainable(resolveValue: any[] = []): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obj: any = {
      // Thenable: allows Promise.all / await to resolve this directly.
      then(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        resolve: (v: any[]) => any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        _reject?: (e: unknown) => any,
      ) {
        return Promise.resolve(resolveValue).then(resolve);
      },
      // Chainable continuation methods — each also returns a thenable chainable.
      orderBy: vi.fn(() => makeThenableChainable(resolveValue)),
      limit: vi.fn().mockResolvedValue(resolveValue),
    };
    return obj;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chainable: any = {
    select: vi.fn(),
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
  };
  // Wire up chain: each returns the next step.
  chainable.select.mockReturnValue(chainable);
  chainable.from.mockReturnValue(chainable);
  chainable.innerJoin.mockReturnValue(chainable);
  // where() is the last common step — return a thenable chainable.
  chainable.where.mockImplementation(() => makeThenableChainable([]));

  const queryDb = {
    profiles: { findFirst },
    follows: { findFirst: vi.fn().mockResolvedValue(undefined) },
    tasteFingerprints: { findFirst: vi.fn().mockResolvedValue(undefined) },
  };

  return {
    db: {
      ...chainable,
      query: queryDb,
    },
    schema: {
      profiles: {
        username: { name: "username" },
        userId: { name: "user_id" },
        isPublic: { name: "is_public" },
        deletedAt: { name: "deleted_at" },
      },
      logs: {
        userId: {},
        isPrivate: {},
        gameId: {},
        updatedAt: {},
      },
      reviews: {
        userId: {},
        publishedAt: {},
        isPublic: {},
        gameId: {},
        id: {},
        body: {},
        rating: {},
      },
      lists: {
        userId: {},
        publishedAt: {},
        isPublic: {},
        id: {},
        title: {},
        slug: {},
        description: {},
      },
      follows: {
        followerId: {},
        followedId: {},
      },
      tasteFingerprints: { userId: {} },
      games: {
        id: {},
        title: {},
        slug: {},
        coverUrl: {},
      },
      platformConnections: {
        userId: {},
        platform: {},
        externalId: {},
        displayName: {},
        isActive: {},
      },
    },
  };
});

vi.mock("@/lib/social/_shared/visibility", () => ({
  isBlockedBetween: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/logs/library-item", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mapRowToLibraryItem: vi.fn((log: any, game: any) => ({ ...log, game })),
  computeUserStatsFromLibrary: vi
    .fn()
    .mockReturnValue({ total: 0, byStatus: {}, averageRating: null }),
}));

vi.mock("@/lib/logs/select", () => ({ LOG_GAME_SELECT: {} }));

const { getProfileSummary } = await import(
  "@/lib/social/_shared/profile-summary"
);

describe("getProfileSummary — early returns", () => {
  it("returns null when profile not found", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { db } = (await import("@/lib/db")) as any;
    db.query.profiles.findFirst.mockResolvedValueOnce(undefined);
    const result = await getProfileSummary("ghost", "viewer-id");
    expect(result).toBeNull();
  });

  it("returns null for private profile + non-owner viewer", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { db } = (await import("@/lib/db")) as any;
    db.query.profiles.findFirst.mockResolvedValueOnce({
      userId: "target-id",
      username: "private-user",
      isPublic: false,
    });
    const result = await getProfileSummary("private-user", "different-viewer");
    expect(result).toBeNull();
  });

  it("returns null for blocked pair + non-owner viewer", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { db } = (await import("@/lib/db")) as any;
    const { isBlockedBetween } = await import(
      "@/lib/social/_shared/visibility"
    );
    db.query.profiles.findFirst.mockResolvedValueOnce({
      userId: "target-id",
      username: "blocked-by",
      isPublic: true,
    });
    (isBlockedBetween as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    const result = await getProfileSummary("blocked-by", "viewer-id");
    expect(result).toBeNull();
  });

  it("returns data for logged-out viewer on public profile", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { db } = (await import("@/lib/db")) as any;
    db.query.profiles.findFirst.mockResolvedValueOnce({
      userId: "target-id",
      username: "alice",
      isPublic: true,
    });
    // count queries end at .where() which resolves to [] by default;
    // followerCount/followingCount fall back to 0 via rawFollowerCount[0]?.value ?? 0.
    const result = await getProfileSummary("alice", null);
    expect(result).not.toBeNull();
    expect(result?.isOwner).toBe(false);
    expect(result?.isFollowing).toBe(false);
  });

  it("returns data for owner even when private", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { db } = (await import("@/lib/db")) as any;
    db.query.profiles.findFirst.mockResolvedValueOnce({
      userId: "owner-id",
      username: "private-owner",
      isPublic: false,
    });
    const result = await getProfileSummary("private-owner", "owner-id");
    expect(result).not.toBeNull();
    expect(result?.isOwner).toBe(true);
  });

  it("returns null for soft-deleted profile (deleted_at is non-null)", async () => {
    // The DB mock resolves findFirst by returned value, not by where clause.
    // A soft-deleted profile would never be returned by findFirst because the
    // isNull(profiles.deletedAt) filter is in the where clause — so undefined
    // is the correct mock return to represent the DB returning no row.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { db } = (await import("@/lib/db")) as any;
    db.query.profiles.findFirst.mockResolvedValueOnce(undefined);
    const result = await getProfileSummary("deleted-user", "viewer-id");
    expect(result).toBeNull();
  });

  it("reflects isFollowing=true when viewer follows the target", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { db } = (await import("@/lib/db")) as any;
    db.query.profiles.findFirst.mockResolvedValueOnce({
      userId: "target-id",
      username: "alice",
      isPublic: true,
    });
    db.query.follows.findFirst.mockResolvedValueOnce({
      followerId: "viewer-id",
      followedId: "target-id",
    });
    const result = await getProfileSummary("alice", "viewer-id");
    expect(result).not.toBeNull();
    expect(result?.isFollowing).toBe(true);
  });
});
