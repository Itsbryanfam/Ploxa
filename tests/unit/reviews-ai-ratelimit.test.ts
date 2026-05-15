import { describe, expect, it, beforeEach, vi } from "vitest";

/**
 * F-004: only startInterview enforced DAILY_REVIEW_CAP. submitAnswer,
 * generateDraft and regenerateSection called the host-paid generate()
 * with no per-user limit, so one daily slot bought unbounded AI calls.
 *
 * Contract pinned here: each of the three actions calls enforceRateLimit
 * before reaching generate(); a RateLimitedError is translated to the
 * action's { ok:false } shape (NOT the { ok:true, stream } success shape).
 *
 * Why we assert on the RESULT SHAPE, not `generate not called`: all three
 * actions invoke generate() inside a fire-and-forget `void (async()=>{})()`
 * IIFE, so a `generate` spy is timing-dependent and false-greens pre-fix.
 * The synchronous ok:false return is the reliable contract; the happy path
 * is fully mocked so pre-fix the action WOULD return ok:true (real RED).
 */

const getCachedUser = vi.fn();
vi.mock("@/lib/supabase/auth-cache", () => ({ getCachedUser }));

const reviewsFindFirst = vi.fn();
const gamesFindFirst = vi.fn();
const reviewQuestionsFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    query: {
      reviews: { findFirst: (...a: unknown[]) => reviewsFindFirst(...a) },
      games: { findFirst: (...a: unknown[]) => gamesFindFirst(...a) },
      reviewQuestions: {
        findMany: (...a: unknown[]) => reviewQuestionsFindMany(...a),
      },
      logs: { findFirst: vi.fn() },
    },
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ returning: vi.fn(async () => [{ id: "r-1" }]) })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
    })),
    delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
  },
  schema: {
    reviews: { id: "id", userId: "user_id", gameId: "game_id" },
    games: { id: "id" },
    reviewQuestions: { reviewId: "review_id" },
    logs: {},
  },
}));

const generate = vi.fn(async () => ({
  textStream: (async function* () {})(),
  providerUsed: "groq",
}));
vi.mock("@/lib/ai/router", () => ({ generate }));

vi.mock("@/lib/ai/rate-limit", () => ({
  DAILY_REVIEW_CAP: 10,
  getUserDailyReviewCount: vi.fn(async () => 0),
  incrementUserDailyReviews: vi.fn(async () => undefined),
}));

vi.mock("@/lib/ai/errors", () => ({
  RateLimitExceededError: class RateLimitExceededError extends Error {},
  AIProvidersExhaustedError: class AIProvidersExhaustedError extends Error {},
}));

vi.mock("@/lib/taste/triggers", () => ({ triggerOnLogWrite: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/reviews/session", () => ({
  createSession: vi.fn(),
  getSession: vi.fn(),
  appendAnswer: vi.fn(),
  appendQuestion: vi.fn(),
  destroySession: vi.fn(),
}));

vi.mock("@/lib/reviews/prompts", () => ({
  SYSTEM_PROMPT: "sys",
  openerQuestion: vi.fn(() => "q1"),
  followUpPrompt: vi.fn(() => "fup"),
  draftPrompt: vi.fn(() => "draft"),
  regenerateSectionPrompt: vi.fn(() => "regen"),
}));

const enforceRateLimit = vi.fn();
class RateLimitedError extends Error {
  constructor(public scope: string, public retryAfterSeconds: number) {
    super("rl");
    this.name = "RateLimitedError";
  }
}
vi.mock("@/lib/security/rate-limit", () => ({
  enforceRateLimit,
  RateLimitedError,
  clientIpForRateLimit: vi.fn(async () => "127.0.0.1"),
}));

import { getSession, appendAnswer } from "@/lib/reviews/session";

const session = (over: Record<string, unknown> = {}) => ({
  interviewId: "iv-1",
  userId: "u1",
  logId: "log-1",
  gameId: 1,
  questions: ["q1"],
  answers: [],
  createdAt: Date.now(),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  getCachedUser.mockResolvedValue({ id: "u1", email: "u@e.com" });
  enforceRateLimit.mockResolvedValue(undefined);
  gamesFindFirst.mockResolvedValue({
    title: "G",
    genres: [],
    themes: [],
    released: null,
    slug: "g",
  });
  reviewQuestionsFindMany.mockResolvedValue([
    { position: 1, answer: "a1" },
  ]);
});

describe("F-004 — review AI entry points enforce a per-user rate limit", () => {
  it("regenerateSection: RateLimitedError → ok:false; guard invoked", async () => {
    reviewsFindFirst.mockResolvedValue({
      id: "r-1",
      body: "a\n\nb\n\nc\n\nd",
      gameId: 1,
      updatedAt: new Date(),
    });
    enforceRateLimit.mockRejectedValueOnce(
      new RateLimitedError("ai:review:gen", 30),
    );

    const { regenerateSection } = await import("@/lib/reviews/server-actions");
    const result = await regenerateSection({
      reviewId: crypto.randomUUID(),
      sectionIndex: 0,
    });

    expect(result).toMatchObject({ ok: false });
    expect(enforceRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "ai:review:gen", identifier: "u1" }),
    );
  });

  it("generateDraft: RateLimitedError → ok:false; guard invoked", async () => {
    vi.mocked(getSession).mockResolvedValue(
      session({ answers: ["a1"] }) as never,
    );
    reviewsFindFirst.mockResolvedValue(undefined); // no existing review
    enforceRateLimit.mockRejectedValueOnce(
      new RateLimitedError("ai:review:gen", 30),
    );

    const { generateDraft } = await import("@/lib/reviews/server-actions");
    const result = await generateDraft({ interviewId: crypto.randomUUID() });

    expect(result).toMatchObject({ ok: false });
    expect(enforceRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "ai:review:gen", identifier: "u1" }),
    );
  });

  it("submitAnswer (turn 1): RateLimitedError → ok:false; guard invoked", async () => {
    vi.mocked(getSession).mockResolvedValue(session() as never);
    vi.mocked(appendAnswer).mockResolvedValue(
      session({ answers: ["a1"] }) as never,
    );
    enforceRateLimit.mockRejectedValueOnce(
      new RateLimitedError("ai:review:gen", 30),
    );

    const { submitAnswer } = await import("@/lib/reviews/server-actions");
    const result = await submitAnswer({
      interviewId: crypto.randomUUID(),
      turn: 1,
      text: "my answer",
    });

    expect(result).toMatchObject({ ok: false });
    expect(enforceRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "ai:review:gen", identifier: "u1" }),
    );
  });

  it("submitAnswer turn 4 is NOT rate-limited (no generate() on that path)", async () => {
    vi.mocked(getSession).mockResolvedValue(
      session({
        questions: ["q1", "q2", "q3", "q4"],
        answers: ["a1", "a2", "a3"],
      }) as never,
    );
    vi.mocked(appendAnswer).mockResolvedValue(
      session({
        questions: ["q1", "q2", "q3", "q4"],
        answers: ["a1", "a2", "a3", "a4"],
      }) as never,
    );

    const { submitAnswer } = await import("@/lib/reviews/server-actions");
    const result = await submitAnswer({
      interviewId: crypto.randomUUID(),
      turn: 4,
      text: "final answer",
    });

    expect(result).toEqual({ ok: true, ready: true });
    expect(enforceRateLimit).not.toHaveBeenCalled();
  });
});
