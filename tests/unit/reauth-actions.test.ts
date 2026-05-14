import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Reauth is the gate in front of password change, email change, and
 * account deletion. These tests pin the contract:
 *  - verifyCurrentPassword discards the session it receives (we only
 *    care about the boolean "is this password correct")
 *  - verifyReauthOtp accepts the email-OTP code from signInWithOtp
 *  - All paths (including rate-limit hits and unauthenticated state)
 *    surface as ReauthFailedError so consumers have a single error
 *    type to catch
 */

const signInWithPasswordMock = vi.fn();
const signInWithOtpMock = vi.fn();
const verifyOtpMock = vi.fn();
const getCachedUserMock = vi.fn();
const enforceRateLimitMock = vi.fn();

// Stand-in for the real RateLimitedError. Re-exported by the mock factory
// so the production code's `instanceof RateLimitedError` check resolves
// against the same class instance the test throws.
class RateLimitedError extends Error {
  constructor(public scope: string, public retryAfterSeconds: number) {
    super(`Rate limited: ${scope} for ${retryAfterSeconds}s`);
    this.name = "RateLimitedError";
  }
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    auth: {
      signInWithPassword: signInWithPasswordMock,
      signInWithOtp: signInWithOtpMock,
      verifyOtp: verifyOtpMock,
    },
  }),
}));

vi.mock("@/lib/supabase/auth-cache", () => ({
  getCachedUser: getCachedUserMock,
}));

vi.mock("@/lib/security/rate-limit", () => ({
  enforceRateLimit: enforceRateLimitMock,
  RateLimitedError,
}));

beforeEach(() => {
  signInWithPasswordMock.mockReset();
  signInWithOtpMock.mockReset();
  verifyOtpMock.mockReset();
  // Reset and restore the persistent default for shared mocks so tests
  // that override .mockResolvedValueOnce don't leak state to siblings.
  getCachedUserMock.mockReset().mockResolvedValue({ id: "u1", email: "u@e.com" });
  enforceRateLimitMock.mockReset().mockResolvedValue(undefined);
  // Hardening: reset module registry so any in-module memoization
  // doesn't bleed between tests (matches T5 pattern).
  vi.resetModules();
});

describe("verifyCurrentPassword", () => {
  it("resolves when password is correct", async () => {
    signInWithPasswordMock.mockResolvedValueOnce({ data: { session: { access_token: "x" } }, error: null });
    const { verifyCurrentPassword } = await import("@/lib/auth/reauth-actions");
    await expect(verifyCurrentPassword("right-password")).resolves.toBeUndefined();
  });

  it("throws ReauthFailedError when password is wrong", async () => {
    signInWithPasswordMock.mockResolvedValueOnce({ data: null, error: { message: "Invalid login credentials" } });
    const { verifyCurrentPassword, ReauthFailedError } = await import("@/lib/auth/reauth-actions");
    await expect(verifyCurrentPassword("wrong")).rejects.toBeInstanceOf(ReauthFailedError);
  });

  it("throws ReauthFailedError when user is not signed in", async () => {
    getCachedUserMock.mockResolvedValueOnce(null);
    const { verifyCurrentPassword, ReauthFailedError } = await import("@/lib/auth/reauth-actions");
    await expect(verifyCurrentPassword("anything")).rejects.toBeInstanceOf(ReauthFailedError);
  });

  it("rewraps RateLimitedError as ReauthFailedError with retry hint", async () => {
    enforceRateLimitMock.mockRejectedValueOnce(new RateLimitedError("reauth:pwd", 42));
    const { verifyCurrentPassword, ReauthFailedError } = await import("@/lib/auth/reauth-actions");
    await expect(verifyCurrentPassword("anything")).rejects.toMatchObject({
      name: "ReauthFailedError",
      message: expect.stringContaining("42s"),
    });
    // Belt-and-suspenders: also assert it's the ReauthFailedError class
    // so callers' single-type catch is honoured.
    await enforceRateLimitMock.mockRejectedValueOnce(new RateLimitedError("reauth:pwd", 30));
    await expect(verifyCurrentPassword("anything")).rejects.toBeInstanceOf(ReauthFailedError);
  });
});

describe("sendReauthOtp", () => {
  it("calls signInWithOtp with shouldCreateUser=false", async () => {
    signInWithOtpMock.mockResolvedValueOnce({ data: {}, error: null });
    const { sendReauthOtp } = await import("@/lib/auth/reauth-actions");
    await sendReauthOtp();
    expect(signInWithOtpMock).toHaveBeenCalledWith({
      email: "u@e.com",
      options: { shouldCreateUser: false },
    });
  });

  it("throws ReauthFailedError when send errors", async () => {
    signInWithOtpMock.mockResolvedValueOnce({ data: null, error: { message: "smtp down" } });
    const { sendReauthOtp, ReauthFailedError } = await import("@/lib/auth/reauth-actions");
    await expect(sendReauthOtp()).rejects.toBeInstanceOf(ReauthFailedError);
  });
});

describe("verifyReauthOtp", () => {
  it("resolves when code is correct", async () => {
    verifyOtpMock.mockResolvedValueOnce({ data: { session: { access_token: "x" } }, error: null });
    const { verifyReauthOtp } = await import("@/lib/auth/reauth-actions");
    await expect(verifyReauthOtp("123456")).resolves.toBeUndefined();
  });

  it("throws ReauthFailedError on wrong/expired code", async () => {
    verifyOtpMock.mockResolvedValueOnce({ data: null, error: { message: "Token has expired" } });
    const { verifyReauthOtp, ReauthFailedError } = await import("@/lib/auth/reauth-actions");
    await expect(verifyReauthOtp("000000")).rejects.toBeInstanceOf(ReauthFailedError);
  });
});
