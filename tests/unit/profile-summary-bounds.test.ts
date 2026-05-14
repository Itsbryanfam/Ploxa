import { describe, expect, it, vi } from "vitest";

/**
 * Bounded-fetch tests for getProfileSummary.
 *
 * Pre-T13 the function loaded ALL of a profile's logs (joined to games)
 * just to compute stats and slice the top 12 covers. A 1000-log power
 * user shipped 1000 cover URLs + game metadata to render 12 thumbnails.
 *
 * Post-T13:
 *   1. Stats come from a single SQL aggregate (no row hydration).
 *   2. libraryTruncated comes from a separate SELECT … LIMIT 12.
 *   3. The two run in parallel.
 *
 * These tests pin both invariants by counting the rows the library mock
 * is asked to return and asserting the aggregate row is consumed.
 *
 * Mock strategy: track which call to chainable.where() corresponds to
 * each of the parallel queries by returning a freshly-tracked thenable
 * each time. The library query is identified by the .limit(12) call.
 */

vi.mock("@/lib/db", () => {
  const findFirst = vi.fn();

  // The mock returns whatever `resolveValue` is plus tracks calls to
  // .limit() so tests can assert the bound (12) was applied.
  const limitCalls: number[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function makeThenableChainable(resolveValue: any[] = []): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obj: any = {
      then(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        resolve: (v: any[]) => any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        _reject?: (e: unknown) => any,
      ) {
        return Promise.resolve(resolveValue).then(resolve);
      },
      orderBy: vi.fn(() => makeThenableChainable(resolveValue)),
      limit: vi.fn((n: number) => {
        limitCalls.push(n);
        // limit() resolves to at most `n` rows from resolveValue.
        return Promise.resolve(resolveValue.slice(0, n));
      }),
    };
    return obj;
  }

  // The aggregate query resolves to a single row containing the
  // SQL-aggregate columns. We give it 6 zero counts + null avg by default.
  const defaultAggregateRow = {
    total: 0,
    backlog: 0,
    playing: 0,
    completed: 0,
    dropped: 0,
    on_hold: 0,
    wishlist: 0,
    averageRating: null,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let aggregateRow: any = defaultAggregateRow;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let libraryRows: any[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function resetAggregate(row?: any) {
    aggregateRow = row ?? defaultAggregateRow;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function setLibraryRows(rows: any[]) {
    libraryRows = rows;
  }
  function clearLimitCalls() {
    limitCalls.length = 0;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chainable: any = {
    select: vi.fn(),
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
  };

  // We need to differentiate between:
  //   - the stats aggregate query (select → from(logs) → where → resolves
  //     to [aggregateRow])
  //   - the library top-12 query (select → from(logs) → innerJoin(games) →
  //     where → orderBy → limit(12) → resolves to libraryRows)
  //   - the count queries (select → from(follows) → where → [])
  //   - the recentReviews / topLists / connections queries (resolve to [])
  //
  // The cleanest discriminator is whether innerJoin() was called.
  // Without innerJoin → either aggregate (logs) or count (follows) or
  // taste (handled via query.tasteFingerprints) or platformConnections.
  //
  // Strategy: track on the chain whether innerJoin was called and what
  // table it joined from. Use a per-call object so parallel chains don't
  // share state.

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function makeChainState(): any {
    let isAggregate = false;
    let isLibrary = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state: any = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      select: vi.fn((projection: any) => {
        // The aggregate projection contains the property "total". We use
        // that as a marker because no other query in the function projects
        // a column called "total".
        if (projection && Object.prototype.hasOwnProperty.call(projection, "total")) {
          isAggregate = true;
        }
        return state;
      }),
      from: vi.fn(() => state),
      innerJoin: vi.fn(() => {
        // The library query is the only one that joins games when
        // selecting log+game columns. The reviews query also joins games
        // but that one is identified by ending at .limit(3) — we let
        // limit() resolve from libraryRows for both, but the reviews query
        // never gets queried for length=12 so it doesn't impact assertions.
        isLibrary = true;
        return state;
      }),
      where: vi.fn(() => {
        if (isAggregate) {
          return makeThenableChainable([aggregateRow]);
        }
        if (isLibrary) {
          // Library query — chain continues to .orderBy().limit(12)
          return makeThenableChainable(libraryRows);
        }
        // Other queries (counts, etc.) → empty array.
        return makeThenableChainable([]);
      }),
    };
    return state;
  }

  // Replace the flat chainable with a per-call state factory.
  chainable.select = vi.fn((projection: unknown) =>
    makeChainState().select(projection),
  );

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
        status: {},
        rating: {},
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
    // Test helpers exposed via the mock module.
    __testHelpers: {
      resetAggregate,
      setLibraryRows,
      clearLimitCalls,
      limitCalls,
    },
  };
});

vi.mock("@/lib/social/_shared/visibility", () => ({
  isBlockedBetween: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/logs/library-item", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mapRowToLibraryItem: vi.fn((log: any, game: any) => ({ ...log, game })),
}));

vi.mock("@/lib/logs/select", () => ({ LOG_GAME_SELECT: {} }));

vi.mock("@/lib/taste/tier", () => ({
  tierForUser: vi.fn().mockReturnValue("explorer"),
}));

const { getProfileSummary } = await import(
  "@/lib/social/_shared/profile-summary"
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockMod = (await import("@/lib/db")) as any;

describe("getProfileSummary — bounded fetch (T13 perf)", () => {
  it("library query is bounded to LIMIT 12 even for a 1000-log user", async () => {
    // Simulate a power user with 1000 logs — but the mock will only
    // return what .limit(N) asks for, replicating real DB behaviour.
    const thousandRows = Array.from({ length: 1000 }, (_, i) => ({
      log: {
        id: `log-${i}`,
        status: "completed",
        rating: null,
        startedAt: null,
        finishedAt: null,
        hoursPlayed: null,
        platformPlayedOn: null,
        isReplay: false,
        isPrivate: false,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      game: {
        id: i,
        slug: `g-${i}`,
        title: `Game ${i}`,
        coverUrl: null,
        posterUrl: null,
        released: null,
        genres: [],
        platforms: [],
      },
    }));
    mockMod.__testHelpers.clearLimitCalls();
    mockMod.__testHelpers.setLibraryRows(thousandRows);
    mockMod.__testHelpers.resetAggregate({
      total: 1000,
      backlog: 100,
      playing: 50,
      completed: 700,
      dropped: 50,
      on_hold: 50,
      wishlist: 50,
      averageRating: "8.4",
    });
    mockMod.db.query.profiles.findFirst.mockResolvedValueOnce({
      userId: "owner-id",
      username: "power-user",
      isPublic: true,
    });

    const result = await getProfileSummary("power-user", "owner-id");

    expect(result).not.toBeNull();
    // libraryTruncated must be ≤ 12 — proves the LIMIT 12 fired.
    expect(result?.libraryTruncated.length).toBeLessThanOrEqual(12);
    expect(result?.libraryTruncated.length).toBe(12);
    // The .limit() call list must contain a 12 (library) — not just 3
    // (recentReviews) or 3 (topLists).
    expect(mockMod.__testHelpers.limitCalls).toContain(12);
  });

  it("stats come from the SQL aggregate row, not from hydrated logs", async () => {
    // Library returns ZERO rows but the aggregate row reports 1000 logs +
    // 700 completed. If the function fell back to in-memory aggregation,
    // result.stats.total would be 0 (length of libraryTruncated). That it
    // matches the aggregate row proves stats now come from SQL.
    mockMod.__testHelpers.clearLimitCalls();
    mockMod.__testHelpers.setLibraryRows([]);
    mockMod.__testHelpers.resetAggregate({
      total: 1000,
      backlog: 100,
      playing: 50,
      completed: 700,
      dropped: 50,
      on_hold: 50,
      wishlist: 50,
      averageRating: "8.4",
    });
    mockMod.db.query.profiles.findFirst.mockResolvedValueOnce({
      userId: "owner-id",
      username: "power-user",
      isPublic: true,
    });

    const result = await getProfileSummary("power-user", "owner-id");

    expect(result).not.toBeNull();
    expect(result?.stats.total).toBe(1000);
    expect(result?.stats.byStatus.completed).toBe(700);
    expect(result?.stats.byStatus.backlog).toBe(100);
    expect(result?.stats.byStatus.playing).toBe(50);
    expect(result?.stats.byStatus.dropped).toBe(50);
    expect(result?.stats.byStatus.on_hold).toBe(50);
    expect(result?.stats.byStatus.wishlist).toBe(50);
    expect(result?.stats.averageRating).toBe(8.4);
  });

  it("averageRating is null when no rated logs (avg returns null from SQL)", async () => {
    mockMod.__testHelpers.clearLimitCalls();
    mockMod.__testHelpers.setLibraryRows([]);
    mockMod.__testHelpers.resetAggregate({
      total: 5,
      backlog: 5,
      playing: 0,
      completed: 0,
      dropped: 0,
      on_hold: 0,
      wishlist: 0,
      averageRating: null,
    });
    mockMod.db.query.profiles.findFirst.mockResolvedValueOnce({
      userId: "owner-id",
      username: "rater",
      isPublic: true,
    });

    const result = await getProfileSummary("rater", "owner-id");
    expect(result?.stats.averageRating).toBeNull();
  });

  it("zero-log user gets total=0, all status counts=0, averageRating=null", async () => {
    // Aggregate query returns one row even when count(*) is 0; verify
    // the function handles the empty-profile case gracefully.
    mockMod.__testHelpers.clearLimitCalls();
    mockMod.__testHelpers.setLibraryRows([]);
    mockMod.__testHelpers.resetAggregate({
      total: 0,
      backlog: 0,
      playing: 0,
      completed: 0,
      dropped: 0,
      on_hold: 0,
      wishlist: 0,
      averageRating: null,
    });
    mockMod.db.query.profiles.findFirst.mockResolvedValueOnce({
      userId: "owner-id",
      username: "fresh",
      isPublic: true,
    });

    const result = await getProfileSummary("fresh", "owner-id");
    expect(result?.stats.total).toBe(0);
    expect(result?.stats.byStatus.backlog).toBe(0);
    expect(result?.stats.byStatus.completed).toBe(0);
    expect(result?.stats.averageRating).toBeNull();
    expect(result?.libraryTruncated).toEqual([]);
  });
});
