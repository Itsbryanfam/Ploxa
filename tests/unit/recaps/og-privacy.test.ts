import { describe, expect, it, beforeEach, vi } from "vitest";

/**
 * F-001: the recap OG routes must 404 private profiles (the URL is
 * enumerable, so "sharing is consent" doesn't hold) and must NOT invoke the
 * host-paid cache-or-build path for them.
 *
 * `@/lib/db` is mocked so `db.execute` returns a primed profile row;
 * drizzle-orm is left real (the mock ignores the SQL arg). `next/og` and the
 * OG card are stubbed so we never render a real image.
 */

vi.mock("@/lib/db", () => ({ db: { execute: vi.fn() }, schema: {} }));

vi.mock("next/og", () => ({
  ImageResponse: class {
    __imageResponse = true;
  },
}));

vi.mock("@/lib/recaps/og/card", () => ({ RecapOgCard: vi.fn(() => null) }));

const cacheOrBuildYearly = vi.fn().mockResolvedValue({
  payload: { tier: "ok", scenes: [] },
  lockedAt: null,
});
const cacheOrBuildMonthly = vi.fn().mockResolvedValue({
  payload: { tier: "ok", scenes: [] },
  lockedAt: null,
});
vi.mock("@/lib/recaps/cache-or-build", () => ({
  cacheOrBuildYearly,
  cacheOrBuildMonthly,
}));

import { db } from "@/lib/db";

const mockExecute = vi.mocked(db.execute);

beforeEach(() => {
  mockExecute.mockReset();
  cacheOrBuildYearly.mockClear();
  cacheOrBuildMonthly.mockClear();
});

const req = () => new Request("http://localhost/og");

describe("OG recap routes — private profile gate (F-001)", () => {
  it("year route 404s a private profile and does not build", async () => {
    mockExecute.mockResolvedValueOnce([
      { user_id: "u1", is_public: false },
    ] as never);
    const { GET } = await import("@/app/og/year/[username]/[year]/route");
    const res = await GET(req(), {
      params: Promise.resolve({ username: "alice", year: "2026" }),
    });
    expect(res.status).toBe(404);
    expect(cacheOrBuildYearly).not.toHaveBeenCalled();
  });

  it("year/scene route 404s a private profile and does not build", async () => {
    mockExecute.mockResolvedValueOnce([
      { user_id: "u1", is_public: false },
    ] as never);
    const { GET } = await import(
      "@/app/og/year/[username]/[year]/scene/[i]/route"
    );
    const res = await GET(req(), {
      params: Promise.resolve({ username: "alice", year: "2026", i: "1" }),
    });
    expect(res.status).toBe(404);
    expect(cacheOrBuildYearly).not.toHaveBeenCalled();
  });

  it("month route 404s a private profile and does not build", async () => {
    mockExecute.mockResolvedValueOnce([
      { user_id: "u1", is_public: false },
    ] as never);
    const { GET } = await import("@/app/og/month/[username]/[yyyymm]/route");
    const res = await GET(req(), {
      params: Promise.resolve({ username: "alice", yyyymm: "202605" }),
    });
    expect(res.status).toBe(404);
    expect(cacheOrBuildMonthly).not.toHaveBeenCalled();
  });

  it("month/scene route 404s a private profile and does not build", async () => {
    mockExecute.mockResolvedValueOnce([
      { user_id: "u1", is_public: false },
    ] as never);
    const { GET } = await import(
      "@/app/og/month/[username]/[yyyymm]/scene/[i]/route"
    );
    const res = await GET(req(), {
      params: Promise.resolve({ username: "alice", yyyymm: "202605", i: "1" }),
    });
    expect(res.status).toBe(404);
    expect(cacheOrBuildMonthly).not.toHaveBeenCalled();
  });

  it("year route still builds for a PUBLIC profile (gate doesn't over-block)", async () => {
    mockExecute.mockResolvedValueOnce([
      { user_id: "u1", is_public: true },
    ] as never);
    const { GET } = await import("@/app/og/year/[username]/[year]/route");
    const res = await GET(req(), {
      params: Promise.resolve({ username: "alice", year: "2026" }),
    });
    expect(res.status).not.toBe(404);
    expect(cacheOrBuildYearly).toHaveBeenCalledWith({
      userId: "u1",
      year: 2026,
    });
  });
});
