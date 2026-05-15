import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * featured.test.ts — Phase 6 T7 unit tests.
 *
 * Surface under test: server actions in `lib/recaps/featured.ts`:
 *   - pinFeaturedList({listId, pinnedUntil?})
 *   - unpinFeaturedList()
 *
 * The `getActiveFeaturedList` read helper lives in `lib/recaps/featured-read.ts`
 * (not "use server") and is covered separately by integration / e2e flows.
 *
 * Mock strategy:
 * - `getCachedUser` → controls session identity.
 * - `isAdmin` → controls admin gate (sync function returning boolean).
 * - `@/lib/db` → fully mocked `execute` / `insert.values` / `transaction(cb)`.
 *   The transaction mock invokes the callback with a `tx` shim that exposes
 *   the same `execute` and `insert` spies, so the body of the callback runs
 *   inline in test land.
 * - `next/cache.revalidatePath` → spied to assert both /discover and
 *   /admin/featured invalidate.
 */

const executeMock = vi.fn();
const insertValuesMock = vi.fn();
const insertMock = vi.fn(() => ({ values: insertValuesMock }));
const transactionMock = vi.fn();
const revalidateMock = vi.fn();
const getCachedUserMock = vi.fn();
const isAdminMock = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    execute: executeMock,
    insert: insertMock,
    transaction: transactionMock,
  },
  schema: {
    featuredLists: {},
  },
}));

vi.mock("@/lib/supabase/auth-cache", () => ({
  getCachedUser: getCachedUserMock,
}));

vi.mock("@/lib/social/moderation/admin", () => ({
  isAdmin: isAdminMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidateMock,
}));

// Dynamic import after mocks register (vi.mock is hoisted).
// Note: `NotAdminError` lives in `featured-read.ts` (not in the "use server"
// sibling) — see the rationale comment in featured.ts.
const { pinFeaturedList, unpinFeaturedList } = await import(
  "@/lib/recaps/featured"
);
const { NotAdminError } = await import("@/lib/recaps/featured-read");

beforeEach(() => {
  executeMock.mockReset();
  insertValuesMock.mockReset();
  insertMock.mockClear();
  transactionMock.mockReset();
  revalidateMock.mockReset();
  getCachedUserMock.mockReset();
  isAdminMock.mockReset();

  // Default: transaction invokes its callback with a tx shim that delegates
  // back to the same execute/insert mocks.
  transactionMock.mockImplementation(
    async (cb: (tx: { execute: typeof executeMock; insert: typeof insertMock }) => Promise<void>) => {
      await cb({ execute: executeMock, insert: insertMock });
    },
  );
  insertValuesMock.mockResolvedValue(undefined);
});

describe("pinFeaturedList — auth gate", () => {
  it("rejects when no user is signed in", async () => {
    getCachedUserMock.mockResolvedValue(null);
    isAdminMock.mockReturnValue(false);
    await expect(pinFeaturedList({ listId: "l-1" })).rejects.toBeInstanceOf(
      NotAdminError,
    );
    expect(executeMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects non-admin caller", async () => {
    getCachedUserMock.mockResolvedValue({ id: "u-1" });
    isAdminMock.mockReturnValue(false);
    await expect(pinFeaturedList({ listId: "l-1" })).rejects.toBeInstanceOf(
      NotAdminError,
    );
    expect(isAdminMock).toHaveBeenCalledWith("u-1");
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

describe("pinFeaturedList — validation", () => {
  beforeEach(() => {
    getCachedUserMock.mockResolvedValue({ id: "admin-1" });
    isAdminMock.mockReturnValue(true);
  });

  it("rejects when list does not exist", async () => {
    // SELECT id, is_public FROM lists … returns empty.
    executeMock.mockResolvedValueOnce([] as never);
    await expect(pinFeaturedList({ listId: "missing" })).rejects.toThrow(
      /list not found/i,
    );
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects when list is private", async () => {
    executeMock.mockResolvedValueOnce([
      { id: "l-1", is_public: false },
    ] as never);
    await expect(pinFeaturedList({ listId: "l-1" })).rejects.toThrow(
      /must be public/i,
    );
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

describe("pinFeaturedList — happy path", () => {
  it("closes existing pin, inserts new pin, revalidates surfaces", async () => {
    getCachedUserMock.mockResolvedValue({ id: "admin-1" });
    isAdminMock.mockReturnValue(true);
    // Stage 1: validation SELECT returns public list.
    executeMock.mockResolvedValueOnce([
      { id: "l-1", is_public: true },
    ] as never);
    // Stage 2: tx.execute (UPDATE) resolves.
    executeMock.mockResolvedValueOnce(undefined as never);
    const pinnedUntil = new Date("2026-12-31T00:00:00Z");

    await pinFeaturedList({ listId: "l-1", pinnedUntil });

    expect(transactionMock).toHaveBeenCalledTimes(1);
    // tx.execute was called once (the UPDATE … pinned_until = now()).
    // Plus the initial validation SELECT outside the transaction — both
    // call the same `executeMock`, so total calls === 2.
    expect(executeMock).toHaveBeenCalledTimes(2);
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertValuesMock).toHaveBeenCalledTimes(1);
    const insertedRow = insertValuesMock.mock.calls[0]?.[0];
    expect(insertedRow).toMatchObject({
      listId: "l-1",
      surface: "discover_landing",
      pinnedBy: "admin-1",
      pinnedUntil,
    });
    expect(revalidateMock).toHaveBeenCalledWith("/discover");
    expect(revalidateMock).toHaveBeenCalledWith("/admin/featured");
    expect(revalidateMock).toHaveBeenCalledTimes(2);
  });

  it("accepts null pinnedUntil (indefinite pin)", async () => {
    getCachedUserMock.mockResolvedValue({ id: "admin-1" });
    isAdminMock.mockReturnValue(true);
    executeMock.mockResolvedValueOnce([
      { id: "l-1", is_public: true },
    ] as never);
    executeMock.mockResolvedValueOnce(undefined as never);

    await pinFeaturedList({ listId: "l-1" });

    const insertedRow = insertValuesMock.mock.calls[0]?.[0];
    expect(insertedRow.pinnedUntil).toBeNull();
  });
});

describe("unpinFeaturedList", () => {
  it("rejects non-admin caller", async () => {
    getCachedUserMock.mockResolvedValue({ id: "u-2" });
    isAdminMock.mockReturnValue(false);
    await expect(unpinFeaturedList()).rejects.toBeInstanceOf(NotAdminError);
    expect(executeMock).not.toHaveBeenCalled();
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("UPDATEs active row and revalidates surfaces (happy path)", async () => {
    getCachedUserMock.mockResolvedValue({ id: "admin-1" });
    isAdminMock.mockReturnValue(true);
    executeMock.mockResolvedValueOnce(undefined as never);

    await unpinFeaturedList();

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(revalidateMock).toHaveBeenCalledWith("/discover");
    expect(revalidateMock).toHaveBeenCalledWith("/admin/featured");
    expect(revalidateMock).toHaveBeenCalledTimes(2);
  });
});
