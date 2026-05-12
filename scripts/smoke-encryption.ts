/**
 * Smoke test for lib/imports/encryption.ts. Exercises round-trip + failure cases.
 *
 * Run: pnpm tsx --conditions react-server scripts/smoke-encryption.ts
 * Exit 0 = all pass; exit 1 = any fail.
 *
 * --conditions react-server is required because lib/imports/encryption.ts
 * imports "server-only" (a Next.js guard). In plain Node/tsx the react-server
 * export condition resolves to the empty shim instead of the throwing default.
 *
 * The async IIFE + dynamic import is intentional: IMPORT_ENCRYPTION_KEY must
 * be set in process.env before lib/env.ts evaluates (it freezes env at load
 * time). Top-level await is not available in a CJS package; the IIFE is
 * equivalent.
 */
import { randomBytes } from "node:crypto";

// Generate a one-shot key for this smoke run (don't depend on env).
// Must be set before lib/env.ts evaluates so requireEnv() finds it.
process.env.IMPORT_ENCRYPTION_KEY = randomBytes(32).toString("base64");

void (async () => {
  // Dynamic import so env var above is captured when lib/env.ts first loads.
  const { encryptSecret, decryptSecret } = await import("../lib/imports/encryption");

  const checks: Array<{ name: string; fn: () => void }> = [
    {
      name: "round-trip ASCII",
      fn: () => {
        const pt = "hello-world-openxbl-key-1234567890";
        const ct = encryptSecret(pt);
        const back = decryptSecret(ct);
        if (back !== pt) throw new Error(`got ${back}`);
      },
    },
    {
      name: "round-trip empty",
      fn: () => {
        const ct = encryptSecret("");
        if (decryptSecret(ct) !== "") throw new Error("empty roundtrip failed");
      },
    },
    {
      name: "round-trip unicode",
      fn: () => {
        const pt = "key with 🔑 and 中文 mixed in";
        const ct = encryptSecret(pt);
        if (decryptSecret(ct) !== pt) throw new Error("unicode roundtrip failed");
      },
    },
    {
      name: "stored format has 3 base64 segments",
      fn: () => {
        const ct = encryptSecret("anything");
        const parts = ct.split(":");
        if (parts.length !== 3) throw new Error(`got ${parts.length} segments`);
        for (const p of parts) {
          if (!/^[A-Za-z0-9+/=]+$/.test(p)) throw new Error(`segment not base64: ${p}`);
        }
      },
    },
    {
      name: "encrypting same plaintext twice produces different ciphertexts (random IV)",
      fn: () => {
        const a = encryptSecret("same");
        const b = encryptSecret("same");
        if (a === b) throw new Error("ciphertexts collided — IV not randomized");
      },
    },
    {
      name: "tampered authTag rejects on decrypt",
      fn: () => {
        const ct = encryptSecret("guarded");
        const [iv, body, tag] = ct.split(":");
        const tamperedTag = Buffer.from(tag, "base64");
        tamperedTag[0] = tamperedTag[0] ^ 0xff;
        const tampered = `${iv}:${body}:${tamperedTag.toString("base64")}`;
        let threw = false;
        try {
          decryptSecret(tampered);
        } catch {
          threw = true;
        }
        if (!threw) throw new Error("tampered ciphertext should have thrown");
      },
    },
    {
      name: "malformed stored value (2 segments) rejects",
      fn: () => {
        let threw = false;
        try {
          decryptSecret("only:two");
        } catch {
          threw = true;
        }
        if (!threw) throw new Error("malformed input should have thrown");
      },
    },
  ];

  let pass = 0;
  let fail = 0;
  for (const { name, fn } of checks) {
    try {
      fn();
      pass++;
      console.log(`  PASS  ${name}`);
    } catch (err) {
      fail++;
      console.log(`  FAIL  ${name}  —  ${(err as Error).message}`);
    }
  }

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail === 0 ? 0 : 1);
})();
