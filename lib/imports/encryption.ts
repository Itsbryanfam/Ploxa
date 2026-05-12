import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { requireEnv } from "@/lib/env";

/**
 * AES-256-GCM helpers for at-rest encryption of platform tokens.
 *
 * Storage format: `base64(iv):base64(ciphertext):base64(authTag)`.
 * - iv is 12 bytes (GCM standard)
 * - authTag is 16 bytes (GCM standard)
 * - ciphertext is variable length
 *
 * Master key comes from IMPORT_ENCRYPTION_KEY env (base64 32 bytes).
 *
 * Phase 3 non-goal: key rotation. If IMPORT_ENCRYPTION_KEY changes, existing
 * ciphertexts become unreadable; the affected user reconnects to repopulate.
 */

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;

function getKey(): Buffer {
  const raw = requireEnv("IMPORT_ENCRYPTION_KEY");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `IMPORT_ENCRYPTION_KEY must decode to 32 bytes; got ${key.length}. Regenerate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    ciphertext.toString("base64"),
    authTag.toString("base64"),
  ].join(":");
}

export function decryptSecret(stored: string): string {
  const key = getKey();
  const parts = stored.split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed ciphertext — expected iv:ciphertext:authTag");
  }
  const [ivB64, ctB64, tagB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plaintext.toString("utf8");
}
