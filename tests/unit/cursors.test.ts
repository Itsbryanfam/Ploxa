import { describe, expect, it } from "vitest";

import {
  compareFeedRows,
  decodeCursor,
  encodeCursor,
  type FeedCursor,
} from "@/lib/social/_shared/cursors";

/**
 * Feed cursor pinning. Off-by-one or sort-drift here means feed pagination
 * either skips rows or returns duplicates — both silent failure modes that
 * are extra painful because users won't report them, they just see "weird
 * feed."
 */

describe("encodeCursor / decodeCursor round-trip", () => {
  it("round-trips a typical cursor exactly", () => {
    const c: FeedCursor = {
      eventAt: new Date("2026-05-12T15:00:00Z"),
      kind: "review",
      actorId: "11111111-1111-1111-1111-111111111111",
    };
    const decoded = decodeCursor(encodeCursor(c));
    expect(decoded).not.toBeNull();
    expect(decoded?.eventAt.toISOString()).toBe(c.eventAt.toISOString());
    expect(decoded?.kind).toBe(c.kind);
    expect(decoded?.actorId).toBe(c.actorId);
  });

  it("returns null for null/undefined/empty input", () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });

  it("returns null for garbage input", () => {
    expect(decodeCursor("not-a-cursor")).toBeNull();
    expect(decodeCursor("aGVsbG8=")).toBeNull(); // valid b64 but bad payload
  });

  it("returns null for unknown kind", () => {
    const bad = Buffer.from(
      JSON.stringify({ at: new Date().toISOString(), k: "follow", a: "x" }),
    ).toString("base64url");
    expect(decodeCursor(bad)).toBeNull();
  });

  it("returns null for invalid date in at field", () => {
    const bad = Buffer.from(
      JSON.stringify({ at: "not-a-date", k: "log", a: "x" }),
    ).toString("base64url");
    expect(decodeCursor(bad)).toBeNull();
  });
});

describe("compareFeedRows — canonical sort", () => {
  const now = new Date("2026-05-12T12:00:00Z");
  const earlier = new Date("2026-05-12T11:59:00Z");

  it("sorts newer eventAt before older (DESC)", () => {
    expect(
      compareFeedRows(
        { eventAt: now, kind: "log", actorId: "a" },
        { eventAt: earlier, kind: "log", actorId: "a" },
      ),
    ).toBeLessThan(0);
  });

  it("on same eventAt, log before review before list", () => {
    expect(
      compareFeedRows(
        { eventAt: now, kind: "log", actorId: "a" },
        { eventAt: now, kind: "review", actorId: "a" },
      ),
    ).toBeLessThan(0);
    expect(
      compareFeedRows(
        { eventAt: now, kind: "review", actorId: "a" },
        { eventAt: now, kind: "list", actorId: "a" },
      ),
    ).toBeLessThan(0);
  });

  it("on same eventAt and kind, actor_id ASC", () => {
    expect(
      compareFeedRows(
        { eventAt: now, kind: "log", actorId: "aaaa" },
        { eventAt: now, kind: "log", actorId: "bbbb" },
      ),
    ).toBeLessThan(0);
  });

  it("returns 0 for identical triplets", () => {
    const row = { eventAt: now, kind: "log" as const, actorId: "x" };
    expect(compareFeedRows(row, row)).toBe(0);
  });
});
