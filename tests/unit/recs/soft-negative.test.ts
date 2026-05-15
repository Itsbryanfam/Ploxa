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

  it("at the time-constant (14d) penalty is 1 - 1/e, NOT 0.5 (exponential, not half-life)", () => {
    const p = softNegativePenalty(
      { dismissedAt: daysAgo(14), snoozedUntil: null, neverAgain: false },
      now,
    );
    expect(p).toBeCloseTo(1 - Math.exp(-1), 4); // ≈ 0.6321 — pins the curve identity
  });

  it("returns 1.0 when dismissedAt is in the future (clock skew / backfill)", () => {
    expect(
      softNegativePenalty(
        { dismissedAt: daysAhead(3), snoozedUntil: null, neverAgain: false },
        now,
      ),
    ).toBe(1.0);
  });

  it("at exactly now, dismissal penalty is ~0 (no decay yet)", () => {
    expect(
      softNegativePenalty(
        { dismissedAt: now, snoozedUntil: null, neverAgain: false },
        now,
      ),
    ).toBeCloseTo(0, 10);
  });
});
