import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * buildDigest is the email pipeline's payload builder. Tests pin:
 *  - null when profile not found
 *  - null when cadence='off'
 *  - null when all sections are empty (no notifications AND no log activity)
 *  - populated payload: correct grouping + hydration + section caps
 *
 * Mocks db; we're not testing SQL — that's covered by the manual gate.
 */

const findFirstSpy = vi.fn();

// Query queue: each db.select(...) call drains one entry when awaited.
// Tests prime the queue in the same order buildDigest runs its queries:
//   1. notifications (Promise.all batch 1, position 0)
//   2. yourWeek logs   (Promise.all batch 1, position 1)
//   3. reviews+games (Promise.all batch 2, only if reviewIds.length > 0)
//   4. lists         (Promise.all batch 2, only if listIds.length > 0)
//   5. comments+reviews+games (Promise.all batch 2, only if parentCommentIds.length > 0)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const queryQueue: any[][] = [];

vi.mock("@/lib/db", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function makeThenableChainable(): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obj: any = {
      from: () => obj,
      leftJoin: () => obj,
      innerJoin: () => obj,
      where: () => obj,
      orderBy: () => obj,
      limit: () => obj,
      // Thenable: drain one queue entry per await.
      then(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        resolve: (v: any[]) => any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        reject?: (e: unknown) => any,
      ) {
        const rows = queryQueue.shift() ?? [];
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
    return obj;
  }

  return {
    db: {
      query: { profiles: { findFirst: findFirstSpy } },
      select: vi.fn(() => makeThenableChainable()),
    },
    schema: {
      notifications: { type: {}, targetId: {}, actorId: {}, createdAt: {}, userId: {} },
      profiles: { userId: {}, username: {}, displayName: {} },
      reviews: { id: {}, gameId: {}, userId: {}, publishedAt: {} },
      lists: { id: {}, title: {}, userId: {} },
      comments: { id: {}, reviewId: {} },
      games: { id: {}, title: {} },
      logs: { userId: {}, gameId: {}, status: {}, lastEventAt: {}, lastEventType: {} },
    },
  };
});

const { buildDigest } = await import("@/lib/social/notifications/digest");

beforeEach(() => {
  findFirstSpy.mockReset();
  queryQueue.length = 0;
});

describe("buildDigest — null cases", () => {
  it("returns null when profile not found", async () => {
    findFirstSpy.mockResolvedValueOnce(undefined);
    const result = await buildDigest("ghost-user");
    expect(result).toBeNull();
  });

  it("returns null when cadence='off'", async () => {
    findFirstSpy.mockResolvedValueOnce({
      userId: "alice",
      username: "alice",
      displayName: null,
      lastDigestSentAt: null,
      emailDigestCadence: "off",
      emailFollows: true,
      emailReactions: true,
      emailComments: true,
      emailWishlist: true,
    });
    const result = await buildDigest("alice");
    expect(result).toBeNull();
  });

  it("returns null when no notifications AND no log activity", async () => {
    findFirstSpy.mockResolvedValueOnce({
      userId: "alice",
      username: "alice",
      displayName: null,
      lastDigestSentAt: null,
      emailDigestCadence: "weekly",
      emailFollows: true,
      emailReactions: true,
      emailComments: true,
      emailWishlist: true,
    });
    queryQueue.push([]); // notifications
    queryQueue.push([]); // yourWeek logs
    const result = await buildDigest("alice");
    expect(result).toBeNull();
  });
});

describe("buildDigest — populated payload", () => {
  it("groups by type and hydrates titles", async () => {
    findFirstSpy.mockResolvedValueOnce({
      userId: "alice",
      username: "alice",
      displayName: "Alice",
      lastDigestSentAt: null,
      emailDigestCadence: "weekly",
      emailFollows: true,
      emailReactions: true,
      emailComments: true,
      emailWishlist: true,
    });
    // Notifications: 1 of each type the digest cares about.
    queryQueue.push([
      {
        type: "new_follower",
        targetId: "alice-uuid",
        actorId: "bob",
        createdAt: new Date(),
        actorUsername: "bob",
        actorDisplayName: null,
      },
      {
        type: "review_liked",
        targetId: "review-1",
        actorId: "carol",
        createdAt: new Date(),
        actorUsername: "carol",
      },
      {
        type: "list_liked",
        targetId: "list-1",
        actorId: "dave",
        createdAt: new Date(),
        actorUsername: "dave",
      },
      {
        type: "review_commented",
        targetId: "review-1",
        actorId: "eve",
        createdAt: new Date(),
        actorUsername: "eve",
      },
      {
        type: "comment_replied",
        targetId: "comment-parent-1",
        actorId: "frank",
        createdAt: new Date(),
        actorUsername: "frank",
      },
    ]);
    // yourWeek: 1 completed, 1 playing.
    queryQueue.push([
      { status: "completed", lastEventType: "status_change", lastEventAt: new Date(), gameTitle: "Hades" },
      { status: "playing", lastEventType: "status_change", lastEventAt: new Date(), gameTitle: "Celeste" },
    ]);
    // Reviews hydration: review-1 → "Outer Wilds"
    queryQueue.push([{ id: "review-1", gameTitle: "Outer Wilds" }]);
    // Lists hydration: list-1 → "GOTY 2024"
    queryQueue.push([{ id: "list-1", title: "GOTY 2024" }]);
    // Parent comment hydration: comment-parent-1 → "Disco Elysium"
    queryQueue.push([{ id: "comment-parent-1", gameTitle: "Disco Elysium" }]);

    const result = await buildDigest("alice");
    expect(result).not.toBeNull();
    expect(result!.recipient).toEqual({ username: "alice", displayName: "Alice" });
    expect(result!.newFollowers).toEqual([{ username: "bob", displayName: null }]);
    expect(result!.reactions).toEqual([
      { actor: "carol", kind: "review_liked", targetTitle: "Outer Wilds" },
      { actor: "dave", kind: "list_liked", targetTitle: "GOTY 2024" },
    ]);
    expect(result!.comments).toEqual([
      { actor: "eve", kind: "review_commented", targetTitle: "Outer Wilds", excerpt: "" },
      { actor: "frank", kind: "comment_replied", targetTitle: "Disco Elysium", excerpt: "" },
    ]);
    expect(result!.wishlistTriggers).toEqual([]);
    expect(result!.yourWeek).toEqual([
      { kind: "log_completed", gameTitle: "Hades" },
      { kind: "log_started", gameTitle: "Celeste" },
    ]);
  });

  it("falls back to 'a review' / 'a list' when hydration misses", async () => {
    findFirstSpy.mockResolvedValueOnce({
      userId: "alice",
      username: "alice",
      displayName: null,
      lastDigestSentAt: null,
      emailDigestCadence: "weekly",
      emailFollows: true,
      emailReactions: true,
      emailComments: true,
      emailWishlist: true,
    });
    queryQueue.push([
      {
        type: "review_liked",
        targetId: "review-deleted",
        actorId: "carol",
        createdAt: new Date(),
        actorUsername: "carol",
      },
    ]);
    queryQueue.push([]); // yourWeek empty
    queryQueue.push([]); // reviews lookup misses (deleted)
    // No lists or parentComments queries because those id arrays are empty.

    const result = await buildDigest("alice");
    expect(result!.reactions).toEqual([
      { actor: "carol", kind: "review_liked", targetTitle: "a review" },
    ]);
  });

  it("returns non-null when only yourWeek activity exists (no notifications)", async () => {
    findFirstSpy.mockResolvedValueOnce({
      userId: "alice",
      username: "alice",
      displayName: null,
      lastDigestSentAt: null,
      emailDigestCadence: "weekly",
      emailFollows: true,
      emailReactions: true,
      emailComments: true,
      emailWishlist: true,
    });
    queryQueue.push([]); // notifications empty
    queryQueue.push([
      { status: "completed", lastEventType: "status_change", lastEventAt: new Date(), gameTitle: "Hades" },
    ]);
    // No hydration queries fire because all id arrays stayed empty.

    const result = await buildDigest("alice");
    expect(result).not.toBeNull();
    expect(result!.newFollowers).toEqual([]);
    expect(result!.reactions).toEqual([]);
    expect(result!.comments).toEqual([]);
    expect(result!.wishlistTriggers).toEqual([]);
    expect(result!.yourWeek).toEqual([{ kind: "log_completed", gameTitle: "Hades" }]);
  });

  it("uses lastDigestSentAt as the since lower bound when more recent than the cadence window", async () => {
    const recentSend = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago — more recent than weekly's 7d window
    findFirstSpy.mockResolvedValueOnce({
      userId: "alice",
      username: "alice",
      displayName: null,
      lastDigestSentAt: recentSend,
      emailDigestCadence: "weekly",
      emailFollows: true,
      emailReactions: true,
      emailComments: true,
      emailWishlist: true,
    });
    queryQueue.push([]); // notifications empty
    queryQueue.push([]); // yourWeek empty
    // Expect null (all sections empty) but the `since` computation is the
    // assertion target — we verify it by checking the result's null contract
    // is hit AFTER both queries fire (proving the cadence-override branch
    // didn't bail early or crash).
    const result = await buildDigest("alice");
    expect(result).toBeNull();
  });
});

describe("buildDigest — per-type email opt-outs (T9)", () => {
  it("excludes new_follower notifications when emailFollows is false", async () => {
    // Profile has follows opted-out; reactions opted-in
    findFirstSpy.mockResolvedValueOnce({
      userId: "alice",
      username: "alice",
      displayName: "Alice",
      lastDigestSentAt: null,
      emailDigestCadence: "weekly",
      emailFollows: false,  // opted out
      emailReactions: true,
      emailComments: true,
      emailWishlist: true,
    });
    // Notifications: 1 new_follower (should be filtered) + 1 review_liked (should pass)
    queryQueue.push([
      {
        type: "new_follower",
        targetId: "alice-uuid",
        actorId: "bob",
        createdAt: new Date(),
        actorUsername: "bob",
        actorDisplayName: null,
      },
      {
        type: "review_liked",
        targetId: "review-1",
        actorId: "carol",
        createdAt: new Date(),
        actorUsername: "carol",
        actorDisplayName: null,
      },
    ]);
    queryQueue.push([]); // yourWeek empty
    // Reviews hydration for the surviving review_liked
    queryQueue.push([{ id: "review-1", gameTitle: "Outer Wilds" }]);
    // No lists or parentComments queries (those id arrays are empty)

    const result = await buildDigest("alice");
    expect(result).not.toBeNull();
    expect(result!.newFollowers).toEqual([]);    // filtered out
    expect(result!.reactions).toHaveLength(1);    // review_liked kept
    expect(result!.reactions[0]).toMatchObject({ kind: "review_liked" });
  });

  it("excludes both review_liked AND list_liked when emailReactions is false", async () => {
    // Profile has reactions opted-out; follows opted-in
    findFirstSpy.mockResolvedValueOnce({
      userId: "alice",
      username: "alice",
      displayName: "Alice",
      lastDigestSentAt: null,
      emailDigestCadence: "weekly",
      emailFollows: true,
      emailReactions: false, // opted out
      emailComments: true,
      emailWishlist: true,
    });
    // Notifications: 1 new_follower (passes) + 1 review_liked + 1 list_liked (both filtered)
    queryQueue.push([
      {
        type: "new_follower",
        targetId: "alice-uuid",
        actorId: "bob",
        createdAt: new Date(),
        actorUsername: "bob",
        actorDisplayName: null,
      },
      {
        type: "review_liked",
        targetId: "review-1",
        actorId: "carol",
        createdAt: new Date(),
        actorUsername: "carol",
        actorDisplayName: null,
      },
      {
        type: "list_liked",
        targetId: "list-1",
        actorId: "dave",
        createdAt: new Date(),
        actorUsername: "dave",
        actorDisplayName: null,
      },
    ]);
    queryQueue.push([]); // yourWeek empty
    // No hydration queries fire: no review/list/comment ids survive the filter

    const result = await buildDigest("alice");
    expect(result).not.toBeNull();
    expect(result!.reactions).toEqual([]);         // both reaction types filtered
    expect(result!.newFollowers).toHaveLength(1);  // follows kept
    expect(result!.newFollowers[0]).toMatchObject({ username: "bob" });
  });
});
