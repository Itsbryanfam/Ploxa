import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Unit tests for toggleProfileVisibility server action.
 *
 * Mock strategy mirrors profile-extras.test.ts:
 * - db.update().set().where() chain is captured via updateMock.
 * - db.query.profiles.findFirst captured via findFirstMock.
 * - revalidatePath captured via revalidateMock.
 * - getCachedUser always returns { id: "user-1", email: "u@e.com" } by default.
 *
 * vi.resetModules() in beforeEach + dynamic imports give each test a fresh module.
 */

const updateMock = vi.fn();
const revalidateMock = vi.fn();
const findFirstMock = vi.fn();

vi.mock("@/lib/db", () => ({
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
      deletedAt: { name: "deleted_at" },
    },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));

vi.mock("@/lib/supabase/auth-cache", () => ({
  getCachedUser: vi.fn().mockResolvedValue({ id: "user-1", email: "u@e.com" }),
}));

// Stubs for indirect imports through server-actions.ts
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
  findFirstMock.mockResolvedValue({ username: "alice" });
  vi.resetModules();
});

describe("toggleProfileVisibility", () => {
  it("flips isPublic to false and revalidates the public profile + privacy page", async () => {
    const { toggleProfileVisibility } = await import(
      "@/lib/settings/visibility-actions"
    );
    const result = await toggleProfileVisibility(false);
    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ isPublic: false }),
    );
    expect(revalidateMock).toHaveBeenCalledWith("/u/alice", "page");
    expect(revalidateMock).toHaveBeenCalledWith("/settings/privacy", "page");
  });

  it("flips isPublic to true", async () => {
    const { toggleProfileVisibility } = await import(
      "@/lib/settings/visibility-actions"
    );
    const result = await toggleProfileVisibility(true);
    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ isPublic: true }),
    );
  });

  it("returns error when user not signed in", async () => {
    const { getCachedUser } = await import("@/lib/supabase/auth-cache");
    vi.mocked(getCachedUser).mockResolvedValueOnce(null);
    const { toggleProfileVisibility } = await import(
      "@/lib/settings/visibility-actions"
    );
    const result = await toggleProfileVisibility(false);
    expect(result).toEqual(expect.objectContaining({ ok: false }));
    expect(updateMock).not.toHaveBeenCalled();
  });
});
