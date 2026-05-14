import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * `getBlockedPairs` is the batched form that replaces N sequential
 * `isBlockedBetween` round-trips on the feed and trending-reviews paths.
 * One block-leak there leaks across every visible row, so the contract
 * needs to be pinned: returns a Set of "the OTHER side" of each block
 * edge — never the viewer's own ID.
 *
 * Mock strategy mirrors visibility.test.ts: stub `@/lib/db` so the
 * select/from/where chain captures arguments, and have the resolver at
 * the end of the chain return synthetic `(blocker_id, blocked_id)` rows
 * the helper would have read from Postgres.
 */

const whereResolveMock = vi.fn();

vi.mock("@/lib/db", () => {
  const mockSchema = {
    blocks: {
      blockerId: { name: "blocker_id" },
      blockedId: { name: "blocked_id" },
    },
  };
  const mockDb = {
    select: vi.fn(() => mockDb),
    from: vi.fn(() => mockDb),
    // The implementation awaits the result of `.where(...)` directly —
    // returning a thenable here lets the helper await our mock value.
    where: vi.fn(() => Promise.resolve(whereResolveMock())),
    limit: vi.fn(() => Promise.resolve([])),
  };
  return { db: mockDb, schema: mockSchema };
});

beforeEach(() => {
  whereResolveMock.mockReset();
});

const VIEWER = "00000000-0000-0000-0000-00000000viewer";
const A = "00000000-0000-0000-0000-0000000000a1";
const B = "00000000-0000-0000-0000-0000000000b1";
const C = "00000000-0000-0000-0000-0000000000c1";

describe("getBlockedPairs — short-circuit guards", () => {
  it("returns an empty Set when viewerId is null (logged-out exception)", async () => {
    const { getBlockedPairs } = await import("@/lib/social/_shared/visibility");
    const { db } = (await import("@/lib/db")) as unknown as {
      db: { select: ReturnType<typeof vi.fn> };
    };
    const result = await getBlockedPairs(null, [A, B, C]);
    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(0);
    // Critical: no DB query was issued — logged-out callers must not
    // hit the blocks table at all.
    expect(db.select).not.toHaveBeenCalled();
  });

  it("returns an empty Set when candidateIds is empty (no rows to filter)", async () => {
    const { getBlockedPairs } = await import("@/lib/social/_shared/visibility");
    const { db } = (await import("@/lib/db")) as unknown as {
      db: { select: ReturnType<typeof vi.fn> };
    };
    const result = await getBlockedPairs(VIEWER, []);
    expect(result.size).toBe(0);
    // Same guard applies — no need to round-trip just to filter zero rows.
    expect(db.select).not.toHaveBeenCalled();
  });
});

describe("getBlockedPairs — Set projection over both edge directions", () => {
  it("projects the BLOCKED side when the viewer is the blocker", async () => {
    // Viewer blocked A and C → rows say (blocker=viewer, blocked=A/C).
    // The Set must contain A and C — i.e. the candidate side, not the
    // viewer side.
    whereResolveMock.mockReturnValueOnce([
      { blockerId: VIEWER, blockedId: A },
      { blockerId: VIEWER, blockedId: C },
    ]);

    const { getBlockedPairs } = await import("@/lib/social/_shared/visibility");
    const result = await getBlockedPairs(VIEWER, [A, B, C]);

    expect(result.has(A)).toBe(true);
    expect(result.has(B)).toBe(false);
    expect(result.has(C)).toBe(true);
    expect(result.has(VIEWER)).toBe(false);
    expect(result.size).toBe(2);
  });

  it("projects the BLOCKER side when a candidate blocked the viewer", async () => {
    // B blocked the viewer → row says (blocker=B, blocked=viewer).
    // The Set must contain B (so feed code can hide rows authored by B).
    whereResolveMock.mockReturnValueOnce([
      { blockerId: B, blockedId: VIEWER },
    ]);

    const { getBlockedPairs } = await import("@/lib/social/_shared/visibility");
    const result = await getBlockedPairs(VIEWER, [A, B, C]);

    expect(result.has(A)).toBe(false);
    expect(result.has(B)).toBe(true);
    expect(result.has(C)).toBe(false);
    expect(result.has(VIEWER)).toBe(false);
  });

  it("merges both directions into one Set when both edges exist", async () => {
    // Mixed bag: viewer blocked A; C blocked viewer. Both should land
    // in the result Set — bidirectional invisibility is the point.
    whereResolveMock.mockReturnValueOnce([
      { blockerId: VIEWER, blockedId: A },
      { blockerId: C, blockedId: VIEWER },
    ]);

    const { getBlockedPairs } = await import("@/lib/social/_shared/visibility");
    const result = await getBlockedPairs(VIEWER, [A, B, C]);

    expect(result.has(A)).toBe(true);
    expect(result.has(B)).toBe(false);
    expect(result.has(C)).toBe(true);
    expect(result.size).toBe(2);
  });

  it("returns an empty Set when no block rows match", async () => {
    whereResolveMock.mockReturnValueOnce([]);

    const { getBlockedPairs } = await import("@/lib/social/_shared/visibility");
    const result = await getBlockedPairs(VIEWER, [A, B, C]);

    expect(result.size).toBe(0);
  });
});

describe("getBlockedPairs — single round-trip (no N+1 regression)", () => {
  it("issues exactly one db.select() call regardless of candidate count", async () => {
    whereResolveMock.mockReturnValueOnce([]);

    const { getBlockedPairs } = await import("@/lib/social/_shared/visibility");
    const { db } = (await import("@/lib/db")) as unknown as {
      db: {
        select: ReturnType<typeof vi.fn>;
        from: ReturnType<typeof vi.fn>;
        where: ReturnType<typeof vi.fn>;
      };
    };
    db.select.mockClear();
    db.from.mockClear();
    db.where.mockClear();

    // 50 candidates — the actual feed-render shape. A regression to the
    // old isBlockedBetween loop would show up as 50 db.select calls.
    const ids = Array.from(
      { length: 50 },
      (_, i) => `00000000-0000-0000-0000-000000000${String(i).padStart(3, "0")}`,
    );
    await getBlockedPairs(VIEWER, ids);

    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.from).toHaveBeenCalledTimes(1);
    expect(db.where).toHaveBeenCalledTimes(1);
  });

  it("de-duplicates the candidate list before issuing the query", async () => {
    // The feed UNION ALL repeats the same actor across log/review/list
    // rows. The helper should de-dup before binding `IN (...)` so we
    // don't ship the same UUID 3× over the wire.
    whereResolveMock.mockReturnValueOnce([
      { blockerId: VIEWER, blockedId: A },
    ]);

    const { getBlockedPairs } = await import("@/lib/social/_shared/visibility");
    const result = await getBlockedPairs(VIEWER, [A, A, A, B, B, C]);

    // The function still returns the right Set even when the input
    // contained repeats; this is the user-visible contract.
    expect(result.has(A)).toBe(true);
    expect(result.size).toBe(1);
  });
});
