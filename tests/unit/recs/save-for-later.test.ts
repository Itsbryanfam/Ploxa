import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * saveRecForLater — destination semantics (production bug 2026-05-15).
 *
 * "Save for later" must add the game to the user's WISHLIST by default
 * (a recommended game is one they don't own — candidatePool excludes every
 * logged game), and only to the BACKLOG when the user already owns it
 * (an existing non-wishlist log row for that game). It previously hardcoded
 * `backlog` for every save.
 *
 * Mock set mirrors the proven `dismissal-actions.test.ts` idiom (the only
 * load-time thrower in `@/lib/recs/server-actions`' transitive graph is
 * `@/lib/cache/redis`). We additionally mock `@/lib/logs/server-actions`
 * so `ensureLog` is observed (status assertion) without dragging its own
 * transitive graph / triggerOnLogWrite into the unit run.
 *
 *   - `@/lib/db` — chainable mock; `db.select()` shifts the next array off
 *     a per-test queue (saveRecForLater issues TWO selects: recommendations
 *     ownership row, then the existing-log lookup). `db.update().set()` is
 *     captured; `db.delete` is a spy asserted never-called.
 */

vi.mock("@/lib/cache/redis", async () => {
  const { createMockRedis } = await import("../../helpers/mock-redis");
  return { redis: createMockRedis() };
});

const revalidateMock = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));

const ensureLogMock = vi.fn(async () => ({ ok: true as const }));
vi.mock("@/lib/logs/server-actions", () => ({ ensureLog: ensureLogMock }));

let selectQueue: unknown[][] = [];
let capturedSet: Record<string, unknown> | null = null;
const deleteSpy = vi.fn();

function makeChain(resolved: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "limit", "update"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.set = vi.fn((arg: Record<string, unknown>) => {
    capturedSet = arg;
    return chain;
  });
  chain.then = (
    onfulfilled: (rows: unknown[]) => unknown,
    onrejected?: (err: unknown) => unknown,
  ) => {
    try {
      return Promise.resolve(onfulfilled(resolved));
    } catch (e) {
      return onrejected ? Promise.resolve(onrejected(e)) : Promise.reject(e);
    }
  };
  return chain;
}

vi.mock("@/lib/db", async () => {
  const schema = await vi.importActual<typeof import("@/lib/db/schema")>(
    "@/lib/db/schema",
  );
  return {
    schema,
    db: {
      select: vi.fn(() => makeChain(selectQueue.shift() ?? [])),
      update: vi.fn(() => makeChain([])),
      delete: deleteSpy,
    },
  };
});

vi.mock("@/lib/supabase/auth-cache", () => ({
  getCachedUser: vi.fn(async () => ({ id: "user-1" })),
}));

beforeEach(() => {
  selectQueue = [];
  capturedSet = null;
  deleteSpy.mockClear();
  ensureLogMock.mockClear();
  revalidateMock.mockClear();
  vi.resetModules();
});

const REC = { id: "rec-1", userId: "user-1", gameId: 42 };

describe("saveRecForLater destination", () => {
  it("defaults to WISHLIST when the user has no existing log (the common rec case)", async () => {
    selectQueue = [[REC], []]; // ownership row, then no existing log
    const { saveRecForLater } = await import("@/lib/recs/server-actions");

    const r = await saveRecForLater("rec-1");

    expect(r).toEqual({ ok: true, message: "Added to your wishlist." });
    expect(ensureLogMock).toHaveBeenCalledWith({
      gameId: 42,
      status: "wishlist",
    });
    // Still dismisses the rec from the current grid (unchanged behavior).
    expect(capturedSet?.dismissed).toBe(true);
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(revalidateMock).toHaveBeenCalledWith("/play-next");
  });

  it("uses BACKLOG when the user already owns it (existing non-wishlist log)", async () => {
    for (const owningStatus of ["backlog", "playing", "completed", "on_hold", "dropped"]) {
      vi.resetModules();
      ensureLogMock.mockClear();
      selectQueue = [[REC], [{ status: owningStatus }]];
      const { saveRecForLater } = await import("@/lib/recs/server-actions");

      const r = await saveRecForLater("rec-1");

      expect(r).toEqual({ ok: true, message: "Added to your backlog." });
      expect(ensureLogMock).toHaveBeenCalledWith({
        gameId: 42,
        status: "backlog",
      });
    }
  });

  it("treats an existing WISHLIST log as not-owned → stays wishlist", async () => {
    selectQueue = [[REC], [{ status: "wishlist" }]];
    const { saveRecForLater } = await import("@/lib/recs/server-actions");

    const r = await saveRecForLater("rec-1");

    expect(r).toEqual({ ok: true, message: "Added to your wishlist." });
    expect(ensureLogMock).toHaveBeenCalledWith({
      gameId: 42,
      status: "wishlist",
    });
  });

  it("returns not-found when the rec doesn't exist", async () => {
    selectQueue = [[]];
    const { saveRecForLater } = await import("@/lib/recs/server-actions");

    const r = await saveRecForLater("missing");

    expect(r).toEqual({ ok: false, reason: "not-found" });
    expect(ensureLogMock).not.toHaveBeenCalled();
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("returns unauthorized when the rec belongs to someone else", async () => {
    selectQueue = [[{ ...REC, userId: "someone-else" }]];
    const { saveRecForLater } = await import("@/lib/recs/server-actions");

    const r = await saveRecForLater("rec-1");

    expect(r).toEqual({ ok: false, reason: "unauthorized" });
    expect(ensureLogMock).not.toHaveBeenCalled();
    expect(revalidateMock).not.toHaveBeenCalled();
  });
});
