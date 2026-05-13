import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * emit() is the single chokepoint for in-app notifications. The dedupe
 * semantic — ON CONFLICT bumps created_at + clears read_at — collapses
 * repeat actions (like-spam, follow-toggle) into a single bumped inbox
 * row instead of N stacked rows. These tests pin:
 *  - self-notify silence (recipient === actor)
 *  - blocked-pair silence (isBlockedBetween short-circuit)
 *  - INSERT-with-onConflictDoUpdate fires when no skip applies
 *  - the conflict clause sets readAt: null
 */

const insertSpy = vi.fn();
const valuesSpy = vi.fn();
const onConflictDoUpdateSpy = vi.fn();
const isBlockedBetweenSpy = vi.fn();

vi.mock("@/lib/db", () => {
  const valuesReturn = {
    onConflictDoUpdate: onConflictDoUpdateSpy.mockResolvedValue(undefined),
  };
  valuesSpy.mockReturnValue(valuesReturn);
  const insertReturn = { values: valuesSpy };
  insertSpy.mockReturnValue(insertReturn);
  return {
    db: { insert: insertSpy },
    schema: {
      notifications: {
        userId: { name: "user_id" },
        type: { name: "type" },
        targetId: { name: "target_id" },
        actorId: { name: "actor_id" },
      },
      notificationTypeEnum: {
        enumValues: [
          "new_follower",
          "review_liked",
          "review_commented",
          "list_liked",
          "wishlist_logged_by_friend",
          "comment_replied",
        ] as const,
      },
    },
  };
});

vi.mock("@/lib/social/_shared/visibility", () => ({
  isBlockedBetween: isBlockedBetweenSpy,
}));

// Dynamic import AFTER mocks are registered (vi.mock is hoisted).
const { emit } = await import("@/lib/social/notifications/emit");

beforeEach(() => {
  insertSpy.mockClear();
  valuesSpy.mockClear();
  onConflictDoUpdateSpy.mockClear();
  isBlockedBetweenSpy.mockReset();
  // Restore the mock return values that were wiped by mockReset/mockClear.
  onConflictDoUpdateSpy.mockResolvedValue(undefined);
  valuesSpy.mockReturnValue({
    onConflictDoUpdate: onConflictDoUpdateSpy,
  });
  insertSpy.mockReturnValue({ values: valuesSpy });
});

describe("emit — skip cases", () => {
  it("silently no-ops on self-notify (recipient === actor)", async () => {
    await emit({
      type: "review_liked",
      recipientUserId: "alice",
      actorUserId: "alice",
      targetId: "review-1",
    });
    expect(insertSpy).not.toHaveBeenCalled();
    expect(isBlockedBetweenSpy).not.toHaveBeenCalled();
  });

  it("silently no-ops when blocked pair", async () => {
    isBlockedBetweenSpy.mockResolvedValueOnce(true);
    await emit({
      type: "review_liked",
      recipientUserId: "alice",
      actorUserId: "bob",
      targetId: "review-1",
    });
    expect(isBlockedBetweenSpy).toHaveBeenCalledWith("alice", "bob");
    expect(insertSpy).not.toHaveBeenCalled();
  });
});

describe("emit — happy path", () => {
  it("INSERT-with-onConflictDoUpdate fires when no skip applies", async () => {
    isBlockedBetweenSpy.mockResolvedValueOnce(false);
    await emit({
      type: "new_follower",
      recipientUserId: "alice",
      actorUserId: "bob",
      targetId: "bob",
    });
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(valuesSpy).toHaveBeenCalledWith({
      userId: "alice",
      type: "new_follower",
      targetId: "bob",
      actorId: "bob",
    });
    expect(onConflictDoUpdateSpy).toHaveBeenCalledTimes(1);
    const conflictArg = onConflictDoUpdateSpy.mock.calls[0][0];
    expect(conflictArg).toMatchObject({ target: expect.any(Array) });
    expect(conflictArg.set).toHaveProperty("readAt", null);
    // createdAt is a sql template literal; just confirm it's truthy/present.
    expect(conflictArg.set).toHaveProperty("createdAt");
  });

  it("checks isBlockedBetween before INSERT", async () => {
    isBlockedBetweenSpy.mockResolvedValueOnce(false);
    await emit({
      type: "comment_replied",
      recipientUserId: "alice",
      actorUserId: "bob",
      targetId: "comment-1",
    });
    expect(isBlockedBetweenSpy).toHaveBeenCalledWith("alice", "bob");
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });
});
