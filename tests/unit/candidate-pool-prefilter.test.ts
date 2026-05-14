import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * candidatePool DB-side prefilter pins (T11 of audit-fixes-2026-05-14).
 *
 * Before this fix, candidatePool ran `db.select(...).from(games)` with
 * no WHERE/LIMIT — full catalog scan on every /play-next cache miss
 * (~10k rows today, growing). Now it pushes a Postgres array-overlap
 * filter on the user's top genre/theme/mechanic keys + an absolute
 * LIMIT cap. Empty-vector users (cold start, no top axes) fall back
 * to a popularity query (rawg_rating DESC).
 *
 * The tests mock the chained query builder used by Drizzle to inspect
 * which path was taken (overlap vs popularity) and to assert the
 * fallback never returns an empty pool just because vectors are sparse.
 *
 * Notes:
 * - We don't try to reconstruct the exact SQL; the assertion is on the
 *   shape of the chained calls + which `where` argument was passed.
 * - `loggedRows` query is also mocked (returns []) so it doesn't blow
 *   up the test on a missing call.
 */

// Build a chainable query mock that records each step. The `final` array
// is what the chain resolves to (treated as the SELECT result).
//
// Drizzle's chain looks like: db.select(cols).from(table).where(...).limit(...).orderBy(...)
// Some chains skip steps (e.g. logged-rows query has no LIMIT); each method
// returns `this` so we can call any method in any order. The chain becomes
// awaitable via a `then` shim that resolves to the queued `final`.
type ChainCall = { method: string; args: unknown[] };

function createChain(final: unknown[]) {
  const calls: ChainCall[] = [];
  const chain: Record<string, unknown> = {
    _calls: calls,
    _final: final,
  };
  const methods = ["select", "from", "where", "orderBy", "limit"];
  for (const m of methods) {
    chain[m] = vi.fn((...args: unknown[]) => {
      calls.push({ method: m, args });
      return chain;
    });
  }
  // Make the chain thenable so `await chain` resolves to the rows.
  chain.then = (
    onfulfilled: (rows: unknown[]) => unknown,
    onrejected?: (err: unknown) => unknown,
  ) => {
    try {
      return Promise.resolve(onfulfilled(final));
    } catch (e) {
      return onrejected ? Promise.resolve(onrejected(e)) : Promise.reject(e);
    }
  };
  type ChainShape = {
    select: (...args: unknown[]) => ChainShape;
    from: (...args: unknown[]) => ChainShape;
    where: (...args: unknown[]) => ChainShape;
    orderBy: (...args: unknown[]) => ChainShape;
    limit: (...args: unknown[]) => ChainShape;
    _calls: ChainCall[];
    _final: unknown[];
  };
  return chain as unknown as ChainShape;
}

// Each db.select() call pops a chain off the queue.
const chainQueue: ReturnType<typeof createChain>[] = [];

function queueResult(final: unknown[]) {
  const chain = createChain(final);
  chainQueue.push(chain);
  return chain;
}

vi.mock("@/lib/db", () => {
  return {
    db: {
      select: vi.fn(() => {
        const next = chainQueue.shift();
        if (!next) throw new Error("test setup bug: chainQueue empty");
        // First chained call is the .select(); record it on the queued chain.
        next.select();
        return next;
      }),
    },
  };
});

// Capture the args passed to `or(...)` so we can assert the prefilter is
// the array-overlap composition (not a no-op).
const orMock = vi.fn((..._conds: unknown[]) => ({ __or: true }));
const arrayOverlapsMock = vi.fn((col: unknown, vals: unknown) => ({
  __overlap: true,
  col,
  vals,
}));
const eqMock = vi.fn((col: unknown, val: unknown) => ({ __eq: true, col, val }));
const descMock = vi.fn((col: unknown) => ({ __desc: true, col }));

vi.mock("drizzle-orm", () => ({
  eq: eqMock,
  or: orMock,
  arrayOverlaps: arrayOverlapsMock,
  desc: descMock,
  // Re-export `sql` as a no-op tag in case the impl uses it elsewhere.
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    __sql: true,
    strings,
    values,
  }),
}));

// Schema is just used as references — the mocks don't care about the actual
// columns, only that the impl passes them through.
vi.mock("@/lib/db/schema", () => ({
  games: {
    id: { __col: "games.id" },
    slug: { __col: "games.slug" },
    title: { __col: "games.title" },
    released: { __col: "games.released" },
    coverUrl: { __col: "games.cover_url" },
    posterUrl: { __col: "games.poster_url" },
    genres: { __col: "games.genres" },
    themes: { __col: "games.themes" },
    mechanics: { __col: "games.mechanics" },
    platforms: { __col: "games.platforms" },
    playtimeAvgHours: { __col: "games.playtime_avg_hours" },
    rawgRating: { __col: "games.rawg_rating" },
  },
  logs: {
    gameId: { __col: "logs.game_id" },
    userId: { __col: "logs.user_id" },
  },
  tasteFingerprints: {
    userId: { __col: "taste_fingerprints.user_id" },
    genreVector: { __col: "taste_fingerprints.genre_vector" },
    themeVector: { __col: "taste_fingerprints.theme_vector" },
    mechanicVector: { __col: "taste_fingerprints.mechanic_vector" },
  },
}));

beforeEach(() => {
  chainQueue.length = 0;
  orMock.mockClear();
  arrayOverlapsMock.mockClear();
  eqMock.mockClear();
  descMock.mockClear();
  vi.resetModules();
});

describe("candidatePool — DB-side prefilter", () => {
  it("issues an array-overlap WHERE filter when the user has top axes", async () => {
    // Chain 1: logged rows (none).
    queueResult([]);
    // Chain 2: games SELECT — return one row that survives scoring.
    queueResult([
      {
        id: 1,
        slug: "g1",
        title: "G1",
        released: null,
        coverUrl: null,
        posterUrl: null,
        genres: ["rpg"],
        themes: ["fantasy"],
        mechanics: ["turn_based"],
        platforms: ["PC"],
        playtimeAvgHours: null,
      },
    ]);

    const { candidatePool } = await import("@/lib/recs/candidate-pool");
    const rows = await candidatePool("u1", {
      vectors: {
        genre: { rpg: 1, action: 0.5 },
        theme: { fantasy: 1 },
        mechanic: { turn_based: 1 },
        gameMode: {},
        playerPerspective: {},
      },
    });

    // arrayOverlaps was called for each axis with a non-empty key list.
    // (Three calls: genres, themes, mechanics.)
    expect(arrayOverlapsMock).toHaveBeenCalledTimes(3);
    for (const call of arrayOverlapsMock.mock.calls) {
      const vals = call[1] as unknown[];
      expect(Array.isArray(vals)).toBe(true);
      expect(vals.length).toBeGreaterThan(0);
    }

    // The three overlap predicates were composed with `or()`.
    expect(orMock).toHaveBeenCalledTimes(1);

    // Row matches the candidate, scoring filters in.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(1);
  });

  it("falls back to popularity (no overlap, ORDER BY rawg_rating) for empty-vector users", async () => {
    // Chain 1: logged rows (none).
    queueResult([]);
    // Chain 2: popularity query — returns top-rated games (no scoring needed
    // beyond what the impl emits in the popularity branch).
    queueResult([
      {
        id: 99,
        slug: "popular",
        title: "Popular",
        released: null,
        coverUrl: null,
        posterUrl: null,
        genres: ["action"],
        themes: ["sci_fi"],
        mechanics: ["shooter"],
        platforms: ["PC"],
        playtimeAvgHours: null,
      },
    ]);

    const { candidatePool } = await import("@/lib/recs/candidate-pool");
    const rows = await candidatePool("u1", {
      vectors: {
        genre: {},
        theme: {},
        mechanic: {},
        gameMode: {},
        playerPerspective: {},
      },
    });

    // Popularity branch must not issue any array-overlap predicates.
    expect(arrayOverlapsMock).not.toHaveBeenCalled();

    // Empty-vector user MUST get rows back — the audit specifically called
    // out cold-start as a regression risk (used to silently return []).
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.id).toBe(99);
  });

  it("ignores zero/negative vector keys when picking top axes (positive signal only)", async () => {
    // A user with a mix of positive + negative entries — only the positive
    // keys should make it into the array-overlap predicate. Otherwise we'd
    // be pre-filtering candidates by genres the user actively dislikes,
    // which inflates the pool with the wrong rows.
    queueResult([]);
    queueResult([
      {
        id: 1,
        slug: "g1",
        title: "G1",
        released: null,
        coverUrl: null,
        posterUrl: null,
        genres: ["rpg"],
        themes: ["fantasy"],
        mechanics: ["turn_based"],
        platforms: ["PC"],
        playtimeAvgHours: null,
      },
    ]);

    const { candidatePool } = await import("@/lib/recs/candidate-pool");
    await candidatePool("u1", {
      vectors: {
        genre: { rpg: 1, mmo: -1 }, // mmo is anti-signal — must NOT prefilter on it
        theme: { fantasy: 1 },
        mechanic: { turn_based: 1, grinding: -0.7 },
        gameMode: {},
        playerPerspective: {},
      },
    });

    // Find the genres call (first overlap arg whose col matches games.genres).
    const overlapCalls = arrayOverlapsMock.mock.calls;
    expect(overlapCalls.length).toBeGreaterThan(0);
    const allKeys = overlapCalls.flatMap((c) => c[1] as string[]);
    expect(allKeys).not.toContain("mmo");
    expect(allKeys).not.toContain("grinding");
    expect(allKeys).toContain("rpg");
  });

  it("caps the candidate query with a LIMIT (safety against pathological overlap)", async () => {
    queueResult([]);
    const gamesChain = queueResult([]);

    const { candidatePool } = await import("@/lib/recs/candidate-pool");
    await candidatePool("u1", {
      vectors: {
        genre: { rpg: 1 },
        theme: { fantasy: 1 },
        mechanic: { turn_based: 1 },
        gameMode: {},
        playerPerspective: {},
      },
    });

    // The SELECT chain has a `.limit()` call (safety cap on catalog rows
    // pulled into JS for scoring).
    const limitCall = gamesChain._calls.find((c) => c.method === "limit");
    expect(limitCall).toBeDefined();
    expect(typeof limitCall?.args[0]).toBe("number");
    expect(limitCall?.args[0] as number).toBeGreaterThan(0);
  });

  it("returns [] (not a popularity query) for an empty userId", async () => {
    const { candidatePool } = await import("@/lib/recs/candidate-pool");
    const rows = await candidatePool("", {
      vectors: {
        genre: {},
        theme: {},
        mechanic: {},
        gameMode: {},
        playerPerspective: {},
      },
    });
    expect(rows).toEqual([]);
    // Did NOT issue any DB calls.
    expect(arrayOverlapsMock).not.toHaveBeenCalled();
  });
});
