import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Play-next redesign Task 13 — dismissal/snooze/never-again server actions.
 *
 * `@/lib/recs/server-actions` is a `"use server"` module that transitively
 * imports `ensureLog` (@/lib/logs/server-actions) → `@/lib/cache/redis`,
 * which throws at load if UPSTASH_REDIS_* env is absent. We mirror the EXACT
 * proven mock set from tests/integration/recs/get-recs.test.ts that makes
 * `server-actions` loadable under Vitest:
 *
 *   - `@/lib/cache/redis` — in-memory mock (tests/helpers/mock-redis), the
 *     only documented load-time thrower in the transitive graph.
 *   - `@/lib/db` — chainable query-builder mock. SELECT pops a
 *     per-test-configurable ownership row; UPDATE records `.set()` so we can
 *     assert the exact written fields. `delete` is also stubbed so the test
 *     can assert it is NEVER called (no row deletion).
 *   - `@/lib/supabase/auth-cache` — getCachedUser → { id: "user-1" }.
 *   - `next/cache` — revalidatePath captured (it throws under Vitest with
 *     "static generation store missing"; standard repo pattern, cf.
 *     tests/unit/visibility-actions.test.ts et al.). The capture also lets
 *     us assert the cache bust fires on the success paths.
 *
 * The dismissal actions never call getFingerprint / candidatePool /
 * fetchSocialSignals (those run only inside getRecs), so unlike the T12
 * integration test we don't need to mock them — they only import `@/lib/db`
 * + `server-only` (auto-stubbed) and so load cleanly under the db mock.
 */

vi.mock("@/lib/cache/redis", async () => {
  const { createMockRedis } = await import("../../helpers/mock-redis");
  return { redis: createMockRedis() };
});

const revalidateMock = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));

// ── DB chainable mock ────────────────────────────────────────────────
// The actions issue exactly two chains:
//   db.select({...}).from(recommendations).where(eq(id)).limit(1)  → ownership
//   db.update(recommendations).set({...}).where(eq(id))            → mutation
// `selectRow` is set per-test (reset in beforeEach) to drive the
// owned / not-found / unauthorized cases. `capturedSet` records the
// argument passed to `.set(...)` so each test can assert the exact fields.

let selectRow: { id: string; userId: string } | undefined;
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
      // SELECT resolves to the configured ownership row (or [] for not-found).
      select: vi.fn(() => makeChain(selectRow ? [selectRow] : [])),
      // UPDATE resolves to [] — the actions only `await` it. `.set()` is
      // captured via the shared chain factory.
      update: vi.fn(() => makeChain([])),
      // Present so a test can assert the actions never delete the row.
      delete: deleteSpy,
    },
  };
});

vi.mock("@/lib/supabase/auth-cache", () => ({
  getCachedUser: vi.fn(async () => ({ id: "user-1" })),
}));

beforeEach(() => {
  selectRow = undefined;
  capturedSet = null;
  deleteSpy.mockClear();
  revalidateMock.mockClear();
  vi.resetModules();
});

const SECONDS = 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

describe("snoozeRec", () => {
  it("sets snoozedUntil ~30d ahead AND dismissed=true so the snooze survives refill", async () => {
    selectRow = { id: "rec-1", userId: "user-1" };
    const { snoozeRec } = await import("@/lib/recs/server-actions");

    const before = Date.now();
    const r = await snoozeRec("rec-1");
    const after = Date.now();

    expect(r.ok).toBe(true);
    expect(capturedSet).not.toBeNull();
    const snoozedUntil = capturedSet?.snoozedUntil as Date;
    expect(snoozedUntil).toBeInstanceOf(Date);
    // ~30d in the future, within the wall-clock window of the call.
    expect(snoozedUntil.getTime()).toBeGreaterThanOrEqual(
      before + THIRTY_DAYS_MS - 5 * SECONDS,
    );
    expect(snoozedUntil.getTime()).toBeLessThanOrEqual(
      after + THIRTY_DAYS_MS + 5 * SECONDS,
    );
    // Production bug 2026-05-15: a snooze is a dismissal. It MUST set
    // dismissed=true so refillRecs ("Show me more like these →", which
    // DELETEs WHERE dismissed=false) doesn't wipe the snooze row — and so
    // the rerank negative-context (WHERE dismissed=true) sees it. The
    // *temporal* nature lives in snoozedUntil, not in withholding dismissed.
    expect(capturedSet?.dismissed).toBe(true);
    // Snooze is temporary — it must NOT set the permanent never-again flag.
    expect(capturedSet).not.toHaveProperty("neverAgain");
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(revalidateMock).toHaveBeenCalledWith("/play-next");
  });

  it("returns not-found when the rec doesn't exist", async () => {
    selectRow = undefined; // select → []
    const { snoozeRec } = await import("@/lib/recs/server-actions");

    const r = await snoozeRec("missing");

    expect(r).toEqual({ ok: false, reason: "not-found" });
    expect(capturedSet).toBeNull();
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("returns unauthorized when the rec belongs to someone else", async () => {
    selectRow = { id: "rec-1", userId: "someone-else" };
    const { snoozeRec } = await import("@/lib/recs/server-actions");

    const r = await snoozeRec("rec-1");

    expect(r).toEqual({ ok: false, reason: "unauthorized" });
    expect(capturedSet).toBeNull();
    expect(revalidateMock).not.toHaveBeenCalled();
  });
});

describe("neverAgainRec", () => {
  it("sets neverAgain=true + dismissedAt + dismissed=true for an owned rec (no row delete)", async () => {
    selectRow = { id: "rec-1", userId: "user-1" };
    const { neverAgainRec } = await import("@/lib/recs/server-actions");

    const before = Date.now();
    const r = await neverAgainRec("rec-1");
    const after = Date.now();

    expect(r.ok).toBe(true);
    expect(capturedSet).not.toBeNull();
    expect(capturedSet?.neverAgain).toBe(true);
    // Production bug 2026-05-15: like snooze, never-again must also flip
    // dismissed=true so it survives refillRecs' WHERE dismissed=false DELETE
    // and feeds the rerank negative-context (WHERE dismissed=true).
    expect(capturedSet?.dismissed).toBe(true);
    const dismissedAt = capturedSet?.dismissedAt as Date;
    expect(dismissedAt).toBeInstanceOf(Date);
    expect(dismissedAt.getTime()).toBeGreaterThanOrEqual(before - SECONDS);
    expect(dismissedAt.getTime()).toBeLessThanOrEqual(after + SECONDS);
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(revalidateMock).toHaveBeenCalledWith("/play-next");
  });

  it("returns not-found when the rec doesn't exist", async () => {
    selectRow = undefined;
    const { neverAgainRec } = await import("@/lib/recs/server-actions");

    const r = await neverAgainRec("missing");

    expect(r).toEqual({ ok: false, reason: "not-found" });
    expect(capturedSet).toBeNull();
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("returns unauthorized when the rec belongs to someone else", async () => {
    selectRow = { id: "rec-1", userId: "someone-else" };
    const { neverAgainRec } = await import("@/lib/recs/server-actions");

    const r = await neverAgainRec("rec-1");

    expect(r).toEqual({ ok: false, reason: "unauthorized" });
    expect(capturedSet).toBeNull();
    expect(revalidateMock).not.toHaveBeenCalled();
  });
});

describe("dismissRec (now also stamps dismissedAt)", () => {
  it("sets dismissed=true AND dismissedAt for an owned rec (no row delete)", async () => {
    selectRow = { id: "rec-1", userId: "user-1" };
    const { dismissRec } = await import("@/lib/recs/server-actions");

    const before = Date.now();
    const r = await dismissRec("rec-1");
    const after = Date.now();

    expect(r.ok).toBe(true);
    expect(capturedSet).not.toBeNull();
    // Existing behavior preserved …
    expect(capturedSet?.dismissed).toBe(true);
    // … plus the NEW soft-negative timestamp for T5's time-decay penalty.
    const dismissedAt = capturedSet?.dismissedAt as Date;
    expect(dismissedAt).toBeInstanceOf(Date);
    expect(dismissedAt.getTime()).toBeGreaterThanOrEqual(before - SECONDS);
    expect(dismissedAt.getTime()).toBeLessThanOrEqual(after + SECONDS);
    // Deliberately does NOT delete the row (kept for rerank neg-context).
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(revalidateMock).toHaveBeenCalledWith("/play-next");
  });

  it("returns not-found when the rec doesn't exist", async () => {
    selectRow = undefined;
    const { dismissRec } = await import("@/lib/recs/server-actions");

    const r = await dismissRec("missing");

    expect(r).toEqual({ ok: false, reason: "not-found" });
    expect(capturedSet).toBeNull();
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("returns unauthorized when the rec belongs to someone else", async () => {
    selectRow = { id: "rec-1", userId: "someone-else" };
    const { dismissRec } = await import("@/lib/recs/server-actions");

    const r = await dismissRec("rec-1");

    expect(r).toEqual({ ok: false, reason: "unauthorized" });
    expect(capturedSet).toBeNull();
    expect(revalidateMock).not.toHaveBeenCalled();
  });
});
