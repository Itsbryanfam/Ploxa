import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { relativeTime } from "@/lib/utils";

/**
 * `relativeTime` is the "Xm ago" / "Xh ago" formatter used across the
 * library + platform-connection cards. The boundaries (60s, 1h, 24h, 7d,
 * 30d) are off-by-one prone: a careless `>` instead of `>=` would
 * surface as "0m ago" or "60m ago" on every list, every day. Pin the
 * exact rollover behavior.
 *
 * We fix the clock with vi.useFakeTimers so the boundary tests are
 * deterministic.
 */

const NOW = new Date("2026-05-13T12:00:00Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function ago(ms: number): Date {
  return new Date(NOW - ms);
}

describe("relativeTime — null / undefined handling", () => {
  it("returns 'never' for null", () => {
    expect(relativeTime(null)).toBe("never");
  });

  it("returns 'never' for undefined", () => {
    expect(relativeTime(undefined)).toBe("never");
  });
});

describe("relativeTime — accepts Date and ISO string", () => {
  it("accepts a Date object", () => {
    expect(relativeTime(ago(30_000))).toBe("just now");
  });

  it("accepts an ISO string equivalently", () => {
    const iso = new Date(NOW - 30_000).toISOString();
    expect(relativeTime(iso)).toBe("just now");
  });
});

describe("relativeTime — boundary rollovers", () => {
  it("renders <60s as 'just now'", () => {
    expect(relativeTime(ago(0))).toBe("just now");
    expect(relativeTime(ago(59_000))).toBe("just now");
  });

  it("rolls into 'Xm ago' at 60s", () => {
    expect(relativeTime(ago(60_000))).toBe("1m ago");
    expect(relativeTime(ago(5 * 60_000))).toBe("5m ago");
    expect(relativeTime(ago(59 * 60_000))).toBe("59m ago");
  });

  it("rolls into 'Xh ago' at 60min", () => {
    expect(relativeTime(ago(60 * 60_000))).toBe("1h ago");
    expect(relativeTime(ago(23 * 60 * 60_000))).toBe("23h ago");
  });

  it("rolls into 'Xd ago' at 24h", () => {
    expect(relativeTime(ago(24 * 60 * 60_000))).toBe("1d ago");
    expect(relativeTime(ago(6 * 24 * 60 * 60_000))).toBe("6d ago");
  });

  it("rolls into 'Xw ago' at 7d", () => {
    expect(relativeTime(ago(7 * 24 * 60 * 60_000))).toBe("1w ago");
    expect(relativeTime(ago(3 * 7 * 24 * 60 * 60_000))).toBe("3w ago");
  });

  it("rolls into a locale date past ~30d", () => {
    // The exact format depends on the runtime locale; we just verify it
    // STOPS using the "Xw ago" shape past the 30-day boundary.
    const result = relativeTime(ago(60 * 24 * 60 * 60_000));
    expect(result).not.toMatch(/^\d+w ago$/);
    expect(result).not.toMatch(/^\d+d ago$/);
  });
});

describe("relativeTime — future timestamps degrade gracefully", () => {
  it("returns 'just now' for a future timestamp (negative seconds)", () => {
    // A future timestamp shouldn't crash. The current impl renders
    // "just now" because seconds < 60 covers negative values too. This
    // pins that behavior so a future change has to think about it.
    expect(relativeTime(new Date(NOW + 5_000))).toBe("just now");
  });
});
