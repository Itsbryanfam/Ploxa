import { describe, expect, it } from "vitest";

import { shelfVisibleCount } from "@/lib/library/shelf-rows";

/**
 * The profile Library preview is a decorative wooden shelf. A ragged
 * final plank (e.g. 12 items at 7 cols → 7 + a half-empty 5) reads as
 * broken. `shelfVisibleCount` trims a *capped* preview to whole rows so
 * every rendered plank is full; the full-library callsites pass no cap
 * and must be left untouched.
 */
describe("shelfVisibleCount", () => {
  it("returns the full total when no maxRows cap (full-library callsites unaffected)", () => {
    expect(shelfVisibleCount(229, 7, undefined)).toBe(229);
    expect(shelfVisibleCount(13, 7, undefined)).toBe(13);
  });

  it("trims a capped preview to complete rows — the screenshot case (24 fetched, 7 cols, 2 rows → 14)", () => {
    expect(shelfVisibleCount(24, 7, 2)).toBe(14);
  });

  it("never exceeds maxRows full rows even when more would fit", () => {
    expect(shelfVisibleCount(24, 12, 2)).toBe(24); // 2 full rows of 12
    expect(shelfVisibleCount(24, 10, 2)).toBe(20); // 2 full rows of 10, 4 hidden
    expect(shelfVisibleCount(100, 9, 2)).toBe(18); // capped at 2 rows
  });

  it("shows a single complete row when only one full row is available", () => {
    expect(shelfVisibleCount(10, 7, 2)).toBe(7); // 1 clean row, 3 → See all
  });

  it("shows the whole library untrimmed when it is shorter than one row (not a truncation artifact)", () => {
    expect(shelfVisibleCount(5, 7, 2)).toBe(5);
    expect(shelfVisibleCount(1, 7, 2)).toBe(1);
  });

  it("returns 0 for an empty library regardless of cap", () => {
    expect(shelfVisibleCount(0, 7, 2)).toBe(0);
    expect(shelfVisibleCount(0, 7, undefined)).toBe(0);
  });

  it("is exact when the total divides evenly into the capped rows", () => {
    expect(shelfVisibleCount(14, 7, 2)).toBe(14);
    expect(shelfVisibleCount(12, 6, 2)).toBe(12);
  });
});
