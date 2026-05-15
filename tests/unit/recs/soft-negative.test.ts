import { describe, expect, it } from "vitest";
import { softNegativePenalty } from "@/lib/recs/soft-negative";

const now = new Date("2026-05-15T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
const daysAhead = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);

describe("softNegativePenalty", () => {
  it("returns 1.0 for never-dismissed game", () => {
    expect(
      softNegativePenalty(
        { dismissedAt: null, snoozedUntil: null, neverAgain: false },
        now,
      ),
    ).toBe(1.0);
  });

  it("returns 0 for never_again=true", () => {
    expect(
      softNegativePenalty(
        { dismissedAt: null, snoozedUntil: null, neverAgain: true },
        now,
      ),
    ).toBe(0);
  });

  it("returns 0 when snoozed_until is in the future", () => {
    expect(
      softNegativePenalty(
        { dismissedAt: null, snoozedUntil: daysAhead(15), neverAgain: false },
        now,
      ),
    ).toBe(0);
  });

  it("returns 1.0 when snoozed_until has passed", () => {
    expect(
      softNegativePenalty(
        { dismissedAt: null, snoozedUntil: daysAgo(1), neverAgain: false },
        now,
      ),
    ).toBe(1.0);
  });

  it("heavily down-weights yesterday's dismissal", () => {
    const p = softNegativePenalty(
      { dismissedAt: daysAgo(1), snoozedUntil: null, neverAgain: false },
      now,
    );
    expect(p).toBeLessThan(0.1);
  });

  it("substantially decays at 15 days", () => {
    const p = softNegativePenalty(
      { dismissedAt: daysAgo(15), snoozedUntil: null, neverAgain: false },
      now,
    );
    expect(p).toBeGreaterThan(0.65);
    expect(p).toBeLessThan(0.9);
  });

  it("approaches 1.0 at 60 days", () => {
    const p = softNegativePenalty(
      { dismissedAt: daysAgo(60), snoozedUntil: null, neverAgain: false },
      now,
    );
    expect(p).toBeGreaterThan(0.98);
  });
});
