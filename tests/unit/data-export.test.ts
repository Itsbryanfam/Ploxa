import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Unit tests for exportUserData (lib/settings/data-export.ts).
 *
 * Mock strategy mirrors profile-extras.test.ts:
 * - db.query.X.findMany / findFirst are vi.fn()s per table.
 * - The .select().from().innerJoin().where() chain used for commentsReceived
 *   is mocked separately via selectChainMock.
 * - vi.resetModules() in beforeEach ensures fresh module state each test.
 */

const findFirstProfileMock = vi.fn();
const findManyLogsMock = vi.fn();
const findManyReviewsMock = vi.fn();
const findManyListsMock = vi.fn();
const findManyCommentsMock = vi.fn();
const findManyNotificationsMock = vi.fn();

// Mocks the .select().from().innerJoin().where() chain used for
// comments_received. Returns whatever selectChainMock resolves to.
const selectChainMock = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      profiles: { findFirst: (...args: unknown[]) => findFirstProfileMock(...args) },
      logs: { findMany: (...args: unknown[]) => findManyLogsMock(...args) },
      reviews: { findMany: (...args: unknown[]) => findManyReviewsMock(...args) },
      lists: { findMany: (...args: unknown[]) => findManyListsMock(...args) },
      comments: { findMany: (...args: unknown[]) => findManyCommentsMock(...args) },
      notifications: { findMany: (...args: unknown[]) => findManyNotificationsMock(...args) },
    },
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: (...args: unknown[]) => selectChainMock(...args),
        }),
      }),
    }),
  },
  schema: {
    profiles: { userId: "user_id", username: "username", displayName: "display_name" },
    logs: { userId: "user_id" },
    reviews: { userId: "user_id" },
    lists: { userId: "user_id" },
    comments: { userId: "user_id", reviewId: "review_id", id: "id", body: "body" },
    notifications: { userId: "user_id", createdAt: "created_at" },
  },
}));

// Stub drizzle operators — they are called with schema fields which are plain
// strings in our mock; the actual values don't matter for shape/PII tests.
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (a: unknown, b: unknown) => [a, b],
  gte: (a: unknown, b: unknown) => [a, b],
  inArray: (a: unknown, b: unknown) => [a, b],
  ne: (a: unknown, b: unknown) => [a, b],
  or: (...args: unknown[]) => args,
  sql: Object.assign((s: TemplateStringsArray) => s[0], {}),
}));

// server-only is a stub in Vitest (see vitest.config.ts)
vi.mock("server-only", () => ({}));

beforeEach(() => {
  findFirstProfileMock.mockReset();
  findManyLogsMock.mockReset();
  findManyReviewsMock.mockReset();
  findManyListsMock.mockReset();
  findManyCommentsMock.mockReset();
  findManyNotificationsMock.mockReset();
  selectChainMock.mockReset();
  vi.resetModules();

  // Default happy-path values for all tables
  findFirstProfileMock.mockResolvedValue({ id: "p-1", username: "alice" });
  findManyLogsMock.mockResolvedValue([]);
  findManyReviewsMock.mockResolvedValue([]);
  findManyListsMock.mockResolvedValue([]);
  findManyCommentsMock.mockResolvedValue([]);
  findManyNotificationsMock.mockResolvedValue([]);
  selectChainMock.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// Test 1: shape — result has exactly the 7 expected top-level keys
// ---------------------------------------------------------------------------

describe("exportUserData shape", () => {
  it("returns an object with all 7 sections", async () => {
    const { exportUserData } = await import("@/lib/settings/data-export");
    const result = await exportUserData("user-1");

    expect(Object.keys(result).sort()).toEqual(
      [
        "comments_authored",
        "comments_received",
        "lists",
        "logs",
        "notifications",
        "profile",
        "reviews",
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// Test 2: PII redaction — comments_received strips all commenter metadata
//         except { user_id, display_name }
// ---------------------------------------------------------------------------

describe("exportUserData PII redaction", () => {
  it("strips authorEmail and authorIp from comments_received", async () => {
    // Simulate a row returned by the .select().from().innerJoin().where() chain.
    // The raw DB row has commenter PII fields that must NOT appear in the export.
    selectChainMock.mockResolvedValue([
      {
        id: "c-1",
        body: "Nice review!",
        authorUserId: "other-user",
        authorDisplayName: "Bob",
        authorUsername: "bob",
        // PII fields — these must be scrubbed by the serializer
        authorEmail: "bob@example.com",
        authorIp: "1.2.3.4",
      },
    ]);

    // The user's reviews need at least one entry so the query is triggered
    findManyReviewsMock.mockResolvedValue([{ id: "r-1", userId: "user-1" }]);

    const { exportUserData } = await import("@/lib/settings/data-export");
    const result = await exportUserData("user-1");

    const serialized = JSON.stringify(result.comments_received);
    expect(serialized).not.toContain("authorEmail");
    expect(serialized).not.toContain("bob@example.com");
    expect(serialized).not.toContain("authorIp");
    expect(serialized).not.toContain("1.2.3.4");

    // The kept fields ARE present
    expect(result.comments_received[0]).toMatchObject({
      id: "c-1",
      body: "Nice review!",
      author: { user_id: "other-user", display_name: "Bob" },
    });
  });

  it("falls back to username when display_name is null", async () => {
    selectChainMock.mockResolvedValue([
      {
        id: "c-2",
        body: "Cool!",
        authorUserId: "other-user",
        authorDisplayName: null,
        authorUsername: "charlie",
      },
    ]);
    findManyReviewsMock.mockResolvedValue([{ id: "r-2", userId: "user-1" }]);

    const { exportUserData } = await import("@/lib/settings/data-export");
    const result = await exportUserData("user-1");

    expect(result.comments_received[0]?.author.display_name).toBe("charlie");
  });
});

// ---------------------------------------------------------------------------
// Test 3: comments_authored verbatim — the full row is preserved as-is
// ---------------------------------------------------------------------------

describe("exportUserData comments_authored", () => {
  it("includes the original body, id, and reviewId verbatim (minus isHidden)", async () => {
    const authoredComment = {
      id: "ca-1",
      reviewId: "r-1",
      userId: "user-1",
      body: "My own comment",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      editedAt: null,
      parentId: null,
      isHidden: false,
    };
    findManyCommentsMock.mockResolvedValue([authoredComment]);

    const { exportUserData } = await import("@/lib/settings/data-export");
    const result = await exportUserData("user-1");

    // isHidden is stripped — leaking moderation state to the comment author
    // would reveal silent auto-flag decisions they were never notified about.
    const { isHidden: _stripped, ...expected } = authoredComment;
    expect(result.comments_authored[0]).toEqual(expected);
    expect(result.comments_authored[0]).not.toHaveProperty("isHidden");
  });

  it("strips isHidden even when the comment was auto-flagged (hidden=true)", async () => {
    const hiddenComment = {
      id: "ca-2",
      reviewId: "r-2",
      userId: "user-1",
      body: "Flagged comment",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      editedAt: null,
      parentId: null,
      isHidden: true,
    };
    findManyCommentsMock.mockResolvedValue([hiddenComment]);

    const { exportUserData } = await import("@/lib/settings/data-export");
    const result = await exportUserData("user-1");

    expect(result.comments_authored[0]).not.toHaveProperty("isHidden");
    // Body, parentage, and other identifiers are preserved — the user's
    // entitled to know their comment exists, just not that it was flagged.
    expect(result.comments_authored[0]).toMatchObject({
      id: "ca-2",
      body: "Flagged comment",
      reviewId: "r-2",
    });
  });
});
