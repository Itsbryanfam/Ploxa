/**
 * recap-email-worker.test.ts — Phase 6 T18.
 *
 * Unit tests for `app/api/internal/recap-email/run/route.ts`.
 *
 * Strategy mirrors the digest worker's auth/concurrency shape.
 *
 * Mock surface:
 *   - @/lib/db          — db.execute (cohort SELECT) + db.update (profile + yearInReviews)
 *   - @/lib/recaps/cache-or-build — cacheOrBuildYearly + cacheOrBuildMonthly
 *   - @/lib/email/recap-template  — renderRecapHtml + renderRecapPlainText + recapSubject
 *   - @/lib/email/unsubscribe-token — signUnsubscribeToken
 *   - resend            — Resend.emails.send stub
 *
 * CRON_SECRET + RESEND_API_KEY + NEXT_PUBLIC_APP_URL are vi.stubEnv'd BEFORE
 * the dynamic import that touches lib/env.ts (per project memory rule).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────
// Env stubs — MUST be above dynamic import of route.ts
// ─────────────────────────────────────────────────────────────

vi.stubEnv("CRON_SECRET", "test-cron-secret-32-chars-aaaaaa");
vi.stubEnv("RESEND_API_KEY", "re_test_key");
vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://ploxa.vercel.app");

// ─────────────────────────────────────────────────────────────
// Module mocks — must be above dynamic import
// ─────────────────────────────────────────────────────────────

const mockExecute = vi.fn();
const mockUpdate = vi.fn();

// db.update(...).set(...).where(...) chain
const mockWhere = vi.fn().mockResolvedValue(undefined);
const mockSet = vi.fn(() => ({ where: mockWhere }));
const mockUpdateChain = { set: mockSet };

vi.mock("@/lib/db", () => ({
  db: {
    execute: mockExecute,
    update: mockUpdate,
  },
  schema: {
    profiles: {
      userId: "userId",
      lastRecapSentAt: "lastRecapSentAt",
    },
    yearInReviews: {
      userId: "userId",
      year: "year",
      lockedAt: "lockedAt",
    },
  },
}));

const mockCacheOrBuildYearly = vi.fn();
const mockCacheOrBuildMonthly = vi.fn();

vi.mock("@/lib/recaps/cache-or-build", () => ({
  cacheOrBuildYearly: mockCacheOrBuildYearly,
  cacheOrBuildMonthly: mockCacheOrBuildMonthly,
}));

const mockRenderRecapHtml = vi.fn();
const mockRenderRecapPlainText = vi.fn();
const mockRecapSubject = vi.fn();

vi.mock("@/lib/email/recap-template", () => ({
  renderRecapHtml: mockRenderRecapHtml,
  renderRecapPlainText: mockRenderRecapPlainText,
  recapSubject: mockRecapSubject,
}));

const mockSignUnsubscribeToken = vi.fn();

vi.mock("@/lib/email/unsubscribe-token", () => ({
  signUnsubscribeToken: mockSignUnsubscribeToken,
}));

const mockEmailsSend = vi.fn();

vi.mock("resend", () => {
  function ResendCtor() {
    return { emails: { send: mockEmailsSend } };
  }
  ResendCtor.prototype = {};
  return { Resend: ResendCtor };
});

// ─────────────────────────────────────────────────────────────
// Dynamic import AFTER mocks + env stubs
// ─────────────────────────────────────────────────────────────

const { POST } = await import("@/app/api/internal/recap-email/run/route");

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

const CORRECT_SECRET = "test-cron-secret-32-chars-aaaaaa";

function makeRequest(
  body: unknown,
  secret: string | null = CORRECT_SECRET,
): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (secret !== null) {
    headers["x-cron-secret"] = secret;
  }
  return new Request("http://localhost/api/internal/recap-email/run", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function makeOkPayload(mode: "yearly" | "monthly" = "yearly") {
  return {
    tier: "ok",
    mode,
    windowStart: mode === "yearly" ? "2026-01-01T00:00:00.000Z" : "2026-04-01T00:00:00.000Z",
    windowEnd: mode === "yearly" ? "2027-01-01T00:00:00.000Z" : "2026-05-01T00:00:00.000Z",
    scenes: ["opening", "stats_total"],
    totals: {
      totalGames: 30,
      totalHoursPlayed: 100,
      completedCount: 20,
      droppedCount: 3,
      replayingCount: 1,
      reviewCount: 5,
    },
    topGames: [],
    captions: {},
  };
}

function makeSparsePayload() {
  return { ...makeOkPayload(), tier: "too_sparse", topGames: [] };
}

function makeCandidates(n = 1) {
  return Array.from({ length: n }, (_, i) => ({
    user_id: `user-${i + 1}`,
    email: `user${i + 1}@example.com`,
    username: `user${i + 1}`,
    email_digest_cadence: "weekly",
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default update chain resolves successfully
  mockUpdate.mockReturnValue(mockUpdateChain);
  mockSet.mockReturnValue({ where: mockWhere });
  mockWhere.mockResolvedValue(undefined);
  // Default recap template mocks
  mockRenderRecapHtml.mockResolvedValue("<html>recap</html>");
  mockRenderRecapPlainText.mockReturnValue("recap text");
  mockRecapSubject.mockReturnValue("Your 2025 in games");
  mockSignUnsubscribeToken.mockResolvedValue("tok-abc");
  // Default Resend: success
  mockEmailsSend.mockResolvedValue({ data: { id: "email-id" }, error: null });
});

// ─────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────

describe("auth gate", () => {
  it("returns 404 when X-Cron-Secret header is missing", async () => {
    const req = makeRequest({ mode: "annual_preview" }, null);
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("returns 404 when X-Cron-Secret is wrong", async () => {
    const req = makeRequest({ mode: "annual_preview" }, "wrong-secret");
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("returns 404 not 401 (does not leak route existence)", async () => {
    const req = makeRequest({ mode: "annual_preview" }, "bad");
    const res = await POST(req);
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────
// Body validation
// ─────────────────────────────────────────────────────────────

describe("body validation", () => {
  it("returns 400 when body is missing / invalid JSON", async () => {
    const req = new Request("http://localhost/api/internal/recap-email/run", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cron-secret": CORRECT_SECRET },
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when mode is missing", async () => {
    const req = makeRequest({});
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when mode is an unknown value", async () => {
    const req = makeRequest({ mode: "quarterly" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────
// Empty cohort
// ─────────────────────────────────────────────────────────────

describe("empty cohort", () => {
  it("returns sent:0, candidates:0 with no sends when no eligible users", async () => {
    mockExecute.mockResolvedValueOnce([]);
    const req = makeRequest({ mode: "annual_preview" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ sent: 0, candidates: 0 });
    expect(mockEmailsSend).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// annual_preview — happy path
// ─────────────────────────────────────────────────────────────

describe("annual_preview happy path", () => {
  it("sends to all candidates and updates last_recap_sent_at", async () => {
    const candidates = makeCandidates(2);
    mockExecute.mockResolvedValueOnce(candidates);
    mockCacheOrBuildYearly.mockResolvedValue(makeOkPayload("yearly"));

    const req = makeRequest({ mode: "annual_preview" });
    const res = await POST(req);
    const json = await res.json();

    expect(json.sent).toBe(2);
    expect(json.failed).toBe(0);
    expect(json.skipped).toBe(0);
    expect(json.candidates).toBe(2);
    // last_recap_sent_at updated for each user
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockEmailsSend).toHaveBeenCalledTimes(2);
  });

  it("calls cacheOrBuildYearly (not monthly) for annual_preview", async () => {
    mockExecute.mockResolvedValueOnce(makeCandidates(1));
    mockCacheOrBuildYearly.mockResolvedValue(makeOkPayload("yearly"));

    await POST(makeRequest({ mode: "annual_preview" }));

    expect(mockCacheOrBuildYearly).toHaveBeenCalledTimes(1);
    expect(mockCacheOrBuildMonthly).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// annual_locked — happy path + locking step
// ─────────────────────────────────────────────────────────────

describe("annual_locked", () => {
  it("sends email and sets locked_at on year_in_reviews after successful send", async () => {
    mockExecute.mockResolvedValueOnce(makeCandidates(1));
    mockCacheOrBuildYearly.mockResolvedValue(makeOkPayload("yearly"));

    const req = makeRequest({ mode: "annual_locked" });
    const res = await POST(req);
    const json = await res.json();

    expect(json.sent).toBe(1);
    expect(json.failed).toBe(0);
    // db.update called twice: once for lastRecapSentAt, once for lockedAt
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });

  it("does NOT set locked_at when send fails (Resend error)", async () => {
    mockExecute.mockResolvedValueOnce(makeCandidates(1));
    mockCacheOrBuildYearly.mockResolvedValue(makeOkPayload("yearly"));
    mockEmailsSend.mockResolvedValueOnce({ data: null, error: { message: "send failed" } });

    const req = makeRequest({ mode: "annual_locked" });
    const res = await POST(req);
    const json = await res.json();

    expect(json.failed).toBe(1);
    expect(json.sent).toBe(0);
    // No db.update at all — neither lastRecapSentAt nor lockedAt
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// monthly — year/monthIndex derivation
// ─────────────────────────────────────────────────────────────

describe("monthly mode", () => {
  it("passes correct year and monthIndex to cacheOrBuildMonthly", async () => {
    // Mock Date so "now" is Feb 1 2026 UTC → monthIndex=1, year=2026
    const fakeNow = new Date("2026-02-01T00:00:00Z");
    vi.setSystemTime(fakeNow);

    mockExecute.mockResolvedValueOnce(makeCandidates(1));
    mockCacheOrBuildMonthly.mockResolvedValue(makeOkPayload("monthly"));

    await POST(makeRequest({ mode: "monthly" }));

    expect(mockCacheOrBuildMonthly).toHaveBeenCalledWith(
      expect.objectContaining({ year: 2026, monthIndex: 1 }),
    );

    vi.useRealTimers();
  });

  it("wraps to December of previous year when invoked on Jan 1", async () => {
    const fakeNow = new Date("2027-01-01T00:00:00Z");
    vi.setSystemTime(fakeNow);

    mockExecute.mockResolvedValueOnce(makeCandidates(1));
    mockCacheOrBuildMonthly.mockResolvedValue(makeOkPayload("monthly"));

    await POST(makeRequest({ mode: "monthly" }));

    expect(mockCacheOrBuildMonthly).toHaveBeenCalledWith(
      expect.objectContaining({ year: 2026, monthIndex: 12 }),
    );

    vi.useRealTimers();
  });

  it("calls cacheOrBuildMonthly (not yearly) for monthly mode", async () => {
    mockExecute.mockResolvedValueOnce(makeCandidates(1));
    mockCacheOrBuildMonthly.mockResolvedValue(makeOkPayload("monthly"));

    await POST(makeRequest({ mode: "monthly" }));

    expect(mockCacheOrBuildMonthly).toHaveBeenCalledTimes(1);
    expect(mockCacheOrBuildYearly).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// Sparse tier
// ─────────────────────────────────────────────────────────────

describe("sparse tier", () => {
  it("counts as skipped, does NOT send email, does NOT update last_recap_sent_at", async () => {
    mockExecute.mockResolvedValueOnce(makeCandidates(1));
    mockCacheOrBuildYearly.mockResolvedValue(makeSparsePayload());

    const res = await POST(makeRequest({ mode: "annual_preview" }));
    const json = await res.json();

    expect(json.skipped).toBe(1);
    expect(json.sent).toBe(0);
    expect(json.failed).toBe(0);
    expect(mockEmailsSend).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("mixed sparse + ok: one skipped, one sent", async () => {
    const [c1, c2] = makeCandidates(2);
    mockExecute.mockResolvedValueOnce([c1, c2]);
    mockCacheOrBuildYearly
      .mockResolvedValueOnce(makeSparsePayload())
      .mockResolvedValueOnce(makeOkPayload("yearly"));

    const res = await POST(makeRequest({ mode: "annual_preview" }));
    const json = await res.json();

    expect(json.skipped).toBe(1);
    expect(json.sent).toBe(1);
    expect(json.failed).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Resend error handling
// ─────────────────────────────────────────────────────────────

describe("Resend error", () => {
  it("counts as failed when Resend returns an error object", async () => {
    mockExecute.mockResolvedValueOnce(makeCandidates(1));
    mockCacheOrBuildYearly.mockResolvedValue(makeOkPayload("yearly"));
    mockEmailsSend.mockResolvedValueOnce({ data: null, error: { message: "rate limited" } });

    const res = await POST(makeRequest({ mode: "annual_preview" }));
    const json = await res.json();

    expect(json.failed).toBe(1);
    expect(json.sent).toBe(0);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("one row fails, next succeeds — batch continues (failed=1, sent=1)", async () => {
    const [c1, c2] = makeCandidates(2);
    mockExecute.mockResolvedValueOnce([c1, c2]);
    mockCacheOrBuildYearly.mockResolvedValue(makeOkPayload("yearly"));
    // First send fails, second succeeds
    mockEmailsSend
      .mockResolvedValueOnce({ data: null, error: { message: "send failed" } })
      .mockResolvedValueOnce({ data: { id: "ok" }, error: null });

    const res = await POST(makeRequest({ mode: "annual_preview" }));
    const json = await res.json();

    expect(json.failed).toBe(1);
    expect(json.sent).toBe(1);
    expect(json.candidates).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────
// DB failure resilience
// ─────────────────────────────────────────────────────────────

describe("DB resilience", () => {
  it("returns 500 when cohort SELECT throws", async () => {
    mockExecute.mockRejectedValueOnce(new Error("DB connection lost"));

    const res = await POST(makeRequest({ mode: "annual_preview" }));
    expect(res.status).toBe(500);
  });

  it("counts as sent even if last_recap_sent_at DB update fails (best-effort)", async () => {
    mockExecute.mockResolvedValueOnce(makeCandidates(1));
    mockCacheOrBuildYearly.mockResolvedValue(makeOkPayload("yearly"));
    // Make the update chain throw
    mockWhere.mockRejectedValueOnce(new Error("deadlock"));

    const res = await POST(makeRequest({ mode: "annual_preview" }));
    const json = await res.json();

    // Email was sent, so count is still 1 even though DB update failed
    expect(json.sent).toBe(1);
    expect(json.failed).toBe(0);
  });

  it("catches pipeline exception per-row (cacheOrBuild throws) → counts as failed", async () => {
    mockExecute.mockResolvedValueOnce(makeCandidates(1));
    mockCacheOrBuildYearly.mockRejectedValueOnce(new Error("AI provider 500"));

    const res = await POST(makeRequest({ mode: "annual_preview" }));
    const json = await res.json();

    expect(json.failed).toBe(1);
    expect(json.sent).toBe(0);
  });
});
