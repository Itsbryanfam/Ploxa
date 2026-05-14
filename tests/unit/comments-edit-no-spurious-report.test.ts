import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Regression test for Fix 1 of T04 (audit-fixes-2026-05-14).
 *
 * Bug: `editComment` filters its UPDATE by `(comments.id, comments.userId)`
 * so a non-author edit no-ops at the row level — but the code path
 * continued past the UPDATE and would INSERT a `reports` row when the
 * submitted body tripped the spam-rules pre-check. An attacker could
 * therefore pollute the moderation `auto_flagged` queue with fake reports
 * against any comment they couldn't actually edit, just by hitting the
 * server action with spammy content.
 *
 * Fix: `.returning({ id })` on the UPDATE, then guard the report INSERT
 * with `result.length > 0` so non-authors hit the no-op branch without
 * any side effects.
 *
 * Mock strategy mirrors visibility-actions.test.ts:
 * - db.update().set().where().returning() captured via updateChain.
 * - db.insert().values() captured via insertSpy (so we can assert it was
 *   NOT called in the non-author case).
 * - db.query.{reports,comments,reviews,profiles}.findFirst stubbed.
 * - revalidatePath stubbed.
 * - getCachedUser stubbed.
 */

const updateReturningMock = vi.fn();
const insertValuesMock = vi.fn();
const reportsFindFirstMock = vi.fn();
const commentsFindFirstMock = vi.fn();
const reviewsFindFirstMock = vi.fn();
const profilesFindFirstMock = vi.fn();
const revalidateMock = vi.fn();
const isBlockedBetweenMock = vi.fn();
const onCommentMock = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => updateReturningMock(),
        }),
      }),
    }),
    insert: () => ({
      values: (v: unknown) => {
        insertValuesMock(v);
        return Promise.resolve();
      },
    }),
    // T14 revalidateAuthorReviewListing now uses a single
    // db.select().from(reviews).innerJoin(profiles).where().limit() instead of
    // two findFirst calls. Stub returns the joined { username } row so the
    // revalidate tail succeeds without affecting the spam-report assertions
    // these tests target.
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: () => Promise.resolve([{ username: "victim" }]),
          }),
        }),
      }),
    }),
    query: {
      reports: {
        findFirst: (...args: unknown[]) => reportsFindFirstMock(...args),
      },
      comments: {
        findFirst: (...args: unknown[]) => commentsFindFirstMock(...args),
      },
      // reviews/profiles findFirst kept for forward-compat with other tests
      // that import this mock shape; revalidateAuthorReviewListing no longer
      // calls them after T14's JOIN refactor.
      reviews: {
        findFirst: (...args: unknown[]) => reviewsFindFirstMock(...args),
      },
      profiles: {
        findFirst: (...args: unknown[]) => profilesFindFirstMock(...args),
      },
    },
  },
  schema: {
    comments: {
      id: { name: "id" },
      userId: { name: "user_id" },
      reviewId: { name: "review_id" },
    },
    reports: {
      id: { name: "id" },
      targetType: { name: "target_type" },
      targetId: { name: "target_id" },
      status: { name: "status" },
    },
    reviews: { id: { name: "id" }, userId: { name: "user_id" } },
    profiles: {
      userId: { name: "user_id" },
      username: { name: "username" },
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ["__and", ...args],
  eq: (a: unknown, b: unknown) => ["__eq", a, b],
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));

vi.mock("@/lib/supabase/auth-cache", () => ({
  getCachedUser: vi.fn().mockResolvedValue({ id: "attacker-1", email: "x@y.z" }),
}));

vi.mock("@/lib/social/_shared/visibility", () => ({
  isBlockedBetween: isBlockedBetweenMock,
}));

vi.mock("@/lib/social/comments/triggers", () => ({
  onComment: onCommentMock,
}));

beforeEach(() => {
  updateReturningMock.mockReset();
  insertValuesMock.mockReset();
  reportsFindFirstMock.mockReset();
  commentsFindFirstMock.mockReset();
  reviewsFindFirstMock.mockReset();
  profilesFindFirstMock.mockReset();
  revalidateMock.mockReset();
  isBlockedBetweenMock.mockReset();
  onCommentMock.mockReset();

  // Defaults: no rows updated (non-author scenario), no existing flag,
  // comment+author lookups succeed so the revalidate tail doesn't blow up.
  updateReturningMock.mockResolvedValue([]);
  reportsFindFirstMock.mockResolvedValue(null);
  commentsFindFirstMock.mockResolvedValue({
    reviewId: "11111111-1111-1111-8111-111111111111",
  });
  reviewsFindFirstMock.mockResolvedValue({ userId: "author-2" });
  profilesFindFirstMock.mockResolvedValue({ username: "victim" });

  vi.resetModules();
});

describe("editComment — non-author edit does not pollute moderation queue", () => {
  it("does NOT insert a report when UPDATE returns no rows (spammy body)", async () => {
    // Spammy body that trips checkSpamRules (>=3 URLs → link_density).
    // We deliberately use real checkSpamRules so this test stays honest
    // about the input that would normally trigger the bug.
    const spammyBody = "https://a.com https://b.com https://c.com";

    const { editComment } = await import("@/lib/social/comments/server-actions");
    const result = await editComment({
      commentId: "22222222-2222-1222-8222-222222222222",
      body: spammyBody,
    });

    // Action returns ok:true regardless — the UPDATE WHERE clause swallows
    // the no-op silently so we don't leak comment-ownership info to the
    // caller. The important assertion is the moderation side effect.
    expect(result).toEqual(
      expect.objectContaining({ ok: true, isFlagged: true }),
    );

    // Critical: no INSERT into reports. The non-author edit was a no-op,
    // so the moderation queue must NOT receive a synthetic auto_flagged row.
    expect(insertValuesMock).not.toHaveBeenCalled();

    // Also: we should not even look up an existing report — the guard
    // short-circuits before the dedupe check.
    expect(reportsFindFirstMock).not.toHaveBeenCalled();
  });

  it("DOES insert a report when UPDATE returns a row (legitimate author flagged on edit)", async () => {
    // Author edit succeeded → 1 row returned. Body still trips the rules,
    // and no prior auto_flagged report exists → INSERT must fire.
    updateReturningMock.mockResolvedValue([{ id: "22222222-2222-1222-8222-222222222222" }]);

    const spammyBody = "https://a.com https://b.com https://c.com";

    const { editComment } = await import("@/lib/social/comments/server-actions");
    const result = await editComment({
      commentId: "22222222-2222-1222-8222-222222222222",
      body: spammyBody,
    });

    expect(result).toEqual(
      expect.objectContaining({ ok: true, isFlagged: true }),
    );

    // INSERT into reports must have fired exactly once, with the auto_flagged
    // shape used elsewhere in the file (matches createComment behavior).
    expect(insertValuesMock).toHaveBeenCalledTimes(1);
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: "comment",
        targetId: "22222222-2222-1222-8222-222222222222",
        status: "auto_flagged",
        reporterId: null,
      }),
    );
  });

  it("does NOT insert a report when UPDATE returns a row but body is clean", async () => {
    // Defensive — make sure we didn't accidentally invert the guard so that
    // every successful author-edit triggers a report insert.
    updateReturningMock.mockResolvedValue([{ id: "22222222-2222-1222-8222-222222222222" }]);

    const cleanBody = "Actually I think the soundtrack was great.";

    const { editComment } = await import("@/lib/social/comments/server-actions");
    await editComment({
      commentId: "22222222-2222-1222-8222-222222222222",
      body: cleanBody,
    });

    expect(insertValuesMock).not.toHaveBeenCalled();
  });
});
