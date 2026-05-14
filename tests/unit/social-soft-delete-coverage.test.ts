import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Soft-delete + block-filter coverage sweep (T03 of audit-fixes-2026-05-14).
 *
 * The 2026-05-14 audit found 6 social/discovery read paths that didn't
 * filter soft-deleted profiles (or didn't pass through the block-filter
 * chokepoint). One test per fix:
 *
 *   1. Comment-thread query on the review page (block filter)
 *   2. Digest cron candidate SELECT (soft-delete)
 *   3. Trending-reviews discovery (soft-delete)
 *   4. Mention resolver (soft-delete)
 *   5. Popular-games discovery (soft-delete)
 *   6. Lists detail page (soft-delete + redactPrivateProfile)
 *
 * Where the query is raw SQL through `db.execute(sql\`...\`)`, we assert
 * against the captured SQL text (so a refactor that drops the filter
 * fails). Where the query is Drizzle ORM, we assert against the where-clause
 * args captured by a thin drizzle-orm mock.
 */

// ---------------------------------------------------------------------------
// Test 1 — Comment-thread block filter (review page chokepoint)
// ---------------------------------------------------------------------------
//
// The review canonical page builds its comment query as
// `db.select(...).from(comments).leftJoin(profiles).where(...).$dynamic()`
// and then wraps with `withBlockedFilter`. We can't easily import the RSC
// page module (it pulls in Next.js internals), so this test reads the file
// source and asserts the wrap is wired.

describe("Hole 1 — Comment-thread query wraps through withBlockedFilter", () => {
  it("review canonical page imports withBlockedFilter and wraps comments", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const filePath = path.join(
      process.cwd(),
      "app",
      "(app)",
      "u",
      "[username]",
      "reviews",
      "[slug]",
      "page.tsx",
    );
    const src = fs.readFileSync(filePath, "utf-8");

    // Import statement present.
    expect(src).toContain("withBlockedFilter");
    expect(src).toMatch(/from\s+["']@\/lib\/social\/_shared\/visibility["']/);

    // Wrap call present, anchored against the comments userId column —
    // confirms the chokepoint was applied to comment authorship, not some
    // other column.
    expect(src).toMatch(/withBlockedFilter\(\s*viewer\?\.id\s*\?\?\s*null\s*,/);
    expect(src).toMatch(/schema\.comments\.userId/);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — Digest cron filters soft-deleted profiles
// ---------------------------------------------------------------------------
//
// The candidate SELECT in app/api/internal/digest/run/route.ts is raw SQL
// (db.execute(sql`...`)) — straightforward to assert the WHERE clause
// includes `p.deleted_at IS NULL`.

describe("Hole 2 — Digest cron WHERE clause filters soft-deleted profiles", () => {
  it("digest route SQL includes p.deleted_at IS NULL", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const filePath = path.join(
      process.cwd(),
      "app",
      "api",
      "internal",
      "digest",
      "run",
      "route.ts",
    );
    const src = fs.readFileSync(filePath, "utf-8");
    // The SELECT lives inside a sql`...` template; match the filter
    // verbatim. If a future refactor drops it, this assertion fails.
    expect(src).toMatch(/p\.deleted_at\s+IS\s+NULL/i);
  });
});

// ---------------------------------------------------------------------------
// Test 3 — Trending-reviews discovery filters soft-deleted authors
// ---------------------------------------------------------------------------

describe("Hole 3 — Trending-reviews SQL filters soft-deleted authors", () => {
  it("trending-reviews SQL includes p.deleted_at IS NULL", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const filePath = path.join(
      process.cwd(),
      "lib",
      "social",
      "discovery",
      "trending-reviews.ts",
    );
    const src = fs.readFileSync(filePath, "utf-8");
    expect(src).toMatch(/p\.deleted_at\s+IS\s+NULL/i);
  });
});

// ---------------------------------------------------------------------------
// Test 4 — Mention resolver filters soft-deleted profiles
// ---------------------------------------------------------------------------
//
// resolveMentionedUserIds is straightforward Drizzle: we can mock the db
// chain and assert that the where-call captured an isNull(...) filter
// against the deletedAt column.

const mentionsWhereSpy = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (arg: unknown) => {
          mentionsWhereSpy(arg);
          return Promise.resolve([]);
        },
      }),
    }),
  },
  schema: {
    profiles: {
      userId: { name: "user_id", _columnName: "user_id" },
      username: { name: "username", _columnName: "username" },
      deletedAt: { name: "deleted_at", _columnName: "deleted_at" },
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  // Reflect args back so the spy can inspect them.
  and: (...args: unknown[]) => ["__and", ...args],
  eq: (a: unknown, b: unknown) => ["__eq", a, b],
  inArray: (col: unknown, vals: unknown) => ["__inArray", col, vals],
  isNull: (col: unknown) => ["__isNull", col],
}));

describe("Hole 4 — Mention resolver filters soft-deleted profiles", () => {
  beforeEach(() => {
    mentionsWhereSpy.mockReset();
    vi.resetModules();
  });

  it("resolveMentionedUserIds passes isNull(deletedAt) into the where clause", async () => {
    const { resolveMentionedUserIds } = await import(
      "@/lib/social/comments/mentions"
    );
    await resolveMentionedUserIds(["alice"]);
    expect(mentionsWhereSpy).toHaveBeenCalledTimes(1);
    const captured = mentionsWhereSpy.mock.calls[0][0];
    // and(...) returns ["__and", inArrayTuple, isNullTuple]
    expect(Array.isArray(captured)).toBe(true);
    const arr = captured as unknown[];
    expect(arr[0]).toBe("__and");
    // One of the sibling tuples must be an isNull against deletedAt.
    const flat = JSON.stringify(arr);
    expect(flat).toContain("__isNull");
    expect(flat).toContain("deleted_at");
  });

  it("returns an empty Map without hitting the DB when no usernames are passed", async () => {
    const { resolveMentionedUserIds } = await import(
      "@/lib/social/comments/mentions"
    );
    const result = await resolveMentionedUserIds([]);
    expect(result.size).toBe(0);
    // No query fired — the early return short-circuits.
    expect(mentionsWhereSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 5 — Popular-games discovery filters soft-deleted authors
// ---------------------------------------------------------------------------

describe("Hole 5 — Popular-games SQL joins profiles + filters soft-deleted authors", () => {
  it("popular-games SQL joins profiles and filters p.deleted_at IS NULL", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const filePath = path.join(
      process.cwd(),
      "lib",
      "social",
      "discovery",
      "popular-games.ts",
    );
    const src = fs.readFileSync(filePath, "utf-8");
    // Both the JOIN and the filter must be present.
    expect(src).toMatch(/JOIN\s+profiles\s+p\s+ON\s+p\.user_id\s*=\s*l\.user_id/i);
    expect(src).toMatch(/p\.deleted_at\s+IS\s+NULL/i);
  });
});

// ---------------------------------------------------------------------------
// Test 6 — Lists detail page filters soft-deleted + redacts private profile
// ---------------------------------------------------------------------------
//
// Two assertions: (a) the page filters soft-deleted in the profile lookup,
// and (b) it calls redactPrivateProfile so non-owner viewers of a private
// profile get displayName blanked.

describe("Hole 6 — Lists detail page filters soft-deleted + redacts private profile", () => {
  it("page filters soft-deleted profile and calls redactPrivateProfile", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const filePath = path.join(
      process.cwd(),
      "app",
      "(app)",
      "u",
      "[username]",
      "lists",
      "[listSlug]",
      "page.tsx",
    );
    const src = fs.readFileSync(filePath, "utf-8");
    // Soft-delete filter on profile lookup.
    expect(src).toMatch(/isNull\(\s*schema\.profiles\.deletedAt\s*\)/);
    // Redaction helper imported + invoked.
    expect(src).toContain("redactPrivateProfile");
    expect(src).toMatch(/from\s+["']@\/lib\/profile\/redact["']/);
  });

  it("redactPrivateProfile blanks displayName for non-owner of private profile", async () => {
    // Pure-function unit test of the redaction logic.
    vi.resetModules();
    const { redactPrivateProfile } = await import("@/lib/profile/redact");
    const result = redactPrivateProfile(
      {
        userId: "target",
        username: "alice",
        displayName: "Alice Real Name",
        isPublic: false,
      },
      "different-viewer",
    );
    expect(result.displayName).toBeNull();
    expect(result.username).toBe("alice"); // username preserved
  });

  it("redactPrivateProfile preserves displayName for the owner", async () => {
    vi.resetModules();
    const { redactPrivateProfile } = await import("@/lib/profile/redact");
    const result = redactPrivateProfile(
      {
        userId: "owner",
        username: "alice",
        displayName: "Alice Real Name",
        isPublic: false,
      },
      "owner",
    );
    expect(result.displayName).toBe("Alice Real Name");
  });

  it("redactPrivateProfile preserves displayName when profile is public", async () => {
    vi.resetModules();
    const { redactPrivateProfile } = await import("@/lib/profile/redact");
    const result = redactPrivateProfile(
      {
        userId: "target",
        username: "alice",
        displayName: "Alice Real Name",
        isPublic: true,
      },
      "different-viewer",
    );
    expect(result.displayName).toBe("Alice Real Name");
  });
});
