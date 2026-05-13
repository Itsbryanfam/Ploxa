import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * Round-trip + tamper-resistance test for the digest unsubscribe JWT
 * helpers. Sign → verify → assert uid; sign → mutate → verify → assert null.
 *
 * UNSUBSCRIBE_SECRET is stubbed via vi.stubEnv before the dynamic import
 * because lib/env.ts is parsed at module load and would otherwise miss
 * the test-supplied value.
 */

// UNSUBSCRIBE_SECRET must be set BEFORE the unsubscribe-token module loads —
// lib/env.ts freezes its serverEnv object at module-evaluation time via
// serverSchema.parse(process.env.*), so a beforeAll() stub fires too
// late. Stubbing at module top-level (above the await import) lands the
// value in process.env in time for env.ts to capture it.
vi.stubEnv("UNSUBSCRIBE_SECRET", "test-secret-at-least-32-chars-long-aaaa");

const { signUnsubscribeToken, verifyUnsubscribeToken } = await import(
  "@/lib/email/unsubscribe-token"
);

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("unsubscribe-token", () => {
  it("round-trips: sign(uid) → verify → returns uid", async () => {
    const token = await signUnsubscribeToken("user-123");
    const uid = await verifyUnsubscribeToken(token);
    expect(uid).toBe("user-123");
  });

  it("returns null when token is tampered with", async () => {
    const token = await signUnsubscribeToken("user-456");
    // Flip a character mid-token to invalidate the signature.
    const mid = Math.floor(token.length / 2);
    const tampered = token.slice(0, mid) + (token[mid] === "a" ? "b" : "a") + token.slice(mid + 1);
    const uid = await verifyUnsubscribeToken(tampered);
    expect(uid).toBeNull();
  });

  it("returns null for malformed garbage", async () => {
    const uid = await verifyUnsubscribeToken("not-a-jwt");
    expect(uid).toBeNull();
  });

  it("returns null for empty string", async () => {
    const uid = await verifyUnsubscribeToken("");
    expect(uid).toBeNull();
  });
});
