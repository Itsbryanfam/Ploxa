import { describe, expect, it } from "vitest";
import { yearWindow, monthWindow } from "@/lib/recaps/window";

describe("window helpers", () => {
  it("yearWindow returns Jan 1 UTC for both ends", () => {
    const { start, end } = yearWindow(2026);
    expect(start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
  it("monthWindow Feb 2024 (leap) ends Mar 1", () => {
    const { start, end } = monthWindow(2024, 2);
    expect(start.toISOString()).toBe("2024-02-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2024-03-01T00:00:00.000Z");
  });
  it("monthWindow Dec wraps to next year Jan", () => {
    const { end } = monthWindow(2026, 12);
    expect(end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});
