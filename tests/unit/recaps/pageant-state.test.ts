import { describe, expect, it } from "vitest";

import { pageantReducer, type PageantState } from "@/components/recaps/Pageant";

/**
 * Pure-reducer tests for the Pageant state machine — Phase 6 T12.
 *
 * The pageant is a client component; its DOM behavior (drag, keyboard,
 * AnimatePresence) is covered by the Playwright smoke in T22. Here we only
 * exercise the transition function so it stays a no-side-effect pure fn
 * that's safe to reason about and refactor.
 */
const init = (
  total = 5,
  index = 0,
  isPaused = false,
): PageantState => ({ index, isPaused, total });

describe("pageantReducer", () => {
  it("ADVANCE moves index forward", () => {
    expect(pageantReducer(init(5, 0), { type: "ADVANCE" }).index).toBe(1);
  });

  it("ADVANCE stops at total - 1 (no overshoot)", () => {
    const last = pageantReducer(init(5, 4), { type: "ADVANCE" });
    expect(last.index).toBe(4);
  });

  it("ADVANCE preserves isPaused", () => {
    const next = pageantReducer(init(5, 0, true), { type: "ADVANCE" });
    expect(next.isPaused).toBe(true);
  });

  it("BACK moves index backward", () => {
    expect(pageantReducer(init(5, 3), { type: "BACK" }).index).toBe(2);
  });

  it("BACK stops at 0 (no underflow)", () => {
    expect(pageantReducer(init(5, 0), { type: "BACK" }).index).toBe(0);
  });

  it("PAUSE sets isPaused true (sticky)", () => {
    const next = pageantReducer(init(5, 0, false), { type: "PAUSE" });
    expect(next.isPaused).toBe(true);
    // Idempotent: pausing while paused stays paused.
    const stillPaused = pageantReducer(next, { type: "PAUSE" });
    expect(stillPaused.isPaused).toBe(true);
  });

  it("RESUME sets isPaused false", () => {
    const next = pageantReducer(init(5, 0, true), { type: "RESUME" });
    expect(next.isPaused).toBe(false);
  });

  it("RESUME preserves index", () => {
    const next = pageantReducer(init(5, 3, true), { type: "RESUME" });
    expect(next.index).toBe(3);
  });

  it("JUMP clamps negative to 0", () => {
    expect(
      pageantReducer(init(5, 2), { type: "JUMP", index: -1 }).index,
    ).toBe(0);
  });

  it("JUMP clamps overflow to total - 1", () => {
    expect(
      pageantReducer(init(5, 0), { type: "JUMP", index: 99 }).index,
    ).toBe(4);
  });

  it("JUMP accepts valid in-range index", () => {
    expect(
      pageantReducer(init(5, 0), { type: "JUMP", index: 2 }).index,
    ).toBe(2);
  });

  it("JUMP preserves isPaused", () => {
    const next = pageantReducer(init(5, 0, true), { type: "JUMP", index: 1 });
    expect(next.isPaused).toBe(true);
  });

  it("does not mutate input state (returns new object)", () => {
    const initial = init(5, 2);
    const next = pageantReducer(initial, { type: "ADVANCE" });
    expect(next).not.toBe(initial);
    expect(initial.index).toBe(2); // input untouched
  });

  it("handles total=1 (single-scene recap) gracefully", () => {
    // No advance, no back — index stays at 0.
    const oneScene = init(1, 0);
    expect(pageantReducer(oneScene, { type: "ADVANCE" }).index).toBe(0);
    expect(pageantReducer(oneScene, { type: "BACK" }).index).toBe(0);
  });
});
