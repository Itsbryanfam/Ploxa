import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * userHasPassword is the source of truth for "should we show the
 * Change Password vs Set Password form on /settings/account?". Wraps
 * the Supabase admin SDK getUserById call (only API surface that exposes
 * encrypted_password presence). Memoized per-request so the same React
 * tree doesn't trigger multiple admin lookups.
 */

const getUserByIdMock = vi.fn();

vi.mock("@/lib/auth/admin-client", () => ({
  getAdminClient: () => ({
    auth: { admin: { getUserById: getUserByIdMock } },
  }),
}));

beforeEach(() => {
  getUserByIdMock.mockReset();
  // Reset the module registry so React.cache()'s in-module memo store
  // is wiped between tests. Without this, two tests calling userHasPassword
  // with the same userId would silently share a memoized result without
  // hitting the mock again — a coincidence-only safety today (each test
  // uses a distinct userId), but cheap insurance against future regressions.
  vi.resetModules();
});

describe("userHasPassword", () => {
  it("returns true when encrypted_password is set", async () => {
    getUserByIdMock.mockResolvedValueOnce({
      data: { user: { id: "u1", encrypted_password: "$2a$10$abc..." } },
      error: null,
    });
    const { userHasPassword } = await import("@/lib/auth/user-has-password");
    expect(await userHasPassword("u1")).toBe(true);
  });

  it("returns false when encrypted_password is null/missing", async () => {
    getUserByIdMock.mockResolvedValueOnce({
      data: { user: { id: "u2", encrypted_password: null } },
      error: null,
    });
    const { userHasPassword } = await import("@/lib/auth/user-has-password");
    expect(await userHasPassword("u2")).toBe(false);
  });

  it("returns false when admin SDK errors (fail-closed: assume no password, gate via OTP)", async () => {
    getUserByIdMock.mockResolvedValueOnce({ data: null, error: new Error("nope") });
    const { userHasPassword } = await import("@/lib/auth/user-has-password");
    expect(await userHasPassword("u3")).toBe(false);
  });
});
