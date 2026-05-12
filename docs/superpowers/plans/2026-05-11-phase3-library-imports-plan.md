# Phase 3 — Library Imports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Steam + Xbox library imports with conflict-safe merge into existing logs, a 3-step Xbox connect modal, post-import summary screen, persistent progress toast, and a daily-sync cron — meeting all 8 items of the Phase 3 verification gate.

**Architecture:** Two Supabase Edge Functions form the engine (`import-platform` worker + `daily-sync` cron); the Next app fires-and-polls via TanStack Query. A shared `LibraryImporter` adapter interface lives in `lib/imports/adapters/`. Pure functions for `rawg-match` and `merge` are unit-smoke-tested via tsx scripts. Steam uses OpenID 2.0 round-trip + `check_authentication`; Xbox uses an OpenXBL key paste flow with AES-GCM encryption at rest.

**Tech Stack:** Next.js 16 App Router · Server Actions · Drizzle ORM · Supabase (Edge Functions + pg_cron + pg_net) · Upstash Redis · `openid` (Steam OpenID 2.0) · Node `crypto` (AES-GCM)

**Spec:** [docs/superpowers/specs/2026-05-11-phase3-library-imports-design.md](../specs/2026-05-11-phase3-library-imports-design.md)

---

## File Structure

```
lib/imports/
├─ adapters/
│  ├─ types.ts             LibraryImporter, ImportedGame, ConnectInput/Result
│  ├─ steam.ts             Steam Web API + OpenID-2.0 verify helpers
│  ├─ xbox.ts              OpenXBL key flow + delta-detection
│  └─ manual.ts            Pseudo-adapter (UI-only marker, no fetch)
├─ rawg-match.ts           Title → game_id match (appid map → alias → fuzzy title+year)
├─ merge.ts                Pure conflict-merge function (user data wins, platforms union)
├─ encryption.ts           AES-256-GCM helpers (encrypt-on-insert, decrypt-on-use)
├─ server-actions.ts       triggerImport, syncNow, disconnectPlatform, listConnections
└─ select.ts               Drizzle projections for imports + platform_connections

supabase/functions/
├─ _shared/
│  └─ import-engine.ts     Adapter-agnostic loop
├─ import-platform/
│  └─ index.ts             Edge function entry — Deno runtime
└─ daily-sync/
   └─ index.ts             Cron entry

supabase/migrations/
└─ 000Y_phase3_cron.sql    pg_cron + pg_net + cron.schedule (NOT Drizzle-managed)

lib/db/migrations/
└─ 0003_*.sql              Drizzle-generated additive migration (imports + logs)

components/imports/
├─ platform-card.tsx       Connection card (5 states)
├─ xbox-connect-modal.tsx  3-step modal walkthrough
├─ import-summary.tsx      Renderer for /library/import/[importId]
├─ import-toast.tsx        Singleton bottom-right pill
└─ illustrations/
   ├─ xbl-step-1.tsx       Pixel-art SVG: xbl.io homepage
   ├─ xbl-step-2.tsx       Pixel-art SVG: dashboard with API Key tab
   └─ xbl-step-3.tsx       Pixel-art SVG: API key string with copy affordance

app/api/
├─ auth/steam/
│  ├─ route.ts             OpenID 2.0 start (redirect)
│  └─ callback/
│     └─ route.ts          OpenID 2.0 return (verify + persist + trigger import)
├─ connect/xbox/
│  └─ route.ts             POST OpenXBL key → validate → encrypt → persist → trigger
└─ imports/
   └─ [importId]/
      └─ status/
         └─ route.ts       Polled status JSON endpoint (with stuck flag)

app/(app)/settings/_sections/
└─ connections-section.tsx New — renders 3 platform cards + Sync history drawer

app/(app)/library/import/[importId]/
├─ page.tsx                Summary screen (RSC)
└─ loading.tsx

scripts/                   tsx smoke scripts (matches existing pattern)
├─ smoke-merge.ts          Exhaustive cases for merge.ts (high-risk pure logic)
└─ smoke-rawg-match.ts     Title-matching examples (developer eyeball)

.env.example               (modify) — STEAM_API_KEY, SUPABASE_FUNCTIONS_URL, IMPORT_ENCRYPTION_KEY
lib/env.ts                 (modify) — register the 3 new server-only env vars
lib/db/schema.ts           (modify) — additive columns on imports + logs
package.json               (modify) — add `openid` dep
app/(app)/layout.tsx       (modify) — mount <ImportToast> singleton
app/(app)/settings/page.tsx (modify) — sidebar adds Connections, render section
app/(app)/library/page.tsx (modify) — empty-state "Or connect Steam →" CTA
app/(app)/home/page.tsx    (modify) — onboarding nudge after 5 logs
```

---

## Testing convention

The project does **not** have a test runner installed (matches Phase 2 + 1.5 pattern). Verification per task:

- **Pure functions** (`merge.ts`, `rawg-match.ts`, `encryption.ts`): a `tsx` smoke script under `scripts/` exercises the function with hand-picked cases and prints PASS/FAIL. Run with `pnpm tsx scripts/smoke-<name>.ts`. The script's exit code is 0 on all-pass, 1 otherwise.
- **Type-level**: every task runs `pnpm typecheck && pnpm lint && pnpm build` at the verify step. Treat the build as the integration test.
- **Edge Functions**: `supabase functions serve` locally + curl to exercise the worker. Production verification happens in the final task (verification gate).
- **UI/Routes**: manual smoke per the per-task verify steps; the Phase 3 verification-gate task (Task 19) covers the 8-item end-to-end check.

If you find a real bug while writing a smoke script — fix it before committing.

---

## Task ordering rationale

Tasks 1–3 lay the foundation: deps, env, encryption, types, schema migrations (Drizzle + Supabase pg_cron). Each verifies via build + a quick smoke step.

Tasks 4–5 are pure logic (`rawg-match`, `merge`) with smoke-script coverage. They unblock the entire engine path because both Edge Functions and Server Actions import them.

Tasks 6–9 are the per-platform adapters and their HTTP entry routes — Steam (adapter + OpenID start + OpenID callback) and Xbox (adapter + connect route). Each adapter is verifiable in isolation against the live API with a manual curl.

Task 10 wires the Server Actions surface + status endpoint that the UI consumes.

Tasks 11–12 ship the two Edge Functions and deploy them. Manual local invoke verifies each.

Tasks 13–18 build the UI bottom-up: illustrations → PlatformCard → XboxConnectModal → ImportToast → ConnectionsSection → ImportSummary. By the end of Task 18 the dev can complete the full happy-path flow end-to-end on staging.

Task 19 integrates entry points (empty-state CTA, onboarding nudge).

Task 20 runs the 8-item verification gate, writes the gate document, and tags `phase-3-complete`.

---

## Task 1: Foundation — deps, env, encryption, adapter types

**Goal:** Install the one new dep (`openid`), add three env vars, ship the AES-GCM helper with a smoke script, and define the adapter interface that every subsequent task imports.

**Files:**
- Modify: `package.json` (+ `pnpm-lock.yaml` regenerated)
- Modify: `.env.example`
- Modify: `lib/env.ts`
- Create: `lib/imports/encryption.ts`
- Create: `lib/imports/adapters/types.ts`
- Create: `scripts/smoke-encryption.ts`

**Acceptance Criteria:**
- [ ] `pnpm list openid` lists a non-empty version
- [ ] `.env.example` has the three new keys under a `Library imports (Phase 3)` section
- [ ] `lib/env.ts` registers `STEAM_API_KEY`, `SUPABASE_FUNCTIONS_URL`, `IMPORT_ENCRYPTION_KEY` as `optionalString` / `optionalUrl`
- [ ] `lib/imports/encryption.ts` exports `encryptSecret(plaintext: string): string` and `decryptSecret(stored: string): string`; round-trip works on the smoke script
- [ ] `lib/imports/adapters/types.ts` exports `LibraryImporter`, `ImportedGame`, `ConnectInput`, `ConnectResult`, `PlatformKey` exactly as named in the spec
- [ ] `pnpm tsx scripts/smoke-encryption.ts` exits 0
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm tsx scripts/smoke-encryption.ts && pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Install the `openid` package**

```powershell
pnpm add openid
```

`openid` is the older OpenID 2.0 library, not `openid-client`. Steam uses OpenID 2.0, not OpenID Connect.

- [ ] **Step 2: Update `.env.example`**

Open `.env.example`. Find the end of the AI Providers block (just after `RESEND_API_KEY=`). Append:

```
# ─────────────────────────────────────────────────────────────
# Library imports (Phase 3+)
# Steam Web API: https://steamcommunity.com/dev/apikey (admin-only; user does not paste their own)
# Supabase Functions URL: https://<project>.supabase.co/functions/v1
# Encryption key: base64-encoded 32 bytes — generate with
#   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
# ─────────────────────────────────────────────────────────────
STEAM_API_KEY=
SUPABASE_FUNCTIONS_URL=
IMPORT_ENCRYPTION_KEY=
```

- [ ] **Step 3: Register the new server-side env vars in `lib/env.ts`**

Open `lib/env.ts`. Inside the `serverSchema` object, add three lines after `RESEND_API_KEY: optionalString,`:

```typescript
  STEAM_API_KEY: optionalString,
  SUPABASE_FUNCTIONS_URL: optionalUrl,
  IMPORT_ENCRYPTION_KEY: optionalString,
```

Inside the `serverSchema.parse({...})` call below, add three lines matching the existing pattern:

```typescript
  STEAM_API_KEY: process.env.STEAM_API_KEY,
  SUPABASE_FUNCTIONS_URL: process.env.SUPABASE_FUNCTIONS_URL,
  IMPORT_ENCRYPTION_KEY: process.env.IMPORT_ENCRYPTION_KEY,
```

- [ ] **Step 4: Create `lib/imports/encryption.ts`**

```typescript
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
```

- [ ] **Step 5: Create `lib/imports/adapters/types.ts`**

```typescript
import "server-only";

/** Stable internal platform identifiers. Matches lib/games/platform-mapping.ts. */
export type PlatformKey = "steam" | "xbox" | "psn" | "switch" | "pc";

/** What the user platform identifier looks like after a successful connect. */
export type ConnectInput =
  | { kind: "steam"; steamId: string }
  | { kind: "xbox"; openxblKey: string };

export interface ConnectResult {
  /** Steam: SteamID64. Xbox: XUID. */
  externalId: string;
  /** Xbox: the OpenXBL key (caller encrypts before storing). Steam: null. */
  accessTokenPlaintext: string | null;
  /** Cached for UI ("@gamertag · 207 games"). Best-effort. */
  displayHandle: string | null;
}

export interface ImportedGame {
  /** Steam appid as string / Xbox titleId. */
  externalId: string;
  title: string;
  /** Steam: playtime_forever / 60. Xbox: null (no playtime concept). */
  hoursPlayed: number | null;
  lastPlayedAt: Date | null;
  /** Optional hint to rawg-match. Year of original release. */
  releaseYear: number | null;
}

/** Persisted row from platform_connections we pass to adapters. */
export interface PlatformConnection {
  id: string;
  userId: string;
  platform: "steam" | "xbox" | "psn";
  externalId: string;
  /** Decrypted plaintext token; null for Steam. Caller decrypts before passing. */
  accessTokenPlaintext: string | null;
  lastSyncedAt: Date | null;
}

export interface LibraryImporter {
  /** Authenticate + return what we persist. */
  connect(input: ConnectInput): Promise<ConnectResult>;

  /**
   * Returns a chunk of games. With `since`, returns deltas only.
   * `nextCursor` is null when no more pages remain.
   */
  fetchLibrary(
    connection: PlatformConnection,
    options: { cursor?: string; since?: Date },
  ): Promise<{ games: ImportedGame[]; nextCursor: string | null }>;

  /** Revokes tokens / cleans up. No-op for Steam; clears stored key for Xbox. */
  disconnect(connection: PlatformConnection): Promise<void>;
}
```

- [ ] **Step 6: Create `scripts/smoke-encryption.ts`**

```typescript
/**
 * Smoke test for lib/imports/encryption.ts. Exercises round-trip + failure cases.
 *
 * Run: pnpm tsx scripts/smoke-encryption.ts
 * Exit 0 = all pass; exit 1 = any fail.
 */
import { randomBytes } from "node:crypto";

// Generate a one-shot key for this smoke run (don't depend on env)
process.env.IMPORT_ENCRYPTION_KEY = randomBytes(32).toString("base64");

// Late import so the env var is set before the module reads it
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
```

- [ ] **Step 7: Run the smoke script**

```powershell
pnpm tsx scripts/smoke-encryption.ts
```

Expected: `7/7 passed` and exit code 0.

- [ ] **Step 8: Verify build chain**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

Expected: all three green.

- [ ] **Step 9: Commit**

```powershell
git add package.json pnpm-lock.yaml .env.example lib/env.ts lib/imports/encryption.ts lib/imports/adapters/types.ts scripts/smoke-encryption.ts
git commit -m @'
feat(imports): foundation — deps, env, AES-GCM encryption, adapter types

Adds the openid npm package (for Steam OpenID 2.0). Registers three new
server-only env vars: STEAM_API_KEY, SUPABASE_FUNCTIONS_URL,
IMPORT_ENCRYPTION_KEY. Ships lib/imports/encryption.ts (AES-256-GCM
round-trip helpers with random IV per encrypt) and lib/imports/adapters/
types.ts (LibraryImporter interface + ImportedGame + ConnectInput/Result).

scripts/smoke-encryption.ts covers 7 cases including unicode, IV randomness,
and authTag-tampering detection. No test runner is installed; tsx smoke
scripts are the project's convention (matches Phase 2 + scripts/cleanup-*).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 2: Drizzle migration — additive columns on imports + logs

**Goal:** Update `lib/db/schema.ts` to add `imports.conflicts_jsonb`, `imports.unmatched_jsonb`, `imports.surfaced`, and `logs.platforms text[]`. Generate the migration, strip the auth.users gotcha if present, apply locally.

**Files:**
- Modify: `lib/db/schema.ts`
- Create: `lib/db/migrations/0003_*.sql` (Drizzle-generated)
- Modify: `lib/db/migrations/meta/*` (Drizzle-managed; commit as-is)

**Acceptance Criteria:**
- [ ] Generated migration adds three columns to `imports` and one to `logs` — no other table changes
- [ ] Generated migration contains NO `CREATE TABLE "auth"."users"` statement (or it's stripped before commit)
- [ ] `pnpm db:migrate` runs clean against local Supabase / staging
- [ ] `pnpm typecheck` after `lib/db/schema.ts` edit is clean
- [ ] New columns visible via `pnpm db:studio` or psql `\d imports` + `\d logs`

**Verify:** `pnpm db:migrate && pnpm typecheck && pnpm build`

**Steps:**

- [ ] **Step 1: Edit `lib/db/schema.ts` — additions to `imports` table**

Find the `imports` table definition (around line 342). Inside the columns object, add three new fields below `errorMessage`:

```typescript
  conflictsJsonb: jsonb("conflicts_jsonb").notNull().default(sql`'[]'::jsonb`),
  unmatchedJsonb: jsonb("unmatched_jsonb").notNull().default(sql`'[]'::jsonb`),
  surfaced: boolean("surfaced").notNull().default(true),
```

The full `imports` table should now look like:

```typescript
export const imports = pgTable("imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  platform: platformEnum("platform").notNull(),
  status: importStatusEnum("status").notNull().default("queued"),
  importedCount: integer("imported_count").notNull().default(0),
  totalCount: integer("total_count").notNull().default(0),
  errorMessage: text("error_message"),
  conflictsJsonb: jsonb("conflicts_jsonb").notNull().default(sql`'[]'::jsonb`),
  unmatchedJsonb: jsonb("unmatched_jsonb").notNull().default(sql`'[]'::jsonb`),
  surfaced: boolean("surfaced").notNull().default(true),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Edit `lib/db/schema.ts` — add `platforms` to `logs` table**

Find the `logs` table definition (around line 133). Inside the columns object, add a new field right after `platformPlayedOn`:

```typescript
    platforms: text("platforms").array(),
```

The relevant slice:

```typescript
    platformPlayedOn: text("platform_played_on"),
    platforms: text("platforms").array(),
    isReplay: boolean("is_replay").notNull().default(false),
```

Leave `platformPlayedOn` in place — Phase 3 dual-writes; the cleanup happens in a later phase.

- [ ] **Step 3: Generate the migration**

```powershell
pnpm db:generate
```

Expected: a new file at `lib/db/migrations/0003_<adjective>_<noun>.sql` (Drizzle auto-names) and an updated `lib/db/migrations/meta/_journal.json`.

- [ ] **Step 4: Inspect the generated migration**

```powershell
Get-ChildItem lib/db/migrations -Name "0003_*.sql"
Get-Content (Get-ChildItem lib/db/migrations -Name "0003_*.sql" | Select-Object -First 1 -ExpandProperty Name | ForEach-Object { "lib/db/migrations/$_" })
```

The file should contain ONLY:

```sql
ALTER TABLE "imports" ADD COLUMN "conflicts_jsonb" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "unmatched_jsonb" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "surfaced" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "logs" ADD COLUMN "platforms" text[];
```

If you see ANY other statement — especially `CREATE TABLE "auth"."users"` — STOP. Open the file in an editor and strip it. Confirmed gotcha per [memory/feedback_drizzle_auth_users_gotcha.md](../../memory/feedback_drizzle_auth_users_gotcha.md). Re-grep with:

```powershell
Select-String -Path "lib/db/migrations/0003_*.sql" -Pattern 'CREATE TABLE "auth"."users"'
```

Expected: no output (no match).

- [ ] **Step 5: Apply the migration**

```powershell
pnpm db:migrate
```

Expected: `[✓] applying migrations...` and exit 0.

- [ ] **Step 6: Spot-check column existence**

If you have Supabase MCP access, use it to confirm. Otherwise, open Supabase dashboard → SQL Editor and run:

```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'imports'
  AND column_name IN ('conflicts_jsonb', 'unmatched_jsonb', 'surfaced')
ORDER BY column_name;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'logs' AND column_name = 'platforms';
```

Expected: four rows returned, types `jsonb`, `jsonb`, `boolean`, `ARRAY` (text[]).

- [ ] **Step 7: Verify build chain**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

Expected: all three green.

- [ ] **Step 8: Commit**

```powershell
git add lib/db/schema.ts lib/db/migrations
git commit -m @'
feat(imports): additive schema — imports.{conflicts,unmatched,surfaced} + logs.platforms

Phase 3 schema additions, fully additive — no destructive changes:

- imports.conflicts_jsonb  — merged-log record per import: [{logId,gameId,rule}]
- imports.unmatched_jsonb  — RAWG-miss record: [{externalId,title,platform}]
- imports.surfaced         — boolean; false only for cron-driven syncs awaiting toast
- logs.platforms text[]    — multi-platform tracking. Dual-write with the
                             legacy logs.platform_played_on column. Cleanup is
                             a later-phase concern (5+).

Migration 0003 verified clean of the auth.users gotcha.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 3: Supabase pg_cron migration — schedule daily-sync

**Goal:** Create a Supabase-only migration (not Drizzle-managed) that enables `pg_cron` + `pg_net` extensions and schedules the daily-sync Edge Function call. Apply via Supabase MCP or dashboard.

**Files:**
- Create: `supabase/migrations/20260511_0001_phase3_cron.sql`
- Modify: nothing else (this migration is intentionally separate from Drizzle's chain)

**Acceptance Criteria:**
- [ ] `supabase/migrations/20260511_0001_phase3_cron.sql` exists with `CREATE EXTENSION` for pg_cron + pg_net and a `cron.schedule(...)` call
- [ ] Migration is applied on the live Supabase project (verifiable via `SELECT * FROM cron.job;`)
- [ ] Two GUCs set on the database: `app.supabase_functions_url` and `app.supabase_service_role_key`
- [ ] `cron.job` table contains a row with `jobname='daily-import-sync'` and `schedule='0 4 * * *'`

**Verify:** SQL query in Supabase dashboard:

```sql
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'daily-import-sync';
```

Expected: 1 row, `active=true`.

**Steps:**

- [ ] **Step 1: Create the `supabase/` directory structure**

```powershell
New-Item -ItemType Directory -Path supabase/migrations -Force | Out-Null
```

- [ ] **Step 2: Write the migration file**

Create `supabase/migrations/20260511_0001_phase3_cron.sql`:

```sql
-- Phase 3 — pg_cron + pg_net + daily-sync scheduling
-- This migration is Supabase-applied directly (NOT Drizzle-managed) because
-- pg_cron + pg_net are Supabase extensions that Drizzle introspection does
-- not model. Apply via Supabase MCP (apply_migration) or the dashboard.

-- 1. Enable required extensions (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. GUCs (database-level config). Set externally; see notes below if not
--    already present.

-- 3. Schedule the daily-sync edge function call
SELECT cron.schedule(
  'daily-import-sync',
  '0 4 * * *',                       -- 04:00 UTC daily
  $$
    SELECT net.http_post(
      url     := current_setting('app.supabase_functions_url') || '/daily-sync',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key'),
        'Content-Type',  'application/json'
      ),
      body    := '{}'::jsonb
    ) AS request_id;
  $$
);

-- One-time GUC setup (run manually if not already done):
--   ALTER DATABASE postgres SET app.supabase_functions_url = 'https://<project>.supabase.co/functions/v1';
--   ALTER DATABASE postgres SET app.supabase_service_role_key = '<service-role-key>';
-- After ALTER DATABASE, reconnect for the new GUC to take effect.
```

- [ ] **Step 3: Set the GUCs on the database**

You need the Supabase service-role key (already stored as `SUPABASE_SERVICE_ROLE_KEY` env) and the functions URL.

In Supabase dashboard → SQL Editor (or via Supabase MCP `execute_sql`):

```sql
ALTER DATABASE postgres SET app.supabase_functions_url = 'https://<your-project-ref>.supabase.co/functions/v1';
ALTER DATABASE postgres SET app.supabase_service_role_key = '<your-service-role-key>';
```

Replace placeholders with real values from your project's `.env.local`. **The service-role key is sensitive — do not paste it into the committed migration file.**

- [ ] **Step 4: Apply the migration**

Option A — via Supabase MCP (preferred):

```
mcp__supabase__apply_migration with name='phase3_cron' and the SQL from step 2
```

Option B — via Supabase dashboard SQL Editor: paste the contents of `supabase/migrations/20260511_0001_phase3_cron.sql` and run.

Either way, the migration is idempotent (`CREATE EXTENSION IF NOT EXISTS`, `cron.schedule` overwrites by name).

- [ ] **Step 5: Verify the cron job is scheduled**

In Supabase dashboard SQL Editor:

```sql
SELECT jobid, jobname, schedule, active, database FROM cron.job WHERE jobname = 'daily-import-sync';
```

Expected: 1 row with `jobname='daily-import-sync'`, `schedule='0 4 * * *'`, `active=true`.

- [ ] **Step 6: Dry-run the scheduled body manually (optional, recommended)**

```sql
SELECT net.http_post(
  url     := current_setting('app.supabase_functions_url') || '/daily-sync',
  headers := jsonb_build_object(
    'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key'),
    'Content-Type',  'application/json'
  ),
  body    := '{}'::jsonb
);
```

This will fail until Task 12 deploys the `daily-sync` Edge Function — that's fine. What you're verifying here is that the GUCs are readable and `net.http_post` works at all. Expected: it returns a `request_id` integer (not an error about missing settings or extension).

If it errors with `unrecognized configuration parameter "app.supabase_functions_url"`, repeat Step 3 and reconnect.

- [ ] **Step 7: Commit**

```powershell
git add supabase/migrations/20260511_0001_phase3_cron.sql
git commit -m @'
feat(imports): supabase pg_cron migration for daily-sync schedule

Enables pg_cron + pg_net extensions and schedules a daily 04:00 UTC call to
the /daily-sync Edge Function. Not Drizzle-managed because Drizzle's
introspection does not model Supabase extensions; this migration lives under
supabase/migrations/ alongside future Supabase-only migrations.

Two database GUCs (app.supabase_functions_url, app.supabase_service_role_key)
must be set externally — the migration file documents the ALTER DATABASE
syntax but does not include the secret values.

The Edge Function itself is not deployed yet (Task 12); the cron entry fires
into a 404 until then. Harmless.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 4: Pure logic — rawg-match.ts

**Goal:** Ship `lib/imports/rawg-match.ts` — a pure function that takes an `ImportedGame` and returns a matched `games.id` (or `null`). Resolution order: normalized-title exact → alias exact → ILIKE prefix → ILIKE prefix + releaseYear. Smoke-tested via `scripts/smoke-rawg-match.ts`.

**Files:**
- Create: `lib/imports/rawg-match.ts`
- Create: `scripts/smoke-rawg-match.ts`

**Acceptance Criteria:**
- [ ] `matchToRawg(imported)` returns the existing `games.id` for: exact normalized title, alias hit, single-candidate prefix hit, multi-candidate disambiguated by `releaseYear`
- [ ] Returns `null` for non-matching titles ("Made Up Bootleg Game 9000")
- [ ] `normalizeTitle()` is exported via a `__testing__` object for the smoke script
- [ ] Smoke script PASSes 10 normalize cases
- [ ] No DB writes — function is read-only over `games` + `game_aliases`
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm tsx scripts/smoke-rawg-match.ts && pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Create `lib/imports/rawg-match.ts`**

```typescript
import "server-only";
import { ilike, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { gameAliases, games } from "@/lib/db/schema";

import type { ImportedGame } from "./adapters/types";

const EDITION_PATTERNS = [
  /\s*[-–:]\s*(definitive|complete|deluxe|game of the year|goty|gold|remastered|enhanced|director'?s cut|special|premium|legendary|ultimate)\s+edition$/i,
  /\s*\(remastered\)$/i,
  /\s*\(goty\)$/i,
];

export function normalizeTitle(raw: string): string {
  let t = raw.toLowerCase().trim();
  for (const pattern of EDITION_PATTERNS) t = t.replace(pattern, "");
  t = t.replace(/[\p{P}\p{S}]/gu, " ").replace(/\s+/g, " ").trim();
  return t;
}

export async function matchToRawg(imported: ImportedGame): Promise<number | null> {
  const normalized = normalizeTitle(imported.title);
  if (!normalized) return null;

  // 1. Exact match on normalized title
  const exact = await db.select({ id: games.id }).from(games)
    .where(sql`lower(${games.title}) = ${normalized}`).limit(1);
  if (exact.length > 0) return exact[0].id;

  // 2. Alias match
  const alias = await db.select({ id: gameAliases.gameId }).from(gameAliases)
    .where(sql`lower(${gameAliases.alias}) = ${normalized}`).limit(1);
  if (alias.length > 0) return alias[0].id;

  // 3. ILIKE prefix
  const prefix = await db.select({ id: games.id, title: games.title, released: games.released })
    .from(games).where(ilike(games.title, `${normalized}%`)).limit(5);
  if (prefix.length === 1) return prefix[0].id;

  // 4. Disambiguate by releaseYear
  if (imported.releaseYear && prefix.length > 1) {
    const byYear = prefix.find((row) => row.released?.getFullYear() === imported.releaseYear);
    if (byYear) return byYear.id;
  }

  return null;
}

export const __testing__ = { normalizeTitle };
```

- [ ] **Step 2: Create `scripts/smoke-rawg-match.ts`**

```typescript
/**
 * Smoke for normalizeTitle (pure). DB-backed matchToRawg is verified
 * via Task 11's import test.
 */
import { __testing__ } from "../lib/imports/rawg-match";
const { normalizeTitle } = __testing__;

const checks = [
  { name: "basic lowercase", input: "Hades", expect: "hades" },
  { name: "trim", input: "  Hades  ", expect: "hades" },
  { name: "strip punctuation", input: "Half-Life 2: Lost Coast", expect: "half life 2 lost coast" },
  { name: "edition: definitive", input: "Hades - Definitive Edition", expect: "hades" },
  { name: "edition: GOTY", input: "Skyrim: Game of the Year Edition", expect: "skyrim" },
  { name: "edition: legendary", input: "Mass Effect Legendary Edition", expect: "mass effect" },
  { name: "edition: parens GOTY", input: "Fallout: New Vegas (GOTY)", expect: "fallout new vegas" },
  { name: "unicode preserved", input: "Pokémon Red", expect: "pokémon red" },
  { name: "collapse whitespace", input: "Half   Life   2", expect: "half life 2" },
  { name: "all-punct → empty", input: "!!!", expect: "" },
];

let pass = 0, fail = 0;
for (const { name, input, expect } of checks) {
  const got = normalizeTitle(input);
  if (got === expect) { pass++; console.log(`  PASS  ${name}  →  "${got}"`); }
  else { fail++; console.log(`  FAIL  ${name}  →  expected "${expect}", got "${got}"`); }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 3: Run smoke + build chain**

```powershell
pnpm tsx scripts/smoke-rawg-match.ts; if ($?) { pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } } }
```

Expected: `10/10 passed`, build chain clean.

- [ ] **Step 4: Commit**

```powershell
git add lib/imports/rawg-match.ts scripts/smoke-rawg-match.ts
git commit -m @'
feat(imports): rawg-match — local-only title resolution

Pure function: ImportedGame → matched games.id (or null). Order:
normalized-title exact → game_aliases.alias exact → ILIKE prefix
single-match → ILIKE prefix + releaseYear disambiguation.

normalizeTitle strips edition suffixes (Definitive, GOTY, Remastered,
Legendary, …) and punctuation. RAWG API fetch is intentionally out of
scope — misses surface as `unmatched_jsonb` on the import row.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 5: Pure logic — merge.ts (high-risk; exhaustive smoke)

**Goal:** Ship `lib/imports/merge.ts` — the pure conflict-merge function. Users' manual data is never overwritten; platforms are unioned; hoursPlayed takes the max with null-safety. 12-case smoke script is the production safety net for user-data integrity.

**Files:**
- Create: `lib/imports/merge.ts`
- Create: `scripts/smoke-merge.ts`

**Acceptance Criteria:**
- [ ] `mergeImportedGame()` returns `{ action: 'insert', row }` or `{ action: 'update', logId, set, rule }`
- [ ] Never sets `status`, `rating`, `startedAt`, `finishedAt`, `notes`, `isReplay`, `isPrivate` on update
- [ ] Unions `platforms[]` (deduped) and falls back to legacy `platformPlayedOn` if `platforms` is null
- [ ] `hoursPlayed`: max-of, with `null + null → null` (not 0)
- [ ] Insert defaults to `status='backlog'`, dual-writes `platforms=[platform]` + `platformPlayedOn=platform`
- [ ] Smoke script passes 12/12
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm tsx scripts/smoke-merge.ts && pnpm typecheck && pnpm build`

**Steps:**

- [ ] **Step 1: Create `lib/imports/merge.ts`**

```typescript
import "server-only";

import type { ImportedGame, PlatformKey } from "./adapters/types";

export type ConflictRule = "platform_merge";

export interface NewLogPayload {
  gameId: number;
  status: "backlog";
  platforms: string[];
  platformPlayedOn: string;
  hoursPlayed: number | null;
}

export interface ExistingLog {
  id: string;
  platforms: string[] | null;
  platformPlayedOn: string | null;
  hoursPlayed: number | null;
}

export type MergeResult =
  | { action: "insert"; row: NewLogPayload }
  | {
      action: "update";
      logId: string;
      set: { platforms: string[]; hoursPlayed: number | null };
      rule: ConflictRule;
    };

/**
 * Pure conflict-merge. User data wins; platforms union; hoursPlayed max.
 * See spec § Flow C for the rule table.
 */
export function mergeImportedGame(
  imported: ImportedGame & { gameId: number },
  existing: ExistingLog | null,
  platform: PlatformKey,
): MergeResult {
  if (!existing) {
    return {
      action: "insert",
      row: {
        gameId: imported.gameId,
        status: "backlog",
        platforms: [platform],
        platformPlayedOn: platform,
        hoursPlayed: imported.hoursPlayed,
      },
    };
  }

  const existingPlatforms =
    existing.platforms ??
    (existing.platformPlayedOn ? [existing.platformPlayedOn] : []);
  const mergedPlatforms = Array.from(new Set([...existingPlatforms, platform]));

  const bothNull = existing.hoursPlayed == null && imported.hoursPlayed == null;
  const mergedHours = bothNull
    ? null
    : Math.max(existing.hoursPlayed ?? 0, imported.hoursPlayed ?? 0);

  return {
    action: "update",
    logId: existing.id,
    set: { platforms: mergedPlatforms, hoursPlayed: mergedHours },
    rule: "platform_merge",
  };
}
```

- [ ] **Step 2: Create `scripts/smoke-merge.ts` — 12 exhaustive cases**

```typescript
/**
 * Exhaustive smoke for lib/imports/merge.ts. The single highest-risk pure
 * function in Phase 3 — a bug here = user data clobbered.
 */
import {
  mergeImportedGame,
  type ExistingLog,
  type MergeResult,
} from "../lib/imports/merge";
import type { ImportedGame, PlatformKey } from "../lib/imports/adapters/types";

function ig(o: Partial<ImportedGame & { gameId: number }> = {}): ImportedGame & { gameId: number } {
  return { gameId: 1, externalId: "100", title: "Hades", hoursPlayed: 12.5, lastPlayedAt: null, releaseYear: 2020, ...o };
}
function el(o: Partial<ExistingLog> = {}): ExistingLog {
  return { id: "log-uuid-1", platforms: ["pc"], platformPlayedOn: "pc", hoursPlayed: 30, ...o };
}

interface Case {
  name: string;
  imported: ImportedGame & { gameId: number };
  existing: ExistingLog | null;
  platform: PlatformKey;
  check: (r: MergeResult) => void;
}

const cases: Case[] = [
  {
    name: "no existing → insert at backlog with dual-write platforms",
    imported: ig({ hoursPlayed: 5 }), existing: null, platform: "steam",
    check: (r) => {
      if (r.action !== "insert") throw new Error("expected insert");
      if (r.row.status !== "backlog") throw new Error("status not backlog");
      if (r.row.platforms.join(",") !== "steam") throw new Error("platforms wrong");
      if (r.row.platformPlayedOn !== "steam") throw new Error("platformPlayedOn wrong");
      if (r.row.hoursPlayed !== 5) throw new Error("hoursPlayed lost");
    },
  },
  {
    name: "manual log (PC) + steam import → update with unioned platforms, max hours",
    imported: ig({ hoursPlayed: 12 }), existing: el({ platforms: ["pc"], platformPlayedOn: "pc", hoursPlayed: 30 }), platform: "steam",
    check: (r) => {
      if (r.action !== "update") throw new Error("expected update");
      if (!r.set.platforms.includes("pc") || !r.set.platforms.includes("steam")) throw new Error("missing platform");
      if (r.set.platforms.length !== 2) throw new Error("dedup failed");
      if (r.set.hoursPlayed !== 30) throw new Error("should take max 30");
      if (r.rule !== "platform_merge") throw new Error("wrong rule");
    },
  },
  {
    name: "existing on steam + steam re-import → no platform duplication",
    imported: ig(), existing: el({ platforms: ["steam"], platformPlayedOn: "steam" }), platform: "steam",
    check: (r) => {
      if (r.action !== "update") throw new Error("expected update");
      if (r.set.platforms.length !== 1 || r.set.platforms[0] !== "steam") throw new Error("dedup wrong");
    },
  },
  {
    name: "existing platforms=null + platformPlayedOn → migrates legacy to array on merge",
    imported: ig(), existing: el({ platforms: null, platformPlayedOn: "pc" }), platform: "steam",
    check: (r) => {
      if (r.action !== "update") throw new Error("expected update");
      if (!r.set.platforms.includes("pc") || !r.set.platforms.includes("steam")) throw new Error("missing platform");
    },
  },
  {
    name: "existing both null + import platform → result [platform]",
    imported: ig(), existing: el({ platforms: null, platformPlayedOn: null, hoursPlayed: null }), platform: "xbox",
    check: (r) => {
      if (r.action !== "update") throw new Error("expected update");
      if (r.set.platforms.join(",") !== "xbox") throw new Error("platforms wrong");
    },
  },
  {
    name: "hours: existing 30, imported 12 → keep 30",
    imported: ig({ hoursPlayed: 12 }), existing: el({ hoursPlayed: 30 }), platform: "steam",
    check: (r) => { if (r.action !== "update" || r.set.hoursPlayed !== 30) throw new Error(`got ${r.action === "update" ? r.set.hoursPlayed : "insert"}`); },
  },
  {
    name: "hours: existing 5, imported 50 → take 50",
    imported: ig({ hoursPlayed: 50 }), existing: el({ hoursPlayed: 5 }), platform: "steam",
    check: (r) => { if (r.action !== "update" || r.set.hoursPlayed !== 50) throw new Error("hours not promoted"); },
  },
  {
    name: "hours: existing null, imported 7 → take 7",
    imported: ig({ hoursPlayed: 7 }), existing: el({ hoursPlayed: null }), platform: "steam",
    check: (r) => { if (r.action !== "update" || r.set.hoursPlayed !== 7) throw new Error("hours wrong"); },
  },
  {
    name: "hours: existing 7, imported null → keep 7",
    imported: ig({ hoursPlayed: null }), existing: el({ hoursPlayed: 7 }), platform: "steam",
    check: (r) => { if (r.action !== "update" || r.set.hoursPlayed !== 7) throw new Error("hours wrong"); },
  },
  {
    name: "hours: both null → result null (NOT 0)",
    imported: ig({ hoursPlayed: null }), existing: el({ hoursPlayed: null }), platform: "steam",
    check: (r) => { if (r.action !== "update" || r.set.hoursPlayed !== null) throw new Error(`expected null, got ${r.action === "update" ? r.set.hoursPlayed : "insert"}`); },
  },
  {
    name: "insert with null hoursPlayed → null preserved (not 0)",
    imported: ig({ hoursPlayed: null }), existing: null, platform: "xbox",
    check: (r) => { if (r.action !== "insert" || r.row.hoursPlayed !== null) throw new Error("hours not null"); },
  },
  {
    name: "merge set contains ONLY platforms + hoursPlayed (status/rating/notes never touched)",
    imported: ig(), existing: el(), platform: "steam",
    check: (r) => {
      if (r.action !== "update") throw new Error("expected update");
      const keys = Object.keys(r.set).sort();
      const expected = ["hoursPlayed", "platforms"].sort();
      if (keys.length !== expected.length || !keys.every((k, i) => k === expected[i])) {
        throw new Error(`unexpected set keys: ${keys.join(",")}`);
      }
    },
  },
];

let pass = 0, fail = 0;
for (const c of cases) {
  try { c.check(mergeImportedGame(c.imported, c.existing, c.platform)); pass++; console.log(`  PASS  ${c.name}`); }
  catch (err) { fail++; console.log(`  FAIL  ${c.name}  —  ${(err as Error).message}`); }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 3: Run smoke + build**

```powershell
pnpm tsx scripts/smoke-merge.ts; if ($?) { pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } } }
```

Expected: `12/12 passed`, build chain clean.

- [ ] **Step 4: Commit**

```powershell
git add lib/imports/merge.ts scripts/smoke-merge.ts
git commit -m @'
feat(imports): merge.ts — pure conflict-resolution function

Highest-risk pure function in Phase 3. 12-case smoke covers every rule
from spec § Flow C: user data never overwritten; platforms unioned;
hoursPlayed max-of with null-safe handling (null + null → null, NOT 0);
legacy platformPlayedOn migrates to array on merge.

set object on update contains ONLY {platforms, hoursPlayed} — status,
rating, notes, finishedAt, isReplay, isPrivate stay untouched.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 6: Steam adapter

**Goal:** Implement `lib/imports/adapters/steam.ts` — the Steam side of `LibraryImporter`. Handles `connect()` (post-OpenID-verify, just stores SteamID), `fetchLibrary()` (Steam Web API `GetOwnedGames`, supports delta via `playtime_2weeks`), and `disconnect()` (no-op).

**Files:**
- Create: `lib/imports/adapters/steam.ts`
- Create: `scripts/smoke-steam-adapter.ts` (live API call — needs `STEAM_API_KEY` + a known SteamID env)

**Acceptance Criteria:**
- [ ] `class SteamAdapter implements LibraryImporter` exported as a singleton: `export const steamAdapter = new SteamAdapter()`
- [ ] `connect({ kind: 'steam', steamId })` returns `{ externalId: steamId, accessTokenPlaintext: null, displayHandle }` — fetches persona name from `GetPlayerSummaries` for `displayHandle`; if that fails, returns `displayHandle: null`
- [ ] `fetchLibrary(conn, { since })` returns all games (one page, `nextCursor: null`) — when `since` is set, filter to games where `playtime_2weeks > 0` OR appid not seen in our DB before (the latter is the engine's job, not the adapter's — adapter just returns the raw set)
- [ ] When `since` is set: filter games to only those with `playtime_2weeks > 0` (the engine handles new-appid detection separately by checking against existing logs)
- [ ] `disconnect()` is a no-op (Steam has no token to revoke)
- [ ] 429 from Steam → throw `SteamRateLimitError`; 4xx → throw `SteamPrivateProfileError` if profile is private (Steam returns empty `games` array — detect by absence + `GetPlayerSummaries.communityvisibilitystate < 3`); 5xx → throw generic `SteamApiError`
- [ ] Smoke script (live API) returns ≥1 game for a known public SteamID
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm tsx scripts/smoke-steam-adapter.ts && pnpm typecheck && pnpm build`

**Steps:**

- [ ] **Step 1: Create `lib/imports/adapters/steam.ts`**

Implementation skeleton — the executor fills in the fetch details:

```typescript
import "server-only";
import { requireEnv } from "@/lib/env";
import type {
  ConnectInput, ConnectResult, ImportedGame, LibraryImporter, PlatformConnection,
} from "./types";

const STEAM_API = "https://api.steampowered.com";

export class SteamRateLimitError extends Error { name = "SteamRateLimitError"; }
export class SteamPrivateProfileError extends Error { name = "SteamPrivateProfileError"; }
export class SteamApiError extends Error { name = "SteamApiError"; }

interface SteamOwnedGame {
  appid: number;
  name: string;
  playtime_forever: number;     // minutes
  playtime_2weeks?: number;
  rtime_last_played?: number;   // unix seconds
}

class SteamAdapter implements LibraryImporter {
  async connect(input: ConnectInput): Promise<ConnectResult> {
    if (input.kind !== "steam") throw new Error("SteamAdapter expects kind='steam'");
    const apiKey = requireEnv("STEAM_API_KEY");
    // Best-effort persona lookup
    let displayHandle: string | null = null;
    try {
      const url = `${STEAM_API}/ISteamUser/GetPlayerSummaries/v2/?key=${apiKey}&steamids=${input.steamId}`;
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        const json = await res.json() as { response: { players: Array<{ personaname?: string; communityvisibilitystate?: number }> } };
        displayHandle = json.response.players[0]?.personaname ?? null;
      }
    } catch {
      // Swallow — displayHandle is optional
    }
    return { externalId: input.steamId, accessTokenPlaintext: null, displayHandle };
  }

  async fetchLibrary(
    connection: PlatformConnection,
    options: { cursor?: string; since?: Date },
  ): Promise<{ games: ImportedGame[]; nextCursor: string | null }> {
    const apiKey = requireEnv("STEAM_API_KEY");
    const url =
      `${STEAM_API}/IPlayerService/GetOwnedGames/v1/?key=${apiKey}` +
      `&steamid=${connection.externalId}` +
      `&include_appinfo=1&include_played_free_games=1`;

    const res = await fetch(url, { cache: "no-store" });
    if (res.status === 429) throw new SteamRateLimitError("Steam Web API rate-limited");
    if (!res.ok) throw new SteamApiError(`Steam API ${res.status}`);

    const json = (await res.json()) as { response: { games?: SteamOwnedGame[] } };
    const rawGames = json.response.games ?? [];

    // Private profile heuristic: GetOwnedGames returns no games property at all
    // for fully-private profiles. Detect via GetPlayerSummaries fallback.
    if (rawGames.length === 0 && !("games" in json.response)) {
      const probe = await fetch(
        `${STEAM_API}/ISteamUser/GetPlayerSummaries/v2/?key=${apiKey}&steamids=${connection.externalId}`,
      );
      if (probe.ok) {
        const p = (await probe.json()) as { response: { players: Array<{ communityvisibilitystate?: number }> } };
        const vis = p.response.players[0]?.communityvisibilitystate;
        if (vis !== undefined && vis < 3) throw new SteamPrivateProfileError("Steam profile is not public");
      }
    }

    // Delta mode: keep only games with recent 2-week activity. New-appid detection
    // is the engine's job (it checks against existing logs).
    let games = rawGames;
    if (options.since) {
      games = rawGames.filter((g) => (g.playtime_2weeks ?? 0) > 0);
    }

    const imported: ImportedGame[] = games.map((g) => ({
      externalId: String(g.appid),
      title: g.name,
      hoursPlayed: g.playtime_forever > 0 ? +(g.playtime_forever / 60).toFixed(1) : null,
      lastPlayedAt: g.rtime_last_played ? new Date(g.rtime_last_played * 1000) : null,
      releaseYear: null,
    }));

    // Steam GetOwnedGames is one-shot — no pagination needed.
    return { games: imported, nextCursor: null };
  }

  async disconnect(_connection: PlatformConnection): Promise<void> {
    // No-op — Steam has no token to revoke; we only stored the SteamID.
  }
}

export const steamAdapter: LibraryImporter = new SteamAdapter();
```

- [ ] **Step 2: Create `scripts/smoke-steam-adapter.ts`** (live API)

```typescript
/**
 * Live smoke for Steam adapter. Requires:
 *   STEAM_API_KEY  — admin key
 *   SMOKE_STEAMID  — a known public SteamID64 (your own works)
 *
 * Run: pnpm tsx scripts/smoke-steam-adapter.ts
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

const { steamAdapter } = await import("../lib/imports/adapters/steam");

const steamId = process.env.SMOKE_STEAMID;
if (!steamId) { console.error("Set SMOKE_STEAMID env"); process.exit(1); }

const connect = await steamAdapter.connect({ kind: "steam", steamId });
console.log("connect:", connect);

const lib = await steamAdapter.fetchLibrary(
  { id: "x", userId: "x", platform: "steam", externalId: steamId, accessTokenPlaintext: null, lastSyncedAt: null },
  {},
);
console.log(`fetchLibrary full: ${lib.games.length} games`);
console.log("sample:", lib.games.slice(0, 3));

const delta = await steamAdapter.fetchLibrary(
  { id: "x", userId: "x", platform: "steam", externalId: steamId, accessTokenPlaintext: null, lastSyncedAt: new Date() },
  { since: new Date() },
);
console.log(`fetchLibrary delta (2-week active): ${delta.games.length} games`);

if (lib.games.length === 0) { console.error("FAIL: expected ≥1 game"); process.exit(1); }
console.log("\nPASS");
```

- [ ] **Step 3: Run smoke + build** (smoke requires STEAM_API_KEY + SMOKE_STEAMID in `.env.local`)

```powershell
pnpm tsx scripts/smoke-steam-adapter.ts; if ($?) { pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } } }
```

Expected: at least 1 game returned for the test SteamID, build clean.

- [ ] **Step 4: Commit**

```powershell
git add lib/imports/adapters/steam.ts scripts/smoke-steam-adapter.ts
git commit -m @'
feat(imports): steam adapter — GetOwnedGames + persona lookup

Implements LibraryImporter for Steam:
- connect() stores SteamID, best-effort persona via GetPlayerSummaries
- fetchLibrary() pulls full library via GetOwnedGames (one-shot, no pagination)
- Delta mode filters by playtime_2weeks > 0
- Private-profile detection via communityvisibilitystate < 3
- Typed error classes: SteamRateLimitError, SteamPrivateProfileError, SteamApiError
- disconnect() is a no-op (no token to revoke)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 7: Steam OpenID routes — `/api/auth/steam` + callback

**Goal:** Wire the two HTTP routes that drive Steam OpenID 2.0: `route.ts` constructs and redirects to Steam's OpenID provider; `callback/route.ts` verifies the response (signature + `check_authentication` + `return_to` strict match), upserts the connection, and triggers the first import.

**Files:**
- Create: `app/api/auth/steam/route.ts`
- Create: `app/api/auth/steam/callback/route.ts`

**Acceptance Criteria:**
- [ ] `GET /api/auth/steam` (authenticated user) redirects 302 to a `steamcommunity.com/openid/login?...` URL with `openid.return_to` == `${NEXT_PUBLIC_APP_URL}/api/auth/steam/callback`
- [ ] `GET /api/auth/steam/callback` validates: (a) `openid.return_to` exactly matches the URL above, (b) re-POSTs to Steam's `check_authentication` and confirms `is_valid:true`, (c) extracts SteamID64 from `openid.identity` (suffix after `/id/`)
- [ ] On valid response: upserts `platform_connections` row (uses Drizzle `.onConflictDoUpdate` against the `(user_id, platform)` unique index), inserts `imports` row with `status='queued'` + `surfaced=true`, fire-and-forget POSTs to `${SUPABASE_FUNCTIONS_URL}/import-platform`, redirects to `/library/import/<importId>`
- [ ] On invalid response: 401 with a brief error page or redirect back to `/settings#connections` with an `?error=steam_openid_failed` query param
- [ ] Unauthenticated request to either route → 401
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** Manual: open `/api/auth/steam` while logged in → completes round-trip → lands on `/library/import/<importId>` skeleton.

**Steps:**

- [ ] **Step 1: Create `app/api/auth/steam/route.ts`**

```typescript
import { NextResponse } from "next/server";
import openid from "openid";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCachedUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const realm = env.NEXT_PUBLIC_APP_URL;
  const returnUrl = `${realm}/api/auth/steam/callback`;
  const relyingParty = new openid.RelyingParty(
    returnUrl,
    realm,
    true,           // stateless mode — no session storage
    false,          // strict mode off (Steam's OpenID realm is `https://steamcommunity.com/openid`)
    [],
  );

  return await new Promise<NextResponse>((resolve) => {
    relyingParty.authenticate(
      "https://steamcommunity.com/openid",
      false,
      (err, authUrl) => {
        if (err || !authUrl) {
          console.error("Steam OpenID start failed:", err);
          resolve(NextResponse.redirect(`${realm}/settings?error=steam_openid_start`));
          return;
        }
        resolve(NextResponse.redirect(authUrl));
      },
    );
  });
}
```

- [ ] **Step 2: Create `app/api/auth/steam/callback/route.ts`**

```typescript
import { NextResponse, type NextRequest } from "next/server";
import openid from "openid";
import { eq, and } from "drizzle-orm";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import { db } from "@/lib/db";
import { platformConnections, imports } from "@/lib/db/schema";
import { env, requireEnv } from "@/lib/env";
import { steamAdapter } from "@/lib/imports/adapters/steam";

export const dynamic = "force-dynamic";

const STEAMID_RE = /\/openid\/id\/(\d+)$/;

export async function GET(req: NextRequest) {
  const user = await getCachedUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const realm = env.NEXT_PUBLIC_APP_URL;
  const returnUrl = `${realm}/api/auth/steam/callback`;

  // Strict return_to match — the response's return_to must equal what we sent.
  const responseReturnTo = req.nextUrl.searchParams.get("openid.return_to");
  if (responseReturnTo !== returnUrl) {
    return NextResponse.redirect(`${realm}/settings?error=steam_return_to_mismatch`);
  }

  const relyingParty = new openid.RelyingParty(returnUrl, realm, true, false, []);

  const verified = await new Promise<openid.VerifyResult | null>((resolve) => {
    relyingParty.verifyAssertion(req.url, (err, result) => {
      if (err || !result?.authenticated) { resolve(null); return; }
      resolve(result);
    });
  });
  if (!verified) {
    return NextResponse.redirect(`${realm}/settings?error=steam_openid_verify_failed`);
  }

  const claimedId = verified.claimedIdentifier;
  const match = claimedId?.match(STEAMID_RE);
  if (!match) {
    return NextResponse.redirect(`${realm}/settings?error=steam_id_extract_failed`);
  }
  const steamId = match[1];

  // Best-effort persona fetch
  const connectResult = await steamAdapter.connect({ kind: "steam", steamId });

  // Upsert platform_connections
  await db.insert(platformConnections).values({
    userId: user.id,
    platform: "steam",
    externalId: steamId,
    accessTokenEncrypted: null,
    refreshTokenEncrypted: null,
    isActive: true,
  }).onConflictDoUpdate({
    target: [platformConnections.userId, platformConnections.platform],
    set: { externalId: steamId, isActive: true },
  });

  // Insert imports row + fire-and-forget Edge Function
  const [importRow] = await db.insert(imports).values({
    userId: user.id,
    platform: "steam",
    status: "queued",
    surfaced: true,
  }).returning({ id: imports.id });

  // Fire-and-forget — don't await
  fetch(`${requireEnv("SUPABASE_FUNCTIONS_URL")}/import-platform`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ importId: importRow.id }),
  }).catch((err) => console.error("Edge Function trigger failed:", err));

  return NextResponse.redirect(`${realm}/library/import/${importRow.id}`);
}
```

- [ ] **Step 3: Verify build chain**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

Note: live verify of the OpenID round-trip happens in Task 20's verification gate (item 1). For now, the build verifies typing only.

- [ ] **Step 4: Commit**

```powershell
git add app/api/auth/steam
git commit -m @'
feat(imports): steam openid 2.0 routes — start + callback

GET /api/auth/steam constructs an OpenID 2.0 redirect to
steamcommunity.com/openid/login with return_to set to our callback.

GET /api/auth/steam/callback enforces two replay-mitigations:
  1. Strict return_to equality (response must match what we sent)
  2. Steam check_authentication round-trip (verifyAssertion)
…then extracts SteamID64 from openid.identity, upserts platform_connections,
inserts an imports row, fire-and-forget triggers the import-platform Edge
Function, and 302s to /library/import/<importId>.

Unauthenticated users → 401. All failure paths redirect to
/settings?error=<reason> for in-app surfacing.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 8: Xbox adapter

**Goal:** Implement `lib/imports/adapters/xbox.ts` — Xbox side of `LibraryImporter`. `connect()` validates the OpenXBL key via `/api/v2/account` and returns the XUID. `fetchLibrary()` pulls titles via `/api/v2/achievements/player/{xuid}`; delta detection uses Upstash-cached previous response (hash diff). `disconnect()` clears the key reference (caller handles the DB).

**Files:**
- Create: `lib/imports/adapters/xbox.ts`

**Acceptance Criteria:**
- [ ] `class XboxAdapter implements LibraryImporter` exported as `export const xboxAdapter`
- [ ] `connect({ kind: 'xbox', openxblKey })`: calls `xbl.io/api/v2/account` with `X-Authorization: <key>` header. On 200 → returns `{ externalId: xuid, accessTokenPlaintext: openxblKey, displayHandle: gamertag }`. On 401 → throw `XboxKeyInvalidError`.
- [ ] `fetchLibrary(conn, { since })`: pulls full title list via `/api/v2/achievements/player/{xuid}/{titleId?}` (the executor will choose the right endpoint — OpenXBL's title-list endpoint may be `/api/v2/dvr/gameclips/users/me` or similar; consult the OpenXBL docs and pick the one returning title metadata). Returns `ImportedGame[]` with `hoursPlayed: null` (Xbox has no playtime concept).
- [ ] Delta mode (`since` set): store the hashed full response under Upstash key `imports:xbox:last:<userId>` (25h TTL). On subsequent calls, hash the new response and compare to the cached. If hashes match → return `{ games: [], nextCursor: null }`. If they differ → return ALL games (engine does the per-title diff against `logs`).
- [ ] 429 → `XboxRateLimitError`; 5xx → `XboxApiError`
- [ ] `disconnect()` is currently a no-op (no revocation endpoint at OpenXBL; the DB's `isActive=false` + `accessTokenEncrypted=null` is set by the caller)
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm typecheck && pnpm lint && pnpm build` (live API smoke is deferred to Task 20's verification gate item 4 — requires a real OpenXBL account).

**Steps:**

- [ ] **Step 1: Create `lib/imports/adapters/xbox.ts`**

Implementation skeleton:

```typescript
import "server-only";
import { createHash } from "node:crypto";

import { redis } from "@/lib/cache/redis";
import type {
  ConnectInput, ConnectResult, ImportedGame, LibraryImporter, PlatformConnection,
} from "./types";

const XBL_BASE = "https://xbl.io/api/v2";
const DELTA_CACHE_TTL_S = 25 * 60 * 60; // 25h — daily sync is every 23h

export class XboxKeyInvalidError extends Error { name = "XboxKeyInvalidError"; }
export class XboxRateLimitError extends Error { name = "XboxRateLimitError"; }
export class XboxApiError extends Error { name = "XboxApiError"; }

interface XblTitle {
  titleId: string;
  name: string;
  // OpenXBL responses vary; the executor checks the live shape and adjusts.
  // Common fields: titleHistory.lastTimePlayed, achievement.currentAchievements
}

async function xblFetch(path: string, key: string): Promise<unknown> {
  const res = await fetch(`${XBL_BASE}${path}`, { headers: { "X-Authorization": key }, cache: "no-store" });
  if (res.status === 401) throw new XboxKeyInvalidError("OpenXBL rejected the key");
  if (res.status === 429) throw new XboxRateLimitError("OpenXBL rate-limited");
  if (!res.ok) throw new XboxApiError(`OpenXBL ${res.status}`);
  return res.json();
}

function hashResponse(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

class XboxAdapter implements LibraryImporter {
  async connect(input: ConnectInput): Promise<ConnectResult> {
    if (input.kind !== "xbox") throw new Error("XboxAdapter expects kind='xbox'");
    const account = (await xblFetch("/account", input.openxblKey)) as {
      profileUsers?: Array<{ id: string; settings: Array<{ id: string; value: string }> }>;
    };
    const user = account.profileUsers?.[0];
    if (!user) throw new XboxKeyInvalidError("OpenXBL returned no account");
    const gamertag = user.settings.find((s) => s.id === "Gamertag")?.value ?? null;
    return { externalId: user.id, accessTokenPlaintext: input.openxblKey, displayHandle: gamertag };
  }

  async fetchLibrary(
    connection: PlatformConnection,
    options: { cursor?: string; since?: Date },
  ): Promise<{ games: ImportedGame[]; nextCursor: string | null }> {
    if (!connection.accessTokenPlaintext) throw new XboxKeyInvalidError("No OpenXBL key on connection");
    const key = connection.accessTokenPlaintext;

    // Endpoint choice: OpenXBL exposes player-title history at /achievements/player/{xuid}.
    // The executor verifies the live response shape (OpenXBL has changed endpoints
    // in the past) and adjusts the parser. If a 401 returns here, the key was
    // revoked since connect — propagate as XboxKeyInvalidError.
    const raw = (await xblFetch(`/achievements/player/${connection.externalId}`, key)) as {
      titles?: XblTitle[];
    };

    const titles = raw.titles ?? [];
    const games: ImportedGame[] = titles.map((t) => ({
      externalId: String(t.titleId),
      title: t.name,
      hoursPlayed: null,
      lastPlayedAt: null,
      releaseYear: null,
    }));

    // Delta mode: hash + compare cached prior response.
    if (options.since) {
      const cacheKey = `imports:xbox:last:${connection.userId}`;
      const newHash = hashResponse(raw);
      const prevHash = await redis.get<string>(cacheKey);
      // Always refresh the cache (whether or not we return data)
      await redis.set(cacheKey, newHash, { ex: DELTA_CACHE_TTL_S });
      if (prevHash === newHash) return { games: [], nextCursor: null };
    } else {
      // First-import: prime the cache so the next delta has a baseline
      await redis.set(`imports:xbox:last:${connection.userId}`, hashResponse(raw), { ex: DELTA_CACHE_TTL_S });
    }

    return { games, nextCursor: null };
  }

  async disconnect(_connection: PlatformConnection): Promise<void> {
    // OpenXBL has no revocation endpoint. The caller sets isActive=false +
    // clears accessTokenEncrypted in the DB.
  }
}

export const xboxAdapter: LibraryImporter = new XboxAdapter();
```

- [ ] **Step 2: Verify build chain**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

- [ ] **Step 3: Commit**

```powershell
git add lib/imports/adapters/xbox.ts
git commit -m @'
feat(imports): xbox adapter — OpenXBL key flow + cached delta detection

Implements LibraryImporter for Xbox via the unofficial OpenXBL proxy:
- connect() validates the user-pasted key against /api/v2/account, returns
  XUID + gamertag
- fetchLibrary() pulls /achievements/player/{xuid}; hoursPlayed is null
  (Xbox has no playtime concept)
- Delta mode hashes the full response and compares to Upstash-cached
  prior response (key: imports:xbox:last:<userId>, TTL 25h). Equal hash →
  return empty array; differ → return all (engine does per-title diff).
- Typed errors: XboxKeyInvalidError (401), XboxRateLimitError (429),
  XboxApiError (other 5xx).
- disconnect() is a no-op; the caller clears DB state directly.

NOTE: OpenXBL endpoints have shifted in the past. The fetchLibrary impl
above uses /achievements/player/{xuid} as the canonical title list;
implementer verifies live response shape before merging.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 9: Xbox connect route — `/api/connect/xbox`

**Goal:** POST endpoint that takes a pasted OpenXBL key, validates via `xboxAdapter.connect()`, AES-GCM-encrypts the key, upserts `platform_connections`, inserts an `imports` row, fire-and-forget triggers the Edge Function, and returns `{ importId }` for the modal to navigate with.

**Files:**
- Create: `app/api/connect/xbox/route.ts`

**Acceptance Criteria:**
- [ ] `POST /api/connect/xbox` accepts JSON body `{ key: string }`; rejects empty/missing with 400
- [ ] Calls `xboxAdapter.connect()` — on `XboxKeyInvalidError` → 401 with `{ error: 'invalid_key' }`
- [ ] AES-GCM-encrypts the plaintext key via `lib/imports/encryption.ts`
- [ ] Upserts `platform_connections (user_id, platform='xbox')` with `accessTokenEncrypted = <ciphertext>`, `externalId = xuid`, `isActive = true`
- [ ] Inserts `imports` row with `status='queued'`, `surfaced=true`
- [ ] Fire-and-forget POST to `${SUPABASE_FUNCTIONS_URL}/import-platform`
- [ ] Returns 200 `{ importId, displayHandle }` so the modal can redirect to `/library/import/<importId>`
- [ ] Unauthenticated → 401
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm typecheck && pnpm build` + manual curl with a real OpenXBL key (deferred to Task 20's gate item 4).

**Steps:**

- [ ] **Step 1: Create `app/api/connect/xbox/route.ts`**

```typescript
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import { db } from "@/lib/db";
import { platformConnections, imports } from "@/lib/db/schema";
import { encryptSecret } from "@/lib/imports/encryption";
import { xboxAdapter, XboxKeyInvalidError } from "@/lib/imports/adapters/xbox";
import { requireEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

const Body = z.object({ key: z.string().min(10).max(2000) });

export async function POST(req: NextRequest) {
  const user = await getCachedUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  let connect;
  try {
    connect = await xboxAdapter.connect({ kind: "xbox", openxblKey: body.key });
  } catch (err) {
    if (err instanceof XboxKeyInvalidError) {
      return NextResponse.json({ error: "invalid_key" }, { status: 401 });
    }
    console.error("Xbox connect failed:", err);
    return NextResponse.json({ error: "xbl_error" }, { status: 502 });
  }

  const accessTokenEncrypted = encryptSecret(body.key);

  await db.insert(platformConnections).values({
    userId: user.id,
    platform: "xbox",
    externalId: connect.externalId,
    accessTokenEncrypted,
    refreshTokenEncrypted: null,
    isActive: true,
  }).onConflictDoUpdate({
    target: [platformConnections.userId, platformConnections.platform],
    set: { externalId: connect.externalId, accessTokenEncrypted, isActive: true },
  });

  const [importRow] = await db.insert(imports).values({
    userId: user.id,
    platform: "xbox",
    status: "queued",
    surfaced: true,
  }).returning({ id: imports.id });

  // Fire-and-forget
  fetch(`${requireEnv("SUPABASE_FUNCTIONS_URL")}/import-platform`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ importId: importRow.id }),
  }).catch((err) => console.error("Edge Function trigger failed:", err));

  return NextResponse.json({ importId: importRow.id, displayHandle: connect.displayHandle });
}
```

- [ ] **Step 2: Verify build chain**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

- [ ] **Step 3: Commit**

```powershell
git add app/api/connect/xbox/route.ts
git commit -m @'
feat(imports): POST /api/connect/xbox — validate, encrypt, persist, trigger

Server-side endpoint for the Xbox connect modal:
- Validates the pasted OpenXBL key via xboxAdapter.connect()
- AES-GCM-encrypts the key before persisting (lib/imports/encryption.ts)
- Upserts platform_connections (idempotent on user_id, platform)
- Inserts imports row with status=queued, surfaced=true
- Fire-and-forget triggers the import-platform Edge Function
- Returns { importId, displayHandle } for the modal to navigate with

Plaintext key never leaves the server boundary after the initial paste.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 10: Server actions + import status polling endpoint

**Goal:** Ship `lib/imports/server-actions.ts` (`triggerImport`, `syncNow`, `disconnectPlatform`, `listConnections`) and `app/api/imports/[importId]/status/route.ts` (the polled JSON endpoint with the stuck-queue mitigation).

**Files:**
- Create: `lib/imports/server-actions.ts`
- Create: `lib/imports/select.ts`
- Create: `app/api/imports/[importId]/status/route.ts`

**Acceptance Criteria:**
- [ ] `lib/imports/select.ts` exports a shared Drizzle projection used by both server actions and the status endpoint
- [ ] `triggerImport(platform: 'steam' | 'xbox')`: validates user is connected to that platform; inserts `imports` row with `surfaced=true`; fire-and-forget Edge Function POST; returns `{ importId }`
- [ ] `syncNow(platform)`: same as `triggerImport` (the engine reads `lastSyncedAt` to decide full vs delta — no separate code path needed)
- [ ] `disconnectPlatform(platform)`: sets `isActive=false` and nulls `accessTokenEncrypted` on `platform_connections`. Logs imported by that platform stay in `logs` (per spec). Calls `<adapter>.disconnect()` for any platform-specific cleanup.
- [ ] `listConnections()`: returns `Array<{ platform, externalId, displayHandle, gameCount, lastSyncedAt, isActive, latestImport }>` where `latestImport` is the most recent `imports` row (for state derivation by `<PlatformCard>`)
- [ ] `GET /api/imports/[importId]/status`: returns the JSON shape from spec § Polling endpoint shape; computes `stuck: true` if `status='queued'` AND `createdAt < now() - 5 minutes`
- [ ] Status endpoint enforces `imports.userId === current user`; 404 otherwise
- [ ] All server actions enforce auth — unauthenticated → throw
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm typecheck && pnpm build` + manual: insert a fake `imports` row with `status='queued'` and `createdAt=10 minutes ago`, GET the status endpoint, see `stuck: true`.

**Steps:**

- [ ] **Step 1: Create `lib/imports/select.ts`**

```typescript
import "server-only";
import { imports, platformConnections, logs } from "@/lib/db/schema";

/** Projection for /api/imports/[importId]/status. */
export const importStatusProjection = {
  id: imports.id,
  status: imports.status,
  importedCount: imports.importedCount,
  totalCount: imports.totalCount,
  errorMessage: imports.errorMessage,
  conflictsJsonb: imports.conflictsJsonb,
  unmatchedJsonb: imports.unmatchedJsonb,
  startedAt: imports.startedAt,
  completedAt: imports.completedAt,
  createdAt: imports.createdAt,
  userId: imports.userId,
} as const;

/** Projection for listConnections — joined to count + lastSyncedAt. */
export const connectionListProjection = {
  platform: platformConnections.platform,
  externalId: platformConnections.externalId,
  lastSyncedAt: platformConnections.lastSyncedAt,
  isActive: platformConnections.isActive,
} as const;
```

- [ ] **Step 2: Create `lib/imports/server-actions.ts`**

```typescript
"use server";
import { and, desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import { db } from "@/lib/db";
import { imports, logs, platformConnections } from "@/lib/db/schema";
import { requireEnv } from "@/lib/env";
import { steamAdapter } from "./adapters/steam";
import { xboxAdapter } from "./adapters/xbox";
import { decryptSecret } from "./encryption";
import { connectionListProjection } from "./select";

type Platform = "steam" | "xbox";

async function requireUser() {
  const user = await getCachedUser();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}

async function fireImportEdge(importId: string) {
  await fetch(`${requireEnv("SUPABASE_FUNCTIONS_URL")}/import-platform`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ importId }),
  }).catch((err) => console.error("Edge Function trigger failed:", err));
}

export async function triggerImport(platform: Platform): Promise<{ importId: string }> {
  const user = await requireUser();
  const [conn] = await db.select().from(platformConnections)
    .where(and(eq(platformConnections.userId, user.id), eq(platformConnections.platform, platform), eq(platformConnections.isActive, true)))
    .limit(1);
  if (!conn) throw new Error("NOT_CONNECTED");

  const [row] = await db.insert(imports).values({
    userId: user.id, platform, status: "queued", surfaced: true,
  }).returning({ id: imports.id });

  void fireImportEdge(row.id);
  revalidatePath("/settings");
  return { importId: row.id };
}

export const syncNow = triggerImport;

export async function disconnectPlatform(platform: Platform): Promise<void> {
  const user = await requireUser();
  const [conn] = await db.select().from(platformConnections)
    .where(and(eq(platformConnections.userId, user.id), eq(platformConnections.platform, platform)))
    .limit(1);
  if (!conn) return;

  // Adapter-specific cleanup (currently no-ops for both)
  const adapter = platform === "steam" ? steamAdapter : xboxAdapter;
  await adapter.disconnect({
    id: conn.id,
    userId: conn.userId,
    platform,
    externalId: conn.externalId,
    accessTokenPlaintext: conn.accessTokenEncrypted ? decryptSecret(conn.accessTokenEncrypted) : null,
    lastSyncedAt: conn.lastSyncedAt,
  });

  await db.update(platformConnections)
    .set({ isActive: false, accessTokenEncrypted: null })
    .where(eq(platformConnections.id, conn.id));
  revalidatePath("/settings");
}

export interface ConnectionSummary {
  platform: Platform | "psn";
  externalId: string | null;
  lastSyncedAt: Date | null;
  isActive: boolean;
  gameCount: number;
  latestImport: {
    id: string;
    status: "queued" | "running" | "completed" | "failed";
    importedCount: number;
    totalCount: number;
    createdAt: Date;
    surfaced: boolean;
  } | null;
}

export async function listConnections(): Promise<ConnectionSummary[]> {
  const user = await requireUser();
  const rows = await db.select().from(platformConnections)
    .where(eq(platformConnections.userId, user.id));

  const summaries = await Promise.all(rows.map(async (r) => {
    // game count: distinct game_ids in logs for this user where platforms contains this platform
    const countRows = await db.execute<{ count: number }>(sql`
      SELECT COUNT(DISTINCT game_id)::int AS count FROM logs
      WHERE user_id = ${user.id} AND ${r.platform} = ANY(platforms)
    `);
    const gameCount = Number(countRows.rows[0]?.count ?? 0);

    const [latest] = await db.select({
      id: imports.id, status: imports.status, importedCount: imports.importedCount,
      totalCount: imports.totalCount, createdAt: imports.createdAt, surfaced: imports.surfaced,
    }).from(imports)
      .where(and(eq(imports.userId, user.id), eq(imports.platform, r.platform)))
      .orderBy(desc(imports.createdAt))
      .limit(1);

    return {
      platform: r.platform,
      externalId: r.externalId,
      lastSyncedAt: r.lastSyncedAt,
      isActive: r.isActive,
      gameCount,
      latestImport: latest ?? null,
    } satisfies ConnectionSummary;
  }));

  return summaries;
}

/** Marks the listed import rows as surfaced. Called by ImportToast on mount
 * after rendering the delta toast. */
export async function markImportsSurfaced(importIds: string[]): Promise<void> {
  if (importIds.length === 0) return;
  const user = await requireUser();
  await db.update(imports).set({ surfaced: true })
    .where(and(eq(imports.userId, user.id), sql`${imports.id} = ANY(${importIds})`));
}
```

- [ ] **Step 3: Create `app/api/imports/[importId]/status/route.ts`**

```typescript
import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import { db } from "@/lib/db";
import { imports } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const STUCK_QUEUE_THRESHOLD_MS = 5 * 60 * 1000;  // 5 minutes

export async function GET(_req: NextRequest, { params }: { params: Promise<{ importId: string }> }) {
  const user = await getCachedUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { importId } = await params;

  const [row] = await db.select().from(imports)
    .where(and(eq(imports.id, importId), eq(imports.userId, user.id)))
    .limit(1);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const stuck =
    row.status === "queued" &&
    Date.now() - new Date(row.createdAt).getTime() > STUCK_QUEUE_THRESHOLD_MS;

  return NextResponse.json({
    id: row.id,
    status: row.status,
    stuck,
    importedCount: row.importedCount,
    totalCount: row.totalCount,
    errorMessage: row.errorMessage,
    conflicts: row.conflictsJsonb,
    unmatched: row.unmatchedJsonb,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  });
}
```

- [ ] **Step 4: Verify build chain**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

- [ ] **Step 5: Manual stuck-queue verification**

In a Supabase SQL session:

```sql
-- Insert a stuck row for yourself (replace <your-uuid>)
INSERT INTO imports (user_id, platform, status, created_at)
VALUES ('<your-uuid>', 'steam', 'queued', now() - interval '10 minutes')
RETURNING id;
```

Then hit `/api/imports/<that-id>/status` in your browser. Expected response: `stuck: true`. Clean up: `DELETE FROM imports WHERE id = '<that-id>';`

- [ ] **Step 6: Commit**

```powershell
git add lib/imports/server-actions.ts lib/imports/select.ts app/api/imports
git commit -m @'
feat(imports): server actions surface + polled status endpoint

lib/imports/server-actions.ts exposes:
- triggerImport / syncNow — same logic, the engine decides full vs delta
  based on lastSyncedAt
- disconnectPlatform — sets isActive=false, nulls accessTokenEncrypted;
  imported logs stay in place (per spec)
- listConnections — returns per-platform summary with gameCount +
  latestImport for PlatformCard state derivation
- markImportsSurfaced — flips `surfaced=true` after toast display

GET /api/imports/[importId]/status returns the spec § Polling shape,
with `stuck: true` if status='queued' AND createdAt > 5 minutes old —
the recovery anchor for fire-and-forget POSTs that silently failed.

All routes 401 on unauthenticated; 404 on cross-user import access.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 11: Edge Function — `import-platform` worker

**Goal:** Ship `supabase/functions/import-platform/index.ts` + a shared engine at `supabase/functions/_shared/import-engine.ts`. Edge Function runs on Deno; it receives `{ importId }`, loads the import + connection, decrypts the Xbox key if applicable, iterates `fetchLibrary` chunks, RAWG-matches, runs merge, upserts logs, updates progress + conflicts + unmatched, finalizes status.

**Files:**
- Create: `supabase/functions/_shared/import-engine.ts`
- Create: `supabase/functions/import-platform/index.ts`

**Acceptance Criteria:**
- [ ] Edge Function authenticates inbound requests against the service-role key (`Authorization: Bearer <SERVICE_ROLE_KEY>`); 401 otherwise
- [ ] Loads the `imports` row + the platform's `platform_connections` row by `(userId, platform)`; 404 / fails the import if either missing
- [ ] Updates `status='running'`, `startedAt=now()` before starting
- [ ] Calls the right adapter based on `platform`; adapters are inline-vendored as Deno-compatible TS into `_shared/` because Edge Functions can't import from the Next app's `lib/` (different runtime)
- [ ] Iterates `fetchLibrary` chunks; for each chunk, RAWG-matches each title (using a Deno-compatible Postgres client — `postgres` npm via `npm:` specifier), runs `mergeImportedGame`, INSERT/UPDATE logs, append to `conflictsJsonb` / `unmatchedJsonb`
- [ ] After each chunk: `UPDATE imports SET imported_count = imported_count + N, conflicts_jsonb = $, unmatched_jsonb = $`
- [ ] On success: `UPDATE imports SET status='completed', completed_at=now()` + `UPDATE platform_connections SET last_synced_at=now()`
- [ ] On hard error: `UPDATE imports SET status='failed', error_message=<short>` — message is short (≤200 chars), user-friendly, no stack traces
- [ ] Transient errors (rate-limit, 5xx) → exponential backoff up to 6 retries before failing
- [ ] Idempotent: re-invoking with the same `importId` is safe (merge.ts is pure; unique constraints prevent duplicate logs)
- [ ] `supabase functions deploy import-platform` succeeds
- [ ] Manual invoke against a real import row processes a small library end-to-end

**Verify:**
```powershell
supabase functions deploy import-platform
supabase functions invoke import-platform --body '{"importId":"<real-uuid>"}'
```

…then SQL-poll `imports` to watch `imported_count` climb and `status` flip to `completed`.

**Steps:**

- [ ] **Step 1: Initialize Supabase functions config (if not already done)**

```powershell
supabase init  # creates supabase/config.toml if absent
```

Confirm `supabase/config.toml` has a `[functions]` section. Don't commit any local development secrets.

- [ ] **Step 2: Create `supabase/functions/_shared/import-engine.ts`**

The Deno runtime requires explicit imports via `npm:` or `https://deno.land/...` specifiers. Inline-vendor the merge logic (we can't `import` from `../../../lib/imports/merge` — different runtime).

```typescript
// Deno runtime (Supabase Edge Functions). Imports use npm: specifiers.
import postgres from "npm:postgres@3.4.9";

export interface ImportRow {
  id: string; user_id: string; platform: "steam" | "xbox" | "psn";
  status: string; imported_count: number; total_count: number;
  conflicts_jsonb: unknown[]; unmatched_jsonb: unknown[];
  surfaced: boolean;
}

export interface ConnectionRow {
  id: string; user_id: string; platform: "steam" | "xbox" | "psn";
  external_id: string; access_token_encrypted: string | null;
  last_synced_at: string | null;
}

export interface ImportedGame {
  externalId: string; title: string; hoursPlayed: number | null;
  lastPlayedAt: Date | null; releaseYear: number | null;
}

/** Vendored merge logic. Must stay byte-identical to lib/imports/merge.ts.
 * If you change one, change both. */
export function mergeImportedGame(
  imported: ImportedGame & { gameId: number },
  existing: { id: string; platforms: string[] | null; platformPlayedOn: string | null; hoursPlayed: number | null } | null,
  platform: string,
) {
  if (!existing) {
    return {
      action: "insert" as const,
      row: {
        gameId: imported.gameId, status: "backlog",
        platforms: [platform], platformPlayedOn: platform,
        hoursPlayed: imported.hoursPlayed,
      },
    };
  }
  const existingPlatforms = existing.platforms ?? (existing.platformPlayedOn ? [existing.platformPlayedOn] : []);
  const mergedPlatforms = Array.from(new Set([...existingPlatforms, platform]));
  const bothNull = existing.hoursPlayed == null && imported.hoursPlayed == null;
  const mergedHours = bothNull ? null : Math.max(existing.hoursPlayed ?? 0, imported.hoursPlayed ?? 0);
  return {
    action: "update" as const,
    logId: existing.id,
    set: { platforms: mergedPlatforms, hoursPlayed: mergedHours },
    rule: "platform_merge",
  };
}

const EDITION_PATTERNS = [
  /\s*[-–:]\s*(definitive|complete|deluxe|game of the year|goty|gold|remastered|enhanced|director'?s cut|special|premium|legendary|ultimate)\s+edition$/i,
  /\s*\(remastered\)$/i, /\s*\(goty\)$/i,
];
export function normalizeTitle(raw: string): string {
  let t = raw.toLowerCase().trim();
  for (const p of EDITION_PATTERNS) t = t.replace(p, "");
  return t.replace(/[\p{P}\p{S}]/gu, " ").replace(/\s+/g, " ").trim();
}

/** Looks up an existing games.id for an ImportedGame using the same algorithm
 * as lib/imports/rawg-match.ts. Implementation reads directly from Postgres. */
export async function matchToRawg(
  sql: ReturnType<typeof postgres>,
  imported: ImportedGame,
): Promise<number | null> {
  const normalized = normalizeTitle(imported.title);
  if (!normalized) return null;
  const exact = await sql`SELECT id FROM games WHERE lower(title) = ${normalized} LIMIT 1`;
  if (exact.length) return exact[0].id;
  const alias = await sql`SELECT game_id AS id FROM game_aliases WHERE lower(alias) = ${normalized} LIMIT 1`;
  if (alias.length) return alias[0].id;
  const prefix = await sql`SELECT id, title, released FROM games WHERE title ILIKE ${normalized + "%"} LIMIT 5`;
  if (prefix.length === 1) return prefix[0].id;
  if (imported.releaseYear && prefix.length > 1) {
    const byYear = prefix.find((r) => r.released && new Date(r.released).getUTCFullYear() === imported.releaseYear);
    if (byYear) return byYear.id;
  }
  return null;
}

/** AES-GCM decrypt — vendored from lib/imports/encryption.ts.
 *  Uses Web Crypto (available in Deno). */
export async function decryptSecret(stored: string, masterKeyB64: string): Promise<string> {
  const [ivB64, ctB64, tagB64] = stored.split(":");
  const keyBytes = Uint8Array.from(atob(masterKeyB64), (c) => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
  const ct = Uint8Array.from(atob(ctB64), (c) => c.charCodeAt(0));
  const tag = Uint8Array.from(atob(tagB64), (c) => c.charCodeAt(0));
  const combined = new Uint8Array(ct.length + tag.length);
  combined.set(ct); combined.set(tag, ct.length);
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, combined);
  return new TextDecoder().decode(pt);
}

/** Fetch the platform's library. Inline-vendored adapter logic for Deno.
 *  See lib/imports/adapters/{steam,xbox}.ts for the Node-side source of truth.
 */
export async function fetchLibrary(
  platform: "steam" | "xbox",
  connection: ConnectionRow,
  steamApiKey: string | null,
  decryptedXboxKey: string | null,
  since: Date | null,
): Promise<ImportedGame[]> {
  if (platform === "steam") {
    if (!steamApiKey) throw new Error("STEAM_API_KEY not set");
    const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${steamApiKey}&steamid=${connection.external_id}&include_appinfo=1&include_played_free_games=1`;
    const res = await fetch(url);
    if (res.status === 429) throw new Error("STEAM_RATE_LIMIT");
    if (!res.ok) throw new Error(`STEAM_API_${res.status}`);
    const json: { response: { games?: Array<{ appid: number; name: string; playtime_forever: number; playtime_2weeks?: number; rtime_last_played?: number }> } } = await res.json();
    const raw = json.response.games ?? [];
    const filtered = since ? raw.filter((g) => (g.playtime_2weeks ?? 0) > 0) : raw;
    return filtered.map((g) => ({
      externalId: String(g.appid), title: g.name,
      hoursPlayed: g.playtime_forever > 0 ? +(g.playtime_forever / 60).toFixed(1) : null,
      lastPlayedAt: g.rtime_last_played ? new Date(g.rtime_last_played * 1000) : null,
      releaseYear: null,
    }));
  } else {
    if (!decryptedXboxKey) throw new Error("XBOX_KEY_MISSING");
    const res = await fetch(`https://xbl.io/api/v2/achievements/player/${connection.external_id}`, {
      headers: { "X-Authorization": decryptedXboxKey },
    });
    if (res.status === 401) throw new Error("XBOX_KEY_INVALID");
    if (res.status === 429) throw new Error("XBOX_RATE_LIMIT");
    if (!res.ok) throw new Error(`XBOX_API_${res.status}`);
    const json: { titles?: Array<{ titleId: string; name: string }> } = await res.json();
    return (json.titles ?? []).map((t) => ({
      externalId: String(t.titleId), title: t.name,
      hoursPlayed: null, lastPlayedAt: null, releaseYear: null,
    }));
  }
}

/** The main engine — runs the import to completion (or failure). */
export async function runImport(opts: {
  sql: ReturnType<typeof postgres>;
  importRow: ImportRow;
  connection: ConnectionRow;
  steamApiKey: string | null;
  encryptionKey: string;
}): Promise<{ status: "completed" | "failed"; errorMessage?: string }> {
  const { sql, importRow, connection, steamApiKey, encryptionKey } = opts;

  // Set running
  await sql`UPDATE imports SET status = 'running', started_at = NOW() WHERE id = ${importRow.id}`;

  try {
    const decryptedXboxKey = importRow.platform === "xbox" && connection.access_token_encrypted
      ? await decryptSecret(connection.access_token_encrypted, encryptionKey)
      : null;
    const since = connection.last_synced_at ? new Date(connection.last_synced_at) : null;

    const games = await fetchLibrary(importRow.platform as "steam" | "xbox", connection, steamApiKey, decryptedXboxKey, since);
    await sql`UPDATE imports SET total_count = ${games.length} WHERE id = ${importRow.id}`;

    const CHUNK = 50;
    const conflicts: unknown[] = [];
    const unmatched: unknown[] = [];
    let imported = 0;

    for (let i = 0; i < games.length; i += CHUNK) {
      const chunk = games.slice(i, i + CHUNK);
      for (const g of chunk) {
        const gameId = await matchToRawg(sql, g);
        if (gameId == null) {
          unmatched.push({ externalId: g.externalId, title: g.title, platform: importRow.platform });
          continue;
        }
        const existing = await sql`SELECT id, platforms, platform_played_on, hours_played FROM logs WHERE user_id = ${importRow.user_id} AND game_id = ${gameId} AND is_replay = false LIMIT 1`;
        const merge = mergeImportedGame(
          { ...g, gameId },
          existing.length ? { id: existing[0].id, platforms: existing[0].platforms, platformPlayedOn: existing[0].platform_played_on, hoursPlayed: existing[0].hours_played ? Number(existing[0].hours_played) : null } : null,
          importRow.platform,
        );
        if (merge.action === "insert") {
          await sql`INSERT INTO logs (user_id, game_id, status, platforms, platform_played_on, hours_played) VALUES (${importRow.user_id}, ${merge.row.gameId}, ${merge.row.status}, ${merge.row.platforms}, ${merge.row.platformPlayedOn}, ${merge.row.hoursPlayed}) ON CONFLICT (user_id, game_id, is_replay) DO NOTHING`;
        } else {
          await sql`UPDATE logs SET platforms = ${merge.set.platforms}, hours_played = ${merge.set.hoursPlayed} WHERE id = ${merge.logId}`;
          conflicts.push({ logId: merge.logId, gameId, rule: merge.rule });
        }
      }
      imported += chunk.length;
      await sql`UPDATE imports SET imported_count = ${imported}, conflicts_jsonb = ${JSON.stringify(conflicts)}::jsonb, unmatched_jsonb = ${JSON.stringify(unmatched)}::jsonb WHERE id = ${importRow.id}`;
    }

    await sql`UPDATE imports SET status = 'completed', completed_at = NOW() WHERE id = ${importRow.id}`;
    await sql`UPDATE platform_connections SET last_synced_at = NOW() WHERE id = ${connection.id}`;
    return { status: "completed" };
  } catch (err) {
    const msg = (err as Error).message.slice(0, 200);
    await sql`UPDATE imports SET status = 'failed', error_message = ${msg}, completed_at = NOW() WHERE id = ${importRow.id}`;
    return { status: "failed", errorMessage: msg };
  }
}
```

- [ ] **Step 3: Create `supabase/functions/import-platform/index.ts`**

```typescript
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.9";
import { runImport, type ImportRow, type ConnectionRow } from "../_shared/import-engine.ts";

Deno.serve(async (req) => {
  // Auth: service-role key via `apikey` header (NOT `Authorization: Bearer`).
  // Supabase's newer `sb_secret_*` keys are not JWTs — Edge Functions must be
  // deployed with `--no-verify-jwt` and validate via string-equality on the
  // `apikey` header. See:
  //   https://supabase.com/docs/guides/api/api-keys
  //   https://supabase.com/docs/guides/functions/auth
  const apikey = req.headers.get("apikey");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!apikey || !serviceRoleKey || apikey !== serviceRoleKey) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { importId } = (await req.json()) as { importId: string };
  if (!importId) return new Response("missing importId", { status: 400 });

  const databaseUrl = Deno.env.get("DATABASE_URL")!;
  const sql = postgres(databaseUrl, { prepare: false });

  try {
    const importRows = await sql<ImportRow[]>`SELECT * FROM imports WHERE id = ${importId} LIMIT 1`;
    if (!importRows.length) return new Response("import not found", { status: 404 });
    const importRow = importRows[0];

    const connRows = await sql<ConnectionRow[]>`
      SELECT * FROM platform_connections
      WHERE user_id = ${importRow.user_id} AND platform = ${importRow.platform}::platform_kind LIMIT 1
    `;
    if (!connRows.length) {
      await sql`UPDATE imports SET status = 'failed', error_message = 'connection not found' WHERE id = ${importId}`;
      return new Response("connection not found", { status: 404 });
    }

    const result = await runImport({
      sql, importRow, connection: connRows[0],
      steamApiKey: Deno.env.get("STEAM_API_KEY") ?? null,
      encryptionKey: Deno.env.get("IMPORT_ENCRYPTION_KEY")!,
    });

    return Response.json(result);
  } finally {
    await sql.end({ timeout: 5 });
  }
});
```

- [ ] **Step 4: Deploy + smoke**

```powershell
supabase secrets set STEAM_API_KEY=$env:STEAM_API_KEY DATABASE_URL=$env:DATABASE_URL IMPORT_ENCRYPTION_KEY=$env:IMPORT_ENCRYPTION_KEY
supabase functions deploy import-platform --no-verify-jwt
```

Then trigger from a Server Action OR manually invoke with a fresh imports row:

```powershell
supabase functions invoke import-platform --body '{"importId":"<real-uuid>"}'
```

Watch the DB via:

```sql
SELECT id, status, imported_count, total_count, error_message FROM imports ORDER BY created_at DESC LIMIT 5;
```

Expected: row goes queued → running → completed with `imported_count = total_count`.

- [ ] **Step 5: Commit**

```powershell
git add supabase/functions/_shared supabase/functions/import-platform
git commit -m @'
feat(imports): import-platform Edge Function — the engine

Deno-runtime Edge Function that runs library imports end-to-end:
  1. service-role auth check
  2. Load imports + platform_connections rows
  3. Decrypt Xbox key (Web Crypto AES-GCM) if applicable
  4. fetchLibrary via the right adapter (Steam GetOwnedGames or
     OpenXBL /achievements/player)
  5. Per-game: RAWG match → merge.ts → INSERT or UPDATE logs
  6. Per-chunk: update imports.imported_count, conflicts_jsonb,
     unmatched_jsonb
  7. On success: status=completed, platform_connections.last_synced_at=NOW
  8. On error: status=failed, short error_message

merge logic is byte-vendored in _shared/import-engine.ts (Edge runtime
can't import from lib/). If lib/imports/merge.ts changes, mirror the
change here.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 12: Edge Function — `daily-sync` cron driver

**Goal:** Ship `supabase/functions/daily-sync/index.ts`. Triggered by pg_cron @ 04:00 UTC; iterates active `platform_connections` rows last-synced over 23h ago; inserts an `imports` row with `surfaced=false`; fire-and-forget invokes `import-platform` per connection (concurrency cap 10).

**Files:**
- Create: `supabase/functions/daily-sync/index.ts`

**Acceptance Criteria:**
- [ ] Edge Function auth: same service-role check as `import-platform`
- [ ] Queries `platform_connections WHERE is_active AND (last_synced_at IS NULL OR last_synced_at < now() - interval '23 hours')`
- [ ] For each connection, INSERT `imports (status='queued', surfaced=false)`
- [ ] Fire-and-forget POST to `${FUNCTIONS_URL}/import-platform` per row, capped at 10 concurrent (via a simple semaphore or `Promise.all` chunking)
- [ ] Returns `{ scheduled: <count> }`
- [ ] `supabase functions deploy daily-sync` succeeds
- [ ] Manual invoke processes the eligible connections; `cron.job` row hitting it produces the same effect

**Verify:**
```powershell
supabase functions deploy daily-sync
supabase functions invoke daily-sync --body '{}'
```

Then check Supabase logs and the `imports` table for new `surfaced=false` rows per eligible connection.

**Steps:**

- [ ] **Step 1: Create `supabase/functions/daily-sync/index.ts`**

```typescript
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.9";

Deno.serve(async (req) => {
  // Auth via `apikey` header (sb_secret_* keys aren't JWTs; deploy with --no-verify-jwt).
  const apikey = req.headers.get("apikey");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!apikey || !serviceRoleKey || apikey !== serviceRoleKey) {
    return new Response("Unauthorized", { status: 401 });
  }

  const databaseUrl = Deno.env.get("DATABASE_URL")!;
  const functionsUrl = Deno.env.get("SUPABASE_FUNCTIONS_URL") ?? Deno.env.get("SUPABASE_URL") + "/functions/v1";
  const sql = postgres(databaseUrl, { prepare: false });

  try {
    const conns = await sql<Array<{ id: string; user_id: string; platform: string }>>`
      SELECT id, user_id, platform FROM platform_connections
      WHERE is_active = true
        AND (last_synced_at IS NULL OR last_synced_at < NOW() - INTERVAL '23 hours')
    `;

    // Concurrency cap = 10
    const CHUNK = 10;
    let scheduled = 0;
    for (let i = 0; i < conns.length; i += CHUNK) {
      const slice = conns.slice(i, i + CHUNK);
      const jobs = slice.map(async (c) => {
        const [row] = await sql<Array<{ id: string }>>`
          INSERT INTO imports (user_id, platform, status, surfaced)
          VALUES (${c.user_id}, ${c.platform}::platform_kind, 'queued', false)
          RETURNING id
        `;
        // Fire-and-forget — apikey header per sb_secret_* convention
        fetch(`${functionsUrl}/import-platform`, {
          method: "POST",
          headers: {
            apikey: serviceRoleKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ importId: row.id }),
        }).catch((err) => console.error("import-platform trigger failed:", err));
        scheduled++;
      });
      await Promise.all(jobs);
    }

    return Response.json({ scheduled });
  } finally {
    await sql.end({ timeout: 5 });
  }
});
```

- [ ] **Step 2: Deploy + invoke**

```powershell
supabase functions deploy daily-sync --no-verify-jwt
supabase functions invoke daily-sync --body '{}'
```

Expected response: `{ "scheduled": N }` where N is the count of eligible connections. Check the `imports` table for `surfaced=false` rows.

- [ ] **Step 3: Commit**

```powershell
git add supabase/functions/daily-sync
git commit -m @'
feat(imports): daily-sync Edge Function — cron-driven delta scheduler

Triggered by pg_cron @ 04:00 UTC (configured in Task 3). Iterates active
platform_connections last-synced ≥23h ago, INSERTs an imports row with
surfaced=false (key difference from foreground syncs), then fire-and-
forget POSTs to import-platform.

Concurrency cap: 10 in-flight imports per cron tick to avoid spiking
Steam Web API limits (100K/day shared across all users — at 200 games
each it'd take 500 users syncing simultaneously to brush against that).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 13: Pixel-art SVG illustrations for the Xbox connect modal

**Goal:** Ship 3 hand-coded SVG components representing the OpenXBL flow at the pixel-art aesthetic level of `components/pixel/platform-icons.tsx`. These render at modal-card scale (~160×120 px) and don't depend on external assets.

**Files:**
- Create: `components/imports/illustrations/xbl-step-1.tsx` — homepage with "Sign In with Microsoft" button highlighted
- Create: `components/imports/illustrations/xbl-step-2.tsx` — dashboard with the "API Key" tab highlighted (purple accent)
- Create: `components/imports/illustrations/xbl-step-3.tsx` — the long API key string + copy affordance

**Acceptance Criteria:**
- [ ] Each component exports a default React functional component accepting optional `width`/`height` props (defaults 160×120)
- [ ] Uses `shapeRendering="crispEdges"` (matches existing pixel-art convention)
- [ ] Palette: dark bg `#0a0a10`, surface `#15151c`, border `#2a2a3a`, accent `#7c5cff`, text `#e0e0ea` — matches the project's existing CSS vars
- [ ] No external images, no `<img>`, no SVG <image> hrefs — pure rects/paths
- [ ] Each component is ≤ 100 lines of JSX (reasonable for hand-coded pixel art)
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm build` + render in Storybook-style smoke (just put them all on a temp `_scratch/` page during dev for eyeball check; not committed).

**Steps:**

- [ ] **Step 1: Reference the existing pattern**

Read `components/pixel/platform-icons.tsx` for the pixel-art idiom in this codebase. The pattern is: stacked `<rect>` elements representing pixels, integer `x/y/width/height`, palette from a small fixed set.

- [ ] **Step 2: Create `components/imports/illustrations/xbl-step-1.tsx`**

```typescript
import { memo } from "react";

interface Props { width?: number; height?: number; }

/**
 * Pixel-art illustration of the xbl.io homepage with the "Sign In" CTA
 * highlighted. The illustration is for the Xbox connect modal's step 1.
 */
export const XblStep1 = memo(function XblStep1({ width = 160, height = 120 }: Props) {
  return (
    <svg viewBox="0 0 160 120" width={width} height={height} shapeRendering="crispEdges" role="img" aria-label="OpenXBL homepage with Sign In with Microsoft button">
      {/* Browser frame */}
      <rect x="0" y="0" width="160" height="120" fill="#0a0a10" />
      <rect x="2" y="2" width="156" height="14" fill="#15151c" />
      <rect x="2" y="16" width="156" height="2" fill="#2a2a3a" />
      {/* Window controls */}
      <rect x="6" y="6" width="4" height="4" fill="#ff5c5c" />
      <rect x="14" y="6" width="4" height="4" fill="#fdca40" />
      <rect x="22" y="6" width="4" height="4" fill="#2dd16d" />
      {/* URL bar */}
      <rect x="34" y="5" width="120" height="6" fill="#0a0a10" />
      <rect x="36" y="7" width="40" height="2" fill="#7c5cff" />
      {/* Page content */}
      <rect x="8" y="22" width="60" height="4" fill="#e0e0ea" />
      <rect x="8" y="30" width="100" height="2" fill="#888" />
      <rect x="8" y="34" width="80" height="2" fill="#888" />
      {/* Hero "Sign in with Microsoft" button — accent */}
      <rect x="40" y="60" width="80" height="20" fill="#7c5cff" />
      <rect x="44" y="66" width="72" height="2" fill="#e0e0ea" />
      <rect x="44" y="72" width="42" height="2" fill="#e0e0ea" />
      {/* Hover pulse hint */}
      <rect x="38" y="58" width="84" height="24" fill="none" stroke="#7c5cff" strokeOpacity="0.4" strokeWidth="1" />
    </svg>
  );
});
```

- [ ] **Step 3: Create `components/imports/illustrations/xbl-step-2.tsx`**

```typescript
import { memo } from "react";

interface Props { width?: number; height?: number; }

/**
 * Pixel-art illustration of the xbl.io dashboard with the "API Key" tab
 * highlighted. Step 2 of the Xbox connect modal.
 */
export const XblStep2 = memo(function XblStep2({ width = 160, height = 120 }: Props) {
  return (
    <svg viewBox="0 0 160 120" width={width} height={height} shapeRendering="crispEdges" role="img" aria-label="OpenXBL dashboard with API Key tab highlighted">
      <rect x="0" y="0" width="160" height="120" fill="#0a0a10" />
      {/* Sidebar */}
      <rect x="0" y="0" width="40" height="120" fill="#15151c" />
      <rect x="4" y="8" width="32" height="4" fill="#e0e0ea" />
      <rect x="4" y="20" width="20" height="2" fill="#888" />
      <rect x="4" y="28" width="24" height="2" fill="#888" />
      {/* API Key tab — highlighted */}
      <rect x="4" y="36" width="32" height="8" fill="#7c5cff" />
      <rect x="6" y="39" width="28" height="2" fill="#e0e0ea" />
      <rect x="4" y="48" width="20" height="2" fill="#888" />
      <rect x="4" y="56" width="22" height="2" fill="#888" />
      {/* Content */}
      <rect x="46" y="8" width="80" height="4" fill="#e0e0ea" />
      <rect x="46" y="20" width="108" height="60" fill="#15151c" />
      <rect x="50" y="26" width="50" height="3" fill="#888" />
      <rect x="50" y="34" width="100" height="6" fill="#0a0a10" />
      <rect x="52" y="36" width="80" height="2" fill="#e0e0ea" />
      <rect x="50" y="48" width="40" height="8" fill="#7c5cff" />
      <rect x="54" y="51" width="32" height="2" fill="#e0e0ea" />
      {/* Pointer arrow at the tab */}
      <rect x="40" y="38" width="4" height="2" fill="#7c5cff" />
      <rect x="42" y="36" width="2" height="6" fill="#7c5cff" />
    </svg>
  );
});
```

- [ ] **Step 4: Create `components/imports/illustrations/xbl-step-3.tsx`**

```typescript
import { memo } from "react";

interface Props { width?: number; height?: number; }

/**
 * Pixel-art illustration of the API key string with a "copy" affordance.
 * Step 3 of the Xbox connect modal.
 */
export const XblStep3 = memo(function XblStep3({ width = 160, height = 120 }: Props) {
  return (
    <svg viewBox="0 0 160 120" width={width} height={height} shapeRendering="crispEdges" role="img" aria-label="API key string with copy button">
      <rect x="0" y="0" width="160" height="120" fill="#0a0a10" />
      {/* Card */}
      <rect x="20" y="30" width="120" height="60" fill="#15151c" />
      <rect x="20" y="30" width="120" height="60" fill="none" stroke="#2a2a3a" strokeWidth="1" />
      {/* "Your API Key" label */}
      <rect x="28" y="38" width="40" height="3" fill="#888" />
      {/* Key string mockup */}
      <rect x="28" y="48" width="86" height="6" fill="#0a0a10" />
      <rect x="30" y="50" width="3" height="2" fill="#7c5cff" />
      <rect x="35" y="50" width="6" height="2" fill="#e0e0ea" />
      <rect x="43" y="50" width="2" height="2" fill="#e0e0ea" />
      <rect x="47" y="50" width="8" height="2" fill="#e0e0ea" />
      <rect x="57" y="50" width="4" height="2" fill="#e0e0ea" />
      <rect x="63" y="50" width="10" height="2" fill="#e0e0ea" />
      <rect x="75" y="50" width="3" height="2" fill="#e0e0ea" />
      <rect x="80" y="50" width="7" height="2" fill="#e0e0ea" />
      <rect x="89" y="50" width="5" height="2" fill="#e0e0ea" />
      <rect x="96" y="50" width="9" height="2" fill="#e0e0ea" />
      <rect x="107" y="50" width="3" height="2" fill="#e0e0ea" />
      {/* Copy button (right side) */}
      <rect x="120" y="46" width="14" height="10" fill="#7c5cff" />
      <rect x="123" y="49" width="8" height="4" fill="none" stroke="#e0e0ea" strokeWidth="1" />
      <rect x="124" y="50" width="6" height="2" fill="#e0e0ea" opacity="0.5" />
      {/* Helper caption */}
      <rect x="28" y="64" width="80" height="2" fill="#888" />
      <rect x="28" y="70" width="60" height="2" fill="#888" />
    </svg>
  );
});
```

- [ ] **Step 5: Verify build chain**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

- [ ] **Step 6: Eyeball-check (optional, non-committed)**

Create a temp `app/(app)/_scratch/imports-illustrations/page.tsx` that renders all three side-by-side at 2× zoom. View on `/_scratch/imports-illustrations`. Tweak rect coordinates if anything looks off. Delete the scratch page before committing.

- [ ] **Step 7: Commit**

```powershell
git add components/imports/illustrations
git commit -m @'
feat(imports): pixel-art SVG illustrations for Xbox connect modal

Three hand-coded SVG components matching the project's pixel-art idiom
(shapeRendering=crispEdges, integer-aligned rects, fixed palette). Used
by the 3-step Xbox connect modal:
  - xbl-step-1: homepage with Sign In CTA highlighted
  - xbl-step-2: dashboard with API Key tab highlighted (pointer arrow)
  - xbl-step-3: API key string + copy button affordance

No external assets. Don't go stale when xbl.io redesigns.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 14: `<PlatformCard>` component — 5 states

> **Dependency note:** Task 14 imports `<XboxConnectModal>` from Task 15. If executing sequentially, run Task 15 *before* Task 14, or create a placeholder file `components/imports/xbox-connect-modal.tsx` with `export function XboxConnectModal() { return null; }` until Task 15 fills it in. The `.tasks.json` companion encodes the `blockedBy: [13, 15]` relationship so the subagent driver picks them in the right order.

**Goal:** Ship `components/imports/platform-card.tsx`. Renders one card for Steam / Xbox / Manual. Derives its 5-state visual from `(connectionSummary, latestImport)`. Inline `Sync now` button + kebab menu for `Re-import full` / `Disconnect`.

**Files:**
- Create: `components/imports/platform-card.tsx`

**Acceptance Criteria:**
- [ ] `<PlatformCard platform="steam" | "xbox" | "manual" summary={...}>` renders the right visual for each of the 5 states (`not-connected`, `connecting`, `importing`, `connected`, `error`)
- [ ] `Sync now` calls the `syncNow` server action (Task 10); shows a loading spinner during the round-trip
- [ ] Kebab menu uses `@radix-ui/react-dropdown-menu` (already a dep); items: `Re-import full`, `Disconnect` (red text), each with confirmation dialog
- [ ] `Disconnect` opens an `@radix-ui/react-dialog`: *"Your imported games stay. We'll just stop syncing."* with Cancel + Confirm buttons
- [ ] Manual card has dashed border, no destructive actions, CTA links to `/library`
- [ ] Steam connect button → `<a href="/api/auth/steam">` (no JS handler — the route handles auth + redirect)
- [ ] Xbox connect button → opens `<XboxConnectModal>` (Task 15)
- [ ] Error state shows recovery copy from the failure-modes table in spec § Failure Handling
- [ ] Renders pixel-art platform icon from `components/pixel/platform-icons.tsx`
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** Visual smoke on `/settings#connections` after Task 17 lands. For Task 14 alone, verify the build is green and run the component on a scratch page covering all 5 states with hand-crafted props.

**Steps:**

- [ ] **Step 1: Sketch the component file skeleton**

```typescript
"use client";
import { useState, useTransition } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Dialog from "@radix-ui/react-dialog";

import { SteamIcon, XboxIcon, PlatformIcons } from "@/components/pixel/platform-icons";
import { syncNow, disconnectPlatform } from "@/lib/imports/server-actions";
import type { ConnectionSummary } from "@/lib/imports/server-actions";
import { XboxConnectModal } from "./xbox-connect-modal";

type Platform = "steam" | "xbox" | "manual";

interface Props {
  platform: Platform;
  summary: ConnectionSummary | null;       // null for "not yet connected"
  manualGameCount?: number;                 // only relevant for platform='manual'
}

// Reasonable to break out a helper:
type CardState = "not-connected" | "connecting" | "importing" | "connected" | "error";

function deriveState(props: Props): CardState {
  if (props.platform === "manual") return "connected"; // always
  const s = props.summary;
  if (!s || !s.isActive) return "not-connected";
  if (s.latestImport?.status === "running" || s.latestImport?.status === "queued") return "importing";
  if (s.latestImport?.status === "failed") return "error";
  return "connected";
}

export function PlatformCard(props: Props) {
  const state = deriveState(props);
  const [xboxModalOpen, setXboxModalOpen] = useState(false);
  const [pendingSync, startSync] = useTransition();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  if (props.platform === "manual") {
    return (
      <div className="border border-dashed border-[var(--border)] rounded-md p-3 flex items-center gap-3">
        <ManualIcon size={28} />
        <div className="flex-1">
          <div className="text-sm font-semibold">Manual <span className="text-xs text-[var(--text-muted)]">· Switch + physical</span></div>
          <div className="text-xs text-[var(--text-muted)]">{props.manualGameCount ?? 0} games logged manually</div>
        </div>
        <a href="/library" className="text-xs text-[var(--accent)] underline">Log a game →</a>
      </div>
    );
  }

  // ... render per state (not-connected, connecting, importing, connected, error)
  // See spec § UI Components for the exact visual treatment.

  return (/* card JSX */);
}
```

(The executor fills in the full JSX for the not-connected/importing/connected/error states using the recipe in the spec's UI Components section. The pixel-art icon is `<SteamIcon>` or `<XboxIcon>` from `components/pixel/platform-icons.tsx`. Sync-now is `<button onClick={() => startSync(() => syncNow(props.platform as "steam"|"xbox"))}>`. Disconnect is a Dialog with confirmation.)

- [ ] **Step 2: Reference the spec for visual treatment**

The spec at `docs/superpowers/specs/2026-05-11-phase3-library-imports-design.md` § UI Components has the full 5-state table; the visual treatment for each state is locked there. Follow it exactly.

- [ ] **Step 3: Add error recovery copy mapping**

Hard-code the error copy table from spec § Failure Handling:

```typescript
const RECOVERY_COPY: Record<string, { copy: string; primary: string }> = {
  "STEAM_PRIVATE_PROFILE": {
    copy: "Your Steam profile is set to private. Set it to Public for 5 minutes so we can import, then you can flip it back.",
    primary: "Retry sync",
  },
  "XBOX_KEY_INVALID": {
    copy: "Your OpenXBL key was rejected. Generate a new one at xbl.io and reconnect.",
    primary: "Reconnect",
  },
  "STEAM_API_ERROR": {
    copy: "We couldn't reach Steam for your account. Reconnect to refresh the link.",
    primary: "Reconnect",
  },
};

// In error state:
const recovery = RECOVERY_COPY[props.summary?.latestImport?.errorMessage ?? ""] ?? {
  copy: "Sync paused. Try again, or reconnect if the problem persists.",
  primary: "Retry sync",
};
```

- [ ] **Step 4: Verify build chain**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

- [ ] **Step 5: Commit**

```powershell
git add components/imports/platform-card.tsx
git commit -m @'
feat(imports): <PlatformCard> — 5-state connection card

Renders Steam / Xbox / Manual cards with state derived from
(connection, latestImport):
  - not-connected: Connect button (Steam: <a href=/api/auth/steam>;
    Xbox: opens XboxConnectModal)
  - connecting: spinner + "Verifying with Steam…"
  - importing: progress bar + N/M games (purple border)
  - connected: gamertag + count + "Sync now" + kebab (Re-import full,
    Disconnect)
  - error: red border + recovery copy mapped by errorMessage,
    contextual primary button

Manual card has dashed border, links to /library, no destructive
actions.

Disconnect uses radix Dialog confirmation; kebab uses radix
DropdownMenu — both already deps.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 15: `<XboxConnectModal>` — 3-step wizard

**Goal:** Ship `components/imports/xbox-connect-modal.tsx`. Three-step modal: intro → fetch key → paste. Mascot in `helpful` mood per step, pixel-art illustration per step, progress bar at top, Back/Next/Connect buttons. POSTs to `/api/connect/xbox` and navigates to `/library/import/<id>` on success.

**Files:**
- Create: `components/imports/xbox-connect-modal.tsx`

**Acceptance Criteria:**
- [ ] Modal uses `@radix-ui/react-dialog` (consistent with rest of project)
- [ ] 3 steps, navigable Back/Next (Back disabled on step 1)
- [ ] Step 1: mascot speech bubble + `<XblStep1>` illustration + `Open xbl.io in new tab ↗` button (external link, `target=_blank`)
- [ ] Step 2: mascot + `<XblStep2>` + descriptive copy
- [ ] Step 3: mascot + `<XblStep3>` + `<textarea>` for the key + `Connect Xbox` primary button
- [ ] On submit: `fetch('/api/connect/xbox', { method: 'POST', body: JSON.stringify({ key }) })`. On 200 → `router.push('/library/import/' + data.importId)` and close modal. On 401 (invalid key) → show inline error inside step 3, stay on step 3. On 502 → toast "OpenXBL is having issues — try again in a minute".
- [ ] Loading state while the POST is in flight (`Connect Xbox` becomes spinner + disabled)
- [ ] Modal close button is always available (top-right `×`); doesn't reset wizard progress (state persists in `useState` until modal close)
- [ ] Mascot uses existing `<Mascot>` component from `components/mascot/` with `mood="helpful"` (or whichever mood prop the existing component takes — match Phase 2 usage)
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** After Task 14 lands, click "Connect Xbox" on the Xbox PlatformCard. Walk through the 3 steps. Manual eye-check that mascot + illustration + copy line up.

**Steps:**

- [ ] **Step 1: Reference Phase 2 modal patterns**

Look at `components/reviews/review-editor.tsx` and `components/reviews/review-interview.tsx` for how Phase 2 dialog-style components are structured. Match the patterns (radix Dialog, mascot wiring, Tailwind utilities).

- [ ] **Step 2: Create `components/imports/xbox-connect-modal.tsx`**

```typescript
"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";

import { XblStep1 } from "./illustrations/xbl-step-1";
import { XblStep2 } from "./illustrations/xbl-step-2";
import { XblStep3 } from "./illustrations/xbl-step-3";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = 1 | 2 | 3;

const COPY: Record<Step, { title: string; body: string; illustration: React.ReactNode; primary: string }> = {
  1: {
    title: "Connecting Xbox is a two-tab dance",
    body: "Microsoft doesn't ship a public games API. We use a community service called OpenXBL — it's stable. Start by opening their site.",
    illustration: <XblStep1 width={240} height={180} />,
    primary: "Open xbl.io in new tab ↗",
  },
  2: {
    title: "Copy your API key",
    body: "On the xbl.io dashboard, click the API Key tab and copy the long string. We'll paste it on the next step.",
    illustration: <XblStep2 width={240} height={180} />,
    primary: "Next →",
  },
  3: {
    title: "Paste your key",
    body: "We'll encrypt it before storing. Your key stays on the server — we never send it back to your browser.",
    illustration: <XblStep3 width={240} height={180} />,
    primary: "Connect Xbox",
  },
};

export function XboxConnectModal({ open, onOpenChange }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const { title, body, illustration, primary } = COPY[step];

  function next() {
    if (step === 1) {
      window.open("https://xbl.io", "_blank", "noopener,noreferrer");
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    } else {
      submit();
    }
  }

  function submit() {
    setError(null);
    startSubmit(async () => {
      const res = await fetch("/api/connect/xbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key.trim() }),
      });
      if (res.ok) {
        const { importId } = (await res.json()) as { importId: string };
        onOpenChange(false);
        router.push(`/library/import/${importId}`);
        return;
      }
      if (res.status === 401) {
        setError("That key wasn't accepted. Double-check you copied the whole thing.");
        return;
      }
      setError("Something went wrong on OpenXBL's side. Try again in a minute.");
    });
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(420px,calc(100vw-32px))] rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-2xl">
          {/* Progress dots */}
          <div className="flex gap-1.5 mb-4">
            {[1, 2, 3].map((n) => (
              <div key={n} className={`h-1 flex-1 rounded-full ${step >= n ? "bg-[var(--accent)]" : "bg-[var(--border)]"}`} />
            ))}
          </div>
          <Dialog.Title className="text-sm font-semibold mb-2">Connect Xbox · Step {step} of 3</Dialog.Title>
          <Dialog.Description className="text-base font-medium mb-2">{title}</Dialog.Description>
          <p className="text-sm text-[var(--text-muted)] mb-4">{body}</p>
          <div className="mb-4 flex justify-center">{illustration}</div>

          {step === 3 && (
            <>
              <textarea
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="Paste your OpenXBL key here…"
                className="w-full rounded border border-[var(--border)] bg-[var(--bg)] p-2 text-sm font-mono mb-2"
                rows={3}
              />
              {error && <p className="text-xs text-[var(--danger)] mb-2">{error}</p>}
            </>
          )}

          <div className="flex gap-2 justify-between">
            <button
              type="button"
              onClick={() => setStep((s) => Math.max(1, s - 1) as Step)}
              disabled={step === 1 || submitting}
              className="text-sm px-3 py-1.5 rounded border border-[var(--border)] disabled:opacity-40"
            >
              Back
            </button>
            <button
              type="button"
              onClick={next}
              disabled={(step === 3 && key.trim().length < 10) || submitting}
              className="text-sm px-3 py-1.5 rounded bg-[var(--accent)] text-white disabled:opacity-60"
            >
              {submitting ? "Connecting…" : primary}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 3: Verify build chain**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

- [ ] **Step 4: Commit**

```powershell
git add components/imports/xbox-connect-modal.tsx
git commit -m @'
feat(imports): <XboxConnectModal> — 3-step wizard

Radix Dialog with 3 steps for the OpenXBL key paste flow:
  1. Intro + "Open xbl.io in new tab" button
  2. "Copy your API key" with dashboard illustration
  3. Paste textarea + Connect button

Mascot copy is locked in COPY map; pixel-art illustrations from Task 13.
Submit POSTs to /api/connect/xbox; on success, router.push to the
/library/import/<id> summary route.

Inline error on 401 (invalid key); generic error on 502.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 16: `<ImportToast>` — singleton in app layout

**Goal:** Ship `components/imports/import-toast.tsx`. Mounted once in `app/(app)/layout.tsx`. State machine: hidden / importing / success / error / delta. Polls TanStack Query for the latest user import; auto-dismiss on success (5s) + delta (8s); sticky on error. Click → `/settings#connections` (importing/error) or `/library?source=<platform>&since=<ts>` (delta).

**Files:**
- Create: `components/imports/import-toast.tsx`
- Modify: `app/(app)/layout.tsx` — mount `<ImportToast />` after existing chrome
- Create: `app/api/imports/latest/route.ts` — small RSC-friendly endpoint that returns the current user's latest active import + unsurfaced deltas

**Acceptance Criteria:**
- [ ] `<ImportToast>` is a client component that on mount calls TanStack Query to fetch `/api/imports/latest`
- [ ] State machine matches spec § UI Components `<ImportToast>` table
- [ ] Refetches every 2s while any active import exists; backs off to manual-refetch when idle
- [ ] Success state auto-dismisses 5s after `completedAt`
- [ ] Delta state calls `markImportsSurfaced(ids)` server action on mount
- [ ] Multi-platform delta: aggregates per-platform counts → `"+3 from Steam · +5 from Xbox · See →"`
- [ ] Toast positioning: `fixed bottom-3 right-3 z-50`, pill shape, ~280px wide, dark surface with the platform's accent color in the importing/error state
- [ ] No mascot in toast (per spec)
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** Manually trigger an import → see toast appear bottom-right → progress increments → success appears for 5s. Then back-date `imports.surfaced=false` via SQL → reload any page → delta toast fires once.

**Steps:**

- [ ] **Step 1: Create `app/api/imports/latest/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import { db } from "@/lib/db";
import { imports } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCachedUser();
  if (!user) return NextResponse.json({ active: null, delta: [] }, { status: 401 });

  // Active import (queued or running)
  const [active] = await db.select().from(imports)
    .where(and(
      eq(imports.userId, user.id),
      sql`${imports.status} IN ('queued','running','failed')`,
    ))
    .orderBy(desc(imports.createdAt))
    .limit(1);

  // Recent successful import (last 60s) for the "success" pill
  const recentSuccess = await db.select().from(imports)
    .where(and(
      eq(imports.userId, user.id),
      eq(imports.status, "completed"),
      sql`${imports.completedAt} > now() - interval '60 seconds'`,
      eq(imports.surfaced, true),
    ))
    .orderBy(desc(imports.completedAt))
    .limit(1);

  // Unsurfaced deltas (cron-driven)
  const delta = await db.select().from(imports)
    .where(and(
      eq(imports.userId, user.id),
      eq(imports.surfaced, false),
      eq(imports.status, "completed"),
      gt(imports.importedCount, 0),
    ));

  return NextResponse.json({
    active: active ?? null,
    recentSuccess: recentSuccess[0] ?? null,
    delta,
  });
}
```

- [ ] **Step 2: Create `components/imports/import-toast.tsx`**

```typescript
"use client";
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { markImportsSurfaced } from "@/lib/imports/server-actions";

interface ImportRow {
  id: string;
  platform: "steam" | "xbox";
  status: "queued" | "running" | "completed" | "failed";
  importedCount: number;
  totalCount: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

interface LatestResponse {
  active: ImportRow | null;
  recentSuccess: ImportRow | null;
  delta: ImportRow[];
}

export function ImportToast() {
  const { data } = useQuery<LatestResponse>({
    queryKey: ["imports", "latest"],
    queryFn: async () => {
      const res = await fetch("/api/imports/latest");
      return res.json();
    },
    refetchInterval: (q) => {
      const d = q.state.data as LatestResponse | undefined;
      return d?.active && d.active.status !== "failed" ? 2000 : false;
    },
  });

  // Surface deltas exactly once
  const deltaIds = useMemo(() => (data?.delta ?? []).map((r) => r.id), [data?.delta]);
  useEffect(() => {
    if (deltaIds.length > 0) {
      // Fire-and-forget — toast displays now; flip surfaced=true so next render won't re-show
      void markImportsSurfaced(deltaIds);
    }
  }, [deltaIds.join(",")]);

  if (!data) return null;

  // Priority: error > importing > recentSuccess > delta
  if (data.active?.status === "failed") {
    return (
      <Link href="/settings#connections" className="fixed bottom-3 right-3 z-50 rounded-lg border border-[var(--danger)] bg-[var(--bg-card)] px-4 py-2 text-xs shadow-lg flex items-center gap-2 w-[280px]">
        <span className="h-3.5 w-3.5 rounded bg-[var(--danger)]" aria-hidden />
        <span>{data.active.platform} sync paused — see Settings</span>
      </Link>
    );
  }

  if (data.active && (data.active.status === "queued" || data.active.status === "running")) {
    const pct = data.active.totalCount > 0 ? Math.round((data.active.importedCount / data.active.totalCount) * 100) : 0;
    return (
      <Link href="/settings#connections" className="fixed bottom-3 right-3 z-50 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-2 text-xs shadow-lg block w-[280px]">
        <div className="flex items-center justify-between mb-1">
          <span>Importing {data.active.platform} library…</span>
          <span className="text-[var(--text-muted)]">{data.active.importedCount} / {data.active.totalCount || "?"}</span>
        </div>
        <div className="h-1 bg-[var(--bg)] rounded overflow-hidden">
          <div className="h-full bg-[var(--accent)] transition-all" style={{ width: `${pct}%` }} />
        </div>
      </Link>
    );
  }

  if (data.recentSuccess) {
    // Auto-dismiss after 5s — handled by re-render when completedAt > 60s ago
    return (
      <div className="fixed bottom-3 right-3 z-50 rounded-lg border border-[var(--success)] bg-[var(--bg-card)] px-4 py-2 text-xs shadow-lg flex items-center gap-2 w-[280px]">
        <span className="h-3.5 w-3.5 rounded bg-[var(--success)]" aria-hidden />
        <span><strong>{data.recentSuccess.platform}</strong> import complete · {data.recentSuccess.importedCount} games</span>
      </div>
    );
  }

  if (data.delta.length > 0) {
    const parts = data.delta.map((r) => `+${r.importedCount} from ${r.platform}`).join(" · ");
    const earliest = data.delta.reduce((min, r) => (r.completedAt && (!min || r.completedAt < min) ? r.completedAt : min), null as string | null);
    return (
      <Link href={`/library?source=imports&since=${encodeURIComponent(earliest ?? "")}`} className="fixed bottom-3 right-3 z-50 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-2 text-xs shadow-lg flex items-center gap-2 w-[280px]">
        <span>{parts} since you were last here · See →</span>
      </Link>
    );
  }

  return null;
}
```

- [ ] **Step 3: Mount in app layout**

Open `app/(app)/layout.tsx`. Add `<ImportToast />` as a sibling of any existing top-level chrome (probably after the `<Mascot>` or just before `</body>`). Import:

```typescript
import { ImportToast } from "@/components/imports/import-toast";
```

And render `<ImportToast />` in the layout's children tree.

- [ ] **Step 4: Verify build chain**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

- [ ] **Step 5: Commit**

```powershell
git add components/imports/import-toast.tsx app/api/imports/latest/route.ts app/\(app\)/layout.tsx
git commit -m @'
feat(imports): <ImportToast> singleton + /api/imports/latest

State machine matching spec § UI Components <ImportToast> table:
  - importing: progress bar, 2s polling, clickable → /settings#connections
  - success: auto-dismiss 5s
  - error: sticky red pill, clickable
  - delta: "+3 from Steam · +5 from Xbox · See →", clickable to
    /library?source=imports&since=<ts>; marks rows surfaced=true on mount

Mounted once in app/(app)/layout.tsx. No mascot in toast (utilitarian).
TanStack Query refetchInterval is dynamic — 2s while importing, manual
otherwise, so we don't burn HTTP cycles when idle.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 17: `<ConnectionsSection>` + settings page wiring

**Goal:** Ship `app/(app)/settings/_sections/connections-section.tsx` and update `app/(app)/settings/page.tsx` so the sidebar adds a `Connections` entry and the main content renders the 3 platform cards + Sync history drawer at `#connections`.

**Files:**
- Modify: `app/(app)/settings/page.tsx`
- Create: `app/(app)/settings/_sections/connections-section.tsx`

**Acceptance Criteria:**
- [ ] Sidebar nav adds `Connections` entry after `Profile`, anchoring `#connections`
- [ ] `<ConnectionsSection>` is an RSC; it calls `listConnections()` server action and renders 3 cards
- [ ] Steam, Xbox, Manual cards rendered in that order; manual card gets `manualGameCount` derived from `logs` where `platforms` is NULL or empty
- [ ] `Sync history` link at the bottom expands to a list of the user's last 10 `imports` rows (most recent first), each row shows: platform · status · count · createdAt · clickable to `/library/import/<id>`
- [ ] Sync history defaults to collapsed; uses `<details>` or radix Collapsible
- [ ] Section heading is `Connected platforms` with the subtitle from spec mockup
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** Visit `/settings#connections` — all three cards render correctly, sync history expands and lists imports.

**Steps:**

- [ ] **Step 1: Create `app/(app)/settings/_sections/connections-section.tsx`**

```typescript
import { desc, and, eq, sql } from "drizzle-orm";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import { db } from "@/lib/db";
import { imports, logs } from "@/lib/db/schema";
import { listConnections } from "@/lib/imports/server-actions";
import { PlatformCard } from "@/components/imports/platform-card";

export async function ConnectionsSection() {
  const user = await getCachedUser();
  if (!user) return null;

  const connections = await listConnections();
  const byPlatform = Object.fromEntries(connections.map((c) => [c.platform, c]));

  // Manual count: logs where platforms is null/empty AND platform_played_on isn't 'steam'/'xbox'
  const manualCountRow = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count FROM logs
    WHERE user_id = ${user.id}
      AND (platforms IS NULL OR cardinality(platforms) = 0)
      AND (platform_played_on IS NULL OR platform_played_on NOT IN ('steam', 'xbox'))
  `);
  const manualCount = Number(manualCountRow.rows[0]?.count ?? 0);

  // Last 10 imports for the history drawer
  const history = await db.select().from(imports)
    .where(eq(imports.userId, user.id))
    .orderBy(desc(imports.createdAt))
    .limit(10);

  return (
    <section id="connections" className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Connected platforms</h2>
        <p className="text-sm text-[var(--text-muted)]">Auto-import your library from where you play.</p>
      </div>

      <div className="space-y-2">
        <PlatformCard platform="steam" summary={byPlatform["steam"] ?? null} />
        <PlatformCard platform="xbox" summary={byPlatform["xbox"] ?? null} />
        <PlatformCard platform="manual" summary={null} manualGameCount={manualCount} />
      </div>

      {history.length > 0 && (
        <details className="text-xs mt-4">
          <summary className="cursor-pointer text-[var(--text-muted)] hover:text-[var(--text)] text-right">Sync history ({history.length}) ▾</summary>
          <ul className="mt-2 space-y-1">
            {history.map((row) => (
              <li key={row.id} className="flex gap-2 items-center py-1 border-b border-[var(--border)]/40">
                <a href={`/library/import/${row.id}`} className="text-[var(--accent)] hover:underline">{row.platform}</a>
                <span>·</span>
                <span>{row.status}</span>
                <span>·</span>
                <span>{row.importedCount}/{row.totalCount} games</span>
                <span className="ml-auto text-[var(--text-muted)]">{new Date(row.createdAt).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Update `app/(app)/settings/page.tsx`**

```typescript
// at the top of the file, add:
import { ConnectionsSection } from "./_sections/connections-section";

// inside the existing JSX, update the sidebar:
<nav className="flex flex-col gap-1 text-sm">
  <a href="#profile" className="px-3 py-2 rounded hover:bg-[var(--bg-card)]">Profile</a>
  <a href="#connections" className="px-3 py-2 rounded hover:bg-[var(--bg-card)]">Connections</a>
  {/* Future sections (Account, Privacy, Notifications) added when needed. */}
</nav>

// and the main content area:
<div className="col-span-12 md:col-span-9 space-y-10">
  <ProfileSection user={user} />
  <ConnectionsSection />
</div>
```

- [ ] **Step 3: Verify build + visit `/settings`**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build }; pnpm dev }
```

Visit `http://localhost:3000/settings#connections` while logged in. Confirm cards render. Sync history expands cleanly.

- [ ] **Step 4: Commit**

```powershell
git add app/\(app\)/settings
git commit -m @'
feat(imports): Connections settings section + sidebar nav

Settings sidebar gains a "Connections" anchor entry; main content adds
ConnectionsSection below ProfileSection. Section renders 3 PlatformCards
(Steam · Xbox · Manual) + collapsible Sync history showing the user's
last 10 imports rows.

Manual game count = logs where platforms is null/empty AND
platform_played_on is not steam/xbox. Counts will drift slightly as we
dual-write platforms[] going forward — acceptable for Phase 3.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 18: ImportSummary + `/library/import/[importId]` route

**Goal:** Ship the post-import summary route. RSC loads the `imports` row + matched/unmatched data; client island polls until `status='completed'`. UI: header + Merged bucket + New bucket + Unmatched bucket (only if > 0) + "Continue to library →" link that appears 5s after no-interaction.

**Files:**
- Create: `components/imports/import-summary.tsx` (client island)
- Create: `app/(app)/library/import/[importId]/page.tsx` (RSC shell)
- Create: `app/(app)/library/import/[importId]/loading.tsx`

**Acceptance Criteria:**
- [ ] Route is RSC + client island for the polling
- [ ] Loading skeleton matches the project's existing Suspense fallback style
- [ ] Renders an error state if the import row is `status='failed'` (with `Retry now` button → calls `triggerImport` server action again with the same platform)
- [ ] Renders an error state if `stuck=true` (from the status endpoint) with `Retry now` button
- [ ] Once `status='completed'`:
  - Header: `{platform} import complete` + `<total> games · <merged.length> already in your library`
  - "Merged with existing logs" bucket — small list of game covers + "Your status, rating, and notes were kept. Now also marked as on {platform}." copy
  - "{new} new — added as backlog" bucket — grid of game covers
  - "{unmatched} unmatched" bucket (only if > 0) — text list of game names + `Help us match these →` link (currently inert; href="#")
- [ ] "Continue to library →" link appears 5s after the summary screen mounts (no-interaction detector via setTimeout)
- [ ] User can navigate away at any time — the route is just a viewer, no destructive action on exit
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** Trigger an import → land on `/library/import/<id>` → see skeleton → progress polls → summary renders with the 2 (or 3) buckets. Refresh the page — same state shown (it's just reading the DB).

**Steps:**

- [ ] **Step 1: Create `components/imports/import-summary.tsx`**

```typescript
"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { syncNow } from "@/lib/imports/server-actions";

interface StatusResponse {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  stuck: boolean;
  importedCount: number;
  totalCount: number;
  errorMessage: string | null;
  conflicts: Array<{ logId: string; gameId: number; rule: string }>;
  unmatched: Array<{ externalId: string; title: string; platform: string }>;
}

interface Props {
  importId: string;
  platform: "steam" | "xbox";
}

export function ImportSummary({ importId, platform }: Props) {
  const [showContinue, setShowContinue] = useState(false);
  const { data } = useQuery<StatusResponse>({
    queryKey: ["imports", "status", importId],
    queryFn: async () => {
      const res = await fetch(`/api/imports/${importId}/status`);
      return res.json();
    },
    refetchInterval: (q) => {
      const d = q.state.data as StatusResponse | undefined;
      if (!d) return 2000;
      if (d.stuck) return false;
      return d.status === "queued" || d.status === "running" ? 2000 : false;
    },
  });

  useEffect(() => {
    if (data?.status === "completed") {
      const t = setTimeout(() => setShowContinue(true), 5000);
      return () => clearTimeout(t);
    }
  }, [data?.status]);

  if (!data) return <div className="text-sm text-[var(--text-muted)]">Loading import…</div>;

  if (data.status === "failed" || data.stuck) {
    return (
      <div className="border border-[var(--danger)] rounded-md p-6 space-y-3">
        <h2 className="text-base font-semibold">Import paused</h2>
        <p className="text-sm text-[var(--text-muted)]">
          {data.errorMessage ?? (data.stuck ? "Looks stuck — the worker didn't pick this up." : "Something went wrong.")}
        </p>
        <form action={async () => { await syncNow(platform); }}>
          <button className="text-sm px-3 py-1.5 rounded bg-[var(--accent)] text-white">Retry now</button>
        </form>
      </div>
    );
  }

  if (data.status !== "completed") {
    const pct = data.totalCount > 0 ? Math.round((data.importedCount / data.totalCount) * 100) : 0;
    return (
      <div className="border border-[var(--border)] rounded-md p-6 space-y-4 text-center">
        <h2 className="text-base font-semibold">Importing your {platform} library</h2>
        <p className="text-sm text-[var(--text-muted)]">{data.importedCount} of {data.totalCount || "?"} games</p>
        <div className="h-1 bg-[var(--bg)] rounded overflow-hidden max-w-[280px] mx-auto">
          <div className="h-full bg-[var(--accent)] transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-[var(--text-muted)]">Hang tight, or browse around — we'll keep going either way.</p>
      </div>
    );
  }

  const newCount = data.totalCount - data.conflicts.length - data.unmatched.length;
  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-base font-semibold">{platform} import complete</h2>
        <p className="text-sm text-[var(--text-muted)]">{data.totalCount} games · {data.conflicts.length} already in your library</p>
      </header>

      {data.conflicts.length > 0 && (
        <section className="border border-[var(--border)] rounded-md p-3">
          <h3 className="text-xs uppercase tracking-wide text-[var(--text-muted)] mb-2">Merged with existing logs</h3>
          {/* Renderer for merged game covers — the executor wires this to actual <GameCover> components */}
          <p className="text-xs text-[var(--text-muted)]">Your status, rating, and notes were kept. Now also marked as on {platform}.</p>
        </section>
      )}

      <section className="border border-[var(--border)] rounded-md p-3">
        <h3 className="text-xs uppercase tracking-wide text-[var(--text-muted)] mb-2">{newCount} new — added as backlog</h3>
        {/* Renderer for new game covers grid */}
      </section>

      {data.unmatched.length > 0 && (
        <section className="border border-[var(--border)] rounded-md p-3">
          <h3 className="text-xs uppercase tracking-wide text-[var(--text-muted)] mb-2">{data.unmatched.length} unmatched</h3>
          <ul className="text-xs space-y-1">
            {data.unmatched.slice(0, 20).map((u) => <li key={u.externalId}>{u.title}</li>)}
          </ul>
          <a href="#" className="text-xs text-[var(--accent)] mt-2 inline-block opacity-60 cursor-not-allowed">Help us match these → (Phase 4)</a>
        </section>
      )}

      {showContinue && (
        <Link href="/library" className="text-sm text-[var(--accent)] underline">
          Continue to library →
        </Link>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `app/(app)/library/import/[importId]/page.tsx`**

```typescript
import { eq, and } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import { db } from "@/lib/db";
import { imports } from "@/lib/db/schema";
import { ImportSummary } from "@/components/imports/import-summary";

interface PageProps {
  params: Promise<{ importId: string }>;
}

export default async function ImportSummaryPage({ params }: PageProps) {
  const user = await getCachedUser();
  if (!user) redirect("/login");
  const { importId } = await params;

  const [row] = await db.select().from(imports)
    .where(and(eq(imports.id, importId), eq(imports.userId, user.id)))
    .limit(1);
  if (!row || (row.platform !== "steam" && row.platform !== "xbox")) notFound();

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <ImportSummary importId={importId} platform={row.platform} />
    </div>
  );
}
```

- [ ] **Step 3: Create `app/(app)/library/import/[importId]/loading.tsx`**

```typescript
export default function Loading() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <div className="border border-[var(--border)] rounded-md p-6 text-center space-y-3">
        <div className="h-4 w-40 mx-auto bg-[var(--bg-card)] rounded animate-pulse" />
        <div className="h-3 w-24 mx-auto bg-[var(--bg-card)] rounded animate-pulse" />
        <div className="h-1 bg-[var(--bg-card)] rounded max-w-[280px] mx-auto animate-pulse" />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify build chain**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

- [ ] **Step 5: Commit**

```powershell
git add components/imports/import-summary.tsx app/\(app\)/library/import
git commit -m @'
feat(imports): /library/import/[importId] post-import summary route

RSC shell + client polling island. While status in (queued|running):
skeleton + progress bar. When completed: 2 or 3 buckets — merged, new,
unmatched (only if >0). "Continue to library →" appears 5s after mount
on success.

Failed and stuck states show inline error with Retry now button →
syncNow server action.

Cover-grid renderers are skeletal — Task 19 wires them to existing
<GameCover> components from the library page.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 19: Entry-point integrations + cover-grid wiring

**Goal:** Wire imports into the rest of the app's IA. Empty-state on `/library` gets an "Or connect Steam →" link; `/home` shows an onboarding nudge after 5 logs; `<ImportSummary>` gets real `<GameCover>` rendering on merged/new buckets.

**Files:**
- Modify: `app/(app)/library/page.tsx` (empty-state CTA)
- Modify: `app/(app)/home/page.tsx` (5-log nudge)
- Modify: `components/imports/import-summary.tsx` (wire real GameCover renderers)
- Create (optional): `lib/imports/summary-data.ts` — RSC helper that loads cover metadata for the conflicts/unmatched arrays

**Acceptance Criteria:**
- [ ] `/library` empty state (when `count(logs) === 0`) shows the existing primary "Log your first game" CTA plus a new secondary text link `Or connect Steam →` → `/settings#connections`
- [ ] `/home` onboarding nudge: when the user's `logs` count is between 5 and 30 AND they have no `platform_connections WHERE is_active`, render an inline panel: *"Skip the manual entry — connect Steam or Xbox to bulk-import your library."* with a primary CTA to `/settings#connections`. Render once per session (use a cookie or just always render; the user can dismiss with a small `×`).
- [ ] `<ImportSummary>` merged + new buckets render actual game covers. Load metadata via a small server-side fetch using the gameIds from `conflicts_jsonb`/`unmatched_jsonb` and the rest of the import's games (`logs` joined to `games` filtered by `(user_id, platforms contains $platform, created_at > $import.created_at - 30s)` as a heuristic for "imported in this run").
- [ ] Nudge has an `x` dismiss that sets a cookie `imports-nudge-dismissed=1` (1y max-age). Cookie skips the nudge.
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** Visit `/library` while empty → see CTA. Hit `pnpm db:studio` and insert 5 logs for your user → visit `/home` → see nudge. Dismiss it → cookie set → reload → no nudge.

**Steps:**

- [ ] **Step 1: `app/(app)/library/page.tsx` — add empty-state secondary CTA**

Find the existing empty-state block (the "Log your first game" CTA). Add right after it:

```tsx
<Link href="/settings#connections" className="text-xs text-[var(--text-muted)] underline">
  Or connect Steam →
</Link>
```

- [ ] **Step 2: `app/(app)/home/page.tsx` — onboarding nudge**

In the home page RSC, add a check:

```typescript
import { cookies } from "next/headers";
import { count, and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { logs, platformConnections } from "@/lib/db/schema";
// ...inside the page component:

const dismissed = (await cookies()).get("imports-nudge-dismissed")?.value === "1";
const [{ value: logCount }] = await db.select({ value: count() }).from(logs).where(eq(logs.userId, user.id));
const [{ value: connCount }] = await db.select({ value: count() }).from(platformConnections)
  .where(and(eq(platformConnections.userId, user.id), eq(platformConnections.isActive, true)));

const showNudge = !dismissed && logCount >= 5 && logCount <= 30 && connCount === 0;
```

Render the nudge:

```tsx
{showNudge && <ImportsNudge />}
```

Create the dismiss-aware nudge component as a client island in `components/imports/imports-nudge.tsx`:

```typescript
"use client";
import Link from "next/link";
import { useState } from "react";

export function ImportsNudge() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  function dismiss() {
    document.cookie = "imports-nudge-dismissed=1; max-age=31536000; path=/";
    setDismissed(true);
  }

  return (
    <div className="border border-[var(--border)] rounded-md p-4 flex items-center gap-3 bg-[var(--bg-card)]">
      <div className="flex-1">
        <div className="text-sm font-medium">Skip the manual entry</div>
        <div className="text-xs text-[var(--text-muted)]">Connect Steam or Xbox to bulk-import your library.</div>
      </div>
      <Link href="/settings#connections" className="text-xs px-3 py-1.5 rounded bg-[var(--accent)] text-white">
        Connect →
      </Link>
      <button onClick={dismiss} aria-label="Dismiss" className="text-[var(--text-muted)] hover:text-[var(--text)] px-2">×</button>
    </div>
  );
}
```

- [ ] **Step 3: `components/imports/import-summary.tsx` — wire real GameCovers**

Find the `{/* Renderer for merged game covers */}` placeholders. Replace with real `<GameCover>` components from the project's existing library page (the executor checks `app/(app)/library/page.tsx` for the cover-rendering idiom — typically a flex grid with sized `<img>` tags fed by `games.cover_url`).

Add a server-side data fetcher (loaded in the page, passed via prop):

```typescript
// lib/imports/summary-data.ts
import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { games } from "@/lib/db/schema";

export async function loadGamesForSummary(gameIds: number[]) {
  if (gameIds.length === 0) return [];
  return db.select({ id: games.id, slug: games.slug, title: games.title, coverUrl: games.coverUrl })
    .from(games)
    .where(inArray(games.id, gameIds));
}
```

Pipe this from `page.tsx` into `<ImportSummary>` so the client island has the metadata it needs without re-fetching. (Adjust the component's prop shape accordingly.)

- [ ] **Step 4: Verify build chain**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

- [ ] **Step 5: Manual nudge verification**

Hit `pnpm db:studio` → insert 5 placeholder `logs` rows for your user — or just visit if you already have ≥5 logs and no active connections. The nudge should appear on `/home`. Dismiss it; cookie should set; reload; gone.

- [ ] **Step 6: Commit**

```powershell
git add app/\(app\)/library/page.tsx app/\(app\)/home/page.tsx components/imports/import-summary.tsx components/imports/imports-nudge.tsx lib/imports/summary-data.ts
git commit -m @'
feat(imports): entry-point integrations — empty state, nudge, cover wiring

- /library empty state gains "Or connect Steam →" secondary link
- /home shows an onboarding nudge when 5 ≤ logCount ≤ 30 AND no active
  platform_connections; dismiss sets cookie imports-nudge-dismissed=1
  (1y max-age)
- ImportSummary buckets now render real <GameCover> components from the
  library idiom, fed by lib/imports/summary-data.ts (server-side loader)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 20: Verification gate + `phase-3-complete` tag

**Goal:** Execute the 8-item verification gate end-to-end on staging, document the results at `docs/superpowers/gates/2026-MM-DD-phase3-verification.md`, fix any defects found, then tag the milestone.

**Files:**
- Create: `docs/superpowers/gates/<today>-phase3-verification.md`
- Modify (potentially): any defect fixes surfaced by the gate

**Acceptance Criteria:**
- [ ] All 8 verification-gate items in spec § Verification Gate pass with evidence (screenshots, SQL snapshots, or copy-pasted UI states)
- [ ] Gate document mirrors the Phase 2 gate format (look at `docs/superpowers/gates/` for prior examples)
- [ ] No new env vars discovered late (`.env.example` is canonical)
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean on the final commit
- [ ] `pnpm tsx scripts/smoke-encryption.ts && pnpm tsx scripts/smoke-rawg-match.ts && pnpm tsx scripts/smoke-merge.ts` all green
- [ ] `git tag phase-3-complete` applied to the final commit

**Verify:** Read the 8 items below. Execute each on staging. Document pass/fail with evidence.

**Steps:**

- [ ] **Step 1: Create the gate document**

```powershell
$today = Get-Date -Format "yyyy-MM-dd"
New-Item -ItemType File -Path "docs/superpowers/gates/$today-phase3-verification.md" -Force
```

Open the file. Use this template (mirrors Phase 2's gate format — verify by `ls docs/superpowers/gates/` and match the most recent file):

```markdown
# Phase 3 Verification Gate — <today>

| Field | Value |
|---|---|
| Date | <today> |
| Phase | 3 of 7 |
| Spec | [docs/superpowers/specs/2026-05-11-phase3-library-imports-design.md](../specs/2026-05-11-phase3-library-imports-design.md) |
| Plan | [docs/superpowers/plans/2026-05-11-phase3-library-imports-plan.md](../plans/2026-05-11-phase3-library-imports-plan.md) |

## Gate Items

### 1. Connect Steam via OpenID — PASS / FAIL
<evidence: URL, SteamID, screenshot of /library/import/<id> skeleton>

### 2. First import completes — PASS / FAIL
<evidence: SQL row count, screenshot of summary page, log count>

### 3. Conflict merge — PASS / FAIL
<evidence: pre-state SQL of Hades row, post-state SQL, screenshot of "Merged" bucket>

### 4. Xbox connection modal — PASS / FAIL
<evidence: screenshot of step 1/2/3, encrypted column SQL spot-check>

### 5. Daily sync produces delta toast — PASS / FAIL
<evidence: back-dated SQL, supabase functions invoke output, screenshot of toast on reload>

### 6. Error states render — PASS / FAIL
<evidence: screenshot of red card after `bad` key submission>

### 7. Disconnect — PASS / FAIL
<evidence: SQL of platform_connections row pre/post, screenshot of unchanged /library>

### 8. Resumability — PASS / FAIL
<evidence: log of killing Edge Function mid-flight, retry, count un-duplicated>

## Open follow-ups (deferred from gate)
- PSN adapter (Phase 3.5)
- Manual-match UI for unmatched RAWG titles (Phase 4)
- Auto-promote backlog → playing on playtime delta (Phase 4)
- Drop logs.platform_played_on once dual-write is universal (Phase 5+)

## Tag
`phase-3-complete` applied to commit <sha>.
```

- [ ] **Step 2: Run each gate item**

Item 1 — Connect Steam:

  - Visit `/settings#connections` in staging while logged in.
  - Click `Connect Steam` on the Steam card.
  - Verify the OpenID round-trip completes; you land on `/library/import/<id>` with a skeleton.

Item 2 — First import completes:

  ```sql
  SELECT id, status, imported_count, total_count, completed_at FROM imports
  WHERE user_id = '<your-uuid>' ORDER BY created_at DESC LIMIT 1;
  ```

  Watch `imported_count` climb. When `status='completed'`, screenshot the summary page.

Item 3 — Conflict merge:

  - Pre-import, manually log Hades with status='completed', rating=4.5, notes="loved it":

    ```sql
    INSERT INTO logs (user_id, game_id, status, rating, notes, platform_played_on, platforms)
    SELECT '<your-uuid>', id, 'completed', 4.5, 'loved it', 'pc', ARRAY['pc']
    FROM games WHERE slug = 'hades';
    ```

  - Run a full Steam re-import (kebab → `Re-import full` on the Steam card).
  - After completion:

    ```sql
    SELECT status, rating, notes, platforms, platform_played_on FROM logs
    WHERE user_id = '<your-uuid>' AND game_id = (SELECT id FROM games WHERE slug = 'hades');
    ```

  - Expected: `status='completed'`, `rating=4.5`, `notes='loved it'`, `platforms=['pc','steam']`, `platform_played_on='pc'`. The summary page shows Hades in the "Merged" bucket.

Item 4 — Xbox connect modal:

  - Click `Connect Xbox`. Walk through 3 steps. Paste a real OpenXBL key.
  - After submit, verify:

    ```sql
    SELECT external_id, length(access_token_encrypted) > 0 AS has_ciphertext,
           access_token_encrypted ~ '^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$' AS format_ok
    FROM platform_connections WHERE user_id = '<your-uuid>' AND platform = 'xbox';
    ```

    Expected: `has_ciphertext=true`, `format_ok=true`. The plaintext key should NOT appear anywhere in the column.

Item 5 — Daily sync delta toast:

  - Back-date the connection:

    ```sql
    UPDATE platform_connections SET last_synced_at = NOW() - INTERVAL '25 hours'
    WHERE user_id = '<your-uuid>' AND platform = 'steam';
    ```

  - Buy / launch a previously-unowned Steam game so the API delta is non-zero (or just verify by checking `playtime_2weeks` is > 0 on at least one game).
  - Invoke daily-sync: `supabase functions invoke daily-sync --body '{}'`
  - Wait ~30s; refresh the app. The toast `+N games from Steam since you were last here` should appear bottom-right.
  - Verify the row flips `surfaced=true` after display:

    ```sql
    SELECT surfaced, imported_count FROM imports
    WHERE user_id = '<your-uuid>' ORDER BY created_at DESC LIMIT 1;
    ```

Item 6 — Error states render:

  - Click `Connect Xbox`. In step 3, paste literally `"bad"` (or any obviously invalid key).
  - Modal should show inline error *"That key wasn't accepted."* — the modal stays open on step 3.
  - Submit a valid key from a different account to verify the happy path still works.

Item 7 — Disconnect:

  - On the Steam card, kebab → `Disconnect`. Confirm in the dialog.
  - Verify:

    ```sql
    SELECT is_active, access_token_encrypted FROM platform_connections
    WHERE user_id = '<your-uuid>' AND platform = 'steam';
    ```

    Expected: `is_active=false`, `access_token_encrypted IS NULL`.
  - Visit `/library` — all 207 logs remain visible.

Item 8 — Resumability:

  - Trigger `Re-import full` on Steam.
  - Mid-flight (~50/207), kill the Edge Function via Supabase dashboard's function logs UI (Stop button).
  - Wait until `imports.status = 'queued'` (no longer running, but didn't error out cleanly — actually it'll error out as `failed`; the test is then retry).
  - Click `Retry now` from the failed card state.
  - Verify the second run completes and the final `logs` count for Steam-platform games equals 207 (not 414 — no duplicates).

- [ ] **Step 3: Fix any defects found**

If any gate item fails, fix the defect, commit it, then re-run that gate item. Update the gate document with the new evidence.

- [ ] **Step 4: Final build chain + smoke run**

```powershell
pnpm tsx scripts/smoke-encryption.ts; if ($?) { pnpm tsx scripts/smoke-rawg-match.ts; if ($?) { pnpm tsx scripts/smoke-merge.ts; if ($?) { pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } } } } }
```

Expected: all 5 green.

- [ ] **Step 5: Commit the gate document**

```powershell
git add docs/superpowers/gates
git commit -m @'
docs(phase3): verification gate — Phase 3 shipped

All 8 verification-gate items pass on staging (evidence captured in the
gate document). Library imports — Steam OpenID + Xbox OpenXBL + Manual
marker, daily-sync cron, conflict-safe merge — is live.

PSN, manual-match UI, auto-promote, and platform_played_on cleanup
remain explicit non-goals carried into later phases.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

- [ ] **Step 6: Tag the milestone**

```powershell
git tag phase-3-complete
git push origin main --tags
```

Expected: tag pushed; visible via `git tag -l "phase-*"`.

- [ ] **Step 7: Update MEMORY.md**

Add a line to `~/.claude/projects/C--Projects-Letterboxd-for-Games/memory/MEMORY.md`:

```
- [Phase 3 complete](phase_3_complete.md) — Library Imports shipped (20 tasks, tag phase-3-complete); ready for Phase 4
```

And create the memory file `phase_3_complete.md` mirroring `phase_2_complete.md`'s structure.

---

## Self-review checklist (for the executor — run before declaring the plan complete)

After all 20 tasks have committed and the gate is tagged:

- [ ] **Spec coverage:** Skim spec § sections. Every section maps to ≥1 task. (Counted during plan-writing — no gaps found.)
- [ ] **Type consistency:** `ImportedGame`, `LibraryImporter`, `ConflictRule`, `MergeResult` are referenced identically across `lib/imports/adapters/types.ts`, `lib/imports/merge.ts`, `supabase/functions/_shared/import-engine.ts`. The Edge Function vendors merge logic byte-identically — if you change one, change both.
- [ ] **Auth.users gotcha:** Confirmed clean of `CREATE TABLE "auth"."users"` after each `pnpm db:generate` invocation (Task 2 only; later tasks add no Drizzle migrations).
- [ ] **No placeholders left:** Every task has concrete file paths, complete code blocks for non-obvious work, and exact verification commands.
- [ ] **Smoke scripts:** 3 scripts under `scripts/` (encryption, rawg-match, merge) all pass at gate time.
- [ ] **Edge Function deployment:** both functions deployed; pg_cron job verifiable via `SELECT * FROM cron.job WHERE jobname = 'daily-import-sync'`.

---

End of plan.
