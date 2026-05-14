import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Unit tests for softDeleteAccount, cancelDeletion, and isAccountSoftDeleted.
 *
 * Mock strategy:
 * - db.query.profiles.findFirst is a vi.fn() (findFirstMock) for per-test control.
 * - db.update().set().where() chain captures the set-value via updateMock.
 * - createSupabaseServerClient returns a stub with auth.signOut captured via signOutMock.
 * - getCachedUser always returns { id: "u1", email: "u@e.com" }.
 * - getProfileByUserId always returns { username: "alice" } by default.
 * - userHasPassword always returns true (password flow) by default.
 * - verifyCurrentPassword / verifyReauthOtp are vi.fn() stubs.
 *
 * Uses vi.resetModules() in beforeEach + dynamic imports so each test gets a
 * fresh module instance — matches pattern from profile-extras.test.ts.
 */

const updateMock = vi.fn();
const signOutMock = vi.fn();
const findFirstMock = vi.fn();

// Stand-in class for ReauthFailedError — must be instanceof-checkable in the
// production code's catch block. StubReauthFailedError extends Error and sets
// name to "ReauthFailedError" so the class identity is distinguishable from
// generic errors even across module-reset boundaries.
class StubReauthFailedError extends Error {
  constructor(message = "Reauthentication failed") {
    super(message);
    this.name = "ReauthFailedError";
  }
}

const verifyCurrentPasswordMock = vi.fn();
const verifyReauthOtpMock = vi.fn();

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

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    auth: { signOut: signOutMock },
  }),
}));

vi.mock("@/lib/supabase/auth-cache", () => ({
  getCachedUser: vi.fn().mockResolvedValue({ id: "u1", email: "u@e.com" }),
}));

vi.mock("@/lib/profile/server-actions", () => ({
  getProfileByUserId: vi.fn().mockResolvedValue({ username: "alice" }),
}));

vi.mock("@/lib/auth/user-has-password", () => ({
  userHasPassword: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/auth/reauth-actions", () => ({
  verifyCurrentPassword: verifyCurrentPasswordMock,
  verifyReauthOtp: verifyReauthOtpMock,
  ReauthFailedError: StubReauthFailedError,
}));

vi.mock("@/lib/security/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  clientIpForRateLimit: vi.fn().mockResolvedValue("127.0.0.1"),
  RateLimitedError: class RateLimitedError extends Error {},
}));

beforeEach(() => {
  updateMock.mockReset();
  signOutMock.mockReset().mockResolvedValue({ error: null });
  findFirstMock.mockReset();
  verifyCurrentPasswordMock.mockReset().mockResolvedValue(undefined);
  verifyReauthOtpMock.mockReset();
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// softDeleteAccount
// ---------------------------------------------------------------------------

describe("softDeleteAccount", () => {
  it("rejects when typed username doesn't match (case-insensitive)", async () => {
    const fd = new FormData();
    fd.set("confirm_username", "wrong");
    fd.set("current_password", "pwd");
    const { softDeleteAccount } = await import("@/lib/settings/account-deletion-actions");
    const result = await softDeleteAccount(fd);
    expect(result).toEqual(expect.objectContaining({ ok: false, error: expect.stringContaining("username") }));
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("accepts case-insensitive username match and writes deletedAt", async () => {
    const fd = new FormData();
    fd.set("confirm_username", "ALICE");
    fd.set("current_password", "pwd");
    const { softDeleteAccount } = await import("@/lib/settings/account-deletion-actions");
    const result = await softDeleteAccount(fd);
    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ deletedAt: expect.any(Date) }),
    );
  });

  it("signs out globally on success", async () => {
    const fd = new FormData();
    fd.set("confirm_username", "alice");
    fd.set("current_password", "pwd");
    const { softDeleteAccount } = await import("@/lib/settings/account-deletion-actions");
    await softDeleteAccount(fd);
    expect(signOutMock).toHaveBeenCalledWith({ scope: "global" });
  });

  it("returns ok:false when verifyCurrentPassword throws ReauthFailedError", async () => {
    verifyCurrentPasswordMock.mockRejectedValueOnce(
      new StubReauthFailedError("Wrong password"),
    );
    const fd = new FormData();
    fd.set("confirm_username", "alice");
    fd.set("current_password", "bad-password");
    const { softDeleteAccount } = await import("@/lib/settings/account-deletion-actions");
    const result = await softDeleteAccount(fd);
    expect(result).toEqual(expect.objectContaining({ ok: false, error: "Wrong password" }));
    expect(updateMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// cancelDeletion
// ---------------------------------------------------------------------------

describe("cancelDeletion", () => {
  it("clears deletedAt by writing null", async () => {
    const { cancelDeletion } = await import("@/lib/settings/account-deletion-actions");
    const result = await cancelDeletion();
    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ deletedAt: null }),
    );
  });
});
