import { afterAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

// IMPORT_ENCRYPTION_KEY must be set BEFORE the encryption module loads —
// lib/env.ts freezes its serverEnv object at module-evaluation time via
// serverSchema.parse(process.env.*), so a beforeAll() stub fires too
// late. Stubbing at module top-level (above the await import) lands the
// value in process.env in time for env.ts to capture it.
const TEST_KEY = randomBytes(32).toString("base64");
vi.stubEnv("IMPORT_ENCRYPTION_KEY", TEST_KEY);

const { encryptSecret, decryptSecret } = await import("@/lib/imports/encryption");

afterAll(() => {
  vi.unstubAllEnvs();
});

/**
 * AES-256-GCM round-trip + format guarantees for at-rest encryption of
 * platform tokens (Phase 3 imports). The audit didn't flag this code, but
 * cryptographic round-trip failures are silent and consequential — every
 * stored Xbox key would become unreadable on a regression. This test pins
 * the wire format AND the IV-uniqueness invariant.
 */

describe("encryptSecret / decryptSecret — round-trip", () => {
  it("decrypts a freshly-encrypted plaintext back to the original", () => {
    const plaintext = "openxbl-test-key-1234567890";
    const stored = encryptSecret(plaintext);
    expect(decryptSecret(stored)).toBe(plaintext);
  });

  it("preserves unicode + binary-ish payloads", () => {
    // Tokens are usually ASCII, but defense-in-depth — a future provider
    // might hand us a base64 blob with all bytes in play.
    const plaintext = "héllo 🎮 \x00\x01\x02 end";
    expect(decryptSecret(encryptSecret(plaintext))).toBe(plaintext);
  });

  it("handles empty-string input (boundary case)", () => {
    expect(decryptSecret(encryptSecret(""))).toBe("");
  });
});

describe("encryptSecret — wire format", () => {
  it("produces `iv:ciphertext:authTag` triples (3 base64-separated parts)", () => {
    const stored = encryptSecret("hello");
    const parts = stored.split(":");
    expect(parts).toHaveLength(3);
    // Each part is base64; non-empty.
    for (const p of parts) {
      expect(p.length).toBeGreaterThan(0);
      expect(Buffer.from(p, "base64").length).toBeGreaterThan(0);
    }
  });

  it("produces a 12-byte IV (GCM standard)", () => {
    const stored = encryptSecret("hello");
    const ivBytes = Buffer.from(stored.split(":")[0], "base64");
    expect(ivBytes.length).toBe(12);
  });

  it("produces a 16-byte authTag (GCM standard)", () => {
    const stored = encryptSecret("hello");
    const tagBytes = Buffer.from(stored.split(":")[2], "base64");
    expect(tagBytes.length).toBe(16);
  });

  it("emits a fresh IV per call so identical plaintexts produce distinct ciphertexts", () => {
    // IV reuse with the same key in GCM is catastrophic for confidentiality
    // AND integrity (it leaks the XOR of plaintexts and lets an attacker
    // forge new authentic ciphertexts). The test fails if encryptSecret
    // ever switches to a deterministic IV.
    const a = encryptSecret("identical plaintext");
    const b = encryptSecret("identical plaintext");
    expect(a).not.toBe(b);
    expect(a.split(":")[0]).not.toBe(b.split(":")[0]); // distinct IVs
  });
});

describe("decryptSecret — failure modes", () => {
  it("throws on malformed ciphertext (missing parts)", () => {
    expect(() => decryptSecret("only-one-part")).toThrow(/Malformed ciphertext/);
    expect(() => decryptSecret("two:parts")).toThrow(/Malformed ciphertext/);
  });

  it("throws (not silently returns garbage) when the authTag is wrong", () => {
    // GCM's auth tag is what makes "tamper detection" a built-in property.
    // Forging a different tag should be rejected at decipher.final().
    const stored = encryptSecret("hello");
    const [iv, ct] = stored.split(":");
    const wrongTag = Buffer.alloc(16, 0).toString("base64");
    expect(() => decryptSecret(`${iv}:${ct}:${wrongTag}`)).toThrow();
  });

  it("throws when the ciphertext is tampered with", () => {
    const stored = encryptSecret("hello");
    const [iv, _ct, tag] = stored.split(":");
    const tampered = Buffer.alloc(16, 0xff).toString("base64");
    expect(() => decryptSecret(`${iv}:${tampered}:${tag}`)).toThrow();
  });
});
