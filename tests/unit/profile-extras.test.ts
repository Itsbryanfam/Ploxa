import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Unit tests for updateDisplayName and updateBio server actions.
 *
 * Mock strategy mirrors profile-summary.test.ts:
 * - db.query.profiles.findFirst is a vi.fn() so we can control what the
 *   username-lookup returns per test.
 * - db.update().set().where() chain is captured via updateMock so we can
 *   assert what values were persisted.
 * - revalidatePath is captured via revalidateMock.
 * - getCachedUser always returns { id: "user-1", email: "u@e.com" }.
 *
 * We use vi.resetModules() in beforeEach + dynamic imports so each test
 * gets a fresh module (avoids memoized state from previous test bleeding in).
 */

const updateMock = vi.fn();
const revalidateMock = vi.fn();
const findFirstMock = vi.fn();

vi.mock("@/lib/db", () => {
  return {
    db: {
      update: () => ({
        set: (v: unknown) => ({
          where: () => {
            updateMock(v);
            return Promise.resolve();
          },
        }),
      }),
      query: {
        profiles: {
          findFirst: (...args: unknown[]) => findFirstMock(...args),
        },
      },
    },
    schema: {
      profiles: {
        userId: { name: "user_id" },
        username: { name: "username" },
        displayName: { name: "display_name" },
        bio: { name: "bio" },
      },
    },
  };
});

vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));

vi.mock("@/lib/supabase/auth-cache", () => ({
  getCachedUser: vi.fn().mockResolvedValue({ id: "user-1", email: "u@e.com" }),
}));

// Stub unused imports pulled in by server-actions.ts
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/lib/security/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  clientIpForRateLimit: vi.fn().mockResolvedValue("127.0.0.1"),
  RateLimitedError: class RateLimitedError extends Error {},
}));

beforeEach(() => {
  updateMock.mockReset();
  revalidateMock.mockReset();
  findFirstMock.mockReset();
  // Default: user has a profile with username "alice"
  findFirstMock.mockResolvedValue({ username: "alice" });
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// updateDisplayName
// ---------------------------------------------------------------------------

describe("updateDisplayName", () => {
  it("trims whitespace and persists the trimmed value", async () => {
    const { updateDisplayName } = await import("@/lib/profile/server-actions");
    await updateDisplayName("  Alice  ");
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "Alice" }),
    );
  });

  it("rejects strings over 64 chars without calling db.update", async () => {
    const { updateDisplayName } = await import("@/lib/profile/server-actions");
    const result = await updateDisplayName("a".repeat(65));
    expect(result).toEqual(expect.objectContaining({ error: expect.any(String) }));
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("accepts exactly 64 chars", async () => {
    const { updateDisplayName } = await import("@/lib/profile/server-actions");
    const result = await updateDisplayName("a".repeat(64));
    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "a".repeat(64) }),
    );
  });

  it("revalidates /u/[username] and /settings/profile on success", async () => {
    const { updateDisplayName } = await import("@/lib/profile/server-actions");
    await updateDisplayName("Alice");
    expect(revalidateMock).toHaveBeenCalledWith("/u/alice", "page");
    expect(revalidateMock).toHaveBeenCalledWith("/settings/profile", "page");
  });

  it("clears displayName by writing null when given an empty string", async () => {
    // Empty-string -> null so the public profile's `displayName ?? username`
    // fallback fires correctly (?? doesn't coerce ""). Matches the Discord
    // action's null-on-clear convention.
    const { updateDisplayName } = await import("@/lib/profile/server-actions");
    const result = await updateDisplayName("");
    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: null }),
    );
  });
});

// ---------------------------------------------------------------------------
// updateBio
// ---------------------------------------------------------------------------

describe("updateBio", () => {
  it("rejects strings over 500 chars without calling db.update", async () => {
    const { updateBio } = await import("@/lib/profile/server-actions");
    const result = await updateBio("a".repeat(501));
    expect(result).toEqual(expect.objectContaining({ error: expect.any(String) }));
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("accepts exactly 500 chars", async () => {
    const { updateBio } = await import("@/lib/profile/server-actions");
    const result = await updateBio("a".repeat(500));
    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ bio: "a".repeat(500) }),
    );
  });

  it("trims whitespace before persisting", async () => {
    const { updateBio } = await import("@/lib/profile/server-actions");
    await updateBio("  Hello world  ");
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ bio: "Hello world" }),
    );
  });

  it("revalidates /u/[username] and /settings/profile on success", async () => {
    const { updateBio } = await import("@/lib/profile/server-actions");
    await updateBio("Cool bio");
    expect(revalidateMock).toHaveBeenCalledWith("/u/alice", "page");
    expect(revalidateMock).toHaveBeenCalledWith("/settings/profile", "page");
  });

  it("clears bio by writing null when given an empty string", async () => {
    // Empty-string -> null for consistency with displayName + Discord.
    const { updateBio } = await import("@/lib/profile/server-actions");
    const result = await updateBio("");
    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ bio: null }),
    );
  });
});
