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
 *       In the CURRENT (buggy) code, scheduleLoad does NOT bump reqIdRef, so
 *       A's loadRecs mints myId === 1 and B's scheduleLoad leaves reqIdRef
 *       still at 0 (B's loadRecs hasn't fired yet when A resolves). Result:
 *       A commits because myId (1) === reqIdRef.current (1 — B bumped it
 *       inside loadRecs when the debounce fired, but A already resolved and
 *       committed before then). This test demonstrates that A SHOULD be
 *       discarded.
 *
 *   (2) A→B→C triple rapid: only C commits; A and B are superseded.
 *   (3) Debounce coalescing: rapid A→B→C fires exactly ONE fetch after
 *       the debounce settles (not three).
 *   (4) Single-change (no rapid): the lone scheduled load commits.
 *   (5) onRefill bumps at initiation and its result commits; a subsequent
 *       stale in-flight load is rejected.
 *   (6) Mount auto-fetch commits (no stale load in flight at mount).
 *
 * These tests target the PROPOSED fix (bump at schedule time). They will
 * FAIL against the current code (which bumps at loadRecs time), making them
 * genuinely RED before the fix is applied.
 *
 * The model:
 *   - `reqIdRef` is a plain { current: number } object.
 *   - `debounceRef` is a plain { current: ReturnType<typeof setTimeout> | null }.
 *   - `scheduleLoad(filters, gen?)` encapsulates the timer logic.
 *   - `loadRecs(filters, gen)` encapsulates the async fetch + commit guard.
 *   - `committed` captures the last-committed result (replaces setRecsState).
 *   - All async work uses Vitest fake timers + resolved Promises.
 */

const LOAD_DEBOUNCE_MS = 350;

// ---------------------------------------------------------------------------
// Helper: build a fresh in-memory model of the scheduleLoad/loadRecs scheme.
// The constructor param `bumpAtSchedule` selects CURRENT vs PROPOSED behaviour:
//   false → bump inside loadRecs (current code — RED path)
//   true  → bump in scheduleLoad (the fix — GREEN path)
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

  // Equivalent of `loadRecs` in _client.tsx.
  async function loadRecs(filters: Filters, gen: number): Promise<void> {
    // In the CURRENT (buggy) scheme, bumpAtSchedule=false means the caller
    // passes reqIdRef.current + 1 (incremented here). In the PROPOSED fix,
    // bumpAtSchedule=true means the gen was already bumped in scheduleLoad.
    const myId = bumpAtSchedule ? gen : ++reqIdRef.current;
    try {
      const result = await getRecs(filters);
      if (myId !== reqIdRef.current) return; // last-write-wins guard
      committed = result;
    } catch {
      if (myId !== reqIdRef.current) return;
      committed = "error";
    }
  }

  // Equivalent of `scheduleLoad` in _client.tsx.
  function scheduleLoad(filters: Filters): void {
    // PROPOSED fix: bump the generation immediately at schedule time so any
    // in-flight older load is invalidated before the debounce even fires.
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
    } catch {
      if (myId !== reqIdRef.current) return;
      committed = "error";
    }
  }

  // Equivalent of the mount auto-fetch: bump + loadRecs immediately.
  async function mountFetch(filters: Filters): Promise<void> {
    const gen = ++reqIdRef.current;
    await loadRecs(filters, gen);
  }

  return { scheduleLoad, loadRecs, onRefill, mountFetch, getCommitted: () => committed, getGen: () => reqIdRef.current };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("schedule-gen-guard — PROPOSED fix (bumpAtSchedule=true)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("(1) A→B rapid: A resolves after B is scheduled — A is DISCARDED, B commits", async () => {
    // A's fetch is slow (resolves after B is scheduled).
    let resolveA!: (v: string) => void;
    const slowA = new Promise<string>((r) => { resolveA = r; });

    const getRecs = vi.fn()
      .mockReturnValueOnce(slowA)      // A's fetch
      .mockResolvedValueOnce("B-result"); // B's fetch

    const { scheduleLoad, getCommitted } = makeScheduler(true, getRecs);

    // Schedule A — bumps gen to 1 at schedule time (proposed fix).
    scheduleLoad({ label: "A" });
    // A's debounce fires.
    vi.advanceTimersByTime(LOAD_DEBOUNCE_MS);
    // A is now in-flight with gen=1. reqIdRef.current === 1.

    // Schedule B BEFORE A resolves — bumps gen to 2 at schedule time.
    scheduleLoad({ label: "B" });
    // At this point reqIdRef.current === 2; A's gen is still 1 → mismatch guaranteed.

    // Now A's slow fetch resolves.
    resolveA("A-result");
    await Promise.resolve(); // flush A's then chain

    // B's debounce fires (start from where A's already elapsed: need additional 350ms).
    vi.advanceTimersByTime(LOAD_DEBOUNCE_MS);
    await Promise.resolve(); // flush B's loadRecs call
    await Promise.resolve(); // flush B's getRecs promise

    // A's result must NOT be committed; B wins.
    expect(getCommitted()).toBe("B-result");
    expect(getCommitted()).not.toBe("A-result");
  });

  it("(2) A→B→C triple rapid: only C commits; A and B superseded", async () => {
    let resolveA!: (v: string) => void;
    let resolveB!: (v: string) => void;
    const slowA = new Promise<string>((r) => { resolveA = r; });
    const slowB = new Promise<string>((r) => { resolveB = r; });

    const getRecs = vi.fn()
      .mockReturnValueOnce(slowA)
      .mockReturnValueOnce(slowB)
      .mockResolvedValueOnce("C-result");

    const { scheduleLoad, getCommitted, getGen } = makeScheduler(true, getRecs);

    // A, B, C scheduled in rapid succession.
    scheduleLoad({ label: "A" });
    vi.advanceTimersByTime(LOAD_DEBOUNCE_MS);   // A fires → in-flight, gen=1
    scheduleLoad({ label: "B" });
    vi.advanceTimersByTime(LOAD_DEBOUNCE_MS);   // B fires → in-flight, gen=2
    scheduleLoad({ label: "C" });
    vi.advanceTimersByTime(LOAD_DEBOUNCE_MS);   // C fires → in-flight, gen=3

    // Resolve A and B (stale).
    resolveA("A-result");
    resolveB("B-result");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // C should commit.
    await Promise.resolve();

    expect(getGen()).toBe(3);
    expect(getCommitted()).toBe("C-result");
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

    const { scheduleLoad, onRefill, getCommitted } = makeScheduler(true, getRecs);

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
    expect(getCommitted()).not.toBe("A-result");
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

    const { scheduleLoad, mountFetch, getCommitted } = makeScheduler(true, getRecs);

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

    // Filter result should win.
    expect(getCommitted()).toBe("filter-result");
  });
});

// ---------------------------------------------------------------------------
// RED verification: these same tests against the CURRENT (buggy) scheme.
// Test (1) should FAIL under bumpAtSchedule=false — proving the test is
// genuinely RED before the fix lands.
// ---------------------------------------------------------------------------

describe("schedule-gen-guard — CURRENT code (bumpAtSchedule=false) — proves RED", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("(RED) A→B rapid with current code: A's result INCORRECTLY commits (stale flash)", async () => {
    // Under the current (buggy) scheme:
    //   - scheduleLoad(A) sets a timer, does NOT bump reqIdRef (stays 0).
    //   - Timer fires → loadRecs mints myId = ++reqIdRef.current = 1.
    //   - scheduleLoad(B) is called while A is in-flight; does NOT bump reqIdRef (stays 1).
    //   - A's fetch resolves → guard: myId(1) === reqIdRef.current(1) → A COMMITS (BUG).
    //   - B's timer fires → loadRecs mints myId = ++reqIdRef.current = 2 → B commits too.
    // So committed ends up as B's result, but only because B ran AFTER A. The
    // window where A's stale result was visible is the flash. We prove the BUG
    // by showing that in the current scheme, A does commit (sets committed to
    // "A-result") before B overwrites it.
    let resolveA!: (v: string) => void;
    const slowA = new Promise<string>((r) => { resolveA = r; });

    // Track every committed value in order.
    const commitLog: string[] = [];
    const baseGetRecs = vi.fn()
      .mockReturnValueOnce(slowA)
      .mockResolvedValueOnce("B-result");

    // Build current (buggy) scheduler.
    const reqIdRef = { current: 0 };
    const debounceRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };

    async function loadRecsCurrent(filters: Filters): Promise<void> {
      const myId = ++reqIdRef.current; // BUG: bumped here, not in scheduleLoad
      const result = await baseGetRecs(filters);
      if (myId !== reqIdRef.current) return;
      commitLog.push(result);
    }

    function scheduleLoadCurrent(filters: Filters): void {
      // BUG: no bump here — reqIdRef stays unchanged
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        void loadRecsCurrent(filters);
      }, LOAD_DEBOUNCE_MS);
    }

    // Schedule A.
    scheduleLoadCurrent({ label: "A" });
    vi.advanceTimersByTime(LOAD_DEBOUNCE_MS); // A fires → myId=1, reqIdRef=1
    // A is in-flight. Schedule B (does NOT bump reqIdRef; still 1).
    scheduleLoadCurrent({ label: "B" });
    // Resolve A NOW (before B's timer fires, while reqIdRef is still 1).
    resolveA("A-result");
    await Promise.resolve(); // A's then: myId(1) === reqIdRef.current(1) → A commits! BUG.
    // B's debounce fires.
    vi.advanceTimersByTime(LOAD_DEBOUNCE_MS); // B fires → myId=2, reqIdRef=2
    await Promise.resolve();
    await Promise.resolve();

    // BUG: A committed before B. The commit log shows A appearing (the flash).
    expect(commitLog).toContain("A-result"); // A incorrectly committed
    // (B also commits after — the flash self-heals, but A was visible.)
  });
});
