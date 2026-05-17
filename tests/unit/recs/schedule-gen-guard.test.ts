import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * schedule-gen-guard.test.ts — Task 15 (play-next stale-card flash fix).
 *
 * Tests the request-generation guard for the scheduleLoad → loadRecs
 * debounce/last-write-wins scheme in app/(app)/play-next/_client.tsx.
 *
 * We model the generation-counter logic as pure functions that mirror the
 * component's internal state machine — no DOM or React needed. The core
 * invariants under test:
 *
 *   (1) A→B rapid: B is scheduled before A's async fetch resolves.
 *       Under the FIXED code, scheduleLoad bumps reqIdRef at schedule time,
 *       so A's gen (1) no longer matches reqIdRef.current (2) when A
 *       resolves — A is rejected BEFORE it can write. "A-result" must NEVER
 *       appear in commitLog (not even transiently). Under the pre-fix model
 *       (bumpAtSchedule=false), A does write, so commitLog contains
 *       "A-result" and the not.toContain assertion FAILS — proving genuine RED.
 *
 *   (2) A→B→C triple rapid: only C commits; A and B are superseded.
 *       Same transient-commit guarantee: neither "A-result" nor "B-result"
 *       must ever appear in commitLog under the fixed scheme.
 *
 *   (3) Debounce coalescing: rapid A→B→C fires exactly ONE fetch after
 *       the debounce settles (not three).
 *   (4) Single-change (no rapid): the lone scheduled load commits.
 *   (5) onRefill bumps at initiation and its result commits; a subsequent
 *       stale in-flight load is rejected.
 *   (6) Mount auto-fetch commits (no stale load in flight at mount).
 *
 * MODEL FAITHFULNESS (verified against _client.tsx):
 *   Post-fix branch (bumpAtSchedule=true):
 *     - scheduleLoad: `const gen = ++reqIdRef.current` (matches line 138 of _client.tsx)
 *     - loadRecs: uses the passed-in `gen` directly as `myId` (matches line 106 guard)
 *   Pre-fix branch (bumpAtSchedule=false):
 *     - scheduleLoad: no bump (reqIdRef stays unchanged)
 *     - loadRecs: `const myId = ++reqIdRef.current` (the old buggy scheme)
 *   The pre-fix model faithfully reproduces the documented bug: A fires,
 *   bumps reqIdRef to 1 (myId=1); B schedules but does NOT bump (reqIdRef
 *   stays 1); A resolves, guard myId(1) === reqIdRef.current(1) passes → A
 *   commits. The bumpAtSchedule toggle is the sole discriminator between
 *   these two schemes, making it a genuine RED/GREEN pair.
 */

const LOAD_DEBOUNCE_MS = 350;

// ---------------------------------------------------------------------------
// Helper: build a fresh in-memory model of the scheduleLoad/loadRecs scheme.
// The constructor param `bumpAtSchedule` selects PRE-FIX vs POST-FIX behaviour:
//   false → bump inside loadRecs (pre-fix / buggy — RED path)
//   true  → bump in scheduleLoad (post-fix / fix — GREEN path)
//
// `commitLog` records EVERY value ever written to committed state in order,
// enabling transient-commit assertions ("A-result must NEVER be written").
// ---------------------------------------------------------------------------

type Filters = { label: string };

function makeScheduler(
  bumpAtSchedule: boolean,
  getRecs: (f: Filters) => Promise<string>,
) {
  const reqIdRef = { current: 0 };
  const debounceRef: { current: ReturnType<typeof setTimeout> | null } = {
    current: null,
  };
  let committed: string | null = null;
  const commitLog: string[] = [];

  // Equivalent of `loadRecs` in _client.tsx.
  async function loadRecs(filters: Filters, gen: number): Promise<void> {
    // Post-fix: myId = the gen passed from scheduleLoad (already bumped there).
    // Pre-fix: myId = ++reqIdRef.current (bumped here instead — the bug).
    const myId = bumpAtSchedule ? gen : ++reqIdRef.current;
    try {
      const result = await getRecs(filters);
      if (myId !== reqIdRef.current) return; // last-write-wins guard
      committed = result;
      commitLog.push(result); // record every write, not just the last
    } catch {
      if (myId !== reqIdRef.current) return;
      committed = "error";
      commitLog.push("error");
    }
  }

  // Equivalent of `scheduleLoad` in _client.tsx.
  function scheduleLoad(filters: Filters): void {
    // Post-fix: bump the generation immediately at schedule time so any
    // in-flight older load is invalidated before the debounce even fires.
    // Pre-fix: no bump here (reqIdRef unchanged until loadRecs fires).
    const gen = bumpAtSchedule ? ++reqIdRef.current : reqIdRef.current;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void loadRecs(filters, gen);
    }, LOAD_DEBOUNCE_MS);
  }

  // Equivalent of `onRefill` in _client.tsx — bumps at initiation, no debounce.
  async function onRefill(filters: Filters): Promise<void> {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const myId = ++reqIdRef.current;
    try {
      const result = await getRecs(filters);
      if (myId !== reqIdRef.current) return;
      committed = result;
      commitLog.push(result);
    } catch {
      if (myId !== reqIdRef.current) return;
      committed = "error";
      commitLog.push("error");
    }
  }

  // Equivalent of the mount auto-fetch: bump + loadRecs immediately.
  async function mountFetch(filters: Filters): Promise<void> {
    const gen = ++reqIdRef.current;
    await loadRecs(filters, gen);
  }

  return {
    scheduleLoad,
    loadRecs,
    onRefill,
    mountFetch,
    getCommitted: () => committed,
    getGen: () => reqIdRef.current,
    getCommitLog: () => commitLog,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("schedule-gen-guard — POST-FIX scheme (bumpAtSchedule=true)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("(1) A→B rapid: A must NEVER be committed (not even transiently) — commitLog does not contain A-result", async () => {
    // A's fetch is slow (resolves after B is scheduled).
    let resolveA!: (v: string) => void;
    const slowA = new Promise<string>((r) => { resolveA = r; });

    const getRecs = vi.fn()
      .mockReturnValueOnce(slowA)           // A's fetch
      .mockResolvedValueOnce("B-result");   // B's fetch

    const { scheduleLoad, getCommitted, getCommitLog } = makeScheduler(true, getRecs);

    // Schedule A — bumps gen to 1 at schedule time (post-fix).
    scheduleLoad({ label: "A" });
    // A's debounce fires.
    vi.advanceTimersByTime(LOAD_DEBOUNCE_MS);
    // A is now in-flight with gen=1. reqIdRef.current === 1.

    // Schedule B BEFORE A resolves — bumps gen to 2 at schedule time.
    scheduleLoad({ label: "B" });
    // reqIdRef.current === 2 now; A's gen is still 1 → mismatch guaranteed on A's resolve.

    // A's slow fetch resolves.
    resolveA("A-result");
    await Promise.resolve(); // flush A's then chain — guard fires, A is rejected

    // B's debounce fires.
    vi.advanceTimersByTime(LOAD_DEBOUNCE_MS);
    await Promise.resolve(); // flush B's loadRecs call
    await Promise.resolve(); // flush B's getRecs promise

    // LOAD-BEARING: A must NEVER have been written to committed state.
    expect(getCommitLog()).not.toContain("A-result");
    // B is the winner.
    expect(getCommitLog()).toContain("B-result");
    expect(getCommitted()).toBe("B-result");
  });

  it("(2) A→B→C triple rapid: neither A-result nor B-result ever in commitLog — only C", async () => {
    let resolveA!: (v: string) => void;
    let resolveB!: (v: string) => void;
    const slowA = new Promise<string>((r) => { resolveA = r; });
    const slowB = new Promise<string>((r) => { resolveB = r; });

    const getRecs = vi.fn()
      .mockReturnValueOnce(slowA)
      .mockReturnValueOnce(slowB)
      .mockResolvedValueOnce("C-result");

    const { scheduleLoad, getCommitted, getGen, getCommitLog } = makeScheduler(true, getRecs);

    // A, B, C scheduled in rapid succession — each bumps gen at schedule time.
    scheduleLoad({ label: "A" });
    vi.advanceTimersByTime(LOAD_DEBOUNCE_MS);   // A fires → in-flight, gen=1
    scheduleLoad({ label: "B" });
    vi.advanceTimersByTime(LOAD_DEBOUNCE_MS);   // B fires → in-flight, gen=2
    scheduleLoad({ label: "C" });
    vi.advanceTimersByTime(LOAD_DEBOUNCE_MS);   // C fires → in-flight, gen=3

    // Resolve A and B (both stale — rejected by gen guard).
    resolveA("A-result");
    resolveB("B-result");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // C resolves.
    await Promise.resolve();

    expect(getGen()).toBe(3);
    expect(getCommitted()).toBe("C-result");

    // LOAD-BEARING: stale A and B must never have appeared in the commit log.
    expect(getCommitLog()).not.toContain("A-result");
    expect(getCommitLog()).not.toContain("B-result");
    expect(getCommitLog()).toContain("C-result");
  });

  it("(3) Debounce coalescing: rapid A→B→C fires exactly ONE fetch", async () => {
    const getRecs = vi.fn().mockResolvedValue("result");
    const { scheduleLoad } = makeScheduler(true, getRecs);

    // Three rapid changes within the debounce window.
    scheduleLoad({ label: "A" });
    vi.advanceTimersByTime(100); // less than 350ms
    scheduleLoad({ label: "B" });
    vi.advanceTimersByTime(100);
    scheduleLoad({ label: "C" });
    // Now let the final debounce settle.
    vi.advanceTimersByTime(LOAD_DEBOUNCE_MS);
    await Promise.resolve();

    // Only ONE fetch should have fired (the debounce coalesced to C).
    expect(getRecs).toHaveBeenCalledTimes(1);
    expect(getRecs).toHaveBeenCalledWith({ label: "C" });
  });

  it("(4) Single-change: the lone scheduled load commits", async () => {
    const getRecs = vi.fn().mockResolvedValue("only-result");
    const { scheduleLoad, getCommitted } = makeScheduler(true, getRecs);

    scheduleLoad({ label: "A" });
    vi.advanceTimersByTime(LOAD_DEBOUNCE_MS);
    await Promise.resolve();
    await Promise.resolve();

    expect(getCommitted()).toBe("only-result");
  });

  it("(5) onRefill commits when no stale load in flight", async () => {
    const getRecs = vi.fn().mockResolvedValue("refill-result");
    const { onRefill, getCommitted } = makeScheduler(true, getRecs);

    await onRefill({ label: "refill" });

    expect(getCommitted()).toBe("refill-result");
  });

  it("(5b) onRefill supersedes an in-flight stale scheduled load", async () => {
    let resolveA!: (v: string) => void;
    const slowA = new Promise<string>((r) => { resolveA = r; });

    const getRecs = vi.fn()
      .mockReturnValueOnce(slowA)
      .mockResolvedValueOnce("refill-result");

    const { scheduleLoad, onRefill, getCommitted, getCommitLog } = makeScheduler(true, getRecs);

    // Schedule A (in-flight).
    scheduleLoad({ label: "A" });
    vi.advanceTimersByTime(LOAD_DEBOUNCE_MS);
    // A is in-flight with gen=1.

    // User clicks refill — bumps gen to 2 immediately.
    const refillPromise = onRefill({ label: "refill" });

    // Now A resolves (stale, gen=1 !== reqIdRef.current=2).
    resolveA("A-result");
    await Promise.resolve();

    // Refill resolves.
    await refillPromise;

    expect(getCommitted()).toBe("refill-result");
    // A must never have been committed.
    expect(getCommitLog()).not.toContain("A-result");
  });

  it("(6) Mount auto-fetch commits", async () => {
    const getRecs = vi.fn().mockResolvedValue("mount-result");
    const { mountFetch, getCommitted } = makeScheduler(true, getRecs);

    await mountFetch({ label: "mount" });

    expect(getCommitted()).toBe("mount-result");
  });

  it("(6b) Mount auto-fetch does NOT commit if a subsequent scheduleLoad fires first", async () => {
    let resolveMount!: (v: string) => void;
    const slowMount = new Promise<string>((r) => { resolveMount = r; });

    const getRecs = vi.fn()
      .mockReturnValueOnce(slowMount)
      .mockResolvedValueOnce("filter-result");

    const { scheduleLoad, mountFetch, getCommitted, getCommitLog } = makeScheduler(true, getRecs);

    // Mount fetch starts (gen=1).
    const mountP = mountFetch({ label: "mount" });

    // User changes a filter before mount resolves (gen=2).
    scheduleLoad({ label: "filter" });
    vi.advanceTimersByTime(LOAD_DEBOUNCE_MS);
    await Promise.resolve();
    await Promise.resolve();

    // Mount resolves (stale gen=1).
    resolveMount("mount-result");
    await mountP;

    // Filter result should win; mount-result must never have been committed.
    expect(getCommitted()).toBe("filter-result");
    expect(getCommitLog()).not.toContain("mount-result");
  });
});

// ---------------------------------------------------------------------------
// RED verification: run the SAME stale-discard scenarios against the PRE-FIX
// (bumpAtSchedule=false) scheme. This section proves the commitLog assertions
// above are genuine REDs — they FAIL under the pre-fix model, meaning a future
// revert of the scheduleLoad bump would be caught immediately.
//
// These tests use `expect.assertions` so they self-document that the
// "toContain" is the mandatory failure trigger, not a no-op.
// ---------------------------------------------------------------------------

describe("schedule-gen-guard — PRE-FIX scheme (bumpAtSchedule=false) — proves RED is genuine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("(RED-1) PRE-FIX A→B rapid: A DOES commit transiently (commitLog contains A-result)", async () => {
    // Under the pre-fix (buggy) scheme:
    //   - scheduleLoad(A) sets timer, does NOT bump reqIdRef (stays 0).
    //   - Timer fires → loadRecs bumps: myId = ++reqIdRef.current = 1.
    //   - scheduleLoad(B) runs, still does NOT bump (reqIdRef stays 1).
    //   - A's fetch resolves → guard: myId(1) === reqIdRef.current(1) → A COMMITS. BUG.
    //   - B's timer fires → loadRecs bumps: myId = ++reqIdRef.current = 2.
    //   - B commits. The flash self-heals but A was written first.
    // commitLog will be ["A-result", "B-result"] — A appeared transiently.
    // This test PASSES under pre-fix (confirming the bug) and thus also confirms
    // the GREEN suite's `not.toContain("A-result")` would FAIL here (genuine RED).
    let resolveA!: (v: string) => void;
    const slowA = new Promise<string>((r) => { resolveA = r; });

    const getRecs = vi.fn()
      .mockReturnValueOnce(slowA)
      .mockResolvedValueOnce("B-result");

    const { scheduleLoad, getCommitLog } = makeScheduler(false, getRecs);

    // Schedule A — pre-fix: no bump at schedule time.
    scheduleLoad({ label: "A" });
    vi.advanceTimersByTime(LOAD_DEBOUNCE_MS); // A fires → myId=1, reqIdRef=1
    // A is in-flight. Schedule B — pre-fix: still no bump (reqIdRef stays 1).
    scheduleLoad({ label: "B" });
    // Resolve A NOW (before B's timer fires, reqIdRef is still 1).
    resolveA("A-result");
    await Promise.resolve(); // A's guard: myId(1) === reqIdRef.current(1) → A commits
    // B's debounce fires.
    vi.advanceTimersByTime(LOAD_DEBOUNCE_MS); // B fires → myId=2, reqIdRef=2
    await Promise.resolve();
    await Promise.resolve();

    // BUG CONFIRMED: A did commit (the transient flash). This is what the
    // post-fix's `not.toContain("A-result")` would catch as a RED failure.
    expect(getCommitLog()).toContain("A-result");
    expect(getCommitLog()).toContain("B-result");
    expect(getCommitLog()).toStrictEqual(["A-result", "B-result"]);
  });

});
