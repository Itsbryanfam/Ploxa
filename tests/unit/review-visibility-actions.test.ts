import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * F-007: createComment and likeReview loaded the review by id with only an
 * existence check — no isPublic / publishedAt / author-visibility gate — so
 * an authenticated caller with a private/unpublished review UUID could
 * comment or like it (and trigger notifications). likeList already gated;
 * this pins the same contract for reviews via loadVisibleReview.
 *
 * Harness mirrors list-likes.test.ts: the REAL loadVisibleReview runs
 * against a mocked db.query.{reviews,profiles}.findFirst so the actual
 * visibility logic is exercised end-to-end.
 */

const getCachedUser = vi.fn();
const isBlockedBetween = vi.fn();
const emit = vi.fn();
const onComment = vi.fn();

const reviewsFindFirst = vi.fn();
const profilesFindFirst = vi.fn();
const commentInsertReturning = vi.fn();
const likeInsertReturning = vi.fn();
const reportInsertValues = vi.fn();

vi.mock("@/lib/db", () => {
  const insert = vi.fn((table: { __t?: string }) => ({
    values: (v: unknown) => {
      if (table?.__t === "reports") {
        reportInsertValues(v);
        return Promise.resolve();
      }
      return {
        returning: () => commentInsertReturning(),
        onConflictDoNothing: () => ({ returning: () => likeInsertReturning() }),
      };
    },
  }));
  return {
    db: {
      query: {
        reviews: { findFirst: (...a: unknown[]) => reviewsFindFirst(...a) },
        profiles: { findFirst: (...a: unknown[]) => profilesFindFirst(...a) },
        comments: { findFirst: vi.fn() },
      },
      insert,
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => ({ limit: () => Promise.resolve([{ username: "x" }]) }),
          }),
        }),
      }),
    },
    schema: {
      comments: { __t: "comments", id: { name: "id" }, userId: {}, reviewId: {} },
      reports: { __t: "reports" },
      reviews: { __t: "reviews", id: { name: "id" }, userId: { name: "user_id" } },
      profiles: { __t: "profiles", userId: { name: "user_id" } },
      likes: { __t: "likes", userId: {}, reviewId: {} },
      listLikes: { __t: "listLikes" },
      lists: { __t: "lists" },
    },
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => ["__and", ...a],
  eq: (a: unknown, b: unknown) => ["__eq", a, b],
}));

vi.mock("@/lib/supabase/auth-cache", () => ({ getCachedUser }));
vi.mock("@/lib/social/_shared/visibility", () => ({ isBlockedBetween }));
vi.mock("@/lib/social/notifications/emit", () => ({ emit }));
vi.mock("@/lib/social/comments/triggers", () => ({ onComment }));
vi.mock("@/lib/social/moderation/rules", () => ({
  checkSpamRules: () => ({ isFlagged: false, reasons: [] }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const REVIEW_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  isBlockedBetween.mockResolvedValue(false);
  emit.mockResolvedValue(undefined);
  onComment.mockResolvedValue(undefined);
  commentInsertReturning.mockResolvedValue([{ id: "c-1" }]);
  likeInsertReturning.mockResolvedValue([{ userId: "viewer" }]);
});

describe("F-007 — createComment requires a visible review", () => {
  it("private (isPublic=false) review → review-not-found, no insert, no notify", async () => {
    getCachedUser.mockResolvedValue({ id: "viewer" });
    reviewsFindFirst.mockResolvedValue({
      id: REVIEW_ID,
      userId: "author",
      isPublic: false,
      publishedAt: new Date(),
    });

    const { createComment } = await import("@/lib/social/comments/server-actions");
    const r = await createComment({ reviewId: REVIEW_ID, body: "nice" });

    expect(r).toEqual({ ok: false, reason: "review-not-found" });
    expect(commentInsertReturning).not.toHaveBeenCalled();
    expect(onComment).not.toHaveBeenCalled();
  });

  it("published+public review but PRIVATE author → review-not-found", async () => {
    getCachedUser.mockResolvedValue({ id: "viewer" });
    reviewsFindFirst.mockResolvedValue({
      id: REVIEW_ID,
      userId: "author",
      isPublic: true,
      publishedAt: new Date(),
    });
    profilesFindFirst.mockResolvedValue({ isPublic: false, deletedAt: null });

    const { createComment } = await import("@/lib/social/comments/server-actions");
    const r = await createComment({ reviewId: REVIEW_ID, body: "nice" });

    expect(r).toEqual({ ok: false, reason: "review-not-found" });
    expect(commentInsertReturning).not.toHaveBeenCalled();
  });

  it("owner commenting on their own unpublished review → proceeds", async () => {
    getCachedUser.mockResolvedValue({ id: "u1" });
    reviewsFindFirst.mockResolvedValue({
      id: REVIEW_ID,
      userId: "u1",
      isPublic: false,
      publishedAt: null,
    });

    const { createComment } = await import("@/lib/social/comments/server-actions");
    const r = await createComment({ reviewId: REVIEW_ID, body: "draft note" });

    expect(r).toMatchObject({ ok: true });
    expect(commentInsertReturning).toHaveBeenCalled();
    expect(onComment).toHaveBeenCalled();
  });
});

describe("F-007 — likeReview requires a visible review", () => {
  it("unpublished review → ok:false, no like insert, no emit", async () => {
    getCachedUser.mockResolvedValue({ id: "viewer" });
    reviewsFindFirst.mockResolvedValue({
      id: REVIEW_ID,
      userId: "author",
      isPublic: true,
      publishedAt: null,
    });

    const { likeReview } = await import("@/lib/social/reactions/server-actions");
    const r = await likeReview(REVIEW_ID);

    expect(r).toEqual({ ok: false });
    expect(likeInsertReturning).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("public+published review by public author → likes + emits", async () => {
    getCachedUser.mockResolvedValue({ id: "viewer" });
    reviewsFindFirst.mockResolvedValue({
      id: REVIEW_ID,
      userId: "author",
      isPublic: true,
      publishedAt: new Date(),
    });
    profilesFindFirst.mockResolvedValue({ isPublic: true, deletedAt: null });

    const { likeReview } = await import("@/lib/social/reactions/server-actions");
    const r = await likeReview(REVIEW_ID);

    expect(r).toEqual({ ok: true });
    expect(likeInsertReturning).toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "review_liked", targetId: REVIEW_ID }),
    );
  });
});
