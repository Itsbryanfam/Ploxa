import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * candidatePool v2 — status-aware exclusion + the SEPARATE backlog lane
 * (`backlogPool`). Play-next Backlog-bucket revival (2026-05-16).
 *
 * Root cause this pins: `candidatePool` excluded EVERY logged game with no
 * status filter, so a backlog/wishlist game never came back as a candidate
 * and the Backlog rail (which requires `inLibrary` members) was structurally
 * dead. Fix = two lanes: discovery (catalog, all logged excluded) +
 * `backlogPool` (owned-but-unplayed logs, re-surfaced for the rail).
 *
 * Same chainable-Drizzle-mock convention as
 * tests/unit/candidate-pool-prefilter.test.ts (mock @/lib/db, @/lib/db/schema,
 * drizzle-orm; pop chains off a queue), extended with `and`/`inArray` so the
 * backlog-lane WHERE composes.
 */

type ChainCall = { method: string; args: unknown[] };

function createChain(final: unknown[]) {
  const calls: ChainCall[] = [];
  const chain: Record<string, unknown> = { _calls: calls, _final: final };
  const methods = [
    "select",
    "from",
    "where",
    "orderBy",
    "limit",
    "innerJoin",
  ];
  for (const m of methods) {
    chain[m] = vi.fn((...args: unknown[]) => {
      calls.push({ method: m, args });
      return chain;
    });
  }
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
  return chain as unknown as {
    select: (...a: unknown[]) => unknown;
    _calls: ChainCall[];
  };
}

const chainQueue: ReturnType<typeof createChain>[] = [];
function queueResult(final: unknown[]) {
  const chain = createChain(final);
  chainQueue.push(chain);
  return chain;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => {
      const next = chainQueue.shift();
      if (!next) throw new Error("test setup bug: chainQueue empty");
      next.select();
      return next;
    }),
  },
}));

const orMock = vi.fn((..._c: unknown[]) => ({ __or: true }));
const andMock = vi.fn((...c: unknown[]) => ({ __and: true, c }));
const arrayOverlapsMock = vi.fn((col: unknown, vals: unknown) => ({
  __overlap: true,
  col,
  vals,
}));
const eqMock = vi.fn((col: unknown, val: unknown) => ({ __eq: true, col, val }));
const descMock = vi.fn((col: unknown) => ({ __desc: true, col }));
const inArrayMock = vi.fn((col: unknown, vals: unknown) => ({
  __inArray: true,
  col,
  vals,
}));

vi.mock("drizzle-orm", () => ({
  eq: eqMock,
  or: orMock,
  and: andMock,
  arrayOverlaps: arrayOverlapsMock,
  desc: descMock,
  inArray: inArrayMock,
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    __sql: true,
    strings,
    values,
  }),
}));

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
    status: { __col: "logs.status" },
  },
  tasteFingerprints: {
    userId: { __col: "taste_fingerprints.user_id" },
    genreVector: { __col: "taste_fingerprints.genre_vector" },
    themeVector: { __col: "taste_fingerprints.theme_vector" },
    mechanicVector: { __col: "taste_fingerprints.mechanic_vector" },
  },
}));

// schema-types derives LogStatus from logStatusEnum; the impl only imports
// the *type*, so a tiny stub keeps the module graph loadable.
vi.mock("@/lib/db/schema-types", () => ({}));

const VECTORS = {
  genre: { rpg: 1, action: 0.5 },
  theme: { fantasy: 1 },
  mechanic: { exploration: 1 },
  gameMode: {},
  playerPerspective: {},
};

function gameRow(id: number, over: Record<string, unknown> = {}) {
  return {
    id,
    slug: `g${id}`,
    title: `G${id}`,
    released: null,
    coverUrl: null,
    posterUrl: null,
    genres: ["rpg"],
    themes: ["fantasy"],
    mechanics: ["exploration"],
    platforms: ["PC"],
    playtimeAvgHours: null,
    rawgRating: null,
    ...over,
  };
}

beforeEach(() => {
  chainQueue.length = 0;
  orMock.mockClear();
  andMock.mockClear();
  arrayOverlapsMock.mockClear();
  eqMock.mockClear();
  descMock.mockClear();
  inArrayMock.mockClear();
  vi.resetModules();
});

describe("candidatePool — status-aware discovery exclusion", () => {
  it("keeps discovery to genuinely-un-logged catalog rows (owned + done both absent — no inLibrary:false leak)", async () => {
    // logged rows: one of each status. ALL must be absent from discovery —
    // completed/dropped/playing because they're finished/in-progress,
    // backlog/wishlist/on_hold because an inLibrary:false discovery copy
    // would leak into Comfort/Wildcard (their only path back is the
    // SEPARATE backlog lane). The discovery scan therefore excludes the
    // full logged-id set; the status partition lives in the lane split.
    queueResult([
      { gameId: 10 },
      { gameId: 11 },
      { gameId: 12 },
      { gameId: 13 },
      { gameId: 14 },
      { gameId: 15 },
    ]);
    // games overlap scan returns the 6 logged ids + 2 genuinely-new ones.
    queueResult([
      gameRow(10),
      gameRow(11),
      gameRow(12),
      gameRow(13),
      gameRow(14),
      gameRow(15),
      gameRow(20),
      gameRow(21),
    ]);

    const { candidatePool } = await import("@/lib/recs/candidate-pool");
    const rows = await candidatePool("u1", { vectors: VECTORS });

    const ids = rows.map((r) => r.id).sort((a, b) => a - b);
    // Only the two never-logged catalog rows survive discovery; no logged
    // id (10..15) leaks through as an inLibrary:false discovery card.
    expect(ids).toEqual([20, 21]);
  });
});

describe("backlogPool — owned-but-unplayed lane", () => {
  it("queries backlog/wishlist/on_hold only and scores with the same dot-product", async () => {
    // The join SELECT resolves to the user's owned-but-unplayed games.
    // VECTORS: genre.rpg=1, theme.fantasy=1, mechanic.exploration=1.
    //   id13 rpg + fantasy, no mechanics  → 1 + 1 + 0 = 2
    //   id15 rpg + exploration, no themes → 1 + 0 + 1 = 2  (TIE with id13)
    //   id14 puzzle only                  → 0
    queueResult([
      gameRow(13, { genres: ["rpg"], themes: ["fantasy"], mechanics: [] }),
      gameRow(14, { genres: ["puzzle"], themes: [], mechanics: [] }),
      gameRow(15, { genres: ["rpg"], themes: [], mechanics: ["exploration"] }),
    ]);

    const { backlogPool } = await import("@/lib/recs/candidate-pool");
    const rows = await backlogPool("u1", { vectors: VECTORS });

    // The WHERE uses inArray(logs.status, [...]) with exactly the
    // owned-but-unplayed statuses — done/active are NOT in the set.
    expect(inArrayMock).toHaveBeenCalledTimes(1);
    const statusArg = inArrayMock.mock.calls[0][1] as string[];
    expect([...statusArg].sort()).toEqual(["backlog", "on_hold", "wishlist"]);
    expect(statusArg).not.toContain("completed");
    expect(statusArg).not.toContain("dropped");
    expect(statusArg).not.toContain("playing");

    // All three owned games returned (NOT s<=0 filtered — the rail must be
    // able to surface a taste-neutral owned game; the bucket floor decides).
    const ids = rows.map((r) => r.id).sort((a, b) => a - b);
    expect(ids).toEqual([13, 14, 15]);

    // Scored with the SAME dot-product as discovery. id14 (puzzle, no
    // vector hit) scores 0 and sorts last; id13 & id15 both score 2.
    expect(rows[rows.length - 1].id).toBe(14);
    expect(rows[rows.length - 1].similarityScore).toBe(0);
    expect(rows[0].similarityScore).toBeGreaterThan(0);
    // Deterministic tie-break: equal score → ascending id (id13 before id15).
    const g13 = rows.find((r) => r.id === 13)!;
    const g15 = rows.find((r) => r.id === 15)!;
    expect(g13.similarityScore).toBe(2);
    expect(g15.similarityScore).toBe(2);
    expect(rows.indexOf(g13)).toBeLessThan(rows.indexOf(g15));
  });

  it("returns [] for an empty userId without touching the DB", async () => {
    const { backlogPool } = await import("@/lib/recs/candidate-pool");
    const rows = await backlogPool("", { vectors: VECTORS });
    expect(rows).toEqual([]);
    expect(inArrayMock).not.toHaveBeenCalled();
  });

  it("de-dupes a game logged more than once", async () => {
    queueResult([gameRow(13), gameRow(13), gameRow(14)]);
    const { backlogPool } = await import("@/lib/recs/candidate-pool");
    const rows = await backlogPool("u1", { vectors: VECTORS });
    const ids = rows.map((r) => r.id).sort((a, b) => a - b);
    expect(ids).toEqual([13, 14]);
  });
});
