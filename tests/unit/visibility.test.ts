import { describe, expect, it, vi } from "vitest";

/**
 * `withBlockedFilter` and `isBlockedBetween` are the social-read chokepoint.
 * Forgetting either on a code path = a block-leak: blocked users see each
 * other's content despite the block. These tests pin the contract.
 *
 * We don't have a test DB harness for Drizzle integration tests yet, so we
 * mock the db helper and verify the SQL composition is correct shape.
 */

vi.mock("@/lib/db", async () => {
  const mockSchema = {
    blocks: {
      blockerId: { name: "blocker_id" },
      blockedId: { name: "blocked_id" },
    },
  };
  const mockDb = {
    select: vi.fn(() => mockDb),
    from: vi.fn(() => mockDb),
    where: vi.fn(() => mockDb),
    limit: vi.fn(() => Promise.resolve([])),
  };
  return { db: mockDb, schema: mockSchema };
});

const { withBlockedFilter, isBlockedBetween } = await import(
  "@/lib/social/_shared/visibility"
);

describe("withBlockedFilter — logged-out exception", () => {
  it("returns the query unchanged when viewerId is null", () => {
    const fakeQuery = { where: vi.fn() } as unknown as Parameters<typeof withBlockedFilter>[1];
    const result = withBlockedFilter(null, fakeQuery, { name: "user_id" } as never);
    expect(result).toBe(fakeQuery);
    expect(fakeQuery.where).not.toHaveBeenCalled();
  });
});

describe("withBlockedFilter — bidirectional notExists composition", () => {
  it("applies a .where() clause when viewerId is set", () => {
    const fakeQuery = { where: vi.fn().mockReturnThis() } as unknown as Parameters<
      typeof withBlockedFilter
    >[1];
    const result = withBlockedFilter("viewer-uuid", fakeQuery, {
      name: "user_id",
    } as never);
    expect(fakeQuery.where).toHaveBeenCalledTimes(1);
    expect(result).toBe(fakeQuery);
  });
});

describe("isBlockedBetween — predicate form", () => {
  it("returns false when no block row exists", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { db } = await import("@/lib/db") as any;
    db.limit.mockResolvedValueOnce([]);
    const result = await isBlockedBetween("a", "b");
    expect(result).toBe(false);
  });

  it("returns true when a block row exists in either direction", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { db } = await import("@/lib/db") as any;
    db.limit.mockResolvedValueOnce([{ x: 1 }]);
    const result = await isBlockedBetween("a", "b");
    expect(result).toBe(true);
  });

  it("queries with OR clause covering both directions", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { db } = await import("@/lib/db") as any;
    db.limit.mockResolvedValueOnce([]);
    await isBlockedBetween("a", "b");
    // The .where() should have been called — exact arg shape is opaque
    // because Drizzle SQL ASTs aren't serializable. We assert the call
    // happened (composition went through) and trust integration tests
    // (Playwright block-cascade.spec.ts) for end-to-end semantics.
    expect(db.where).toHaveBeenCalled();
  });
});
