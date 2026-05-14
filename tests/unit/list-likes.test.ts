import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * likeList / unlikeList — list reaction server actions.
 *
 * Pinned semantics:
 *   - Anonymous → ok:false (no DB writes)
 *   - List not found → ok:false
 *   - Unpublished or private list → ok:false (UI should reflect, not silent)
 *   - Self-like → ok:true silently (don't reveal "you can't like your own"
 *     as a discrete error path)
 *   - Blocked pair → ok:true silently (don't leak block edge)
 *   - Happy path: INSERT-ON-CONFLICT-DO-NOTHING + emit() fires once on
 *     fresh insert; re-like (0 rows returning) does NOT fire emit
 *   - Unlike: idempotent DELETE (no FK lookups, no emit)
 *
 * Mocks: @/lib/db, getCachedUser, isBlockedBetween, emit. We're testing
 * the action's control flow, not the SQL chain — that's covered by the
 * lists-flow e2e + manual gate for the wider lists feature.
 */

// Bare-minimum chainable mocks — return a thenable that resolves to the
// queued shape per call. Each list-action call drains either:
//   - 1 findFirst (lists) for like
//   - 1 returning (insert) for like
//   - 1 delete chain for unlike
// We control resolved values directly per test via mocks.

const getCachedUserSpy = vi.fn();
const isBlockedBetweenSpy = vi.fn();
const emitSpy = vi.fn();

const insertedReturningSpy = vi.fn();
const findFirstSpy = vi.fn();
const deleteWhereSpy = vi.fn();

vi.mock("@/lib/db", () => {
  // Insert chain: db.insert(table).values(...).onConflictDoNothing().returning(...)
  const onConflictDoNothing = () => ({
    returning: insertedReturningSpy,
  });
  const valuesReturn = { onConflictDoNothing };
  const insertReturn = { values: () => valuesReturn };
  const insert = vi.fn(() => insertReturn);

  // Delete chain: db.delete(table).where(...)
  const deleteReturn = { where: deleteWhereSpy };
  const delete_ = vi.fn(() => deleteReturn);

  return {
    db: {
      query: {
        lists: { findFirst: findFirstSpy },
        reviews: { findFirst: findFirstSpy },
      },
      insert,
      delete: delete_,
    },
    schema: {
      likes: {
        userId: { name: "user_id" },
        reviewId: { name: "review_id" },
      },
      listLikes: {
        userId: { name: "user_id" },
        listId: { name: "list_id" },
      },
      lists: { id: { name: "id" } },
      reviews: { id: { name: "id" } },
    },
  };
});

vi.mock("@/lib/supabase/auth-cache", () => ({
  getCachedUser: getCachedUserSpy,
}));

vi.mock("@/lib/social/_shared/visibility", () => ({
  isBlockedBetween: isBlockedBetweenSpy,
}));

vi.mock("@/lib/social/notifications/emit", () => ({
  emit: emitSpy,
}));

// Dynamic import after mocks register (vi.mock is hoisted).
const { likeList, unlikeList } = await import("@/lib/social/reactions/server-actions");

beforeEach(() => {
  getCachedUserSpy.mockReset();
  isBlockedBetweenSpy.mockReset();
  emitSpy.mockReset();
  insertedReturningSpy.mockReset();
  findFirstSpy.mockReset();
  deleteWhereSpy.mockReset();

  // Default happy-path resolves; tests override per-case.
  emitSpy.mockResolvedValue(undefined);
  deleteWhereSpy.mockResolvedValue(undefined);
});

describe("likeList — auth + lookup gates", () => {
  it("returns ok:false when no user", async () => {
    getCachedUserSpy.mockResolvedValue(null);
    const r = await likeList("list-1");
    expect(r).toEqual({ ok: false });
    expect(findFirstSpy).not.toHaveBeenCalled();
    expect(insertedReturningSpy).not.toHaveBeenCalled();
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it("returns ok:false when list not found", async () => {
    getCachedUserSpy.mockResolvedValue({ id: "u1" });
    findFirstSpy.mockResolvedValue(undefined);
    const r = await likeList("list-1");
    expect(r).toEqual({ ok: false });
    expect(insertedReturningSpy).not.toHaveBeenCalled();
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it("returns ok:false when list is private (isPublic=false)", async () => {
    getCachedUserSpy.mockResolvedValue({ id: "u1" });
    findFirstSpy.mockResolvedValue({
      userId: "owner",
      isPublic: false,
      publishedAt: new Date(),
    });
    const r = await likeList("list-1");
    expect(r).toEqual({ ok: false });
    expect(insertedReturningSpy).not.toHaveBeenCalled();
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it("returns ok:false when list is unpublished (publishedAt=null)", async () => {
    getCachedUserSpy.mockResolvedValue({ id: "u1" });
    findFirstSpy.mockResolvedValue({
      userId: "owner",
      isPublic: true,
      publishedAt: null,
    });
    const r = await likeList("list-1");
    expect(r).toEqual({ ok: false });
    expect(insertedReturningSpy).not.toHaveBeenCalled();
    expect(emitSpy).not.toHaveBeenCalled();
  });
});

describe("likeList — silent skips", () => {
  it("self-like returns ok:true silently (no insert, no emit)", async () => {
    getCachedUserSpy.mockResolvedValue({ id: "owner" });
    findFirstSpy.mockResolvedValue({
      userId: "owner", // same as viewer
      isPublic: true,
      publishedAt: new Date(),
    });
    const r = await likeList("list-1");
    expect(r).toEqual({ ok: true });
    expect(isBlockedBetweenSpy).not.toHaveBeenCalled();
    expect(insertedReturningSpy).not.toHaveBeenCalled();
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it("blocked-pair returns ok:true silently (no insert, no emit)", async () => {
    getCachedUserSpy.mockResolvedValue({ id: "viewer" });
    findFirstSpy.mockResolvedValue({
      userId: "owner",
      isPublic: true,
      publishedAt: new Date(),
    });
    isBlockedBetweenSpy.mockResolvedValue(true);
    const r = await likeList("list-1");
    expect(r).toEqual({ ok: true });
    expect(isBlockedBetweenSpy).toHaveBeenCalledWith("viewer", "owner");
    expect(insertedReturningSpy).not.toHaveBeenCalled();
    expect(emitSpy).not.toHaveBeenCalled();
  });
});

describe("likeList — happy path + dedupe", () => {
  it("first like inserts a row + emits list_liked", async () => {
    getCachedUserSpy.mockResolvedValue({ id: "viewer" });
    findFirstSpy.mockResolvedValue({
      userId: "owner",
      isPublic: true,
      publishedAt: new Date(),
    });
    isBlockedBetweenSpy.mockResolvedValue(false);
    insertedReturningSpy.mockResolvedValue([{ userId: "viewer" }]); // row inserted

    const r = await likeList("list-1");
    expect(r).toEqual({ ok: true });
    expect(insertedReturningSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith({
      type: "list_liked",
      recipientUserId: "owner",
      actorUserId: "viewer",
      targetId: "list-1",
    });
  });

  it("re-like (0 rows returning from ON CONFLICT) does NOT emit", async () => {
    getCachedUserSpy.mockResolvedValue({ id: "viewer" });
    findFirstSpy.mockResolvedValue({
      userId: "owner",
      isPublic: true,
      publishedAt: new Date(),
    });
    isBlockedBetweenSpy.mockResolvedValue(false);
    // ON CONFLICT DO NOTHING returns 0 rows when the (user, list) PK
    // already exists — emit must NOT fire so we don't double-notify.
    insertedReturningSpy.mockResolvedValue([]);

    const r = await likeList("list-1");
    expect(r).toEqual({ ok: true });
    expect(insertedReturningSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy).not.toHaveBeenCalled();
  });
});

describe("unlikeList", () => {
  it("returns ok:false when no user (no DELETE issued)", async () => {
    getCachedUserSpy.mockResolvedValue(null);
    const r = await unlikeList("list-1");
    expect(r).toEqual({ ok: false });
    expect(deleteWhereSpy).not.toHaveBeenCalled();
  });

  it("idempotent DELETE — fires regardless of whether row exists", async () => {
    getCachedUserSpy.mockResolvedValue({ id: "viewer" });
    const r = await unlikeList("list-1");
    expect(r).toEqual({ ok: true });
    expect(deleteWhereSpy).toHaveBeenCalledTimes(1);
    // Unlike must NEVER emit — un-actions don't notify the recipient.
    expect(emitSpy).not.toHaveBeenCalled();
  });
});
