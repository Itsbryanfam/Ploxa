import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/lib/auth/safe-next";

/**
 * Security primitive: an open-redirect guard for `?next=` query params
 * that get forwarded to redirect() / NextResponse.redirect() after login.
 * Browsers treat `//host` and `/\host` as protocol-relative or
 * backslash-protocol URLs that navigate cross-origin, so a naive
 * startsWith("/") check would forward users to attacker-controlled
 * domains after authentication.
 *
 * Every case here corresponds to a known phishing pattern. Don't relax
 * the rules without re-reading the OWASP unvalidated-redirect cheat
 * sheet.
 */

describe("safeRedirectPath — accepts internal paths", () => {
  it("accepts a typical internal route", () => {
    expect(safeRedirectPath("/dashboard")).toBe("/dashboard");
  });

  it("accepts internal routes with query strings", () => {
    expect(safeRedirectPath("/library?platform=steam")).toBe("/library?platform=steam");
  });

  it("accepts internal routes with hash fragments", () => {
    expect(safeRedirectPath("/u/me#reviews")).toBe("/u/me#reviews");
  });
});

describe("safeRedirectPath — rejects cross-origin patterns", () => {
  it("rejects protocol-relative URLs (//host)", () => {
    // The classic open-redirect: //evil.com bypasses startsWith("/").
    expect(safeRedirectPath("//evil.com")).toBe("/home");
    expect(safeRedirectPath("//evil.com/path")).toBe("/home");
  });

  it("rejects backslash-protocol URLs (/\\host)", () => {
    // Some browsers normalize /\host → //host. Block both shapes.
    expect(safeRedirectPath("/\\evil.com")).toBe("/home");
  });

  it("rejects absolute URLs with explicit scheme", () => {
    expect(safeRedirectPath("https://evil.com")).toBe("/home");
    expect(safeRedirectPath("http://evil.com")).toBe("/home");
    expect(safeRedirectPath("javascript:alert(1)")).toBe("/home");
  });

  it("rejects bare paths without a leading slash", () => {
    expect(safeRedirectPath("dashboard")).toBe("/home");
    expect(safeRedirectPath("evil.com")).toBe("/home");
  });
});

describe("safeRedirectPath — null / undefined / empty fallback", () => {
  it("returns the default fallback for null", () => {
    expect(safeRedirectPath(null)).toBe("/home");
  });

  it("returns the default fallback for undefined", () => {
    expect(safeRedirectPath(undefined)).toBe("/home");
  });

  it("returns the default fallback for empty string", () => {
    expect(safeRedirectPath("")).toBe("/home");
  });

  it("respects a custom fallback when supplied", () => {
    expect(safeRedirectPath(null, "/login")).toBe("/login");
    expect(safeRedirectPath("//evil.com", "/login")).toBe("/login");
  });
});
