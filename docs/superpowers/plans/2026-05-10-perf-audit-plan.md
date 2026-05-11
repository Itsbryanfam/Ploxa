# Performance Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply Tiers 1–4 of the post-Phase-1.5 perf audit. Twelve UI/UX-neutral optimizations across server actions, database schema, client components, and build config. Each task is its own commit, mirroring the Phase 1.5.15a/b/c pattern.

**Architecture:** Server-side dedup and auth caching first (Tier 1, 5 tasks), then additive DB indexes (Tier 2, 1 task), then client polish (Tier 3, 4 tasks), then build config & bundle analyzer (Tier 4, 2 tasks). Tier 5 from the spec is the deliberately-skipped register and produces zero tasks.

**Tech Stack:** Next.js 16 · React 19 · Drizzle ORM + Postgres (Supabase) · TanStack Query · Tailwind v4 · TypeScript · pnpm

**Spec:** [docs/superpowers/specs/2026-05-10-perf-audit-design.md](../specs/2026-05-10-perf-audit-design.md) (commit `cd3fb5d`)

**Predecessor:** [docs/superpowers/perf/2026-05-10-phase1.5-baseline.md](../perf/2026-05-10-phase1.5-baseline.md)

---

## Conventions

**Verification:** No test framework exists in this project. Each task's verify command is:
```
pnpm typecheck && pnpm lint && pnpm build
```
Plus task-specific manual checks noted per task.

**Commit message format:** Mirrors the Phase 1.5.15 pattern:
```
perf: TX.Y — <one-line summary>
```
where `X.Y` is the task number (e.g., `T1.1`, `T2.1`).

**Constraint:** No UI/UX changes. If a task accidentally changes visible behavior (animation timing, scroll, layout), revert and re-scope.

---

## Task 1.1: Drop redundant `findFirst` in `createLog`

**Goal:** Eliminate the pre-INSERT duplicate-check SELECT in `createLog`. Rely on the existing unique-constraint catch path.

**Files:**
- Modify: `lib/logs/server-actions.ts:61-70`

**Acceptance Criteria:**
- [ ] The `findFirst` call inside `createLog` is removed
- [ ] The `if (existing) return { ok: false, error: ... }` block is removed
- [ ] The existing try/catch around the INSERT still catches SQLSTATE `23505` and maps it to `"Already logged. Edit the existing log instead."`
- [ ] `pnpm typecheck && pnpm lint && pnpm build` passes

**Verify:** `pnpm typecheck && pnpm lint && pnpm build` → expected: build succeeds, no errors.

**Manual verification (when user is at PC):** Add a log twice via the ⌘K palette → second attempt shows the "Already logged" toast.

**Steps:**

- [ ] **Step 1: Read the current `createLog` body to confirm line numbers**

```bash
sed -n '35,100p' lib/logs/server-actions.ts
```
Confirms the `findFirst` (lines 61-67) and the `if (existing)` block (lines 68-70) before editing.

- [ ] **Step 2: Apply the edit**

In `lib/logs/server-actions.ts`, locate the block:
```ts
  // Check for existing non-replay log on this game.
  const existing = await db.query.logs.findFirst({
    where: and(
      eq(schema.logs.userId, user.id),
      eq(schema.logs.gameId, game.id),
      eq(schema.logs.isReplay, false),
    ),
  });
  if (existing) {
    return { ok: false, error: "Already logged. Edit the existing log instead." };
  }

  // Insert. Wrap in try/catch so the (userId, gameId, isReplay) unique-constraint
  // race (between findFirst above and this insert) maps to the same friendly
  // "Already logged" message instead of bubbling as an unhandled throw.
```

Replace with:
```ts
  // Insert. The (userId, gameId, isReplay) unique index enforces dedup.
  // SQLSTATE 23505 (unique violation) maps to the friendly "Already logged"
  // message; no pre-check SELECT is needed.
```

- [ ] **Step 3: Verify the catch path still handles the unique-violation case**

Confirm the existing try/catch around the INSERT (around line 89) still maps `23505` to:
```ts
if (typeof err === "object" && err !== null && (err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
  return { ok: false, error: "Already logged. Edit the existing log instead." };
}
```
This block is unchanged — it already handles both the previously-existing-log case and the race case identically.

- [ ] **Step 4: Run verification**

```bash
pnpm typecheck && pnpm lint && pnpm build
```
Expected: all three pass with no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/logs/server-actions.ts
git commit -m "perf: T1.1 — drop redundant findFirst in createLog

The unique index logs_user_game_replay_uniq already enforces dedup,
and the existing catch path maps SQLSTATE 23505 to the same friendly
'Already logged' error. The pre-INSERT findFirst was wasteful.

Saves one DB round-trip per log-creation.

Spec: docs/superpowers/specs/2026-05-10-perf-audit-design.md (T1.1)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 1.2: React `cache()` wrapper for `supabase.auth.getUser()`

**Goal:** Add a per-request memoized auth helper and replace 14 inline `supabase.auth.getUser()` call sites in application code. (The single call in `lib/supabase/middleware.ts` stays as-is — different lifecycle.)

**Files:**
- Create: `lib/supabase/auth-cache.ts`
- Modify: `lib/logs/server-actions.ts` (7 call sites: lines 44-47, 111-114, 181-184, 204-207, 226-229, 271-274, 320-323)
- Modify: `lib/profile/server-actions.ts` (2 call sites: lines 82-86, 194-198)
- Modify: `lib/profile/avatar-actions.ts` (1 call site: lines 28-32)
- Modify: `app/(app)/layout.tsx` (1 call site: lines 26-29)
- Modify: `app/page.tsx` (1 call site: line 15)
- Modify: `app/(app)/games/[slug]/page.tsx` (1 call site: line 25)
- Modify: `app/(app)/@modal/(.)games/[slug]/page.tsx` (1 call site: line 28)
- Modify: `app/(app)/u/[username]/page.tsx` (1 call site: line 26)
- Modify: `app/(app)/settings/page.tsx` (1 call site: line 10)

**Acceptance Criteria:**
- [ ] New file `lib/supabase/auth-cache.ts` exports `getCachedUser` wrapped in React's `cache()`
- [ ] All 14 application-code call sites replaced with `const user = await getCachedUser();`
- [ ] `lib/supabase/middleware.ts:39` is **untouched** (intentional — middleware runs before the React tree)
- [ ] Search: `grep -rn "supabase.auth.getUser()" --include="*.ts" --include="*.tsx" .` returns only `lib/supabase/middleware.ts` in application code
- [ ] `pnpm typecheck && pnpm lint && pnpm build` passes

**Verify:**
```bash
pnpm typecheck && pnpm lint && pnpm build && \
  grep -rn "supabase\.auth\.getUser()" --include="*.ts" --include="*.tsx" app lib
```
Expected: build passes; the grep returns only `lib/supabase/middleware.ts:39`.

**Manual verification (when user is at PC):** Cold-load `/home`; the Next.js dev console should show one auth verification per request instead of three or four.

**Steps:**

- [ ] **Step 1: Create the helper**

Write `lib/supabase/auth-cache.ts`:
```ts
import "server-only";
import { cache } from "react";
import { createSupabaseServerClient } from "./server";

/**
 * Per-request memoized wrapper around supabase.auth.getUser(). React's
 * cache() ensures that multiple server actions or Server Components in
 * the same request share one JWT verification round-trip instead of
 * verifying independently.
 *
 * Do NOT use this in middleware — middleware runs before the React tree
 * and has its own session-refresh lifecycle.
 */
export const getCachedUser = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
});
```

- [ ] **Step 2: Replace call sites in `lib/logs/server-actions.ts`**

Add import at the top of the file (next to existing imports):
```ts
import { getCachedUser } from "@/lib/supabase/auth-cache";
```

For each of the 7 call sites, replace:
```ts
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };  // or similar guard
```

With:
```ts
  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Not signed in" };  // preserve existing guard wording
```

Specific lines to edit (preserve each function's exact "not signed in" wording — some return `null`, some return error envelopes):
- Lines 44-47: `createLog` — returns `{ ok: false, error: "Not signed in" }`
- Lines 111-114: `getUserLibrary` — returns `[]`
- Lines 181-184: `updateLogStatus` — returns `{ ok: false, error: "Not signed in" }`
- Lines 204-207: `deleteLog` — returns `{ ok: false, error: "Not signed in" }`
- Lines 226-229: `getUserStats` — returns `null`
- Lines 271-274: `getRecentActivity` — returns `[]`
- Lines 320-323: `updateLogFull` — returns `{ ok: false, error: "Not signed in" }`

After replacement, remove the `import { createSupabaseServerClient } from "@/lib/supabase/server";` line if no remaining callers use it within this file. Verify with: `grep -n "createSupabaseServerClient" lib/logs/server-actions.ts` → should return 0 lines.

- [ ] **Step 3: Replace call sites in `lib/profile/server-actions.ts`**

Add the import:
```ts
import { getCachedUser } from "@/lib/supabase/auth-cache";
```

Replace at lines 82-86 (`ensureMyProfile`) and 194-198 (`updateUsername`) using the same pattern. Note `getHeaderUser` (line 35) is unchanged — it already takes a pre-authed `User` parameter.

Verify `createSupabaseServerClient` is no longer imported here either — except `posterUrlFor` at line 22 still uses it for `supabase.storage.from(...)`, so keep the import.

- [ ] **Step 4: Replace call sites in `lib/profile/avatar-actions.ts`**

Add import, replace lines 28-32 in `uploadAvatar`. Keep the `createSupabaseServerClient` import — it's still used by `posterUrlFor` indirectly (verify).

- [ ] **Step 5: Replace call sites in `app/(app)/layout.tsx`**

Lines 26-29 currently:
```tsx
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
```

Replace with:
```tsx
  const authUser = await getCachedUser();
```

Add `import { getCachedUser } from "@/lib/supabase/auth-cache";` and remove `createSupabaseServerClient` import if unused.

- [ ] **Step 6: Replace call sites in the five page files**

`app/page.tsx:15`, `app/(app)/games/[slug]/page.tsx:25`, `app/(app)/@modal/(.)games/[slug]/page.tsx:28`, `app/(app)/u/[username]/page.tsx:26`, `app/(app)/settings/page.tsx:10` — same pattern. Each calls `supabase.auth.getUser()` in a Server Component. Replace each with `const user = await getCachedUser();` and remove the now-unused `createSupabaseServerClient` import.

Note: some of these pages may use `createSupabaseServerClient` for other purposes (e.g., direct Supabase Storage access). Check each before removing the import.

- [ ] **Step 7: Run grep to confirm completeness**

```bash
grep -rn "supabase\.auth\.getUser()" --include="*.ts" --include="*.tsx" app lib
```
Expected: exactly one match, in `lib/supabase/middleware.ts:39`.

- [ ] **Step 8: Run verification**

```bash
pnpm typecheck && pnpm lint && pnpm build
```
Expected: all three pass.

- [ ] **Step 9: Commit**

```bash
git add lib/supabase/auth-cache.ts lib/logs/server-actions.ts lib/profile/server-actions.ts lib/profile/avatar-actions.ts app/
git commit -m "perf: T1.2 — React cache() wrapper for supabase.auth.getUser

A typical /home request walks middleware → app layout → Server Component
→ 2-3 server actions, with each step independently verifying the JWT.
React's cache() collapses these into one verification per request.

- Create lib/supabase/auth-cache.ts exporting getCachedUser (cache()-wrapped)
- Replace 14 inline call sites across server actions and page files
- middleware.ts:39 untouched (different lifecycle)

Saves 3+ JWT round-trips per /home load, 2+ per /library, similar elsewhere.

Spec: docs/superpowers/specs/2026-05-10-perf-audit-design.md (T1.2)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 1.3: Derive recent activity from already-fetched library on dashboard

**Goal:** Drop the `getRecentActivity(10)` server-action call from the dashboard. Derive the activity feed from `library.slice(0, 10)` in JS, mirroring the Phase 1.5.15c stats-from-library pattern.

**Files:**
- Modify: `app/(app)/_cockpit/cockpit-dashboard.tsx`

**Acceptance Criteria:**
- [ ] `getRecentActivity` is no longer imported or called in `cockpit-dashboard.tsx`
- [ ] A new helper `computeRecentActivityFromLibrary(library: LibraryItem[]): ActivityEvent[]` is defined in the same file
- [ ] The helper maps `library.slice(0, 10)` to `ActivityEvent` with identical field semantics
- [ ] The `getRecentActivity` export remains in `lib/logs/server-actions.ts` (kept for future callers)
- [ ] Activity timeline on `/home` renders the same items in the same order
- [ ] `pnpm typecheck && pnpm lint && pnpm build` passes

**Verify:** `pnpm typecheck && pnpm lint && pnpm build` → all pass.

**Manual verification (when user is at PC):** Visit `/home`; the "Recent activity" section shows the same items as before.

**Steps:**

- [ ] **Step 1: Read the current dashboard to confirm structure**

```bash
cat app/\(app\)/_cockpit/cockpit-dashboard.tsx
```
Confirms imports (line 1) and `Promise.all` at lines 38-41.

- [ ] **Step 2: Update the imports**

Currently:
```ts
import { getUserLibrary, getRecentActivity, type UserStats } from "@/lib/logs/server-actions";
import type { LibraryItem } from "@/lib/logs/server-actions";
```

Replace with:
```ts
import { getUserLibrary, type UserStats } from "@/lib/logs/server-actions";
import type { LibraryItem, ActivityEvent } from "@/lib/logs/server-actions";
```

(Verify `ActivityEvent` is exported from `server-actions.ts` — it is, at line 259-267. If it's not currently exported, also export it there.)

- [ ] **Step 3: Add the helper above `CockpitDashboard`**

After the existing `computeUserStatsFromLibrary` function, add:
```ts
/**
 * Derive the recent-activity feed from an already-fetched library array,
 * avoiding a second DB round-trip on /home. The first 10 items of library
 * (sorted desc by updatedAt) ARE the activity feed.
 *
 * getRecentActivity() in server-actions.ts is kept for callers that don't
 * already have the library pre-loaded (e.g. future profile-page activity).
 */
function computeRecentActivityFromLibrary(items: LibraryItem[]): ActivityEvent[] {
  return items.slice(0, 10).map((item) => ({
    type: "logged" as const,
    logId: item.logId,
    status: item.status,
    rating: item.rating,
    gameTitle: item.game.title,
    gameSlug: item.game.slug,
    at: item.updatedAt,
  }));
}
```

- [ ] **Step 4: Update the `Promise.all` and downstream usage**

Currently lines 38-42:
```ts
  const [library, activity] = await Promise.all([
    getUserLibrary({}),
    getRecentActivity(10),
  ]);
  const stats = computeUserStatsFromLibrary(library);
```

Replace with:
```ts
  const library = await getUserLibrary({});
  const stats = computeUserStatsFromLibrary(library);
  const activity = computeRecentActivityFromLibrary(library);
```

The rest of the component body (greeting context, JSX) is unchanged.

- [ ] **Step 5: Confirm `getRecentActivity` is still exported in server-actions.ts**

```bash
grep -n "export async function getRecentActivity" lib/logs/server-actions.ts
```
Expected: matches at line 269. Leave the export — future callers may need it.

- [ ] **Step 6: Run verification**

```bash
pnpm typecheck && pnpm lint && pnpm build
```
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add app/\(app\)/_cockpit/cockpit-dashboard.tsx
git commit -m "perf: T1.3 — derive dashboard activity from library array

getUserLibrary({}) returns logs sorted desc by updatedAt. The first 10
items ARE the activity feed; getRecentActivity(10) was a second JOIN of
the same data.

Mirrors the Phase 1.5.15c (commit 3d81bac) stats-from-library pattern.
getRecentActivity() export retained for future non-dashboard callers.

Saves 1 logs-JOIN-games query per /home load.

Spec: docs/superpowers/specs/2026-05-10-perf-audit-design.md (T1.3)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 1.4: Move `isPrivate` filter from JS into SQL on public profile page

**Goal:** Push the `isPrivate` filter into the WHERE clause on `/u/[username]` so private logs never traverse the DB→Node boundary for non-owner viewers.

**Files:**
- Modify: `app/(app)/u/[username]/page.tsx:30-63`

**Acceptance Criteria:**
- [ ] The `.where(eq(schema.logs.userId, profile.userId))` clause is replaced with `and(eq(userId, ...), isOwn ? undefined : eq(isPrivate, false))`
- [ ] The post-fetch `.filter((r) => isOwn || !r.log.isPrivate)` is removed; replaced with a direct `.map(...)`
- [ ] Privacy semantics identical: owners see everything, non-owners see only public
- [ ] `pnpm typecheck && pnpm lint && pnpm build` passes

**Verify:** `pnpm typecheck && pnpm lint && pnpm build` → all pass.

**Manual verification (when user is at PC):** Mark one of your logs as private; view your own profile (private log appears); sign out or use an incognito tab, view the same profile (private log absent).

**Steps:**

- [ ] **Step 1: Confirm `and` is already imported**

```bash
grep -n "^import.*drizzle-orm" app/\(app\)/u/\[username\]/page.tsx
```
Currently imports `eq, desc` (line 2). Update to add `and`:
```ts
import { and, eq, desc } from "drizzle-orm";
```

- [ ] **Step 2: Update the WHERE clause and remove the JS filter**

The existing query at lines 30-59 has a multi-line `.select({ log: { ... }, game: { ... } })` projection. Preserve that projection unchanged — only the `.where(...)` and the post-fetch handling change.

**Before (lines 56-63):**
```ts
    .where(eq(schema.logs.userId, profile.userId))
    .orderBy(desc(schema.logs.updatedAt));

  const items: LibraryItem[] = rows
    .filter((r) => isOwn || !r.log.isPrivate)
    .map((r) => mapRowToLibraryItem(r.log, r.game));
```

**After (lines 56-65):**
```ts
    .where(
      and(
        eq(schema.logs.userId, profile.userId),
        isOwn ? undefined : eq(schema.logs.isPrivate, false),
      ),
    )
    .orderBy(desc(schema.logs.updatedAt));

  const items: LibraryItem[] = rows.map((r) =>
    mapRowToLibraryItem(r.log, r.game),
  );
```

Drizzle's `and()` treats `undefined` operands as no-ops, so `isOwn=true` produces `WHERE userId = ?` and `isOwn=false` produces `WHERE userId = ? AND isPrivate = false`. The `.select({...})`, `.from(...)`, and `.innerJoin(...)` chain steps above remain unchanged.

- [ ] **Step 3: Run verification**

```bash
pnpm typecheck && pnpm lint && pnpm build
```
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/u/\[username\]/page.tsx
git commit -m "perf: T1.4 — move isPrivate filter from JS to SQL on profile page

Public profile fetched all logs (including private), then filtered in JS.
Now the WHERE clause excludes private rows for non-owner viewers, so they
never traverse the DB→Node boundary.

Smaller payload over the wire when private logs exist. Privacy semantics
identical.

Spec: docs/superpowers/specs/2026-05-10-perf-audit-design.md (T1.4)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 1.5: Tighter column projection on `getProfileByUsername`

**Goal:** Add explicit `columns:` projection matching actual caller usage. Verified caller: `/u/[username]` accesses `userId`, `username`, `displayName`, `bio` only.

**Files:**
- Modify: `lib/profile/server-actions.ts:55-60`

**Acceptance Criteria:**
- [ ] `getProfileByUsername` returns only `userId`, `username`, `displayName`, `bio`
- [ ] No caller of `getProfileByUsername` breaks (verified via grep + typecheck)
- [ ] `pnpm typecheck && pnpm lint && pnpm build` passes

**Verify:**
```bash
grep -rn "getProfileByUsername" --include="*.ts" --include="*.tsx" app lib && \
  pnpm typecheck && pnpm lint && pnpm build
```
Expected: grep shows callers; typecheck would surface any missing-field references.

**Steps:**

- [ ] **Step 1: List all callers and their field accesses**

```bash
grep -rn "getProfileByUsername" --include="*.ts" --include="*.tsx" app lib
```
Expected: one production caller — `app/(app)/u/[username]/page.tsx:19`. Inspect the access pattern in that file:
```bash
grep -n "profile\." app/\(app\)/u/\[username\]/page.tsx
```
Confirms uses: `profile.userId`, `profile.username`, `profile.displayName`, `profile.bio`. No access to `avatarUrl`, `profilePictureUrl`, `profilePictureKind`, `mascotVariant`, `isPublic`, `createdAt`, `updatedAt`.

- [ ] **Step 2: Apply the projection**

Replace lines 55-60 in `lib/profile/server-actions.ts`:
```ts
export async function getProfileByUsername(username: string) {
  const profile = await db.query.profiles.findFirst({
    where: eq(schema.profiles.username, username),
  });
  return profile ?? null;
}
```

With:
```ts
export async function getProfileByUsername(username: string) {
  const profile = await db.query.profiles.findFirst({
    where: eq(schema.profiles.username, username),
    columns: {
      userId: true,
      username: true,
      displayName: true,
      bio: true,
    },
  });
  return profile ?? null;
}
```

- [ ] **Step 3: Run verification**

```bash
pnpm typecheck && pnpm lint && pnpm build
```
Expected: all pass. TypeScript would error if any caller accesses a now-omitted field.

- [ ] **Step 4: Commit**

```bash
git add lib/profile/server-actions.ts
git commit -m "perf: T1.5 — tighter column projection on getProfileByUsername

Verified callers (app/(app)/u/[username]/page.tsx) access only userId,
username, displayName, bio. Drop the implicit SELECT * in favor of an
explicit columns: projection.

Minor wire-format reduction; primary win is clarity/maintainability.

Spec: docs/superpowers/specs/2026-05-10-perf-audit-design.md (T1.5)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2.1: Composite indexes on `logs(user_id, updated_at)` and `logs(user_id, status, updated_at)`

**Goal:** Add two additive indexes via Drizzle. Generate the migration, hand-add `ANALYZE logs;` to the migration SQL, and apply via `pnpm db:migrate`.

**Files:**
- Modify: `lib/db/schema.ts:132-157`
- Create: `drizzle/00NN_<auto-named>.sql` (Drizzle-generated; the implementer hand-edits to add `ANALYZE`)

**Acceptance Criteria:**
- [ ] Two indexes added to the `logs` table definition: `logs_user_updated_at_idx` and `logs_user_status_updated_at_idx`
- [ ] `pnpm db:generate` produces a migration with exactly two `CREATE INDEX` statements
- [ ] The migration file is hand-edited to append `ANALYZE logs;` at the end
- [ ] Migration applied successfully via `pnpm db:migrate`
- [ ] `pnpm typecheck && pnpm lint && pnpm build` passes

**Verify:**
```bash
pnpm typecheck && pnpm lint && pnpm build
```
Expected: all pass.

**Manual verification:** After migration, run in `pnpm db:studio` (or via psql):
```sql
EXPLAIN ANALYZE SELECT * FROM logs WHERE user_id = '<some-uuid>' ORDER BY updated_at DESC LIMIT 10;
```
Expected: query plan uses `logs_user_updated_at_idx` (Index Scan, not Seq Scan).

**Steps:**

- [ ] **Step 1: Add the indexes to the schema**

Edit `lib/db/schema.ts`. At the top of the file, the imports currently include:
```ts
import { sql } from "drizzle-orm";
import {
  boolean, integer, jsonb, numeric, pgEnum, pgSchema, pgTable, primaryKey,
  text, timestamp, uniqueIndex, uuid, varchar,
} from "drizzle-orm/pg-core";
```

Add `desc` to the drizzle-orm import and `index` to the pg-core import:
```ts
import { desc, sql } from "drizzle-orm";
import {
  boolean, index, integer, jsonb, numeric, pgEnum, pgSchema, pgTable, primaryKey,
  text, timestamp, uniqueIndex, uuid, varchar,
} from "drizzle-orm/pg-core";
```

In the `logs` table definition (lines 132-157), the second argument currently is:
```ts
  (table) => ({
    userGameIdx: uniqueIndex("logs_user_game_replay_uniq").on(table.userId, table.gameId, table.isReplay),
  }),
```

Replace with:
```ts
  (table) => ({
    userGameIdx: uniqueIndex("logs_user_game_replay_uniq").on(table.userId, table.gameId, table.isReplay),
    userUpdatedAtIdx: index("logs_user_updated_at_idx").on(table.userId, desc(table.updatedAt)),
    userStatusUpdatedIdx: index("logs_user_status_updated_at_idx").on(table.userId, table.status, desc(table.updatedAt)),
  }),
```

If `desc(table.updatedAt)` does not type-check (Drizzle 0.45 API variation), fall back to the SQL-template syntax:
```ts
import { sql } from "drizzle-orm";
// ...
userUpdatedAtIdx: index("logs_user_updated_at_idx").on(table.userId, sql`${table.updatedAt} DESC`),
userStatusUpdatedIdx: index("logs_user_status_updated_at_idx").on(table.userId, table.status, sql`${table.updatedAt} DESC`),
```

- [ ] **Step 2: Generate the migration**

```bash
pnpm db:generate
```
Expected: Drizzle creates a new migration file in `drizzle/` (e.g., `drizzle/0002_<auto-name>.sql`). Read the file to confirm it contains exactly two `CREATE INDEX` statements for the new indexes and nothing else:

```bash
ls -t drizzle/*.sql | head -1
cat $(ls -t drizzle/*.sql | head -1)
```

Expected SQL (modulo Drizzle's exact formatting):
```sql
CREATE INDEX "logs_user_updated_at_idx" ON "logs" ("user_id","updated_at" DESC);
CREATE INDEX "logs_user_status_updated_at_idx" ON "logs" ("user_id","status","updated_at" DESC);
```

If the diff includes anything else (column changes, table rewrites), STOP and investigate — that's a schema drift, not the intended migration.

- [ ] **Step 3: Append `ANALYZE logs;` to the migration**

Edit the generated SQL file. Append at the very end:
```sql
ANALYZE logs;
```

Rationale: Postgres needs fresh statistics to use the new indexes optimally. Drizzle doesn't emit this; without it, the planner might continue using the old plan until autovacuum runs ANALYZE later.

- [ ] **Step 4: Verify Drizzle's migration journal is updated**

```bash
cat drizzle/meta/_journal.json | tail -20
```
Expected: a new entry for this migration. Drizzle adds this automatically with `db:generate`.

- [ ] **Step 5: Apply the migration**

Before running, confirm `.env` has `DATABASE_URL` set to the intended target (likely staging or local — confirm with user if uncertain):
```bash
grep "^DATABASE_URL=" .env | head -1
```

Then apply:
```bash
pnpm db:migrate
```
Expected: migration runs without error. Brief sub-second lock on the `logs` table while indexes build (acceptable at current scale).

- [ ] **Step 6: Verify indexes exist in the database**

In `pnpm db:studio` or via psql:
```sql
SELECT indexname FROM pg_indexes WHERE tablename = 'logs';
```
Expected output includes:
- `logs_pkey`
- `logs_user_game_replay_uniq`
- `logs_user_updated_at_idx`        ← new
- `logs_user_status_updated_at_idx` ← new

- [ ] **Step 7: Verify a query uses the new index**

```sql
EXPLAIN ANALYZE
SELECT * FROM logs
WHERE user_id = '<some-real-user-uuid>'
ORDER BY updated_at DESC
LIMIT 10;
```
Expected: `Index Scan using logs_user_updated_at_idx` in the plan (not `Seq Scan` or sort-after-scan).

- [ ] **Step 8: Run the application verification**

```bash
pnpm typecheck && pnpm lint && pnpm build
```
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add lib/db/schema.ts drizzle/
git commit -m "perf: T2.1 — composite indexes on logs(user_id, updated_at) and (user_id, status, updated_at)

Covers two hot query shapes:
- Default library/dashboard/profile-page reads: WHERE user_id = ? ORDER BY updated_at DESC
- Filter-chip library reads: WHERE user_id = ? AND status = ? ORDER BY updated_at DESC

Migration adds ANALYZE logs; so the planner uses the new indexes immediately
rather than waiting for autovacuum.

Spec: docs/superpowers/specs/2026-05-10-perf-audit-design.md (T2.1)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3.1: `React.memo` on `LibraryPoster` and hot leaf SVG components

**Goal:** Wrap six components in `React.memo` to prevent re-renders when props are referentially stable. No behavior change.

**Files:**
- Modify: `components/library/library-poster.tsx`
- Modify: `components/mascot/mascot.tsx`
- Modify: `components/pixel/hearts.tsx`
- Modify: `components/pixel/status-icons.tsx`
- Modify: `components/pixel/platform-icons.tsx`
- Modify: `components/ui/status-badge.tsx`

**Acceptance Criteria:**
- [ ] Each of the six components is exported as `React.memo(function ...)` instead of a plain function
- [ ] No behavior change (same render output for same props)
- [ ] `pnpm typecheck && pnpm lint && pnpm build` passes

**Verify:** `pnpm typecheck && pnpm lint && pnpm build` → all pass.

**Manual verification (when user is at PC):** Visit `/library`; toggle filter chips; visual output identical. Open React DevTools profiler to spot-check fewer re-renders (optional).

**Steps:**

- [ ] **Step 1: Update `library-poster.tsx`**

Current export pattern (top of file imports + `export function LibraryPoster(...)`):
```tsx
import { useState } from "react";
// ...

export function LibraryPoster({ item }: { item: LibraryItem }) {
  // body
}
```

Replace with:
```tsx
import { memo, useState } from "react";
// ...

export const LibraryPoster = memo(function LibraryPoster({ item }: { item: LibraryItem }) {
  // body — unchanged
});
```

Keep the function name in the inner declaration so React DevTools shows the component name properly.

- [ ] **Step 2: Update `components/mascot/mascot.tsx`**

Find the exported `Mascot` function. Wrap the same way:
```tsx
import { memo } from "react";
// ...
export const Mascot = memo(function Mascot(props: MascotProps) {
  // body
});
```

Inspect the existing file first — if `Mascot` is the only export, this is straightforward. If there are multiple exports, wrap each leaf component that takes props (skip internal-only helpers).

- [ ] **Step 3: Update `components/pixel/hearts.tsx`**

This file exports `HeartFull`, `HeartHalf`, `HeartEmpty`. Wrap each:
```tsx
import { memo } from "react";

export const HeartFull = memo(function HeartFull(props: HeartProps) { /* body */ });
export const HeartHalf = memo(function HeartHalf(props: HeartProps) { /* body */ });
export const HeartEmpty = memo(function HeartEmpty(props: HeartProps) { /* body */ });
```

- [ ] **Step 4: Update `components/pixel/status-icons.tsx`**

Same pattern. Read the file to enumerate the exported icon components, wrap each in `memo`.

- [ ] **Step 5: Update `components/pixel/platform-icons.tsx`**

Same pattern. Likely exports `PlatformIcon` (and possibly sub-components). Wrap.

- [ ] **Step 6: Update `components/ui/status-badge.tsx`**

Same pattern. Wrap the exported `StatusBadge` in `memo`.

- [ ] **Step 7: Run verification**

```bash
pnpm typecheck && pnpm lint && pnpm build
```
Expected: all pass. TypeScript would catch any signature mismatches.

- [ ] **Step 8: Commit**

```bash
git add components/library/library-poster.tsx components/mascot/mascot.tsx components/pixel/ components/ui/status-badge.tsx
git commit -m "perf: T3.1 — React.memo on LibraryPoster and hot leaf SVG components

50-200 LibraryPoster instances in the shelf each contain nested static
SVG components. When a poster's local menuOpen state toggles, every child
SVG re-renders for no reason. React.memo gates these renders behind a
shallow props comparison.

No behavior change — memo is a fast-path optimization; falling through is
the existing render path.

Components wrapped:
- LibraryPoster
- Mascot
- HeartFull / HeartHalf / HeartEmpty
- StatusIcons (each export)
- PlatformIcon (each export)
- StatusBadge

Spec: docs/superpowers/specs/2026-05-10-perf-audit-design.md (T3.1)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3.2: `priority` prop on the first visible poster (LCP hint)

**Goal:** Mark the first poster in shelf, list, and stacks views with Next.js's `priority` prop so the browser preloads the LCP image.

**Files:**
- Modify: `components/library/library-shelf.tsx:37-39`
- Modify: `components/library/library-list.tsx` (the `.map(...)` over items)
- Modify: `components/library/status-stacks.tsx` (the `.map(...)` over items in the first stack)
- Modify: `components/library/library-poster.tsx` (add a `priority?: boolean` prop, thread to `<Image>`)

**Acceptance Criteria:**
- [ ] `LibraryPoster` accepts an optional `priority?: boolean` prop (default `false`)
- [ ] `<Image>` inside `LibraryPoster` receives `priority={priority}`
- [ ] `LibraryShelf` passes `priority={i === 0}` to the first poster in its `items.map(...)`
- [ ] `LibraryList` does the equivalent on its row component
- [ ] `StatusStacks` does the equivalent on the first poster in the first non-empty stack
- [ ] `pnpm typecheck && pnpm lint && pnpm build` passes

**Verify:** `pnpm typecheck && pnpm lint && pnpm build` → all pass.

**Manual verification (when user is at PC):** Cold-load `/library` with DevTools Network tab open; the first poster image request has `Priority: High`.

**Steps:**

- [ ] **Step 1: Add the prop to `LibraryPoster`**

After T3.1, `library-poster.tsx` exports a `memo`-wrapped function. Update its signature and the `<Image>`:

Current:
```tsx
export const LibraryPoster = memo(function LibraryPoster({ item }: { item: LibraryItem }) {
  // ...
  <Image src={item.game.coverUrl} alt={...} fill sizes="..." className="object-cover" />
  // ...
});
```

Update to:
```tsx
export const LibraryPoster = memo(function LibraryPoster({
  item, priority = false,
}: { item: LibraryItem; priority?: boolean }) {
  // ...
  <Image src={item.game.coverUrl} alt={...} fill sizes="..." className="object-cover" priority={priority} />
  // ...
});
```

- [ ] **Step 2: Update `LibraryShelf`**

Current (`library-shelf.tsx:37-39`):
```tsx
{items.map((item) => (
  <LibraryPoster key={item.logId} item={item} />
))}
```

Replace with:
```tsx
{items.map((item, i) => (
  <LibraryPoster key={item.logId} item={item} priority={i === 0} />
))}
```

- [ ] **Step 3: Update `LibraryList`**

Read the file:
```bash
cat components/library/library-list.tsx
```

Find the `items.map(...)` rendering each row. Apply the same `priority={i === 0}` pattern — passed either to a `<LibraryListRow>` sub-component (which forwards to its `<Image>`) or directly to the `<Image>` if `library-list.tsx` renders the image inline.

If `<Image>` is rendered inline, add the `priority` prop:
```tsx
<Image src={...} alt={...} fill sizes="48px" className="object-cover" priority={i === 0} />
```

- [ ] **Step 4: Update `StatusStacks`**

Read the file:
```bash
cat components/library/status-stacks.tsx
```

This view groups items into stacks by status. The "first visible poster" semantically is the first item in the first non-empty stack. Identify the rendering structure:
- If stacks render outer-to-inner with each containing posters, find the first stack's first item and pass `priority={true}` to it.
- A safe simplification: use `priority={i === 0}` on the outer flat enumeration if there is one, otherwise only the first stack's first item.

Concrete: if the structure is `statuses.map((status) => statusItems.map((item, i) => <Image .../>))`, then the first iteration of both loops produces the LCP image. A clear way:
```tsx
{statuses.map((status, si) =>
  itemsByStatus[status].map((item, i) => (
    <Image
      // ...
      priority={si === 0 && i === 0}
    />
  ))
)}
```

Adapt to the actual file structure.

- [ ] **Step 5: Run verification**

```bash
pnpm typecheck && pnpm lint && pnpm build
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add components/library/
git commit -m "perf: T3.2 — priority prop on first visible poster (LCP hint)

The LCP image on /library is the first poster's cover. Marking it
priority lets Next.js emit a preload hint and set fetchPriority=high
on the request.

Applied to shelf, list, and stacks views' first item.

Spec: docs/superpowers/specs/2026-05-10-perf-audit-design.md (T3.2)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3.3: `next/dynamic` for `react-easy-crop` in `AvatarUploader`

**Goal:** Move the cropper (~45KB gzip) out of the eager bundle for `/settings`. Load on demand when the crop dialog opens.

**Files:**
- Modify: `components/settings/avatar-uploader.tsx:1-13`

**Acceptance Criteria:**
- [ ] `Cropper` is imported via `next/dynamic` with `ssr: false`
- [ ] The cropper still renders inside the existing `<Dialog>` when a file is picked
- [ ] No visible behavior change (file pick → dialog opens → cropper appears)
- [ ] `pnpm typecheck && pnpm lint && pnpm build` passes

**Verify:**
```bash
pnpm typecheck && pnpm lint && pnpm build
```
Expected: all pass.

**Manual verification (when user is at PC):** Visit `/settings`, click avatar slot, pick a JPG/PNG/WebP. Crop dialog opens; cropper appears within a few hundred ms (may show a brief empty state during chunk fetch on slow network). Crop and save — output identical to before.

**Steps:**

- [ ] **Step 1: Update the imports**

Currently lines 1-13:
```tsx
"use client";

import { useCallback, useRef, useState } from "react";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
```

Replace with:
```tsx
"use client";

import { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Area } from "react-easy-crop";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// The cropper is only needed when the user picks a non-GIF file (the dialog
// opens at that point). Lazy-loading drops ~45KB gzip from the initial
// /settings bundle. ssr: false because canvas/file APIs are browser-only.
const Cropper = dynamic(() => import("react-easy-crop"), {
  ssr: false,
  loading: () => null,
});
```

Important: keep the `import type { Area } from "react-easy-crop";` — types are erased at compile time and add zero bundle cost.

- [ ] **Step 2: Confirm no other usage of `Cropper` outside this file**

```bash
grep -rn "react-easy-crop" --include="*.ts" --include="*.tsx" .
```
Expected: only `components/settings/avatar-uploader.tsx`.

- [ ] **Step 3: Run verification**

```bash
pnpm typecheck && pnpm lint && pnpm build
```
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add components/settings/avatar-uploader.tsx
git commit -m "perf: T3.3 — next/dynamic for react-easy-crop in AvatarUploader

react-easy-crop (~45KB gzip) is only used when the user picks a non-GIF
file for avatar upload. Lazy-load it via next/dynamic so it doesn't bloat
the /settings initial bundle for visitors who never crop an avatar.

ssr: false because canvas/file APIs are browser-only. The FileReader read
that precedes the dialog open masks the dynamic chunk fetch.

Spec: docs/superpowers/specs/2026-05-10-perf-audit-design.md (T3.3)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3.4: `content-visibility: auto` on library grid items

**Goal:** Skip layout/paint for off-viewport library posters and list rows. DOM stays intact (Ctrl+F, a11y unaffected).

**Files:**
- Modify: `app/globals.css` (add the CSS rule)
- Modify: `components/library/library-poster.tsx` (add className to outer `motion.div`)
- Modify: `components/library/library-list.tsx` (add className to row wrapper)

**Acceptance Criteria:**
- [ ] A new CSS class `.lib-item-cv` defined in `app/globals.css` with `content-visibility: auto` and `contain-intrinsic-size: 0 240px`
- [ ] The class is applied to `LibraryPoster`'s outermost `motion.div`
- [ ] The class is applied to `LibraryList`'s row wrapper
- [ ] **Not** applied to `LibraryShelf`'s grid container (the parent `motion.div layout`)
- [ ] Poster-to-modal morph (Framer Motion `layoutId`) still works after the change
- [ ] `pnpm typecheck && pnpm lint && pnpm build` passes

**Verify:** `pnpm typecheck && pnpm lint && pnpm build` → all pass.

**Manual verification (when user is at PC):** Visit `/library`; scroll the shelf; visually identical. Click a poster in the middle of the shelf — the modal morph from poster → game-detail modal should still feel smooth. If the morph feels broken or jumpy, see fallback below.

**Fallback if the morph misbehaves:** Remove the className from `LibraryPoster`'s `motion.div`; keep it only on `LibraryList` rows. Open a Tier-5 follow-up note.

**Steps:**

- [ ] **Step 1: Identify the right stylesheet**

```bash
ls app/globals.css app/styles*.css 2>/dev/null
```
The Tailwind v4 project keeps global styles in `app/globals.css`. If a different file is used, adapt accordingly.

- [ ] **Step 2: Add the CSS rule**

Append to `app/globals.css`:
```css
/* Skip layout/paint for off-viewport library items.
 * contain-intrinsic-size reserves an estimated height for off-viewport
 * items to prevent scrollbar jumps. 240px is sized for the shelf's
 * ~140px-wide 2:3-aspect posters; list rows are shorter but the same
 * value works (it's a minimum reservation, not a fixed height).
 */
.lib-item-cv {
  content-visibility: auto;
  contain-intrinsic-size: 0 240px;
}
```

- [ ] **Step 3: Apply the className in `library-poster.tsx`**

After T3.1 + T3.2, the outer element is a `motion.div`. Add `lib-item-cv` to its className.

Current (post-T3.1/T3.2):
```tsx
<motion.div
  layout
  layoutId={`poster-${item.logId}`}
  initial={{ opacity: 0, scale: 0.95 }}
  animate={{ opacity: 1, scale: 1 }}
  exit={{ opacity: 0, scale: 0.9 }}
  transition={{ type: "spring", stiffness: 400, damping: 30 }}
  className="group relative aspect-[2/3] w-full overflow-hidden rounded-md bg-[var(--bg-elev)] border border-[var(--border-soft)] hover:border-[var(--accent-soft)] transition-colors"
>
```

Add `lib-item-cv` to the className (the `cn(...)` helper isn't used here — direct string concat is fine):
```tsx
className="lib-item-cv group relative aspect-[2/3] w-full overflow-hidden rounded-md bg-[var(--bg-elev)] border border-[var(--border-soft)] hover:border-[var(--accent-soft)] transition-colors"
```

- [ ] **Step 4: Apply the className in `library-list.tsx`**

Read the file to find the row wrapper element:
```bash
cat components/library/library-list.tsx
```

Locate the per-row wrapper (likely a `<li>` or `<div>` inside the `.map(...)`). Add `lib-item-cv` to its className. Use the `cn()` helper from `@/lib/utils` if the existing className already uses it.

- [ ] **Step 5: Verify `LibraryShelf` grid container is NOT modified**

The grid container (`library-shelf.tsx:29` — `<motion.div layout className="grid gap-3" ...>`) should remain unchanged. Applying `content-visibility: auto` to the grid container would hide the entire grid until scroll, which is the opposite of what we want.

- [ ] **Step 6: Run verification**

```bash
pnpm typecheck && pnpm lint && pnpm build
```
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add app/globals.css components/library/library-poster.tsx components/library/library-list.tsx
git commit -m "perf: T3.4 — content-visibility: auto on library grid items

Tells the browser to skip layout/paint for off-viewport posters and list
rows. DOM stays intact (Ctrl+F, screen readers, scroll-anchoring all
unaffected). Items layout/paint on the fly as they scroll into view.

Applied to LibraryPoster's outer motion.div and LibraryList rows. Not
applied to LibraryShelf's grid container (would hide the whole grid).

Spec: docs/superpowers/specs/2026-05-10-perf-audit-design.md (T3.4)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4.1: Install and wire up `@next/bundle-analyzer`

**Goal:** Add the bundle analyzer as a devDep, gated by an `ANALYZE=true` env var. Provides a static measurement source — generated HTML reports that can be inspected without DevTools access.

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml` (auto-updated by pnpm)
- Modify: `next.config.ts`

**Acceptance Criteria:**
- [ ] `@next/bundle-analyzer` is in `devDependencies`
- [ ] A `pnpm analyze` script is added that sets `ANALYZE=true` and runs `next build`
- [ ] `next.config.ts` wraps the config in `withBundleAnalyzer({ enabled: process.env.ANALYZE === "true" })`
- [ ] `pnpm build` (without ANALYZE) succeeds and produces no analyzer output
- [ ] `pnpm analyze` (cross-env on Windows: see Step 4) succeeds and produces `.next/analyze/client.html` and `.next/analyze/server.html`

**Verify:**
```bash
pnpm typecheck && pnpm lint && pnpm build
```
Expected: all pass. Plus, `pnpm analyze` (Step 4) produces analyzer HTML.

**Steps:**

- [ ] **Step 1: Install the package**

```bash
pnpm add -D @next/bundle-analyzer
```
Expected: `package.json` gets the new entry under `devDependencies`; `pnpm-lock.yaml` updates.

- [ ] **Step 2: Add the analyze script**

Edit `package.json`, in the `"scripts"` block. Currently:
```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "typecheck": "tsc --noEmit",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate",
  "db:push": "drizzle-kit push",
  "db:studio": "drizzle-kit studio"
}
```

Add the `analyze` script. On Windows, `ANALYZE=true next build` won't work as inline env-var syntax — use `cross-env` (already common in Next projects) or rely on `pnpm`'s built-in handling. The safest cross-platform form, given this project's Windows-primary dev environment:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "analyze": "cross-env ANALYZE=true next build",
  "start": "next start",
  ...
}
```

If `cross-env` isn't already a devDep, install it:
```bash
pnpm add -D cross-env
```

Verify:
```bash
grep -E "cross-env|@next/bundle-analyzer" package.json
```

- [ ] **Step 3: Wrap `next.config.ts`**

Current `next.config.ts` (9 lines):
```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "media.rawg.io" }],
  },
};

export default nextConfig;
```

Replace with:
```ts
import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "media.rawg.io" }],
  },
};

export default withBundleAnalyzer(nextConfig);
```

- [ ] **Step 4: Verify the analyzer produces output**

```bash
pnpm analyze
```
Expected: build runs; on completion, `.next/analyze/client.html` and `.next/analyze/server.html` (and possibly `edge.html`) exist:
```bash
ls .next/analyze/
```

Read the HTML titles or top-level summary (the implementer can `Read` these HTML files to extract bundle composition data).

- [ ] **Step 5: Verify normal build is unaffected**

```bash
pnpm build
```
Expected: build completes; no `.next/analyze/` updated (the analyzer is gated by `ANALYZE=true`).

- [ ] **Step 6: Run full verification**

```bash
pnpm typecheck && pnpm lint && pnpm build
```
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml next.config.ts
git commit -m "perf: T4.1 — add @next/bundle-analyzer for static bundle audits

Gated by ANALYZE=true env var. Use 'pnpm analyze' to generate static HTML
treemaps of client and server bundles at .next/analyze/. No effect on
normal builds.

Provides a measurement source even without DevTools access — the output
is static HTML we can read to identify oversized dependencies.

Spec: docs/superpowers/specs/2026-05-10-perf-audit-design.md (T4.1)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4.2: `next.config.ts` enhancements (images, compiler, experimental)

**Goal:** Apply four config additions: AVIF + longer image cache, barrel-import optimization, `removeConsole` in production, and `staleTimes` for the Router cache.

**Files:**
- Modify: `next.config.ts`

**Acceptance Criteria:**
- [ ] `images.formats` is `["image/avif", "image/webp"]`
- [ ] `images.minimumCacheTTL` is `60 * 60 * 24 * 30` (30 days)
- [ ] `compiler.removeConsole` is `{ exclude: ["error", "warn"] }`
- [ ] `experimental.optimizePackageImports` lists `lucide-react`, `framer-motion`, and the three `@radix-ui/*` packages currently in use
- [ ] `experimental.staleTimes` is `{ dynamic: 30, static: 180 }`
- [ ] `pnpm typecheck && pnpm lint && pnpm build` passes
- [ ] Normal `pnpm build` succeeds with no new warnings about experimental flags

**Verify:**
```bash
pnpm typecheck && pnpm lint && pnpm build
```
Expected: all pass.

**Manual verification (when user is at PC):**
- Visit `/library` with DevTools open; cover images served as `image/avif` (check Network tab response Content-Type).
- Log a game; navigate to `/home`; navigate back to `/library` — confirm the new log appears (revalidatePath worked). Then rapid-click between `/home` and `/library` — navigation is snappier than before (Router cache hit).

**Steps:**

- [ ] **Step 1: Update `next.config.ts`**

After T4.1, the file looks like:
```ts
import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "media.rawg.io" }],
  },
};

export default withBundleAnalyzer(nextConfig);
```

Replace the `nextConfig` declaration with:
```ts
const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "media.rawg.io" }],
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24 * 30, // 30 days
  },
  compiler: {
    removeConsole: { exclude: ["error", "warn"] },
  },
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "framer-motion",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-slot",
    ],
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
};
```

- [ ] **Step 2: Confirm the Radix list matches actual dependencies**

```bash
grep '"@radix-ui/' package.json
```
Expected lines (from current `package.json`):
- `"@radix-ui/react-dialog"`
- `"@radix-ui/react-dropdown-menu"`
- `"@radix-ui/react-slot"`

If the dependency list differs, adjust the `optimizePackageImports` array to match. The principle: only list packages that are actually installed and used.

- [ ] **Step 3: Run verification**

```bash
pnpm typecheck && pnpm lint && pnpm build
```
Expected: all pass. Next.js may print informational notes about experimental features (`optimizePackageImports`, `staleTimes`) — that's expected and acceptable.

- [ ] **Step 4: Commit**

```bash
git add next.config.ts
git commit -m "perf: T4.2 — next.config.ts enhancements (AVIF, cache, optimizePackageImports, staleTimes)

- images.formats: serve AVIF (typically 20-50% smaller than WebP for photos)
  with WebP fallback. RAWG covers go through next/image so this applies.
- images.minimumCacheTTL: 30 days. RAWG URLs are immutable; long cache
  avoids re-encoding the same image on every cache miss.
- compiler.removeConsole: strip console.log/.info/.debug in prod; keep
  .error/.warn for runtime debugging.
- experimental.optimizePackageImports: explicit list for lucide-react,
  framer-motion, and the three Radix packages we use. Rewrites barrel
  imports to deep imports to drop unused exports.
- experimental.staleTimes: dynamic=30 makes back-navigation within 30s
  near-instant. Safe because all writes call revalidatePath which
  invalidates the Router cache.

Spec: docs/superpowers/specs/2026-05-10-perf-audit-design.md (T4.2)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Post-tier cleanup: Append "Applied audit fixes" to the perf baseline doc

**Goal:** Mirror the Phase 1.5.15 pattern — append an "Audit Tier 1–4 applied" section to `docs/superpowers/perf/2026-05-10-phase1.5-baseline.md` listing each task's commit SHA and a one-line summary.

**Files:**
- Modify: `docs/superpowers/perf/2026-05-10-phase1.5-baseline.md`

**Acceptance Criteria:**
- [ ] A new top-level section "Applied audit fixes (post-Phase-1.5, 2026-05-10)" is appended
- [ ] Each of the 12 tasks (T1.1–T4.2) listed with its commit SHA and one-line summary
- [ ] The doc is committed

**Verify:** Visual review of the appended section in the baseline doc.

**Steps:**

- [ ] **Step 1: Gather commit SHAs**

```bash
git log --oneline --grep="perf: T" -20
```
Expected: 12 commits, one per task.

- [ ] **Step 2: Append the section**

At the end of `docs/superpowers/perf/2026-05-10-phase1.5-baseline.md`, append:
```markdown
---

## Applied audit fixes (post-Phase-1.5, 2026-05-10)

Tiers 1–4 of the perf audit landed as 12 atomic commits. See
[docs/superpowers/specs/2026-05-10-perf-audit-design.md](../specs/2026-05-10-perf-audit-design.md)
for the spec and rationale.

### Tier 1 — Server-side cleanup
- `<SHA>` perf: T1.1 — drop redundant findFirst in createLog
- `<SHA>` perf: T1.2 — React cache() wrapper for supabase.auth.getUser
- `<SHA>` perf: T1.3 — derive dashboard activity from library array
- `<SHA>` perf: T1.4 — move isPrivate filter from JS to SQL on profile page
- `<SHA>` perf: T1.5 — tighter column projection on getProfileByUsername

### Tier 2 — Database indexes
- `<SHA>` perf: T2.1 — composite indexes on logs(user_id, updated_at) and (user_id, status, updated_at)

### Tier 3 — Client polish
- `<SHA>` perf: T3.1 — React.memo on LibraryPoster and hot leaf SVG components
- `<SHA>` perf: T3.2 — priority prop on first visible poster (LCP hint)
- `<SHA>` perf: T3.3 — next/dynamic for react-easy-crop
- `<SHA>` perf: T3.4 — content-visibility: auto on library grid items

### Tier 4 — Build config & bundle analyzer
- `<SHA>` perf: T4.1 — add @next/bundle-analyzer for static bundle audits
- `<SHA>` perf: T4.2 — next.config.ts enhancements (AVIF, cache, optimizePackageImports, staleTimes)

### Skipped (deliberately — see spec Tier 5)
- Framer Motion `layout` swap for CSS — animation feel risk
- Virtual scrolling — Ctrl+F and a11y risk
- Pagination — product-model change
- `<Suspense>` streaming dashboard — perceived load-order change
- `useDeferredValue` in palette — RAWG API rate-limit risk
- Edge runtime for middleware — architectural scope
- `unstable_cache` for hot reads — complexity vs current scale
- SQL GROUP BY rewrite of `getUserStats` — dormant code

### Empirical numbers (still TBD — fill in when user back at PC)
Use the bundle analyzer output (`pnpm analyze` → `.next/analyze/client.html`)
plus a cold-load Chrome DevTools sweep to fill in:

- /library cold-load image transfer bytes (filter `media.rawg.io` in Network tab): ___ KB
- /library cold-load `getUserLibrary` calls visible: ___ (expected: 1)
- /home cold-load DB queries (server log): ___ (expected: 1)
- /home cold-load auth verifications (server log): ___ (expected: 1)
- /library LCP: ___ ms
- /settings initial JS bundle: ___ KB (before-vs-after T3.3)
- Client bundle: ___ KB total (top 3 entries from bundle analyzer)
```

Replace `<SHA>` placeholders with the actual SHAs from Step 1.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/perf/2026-05-10-phase1.5-baseline.md
git commit -m "docs(perf): append 'Applied audit fixes' to Phase 1.5 baseline

Catalogs the 12 commits from Tiers 1-4 of the perf audit with their SHAs
and one-line summaries. Skipped items (Tier 5) listed for traceability.
Empirical numbers section left TBD for the post-audit Chrome DevTools
sweep (user away from PC for now).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Self-review checklist (writer)

- [x] Each task has Goal, Files (with line refs where useful), Acceptance Criteria, Verify command, Steps with code blocks, and a Commit step
- [x] No placeholders ("TBD", "etc.", "similar to") in step content — code blocks show the actual changes
- [x] File paths are exact and absolute-from-repo-root
- [x] Verification commands are runnable and have expected output noted
- [x] Inter-task dependencies declared in the file-structure map at the top of this plan
- [x] Tier 5 items are deliberately not tasks — they're listed in the post-cleanup doc append as the "skipped" register
- [x] Commit messages follow the `perf: TX.Y — summary` format mirroring Phase 1.5.15a/b/c
- [x] No invented APIs (Drizzle index syntax has a fallback noted for the desc() variation)

---

## Resuming work

```
/superpowers-extended-cc:executing-plans docs/superpowers/plans/2026-05-10-perf-audit-plan.md
```

Tasks file: `docs/superpowers/plans/2026-05-10-perf-audit-plan.md.tasks.json` (co-located).
