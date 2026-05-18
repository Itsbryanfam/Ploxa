import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * getSimilarUsers payload + binding contract.
 *
 * Behavioural pins:
 *  - viewerFollows / followsViewer are stamped correctly from the single
 *    batched directed-follows lookup (T08 of audit-fixes-2026-05-14).
 *  - That follows lookup is ONE round-trip, not N-per-candidate.
 *
 * Binding contract (regression lock for the /discover outage 2026-05-17):
 * the follows-batch lookup MUST bind candidate IDs per-element through the
 * Drizzle query builder (`db.select().from(follows).where(...inArray...)`).
 * It must NOT interpolate the JS array into a raw `db.execute(sql\`...
 * ANY(${ids}::uuid[])\`)` template — postgres-js with `prepare: false`
 * (Supabase pooler) stringifies the array into a single param, so Postgres
 * receives a bare UUID where it expects an array literal and raises
 * `malformed array literal`. Same gotcha documented at
 * lib/imports/server-actions.ts; same builder fix as the structural twin
 * getBlockedPairs in lib/social/_shared/visibility.ts.
 *
 * Mock strategy: calls 1 (viewer fingerprint) and 2 (candidate pool) stay
 * raw `db.execute` (scalar binds only — safe). The follows lookup is the
 * builder chain, mocked like visibility-batch.test.ts.
 */

// db.execute drives calls 1 & 2 only (fingerprint, candidate pool).
const executeMock = vi.fn();
// The batched follows lookup resolves through the select/from/where chain.
// Module-scope so beforeEach can clear call counts (the chain mock is
// shared across tests — mirrors visibility-batch.test.ts).
const selectMock = vi.fn();
const fromMock = vi.fn();
const whereMock = vi.fn();
const followsResolveMock = vi.fn();

vi.mock("@/lib/db", () => {
  const mockSchema = {
    follows: {
      followerId: { name: "follower_id" },
      followedId: { name: "followed_id" },
    },
  };
  const mockDb = {
    execute: executeMock,
    select: selectMock,
    from: fromMock,
    where: whereMock,
  };
  selectMock.mockImplementation(() => mockDb);
  fromMock.mockImplementation(() => mockDb);
  // getSimilarUsers awaits `.where(...)` directly — a thenable here lets
  // it await our synthetic directed-follows rows.
  whereMock.mockImplementation(() => Promise.resolve(followsResolveMock()));
  return { db: mockDb, schema: mockSchema };
});

// drift = 0 → similarity 1 for every candidate; deterministic ordering.
vi.mock("@/lib/taste/vectors", () => ({
  drift: vi.fn((_a: unknown, _b: unknown) => 0),
}));

beforeEach(() => {
  executeMock.mockReset();
  followsResolveMock.mockReset();
  followsResolveMock.mockReturnValue([]);
  // mockClear (not mockReset) — keep the chain implementations set in the
  // vi.mock factory (it runs once); only wipe accumulated call counts.
  selectMock.mockClear();
  fromMock.mockClear();
  whereMock.mockClear();
  vi.resetModules();
});

function viewerFp(totalLogs: number) {
  return [
    {
      genre_vector: { rpg: 1 },
      theme_vector: { fantasy: 1 },
      mechanic_vector: { turn_based: 1 },
      total_logs_at_generation: totalLogs,
    },
  ];
}

function candidate(userId: string, username: string) {
  return {
    user_id: userId,
    username,
    display_name: username,
    profile_picture_url: null,
    genre_vector: {},
    theme_vector: {},
    mechanic_vector: {},
    total_logs_at_generation: 20,
  };
}

describe("getSimilarUsers — viewerFollows / followsViewer stamping", () => {
  it("stamps both directions correctly from the batched directed-follows lookup", async () => {
    executeMock.mockResolvedValueOnce(viewerFp(25)); // call 1: viewer fp
    executeMock.mockResolvedValueOnce([
      candidate("u2", "alice"),
      candidate("u3", "bob"),
    ]); // call 2: candidate pool
    // Builder follows lookup: u1→u2 (viewer follows u2), u3→u1 (u3 follows viewer).
    followsResolveMock.mockReturnValueOnce([
      { followerId: "u1", followedId: "u2" },
      { followerId: "u3", followedId: "u1" },
    ]);

    const { getSimilarUsers } = await import(
      "@/lib/social/discovery/similar-users"
    );
    const rows = await getSimilarUsers("u1", 12);
    expect(rows).toHaveLength(2);

    const byId = new Map(rows.map((r) => [r.userId, r]));
    expect(byId.get("u2")?.viewerFollows).toBe(true);
    expect(byId.get("u2")?.followsViewer).toBe(false);
    expect(byId.get("u3")?.viewerFollows).toBe(false);
    expect(byId.get("u3")?.followsViewer).toBe(true);
  });
});

describe("getSimilarUsers — follows lookup binding contract", () => {
  it("routes the batched follows lookup through the Drizzle builder, never a raw array-bind db.execute", async () => {
    executeMock.mockResolvedValueOnce(viewerFp(25));
    executeMock.mockResolvedValueOnce([
      candidate("u2", "a"),
      candidate("u3", "b"),
      candidate("u4", "c"),
    ]);
    followsResolveMock.mockReturnValueOnce([]);

    const { getSimilarUsers } = await import(
      "@/lib/social/discovery/similar-users"
    );
    const { db } = (await import("@/lib/db")) as unknown as {
      db: { select: ReturnType<typeof vi.fn>; where: ReturnType<typeof vi.fn> };
    };
    await getSimilarUsers("u1", 12);

    // Exactly 2 raw db.execute calls: viewer-fp + candidate pool. The
    // follows lookup is NOT a third db.execute — a regression to the
    // `db.execute(sql\`...ANY(${ids}::uuid[])\`)` shape would make this 3
    // and crash /discover with `malformed array literal` in production.
    expect(executeMock).toHaveBeenCalledTimes(2);
    // It goes through the parameterised builder instead — exactly one
    // batched round-trip (not N-per-candidate).
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.where).toHaveBeenCalledTimes(1);
  });

  it("skips the follows lookup entirely when there are no candidates", async () => {
    executeMock.mockResolvedValueOnce(viewerFp(25));
    executeMock.mockResolvedValueOnce([]); // empty candidate pool

    const { getSimilarUsers } = await import(
      "@/lib/social/discovery/similar-users"
    );
    const { db } = (await import("@/lib/db")) as unknown as {
      db: { select: ReturnType<typeof vi.fn> };
    };
    const rows = await getSimilarUsers("u1", 12);

    expect(rows).toEqual([]);
    expect(executeMock).toHaveBeenCalledTimes(2); // fp + candidates only
    expect(db.select).not.toHaveBeenCalled();
  });

  it("returns [] without any candidate or follows query when viewer fingerprint is empty-tier", async () => {
    executeMock.mockResolvedValueOnce(viewerFp(0)); // 0 logs → "empty" tier

    const { getSimilarUsers } = await import(
      "@/lib/social/discovery/similar-users"
    );
    const { db } = (await import("@/lib/db")) as unknown as {
      db: { select: ReturnType<typeof vi.fn> };
    };
    const rows = await getSimilarUsers("u1", 12);

    expect(rows).toEqual([]);
    expect(executeMock).toHaveBeenCalledTimes(1); // viewer-fp only
    expect(db.select).not.toHaveBeenCalled();
  });
});
