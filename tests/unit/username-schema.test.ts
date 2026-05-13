import { describe, expect, it } from "vitest";
import { usernameSchema } from "@/lib/profile/username-schema";
import { RESERVED_USERNAMES } from "@/lib/profile/reserved-usernames";

// Pins the audit #5 invariant: any code path that runs a candidate name
// through usernameSchema is automatically gated on RESERVED_USERNAMES —
// it's baked into the schema via .refine, not a separate check at every
// callsite.

describe("usernameSchema — character/length rules", () => {
  it("accepts a typical 3-24 char lowercase name", () => {
    expect(usernameSchema.safeParse("hades_fan").success).toBe(true);
    expect(usernameSchema.safeParse("abc").success).toBe(true);
    expect(usernameSchema.safeParse("a".repeat(24)).success).toBe(true);
  });

  it("rejects names with uppercase characters", () => {
    expect(usernameSchema.safeParse("Hades").success).toBe(false);
    expect(usernameSchema.safeParse("HADES").success).toBe(false);
  });

  it("rejects names shorter than 3 chars", () => {
    expect(usernameSchema.safeParse("ab").success).toBe(false);
    expect(usernameSchema.safeParse("").success).toBe(false);
  });

  it("rejects names longer than 24 chars", () => {
    expect(usernameSchema.safeParse("a".repeat(25)).success).toBe(false);
  });

  it("rejects punctuation / whitespace / emoji", () => {
    expect(usernameSchema.safeParse("hello-world").success).toBe(false);
    expect(usernameSchema.safeParse("hello world").success).toBe(false);
    expect(usernameSchema.safeParse("hello.world").success).toBe(false);
    expect(usernameSchema.safeParse("hades🎮").success).toBe(false);
  });

  it("allows digits and underscores", () => {
    expect(usernameSchema.safeParse("user_42").success).toBe(true);
    expect(usernameSchema.safeParse("_underscore").success).toBe(true);
    expect(usernameSchema.safeParse("42player").success).toBe(true);
  });
});

describe("usernameSchema — reserved-name rejection (audit #5)", () => {
  it("rejects every name in RESERVED_USERNAMES", () => {
    // Spot-check obvious ones, then verify the full set is covered.
    for (const reserved of ["admin", "api", "settings"]) {
      const r = usernameSchema.safeParse(reserved);
      // The reserved name may or may not also fail the regex — what we care
      // about is that safeParse returns success=false either way.
      expect(r.success).toBe(false);
    }
  });

  it("every lowercase reserved name fails safeParse (full sweep)", () => {
    // Filter to names that would otherwise pass the regex — uppercase or
    // disallowed-char reserved names are blocked by the regex regardless.
    const regexCompatible = [...RESERVED_USERNAMES].filter((n) =>
      /^[a-z0-9_]{3,24}$/.test(n),
    );
    expect(regexCompatible.length).toBeGreaterThan(0); // sanity: list isn't empty
    for (const name of regexCompatible) {
      const r = usernameSchema.safeParse(name);
      expect(r.success, `expected "${name}" to be rejected as reserved`).toBe(false);
    }
  });

  it("returns the 'reserved' error message (not a regex error) for reserved names", () => {
    const r = usernameSchema.safeParse("admin");
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.some((i) => /reserved/i.test(i.message))).toBe(true);
  });
});
