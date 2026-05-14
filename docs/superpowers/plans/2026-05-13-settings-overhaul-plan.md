# Settings Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand `/settings` from "profile + connections only" to a full account-management center: change password / change email / sessions, per-type notification opt-outs, profile visibility, and a soft-delete + JSON data-export account-lifecycle flow.

**Architecture:** Subpath routes under `/settings/*` (one section per route, replacing today's in-page tabs). Sensitive flows gate on **inline hybrid reauth** — current password if the user has one, else a 6-digit OTP code via Supabase `signInWithOtp` — verified in the same server action that applies the change. Soft-deleted accounts are gated everywhere via `profiles.deleted_at IS NULL` filters; a nightly Edge cron hard-deletes past-grace rows through Supabase's `auth.users` cascade chain.

**Tech Stack:** Next.js 16 App Router · Server Actions · Supabase Auth (incl. admin SDK for `userHasPassword`) · Drizzle ORM · `react`'s `cache()` for per-request memoization · Vitest · Supabase Edge Functions (Deno) · `JSZip` (data export bundle)

**Spec:** [docs/superpowers/specs/2026-05-13-settings-overhaul-design.md](../specs/2026-05-13-settings-overhaul-design.md)

**Prior plan for reference style:** [docs/superpowers/plans/2026-05-12-phase5-social-plan.md](./2026-05-12-phase5-social-plan.md)

---

## File Structure

```
lib/db/
├─ migrations/0013_account_lifecycle_prefs.sql       Hand-written: 5 cols + partial index
└─ schema.ts                                          (modify) Drizzle mirror

lib/auth/
├─ user-has-password.ts                               Admin SDK check, per-request cached
├─ reauth-actions.ts                                  verifyCurrentPassword, sendReauthOtp, verifyReauthOtp
└─ admin-client.ts                                    (NEW) service-role client factory (server-only)

lib/settings/
├─ visibility-actions.ts                              toggleProfileVisibility(isPublic)
├─ notification-prefs-actions.ts                      updateCadence + updateEmailType
├─ account-deletion-actions.ts                        softDeleteAccount, cancelDeletion
└─ data-export.ts                                     exportUserData → JSZip blob

lib/profile/
└─ server-actions.ts                                  (modify) add updateDisplayName, updateBio

lib/social/notifications/
└─ digest.ts                                          (modify) filter notifications by per-type opt-outs

lib/supabase/
└─ middleware.ts                                      (modify, optional) — not changed; layout-level guard handles deleted_at

app/(app)/settings/
├─ layout.tsx                                         (NEW) sidebar + content shell
├─ page.tsx                                           (modify) → 307 redirect to /settings/profile
├─ profile/page.tsx                                   (NEW, contents extracted from existing _sections/profile-section.tsx)
├─ account/
│   ├─ page.tsx                                       (NEW) Email + Password + Sessions
│   └─ _components/
│       ├─ change-email-form.tsx                      Form + reauth + live-actual poll
│       ├─ change-password-form.tsx                   Branches "set" vs "change" by hasPassword
│       └─ sign-out-others-button.tsx                 Single button + confirm modal
├─ notifications/page.tsx                             (NEW) cadence + 4 checkboxes
├─ privacy/page.tsx                                   (NEW) visibility toggle + blocked list
├─ connections/page.tsx                               (NEW, contents extracted from _sections/connections-section.tsx)
├─ danger/
│   ├─ page.tsx                                       (NEW) export + delete cards
│   └─ _components/
│       ├─ export-data-button.tsx
│       └─ delete-account-flow.tsx                    Modal + reauth + type-username-confirm
├─ blocked/page.tsx                                   (modify) → 301 redirect to /settings/privacy#blocked
└─ _sections/                                         (delete after extraction)

app/(app)/cancel-deletion/page.tsx                    (NEW) "Cancel deletion?" one-button page
app/(app)/layout.tsx                                  (modify) add deleted_at guard

app/account-deleted/page.tsx                          (NEW, public) post-delete landing page
app/auth/callback/route.ts                            (modify) detect deleted_at → /cancel-deletion

components/settings/
├─ sidebar-nav.tsx                                    (NEW) extracted vertical nav with active-state
└─ reauth-challenge.tsx                               (NEW) shared UI primitive — branches on hasPassword

supabase/functions/account-purge/
└─ index.ts                                           (NEW) nightly cron — hard-delete past-grace rows

tests/unit/
├─ user-has-password.test.ts                          (NEW)
├─ reauth-actions.test.ts                             (NEW)
├─ visibility-actions.test.ts                         (NEW)
├─ notification-prefs.test.ts                         (NEW)
├─ digest-builder.test.ts                             (modify) cover per-type opt-out filtering
├─ account-deletion-actions.test.ts                   (NEW)
├─ data-export.test.ts                                (NEW)
└─ profile-extras.test.ts                             (NEW) updateDisplayName + updateBio
```

---

## Pre-merge gotchas

1. **Drizzle snapshot drift** (per memory `feedback_drizzle_snapshot_chain_drift.md`): snapshots 0007–0011 are missing on disk. After running `pnpm drizzle-kit generate`, **grep the generated SQL for any phantom statements** that don't belong to this migration (Phase-5 tables, `games_steam_appid_idx` partial index) and strip them before applying. Do not just trust the generator.
2. **`vi.stubEnv` hoisting** (per memory `tests_setup_2026_05_13.md`): tests that touch `lib/env.ts` need `vi.stubEnv()` calls hoisted **above** any dynamic import that pulls env. Use the existing pattern from `tests/unit/encryption.test.ts` as the template.
3. **`server-only` shim**: tests import server-only modules; the Vitest config stubs `server-only` for this. No action needed beyond following the existing pattern.
4. **Admin SDK key**: `SUPABASE_SERVICE_ROLE_KEY` must already be set in `.env` (memory confirms). The new `lib/auth/admin-client.ts` is server-only; never import it from a client component.

---

## Tasks

### Task 1: Migration 0013 — soft-delete + email opt-out columns

**Goal:** Add 5 new columns to `profiles` and a partial index. Apply to live DB. Drizzle schema mirrored.

**Files:**
- Create: `lib/db/migrations/0013_account_lifecycle_prefs.sql`
- Modify: `lib/db/schema.ts` (the `profiles` table definition, around line 100–131)

**Acceptance Criteria:**
- [ ] `profiles` has 5 new columns: `deleted_at` (TIMESTAMPTZ NULL), `email_follows`, `email_reactions`, `email_comments`, `email_wishlist` (BOOLEAN NOT NULL DEFAULT TRUE each)
- [ ] Partial index `profiles_deleted_at_idx ON profiles (deleted_at) WHERE deleted_at IS NOT NULL` exists
- [ ] `lib/db/schema.ts` Drizzle definition matches
- [ ] Migration applied to live project via `mcp__supabase__apply_migration`
- [ ] `mcp__supabase__list_tables` confirms columns present

**Verify:** `pnpm tsc --noEmit` (no TS errors after schema change)

**Steps:**

- [ ] **Step 1: Generate the Drizzle schema diff first**

Edit `lib/db/schema.ts`. Add to the `profiles` table definition (preserve existing column order; append the new ones at the end alongside `lastDigestSentAt`):

```ts
deletedAt: timestamp("deleted_at", { withTimezone: true }),
emailFollows: boolean("email_follows").notNull().default(true),
emailReactions: boolean("email_reactions").notNull().default(true),
emailComments: boolean("email_comments").notNull().default(true),
emailWishlist: boolean("email_wishlist").notNull().default(true),
```

Run `pnpm drizzle-kit generate` to produce a draft migration file under `lib/db/migrations/`.

- [ ] **Step 2: Audit the generated SQL for drift; rewrite as hand-authored migration**

Per pre-merge gotcha #1, the generator may emit phantom Phase-5 / IGDB statements. **Delete the auto-generated file** and write `lib/db/migrations/0013_account_lifecycle_prefs.sql` by hand:

```sql
-- 0013_account_lifecycle_prefs.sql
-- Adds soft-delete marker + per-type email opt-out booleans + purge-cron index.
-- See: docs/superpowers/specs/2026-05-13-settings-overhaul-design.md

ALTER TABLE profiles
  ADD COLUMN deleted_at      TIMESTAMPTZ,
  ADD COLUMN email_follows   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN email_reactions BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN email_comments  BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN email_wishlist  BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX profiles_deleted_at_idx
  ON profiles (deleted_at)
  WHERE deleted_at IS NOT NULL;
```

- [ ] **Step 3: Apply the migration to the live project**

```
mcp__supabase__apply_migration name="0013_account_lifecycle_prefs" query=<contents of the SQL file>
```

- [ ] **Step 4: Verify columns exist**

```
mcp__supabase__list_tables schemas=["public"]
```

Expected: `profiles` row shows `deleted_at`, `email_follows`, `email_reactions`, `email_comments`, `email_wishlist` in the columns list.

- [ ] **Step 5: TS sanity check**

Run: `pnpm tsc --noEmit`
Expected: zero errors. (If errors mention `email_follows` etc., the schema.ts edit didn't save — re-check.)

- [ ] **Step 6: Commit**

```bash
git add lib/db/schema.ts lib/db/migrations/0013_account_lifecycle_prefs.sql
git commit -m "feat(settings): migration 0013 — soft-delete + email opt-out columns"
```

```json:metadata
{"files":["lib/db/schema.ts","lib/db/migrations/0013_account_lifecycle_prefs.sql"],"verifyCommand":"pnpm tsc --noEmit","acceptanceCriteria":["profiles has 5 new columns","partial index profiles_deleted_at_idx exists","drizzle schema mirrored","migration applied to live"]}
```

---

### Task 2: Soft-delete read-side filter audit + updates

**Goal:** Every query that surfaces another user's content honors `profiles.deleted_at IS NULL`. No "deleted" user remains visible in feed/profile/recs/comments.

**Files:**
- Modify (audit list, expect ~6 files):
  - `lib/social/feed/queries.ts`
  - `lib/social/follows/server-actions.ts`
  - `lib/social/_shared/profile-summary.ts`
  - `lib/social/discovery/similar-users.ts`
  - `lib/social/comments/server-actions.ts` (display path)
  - `app/(app)/u/[username]/page.tsx` (profile route guard)

**Acceptance Criteria:**
- [ ] Every `from(profiles)` join in `lib/` and `app/` either filters `deleted_at IS NULL` OR is in the explicit allowlist (taste-fingerprint cron, account-purge cron, the soft-delete server actions themselves)
- [ ] `/u/[username]` returns 404 when the profile's `deleted_at` is non-null
- [ ] Comments by a soft-deleted user render with author label `"[deleted user]"` and a generic avatar
- [ ] Existing tests pass

**Verify:** `pnpm vitest run` (all tests green)

**Steps:**

- [ ] **Step 1: Grep the audit set**

```bash
grep -rn "from(profiles" lib/ app/ --include="*.ts" --include="*.tsx"
grep -rn "innerJoin(profiles" lib/ app/ --include="*.ts" --include="*.tsx"
```

For each match, decide: (a) needs `deleted_at IS NULL` filter, or (b) is in the allowlist (taste cron, purge cron, soft-delete itself).

- [ ] **Step 2: Add filters to feed query**

Edit `lib/social/feed/queries.ts`. Wherever `profiles` is joined for the actor side, add `isNull(profiles.deletedAt)` to the WHERE / ON clause:

```ts
import { isNull, and, eq } from "drizzle-orm";
// ...existing query builder...
.where(
  and(
    // ...existing conditions...
    isNull(profiles.deletedAt),  // hide soft-deleted actors
  ),
)
```

- [ ] **Step 3: Add filters to profile-summary, follows, similar-users**

Same pattern. In `lib/social/_shared/profile-summary.ts`:

```ts
const profile = await db.query.profiles.findFirst({
  where: and(eq(profiles.username, username), isNull(profiles.deletedAt)),
});
if (!profile) return null;  // 404 cascades from the route layer
```

In `lib/social/follows/server-actions.ts` (both `getFollowers` and `getFollowing`), add `isNull(profiles.deletedAt)` to filter out soft-deleted users from the lists.

In `lib/social/discovery/similar-users.ts`, filter the candidate set:

```ts
.where(and(...existing, isNull(profiles.deletedAt)))
```

- [ ] **Step 4: Update `/u/[username]` route guard**

Edit `app/(app)/u/[username]/page.tsx`. The existing flow likely fetches the profile then 404s if not found — confirm the soft-delete check is implicit via the profile-summary edit above. If `getProfileSummary` returns null for soft-deleted, the route already 404s. Verify by reading the file.

- [ ] **Step 5: Comment-author masking**

Edit `lib/social/comments/server-actions.ts` (or the display layer it returns to). Where comment rows are returned with author info:

```ts
// In the SELECT, also pull the author's deleted_at
// In the result mapping:
const authorLabel = row.authorDeletedAt
  ? { username: "[deleted user]", displayName: null, avatar: null }
  : { username: row.authorUsername, displayName: row.authorDisplayName, avatar: row.authorAvatar };
```

The comment body itself stays visible so threads remain readable.

- [ ] **Step 6: Run existing tests**

Run: `pnpm vitest run`
Expected: all tests green. (Some existing tests use fixtures that may need `deletedAt: null` added — fix as you find them.)

- [ ] **Step 7: Commit**

```bash
git add lib/social/ app/\(app\)/u/
git commit -m "feat(settings): audit + filter all read paths by profiles.deleted_at"
```

```json:metadata
{"files":["lib/social/feed/queries.ts","lib/social/follows/server-actions.ts","lib/social/_shared/profile-summary.ts","lib/social/discovery/similar-users.ts","lib/social/comments/server-actions.ts","app/(app)/u/[username]/page.tsx"],"verifyCommand":"pnpm vitest run","acceptanceCriteria":["every from(profiles) honors deleted_at OR is allowlisted","/u/[username] 404s for soft-deleted profiles","comments by soft-deleted users render as [deleted user]"]}
```

---

### Task 3: Layout shell + sidebar nav extraction + route migration

**Goal:** Convert `/settings` from a single-page-with-in-page-tabs into a sidebar layout with one route per section. Existing Profile and Connections content moves to subroutes; `/settings/blocked` becomes a redirect.

**Files:**
- Create: `app/(app)/settings/layout.tsx`
- Create: `components/settings/sidebar-nav.tsx`
- Create: `app/(app)/settings/profile/page.tsx` (moves existing profile-section content)
- Create: `app/(app)/settings/connections/page.tsx` (moves existing connections-section content)
- Modify: `app/(app)/settings/page.tsx` → redirect
- Modify: `app/(app)/settings/blocked/page.tsx` → redirect
- Delete: `app/(app)/settings/_sections/profile-section.tsx`, `app/(app)/settings/_sections/connections-section.tsx` (after content moves)

**Acceptance Criteria:**
- [ ] `/settings` issues 307 redirect to `/settings/profile`
- [ ] `/settings/blocked` issues 301 redirect to `/settings/privacy#blocked` (will 404 until Task 8 ships, but the redirect is in place)
- [ ] `/settings/profile` renders the existing profile-edit UI under the new sidebar
- [ ] `/settings/connections` renders the existing connections UI under the new sidebar
- [ ] Sidebar shows 6 links (Profile, Account, Notifications, Privacy, Connections, Danger Zone) — Account/Notifications/Privacy/Danger temporarily 404 until later tasks add their pages
- [ ] Active link styling matches the current `/settings` sidebar visual

**Verify:** `pnpm tsc --noEmit` and visit `/settings` in dev → redirect → `/settings/profile` renders

**Steps:**

- [ ] **Step 1: Build the sidebar nav component**

Create `components/settings/sidebar-nav.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SECTIONS = [
  { href: "/settings/profile", label: "Profile" },
  { href: "/settings/account", label: "Account" },
  { href: "/settings/notifications", label: "Notifications" },
  { href: "/settings/privacy", label: "Privacy" },
  { href: "/settings/connections", label: "Connections" },
  { href: "/settings/danger", label: "Danger Zone" },
] as const;

export function SettingsSidebarNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1" aria-label="Settings navigation">
      {SECTIONS.map((s) => {
        const active = pathname === s.href || pathname.startsWith(s.href + "/");
        return (
          <Link
            key={s.href}
            href={s.href}
            className={[
              "rounded-md px-3 py-2 text-sm transition-colors",
              active
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            ].join(" ")}
            aria-current={active ? "page" : undefined}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

(Match existing class names from the current `app/(app)/settings/page.tsx` sidebar — read that file first and reuse the same Tailwind tokens.)

- [ ] **Step 2: Build the layout**

Create `app/(app)/settings/layout.tsx`:

```tsx
import type { ReactNode } from "react";
import { SettingsSidebarNav } from "@/components/settings/sidebar-nav";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold">Settings</h1>
      <div className="grid gap-8 md:grid-cols-[180px_1fr]">
        <aside><SettingsSidebarNav /></aside>
        <main>{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Move profile content**

Read the current content of `app/(app)/settings/_sections/profile-section.tsx`. Create `app/(app)/settings/profile/page.tsx` with that same body — but as the page default export (Server Component if it currently is; pull the Client Component subparts via imports).

- [ ] **Step 4: Move connections content**

Same pattern as Step 3 for `app/(app)/settings/_sections/connections-section.tsx` → `app/(app)/settings/connections/page.tsx`.

- [ ] **Step 5: Convert `/settings/page.tsx` to a redirect**

Replace the entire file contents with:

```tsx
import { redirect } from "next/navigation";

export default function SettingsIndex() {
  redirect("/settings/profile");
}
```

- [ ] **Step 6: Convert `/settings/blocked/page.tsx` to a redirect**

```tsx
import { redirect, permanentRedirect } from "next/navigation";

export default function BlockedRedirect() {
  // 301 — old URL retained for any inbound notification-email deep links
  permanentRedirect("/settings/privacy#blocked");
}
```

- [ ] **Step 7: Delete the now-empty `_sections/`**

```bash
rm -r "app/(app)/settings/_sections"
```

- [ ] **Step 8: TS check + manual smoke**

Run: `pnpm tsc --noEmit`
Expected: zero errors.

Run: `pnpm dev`, visit `http://localhost:3000/settings` → confirm redirect to `/settings/profile`. Click each sidebar link; Account/Notifications/Privacy/Danger should 404 (those pages don't exist yet — that's expected). Profile + Connections should render.

- [ ] **Step 9: Commit**

```bash
git add app/\(app\)/settings/ components/settings/sidebar-nav.tsx
git commit -m "feat(settings): subpath route migration + sidebar nav layout"
```

```json:metadata
{"files":["app/(app)/settings/layout.tsx","app/(app)/settings/page.tsx","app/(app)/settings/profile/page.tsx","app/(app)/settings/connections/page.tsx","app/(app)/settings/blocked/page.tsx","components/settings/sidebar-nav.tsx"],"verifyCommand":"pnpm tsc --noEmit","acceptanceCriteria":["/settings 307 redirects to /settings/profile","/settings/blocked 301 redirects to /settings/privacy#blocked","Sidebar shows 6 sections with active styling","Profile + Connections render under new layout"]}
```

---

### Task 4: Profile section — display name + bio

**Goal:** Add UI for `displayName` and `bio` (schema columns already exist). Save-on-blur via two new server actions parallel to `updateDiscordUsername`.

**Files:**
- Modify: `lib/profile/server-actions.ts` (add `updateDisplayName`, `updateBio`)
- Modify: `app/(app)/settings/profile/page.tsx` (add the two new fields)
- Create: `tests/unit/profile-extras.test.ts`

**Acceptance Criteria:**
- [ ] Display name input accepts 0–64 chars; values >64 are rejected with a returned error
- [ ] Bio textarea accepts 0–500 chars; longer values rejected
- [ ] Both trim leading/trailing whitespace before persisting
- [ ] Both revalidate `/u/[username]` and `/settings/profile` after save
- [ ] 4 unit tests pass (length cap, trim, empty-string clears the field, revalidation called)

**Verify:** `pnpm vitest run tests/unit/profile-extras.test.ts`

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/profile-extras.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Pins the contract for the new display-name + bio editors.
 * - 64-char cap on displayName, 500-char cap on bio (matches schema)
 * - Whitespace trimmed before persistence
 * - Empty string clears the field (writes "" not null — matches existing
 *   updateDiscordUsername convention so we don't have a column-by-column
 *   null-vs-empty inconsistency)
 * - Successful save revalidates the public profile + the settings page
 */

const updateMock = vi.fn();
const revalidateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    update: () => ({ set: (v: unknown) => ({ where: () => updateMock(v) }) }),
  },
  schema: { profiles: { userId: "userId" } },
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));

vi.mock("@/lib/supabase/auth-cache", () => ({
  getCachedUser: vi.fn().mockResolvedValue({ id: "user-1", email: "u@e.com" }),
}));

vi.mock("@/lib/db/queries/profiles", () => ({
  getProfileByUserId: vi.fn().mockResolvedValue({ username: "alice" }),
}));

beforeEach(() => {
  updateMock.mockReset();
  revalidateMock.mockReset();
});

describe("updateDisplayName", () => {
  it("trims whitespace and persists", async () => {
    const { updateDisplayName } = await import("@/lib/profile/server-actions");
    await updateDisplayName("  Alice  ");
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ displayName: "Alice" }));
  });

  it("rejects strings over 64 chars", async () => {
    const { updateDisplayName } = await import("@/lib/profile/server-actions");
    const result = await updateDisplayName("a".repeat(65));
    expect(result).toEqual(expect.objectContaining({ error: expect.any(String) }));
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("revalidates the public profile + settings page on success", async () => {
    const { updateDisplayName } = await import("@/lib/profile/server-actions");
    await updateDisplayName("Alice");
    expect(revalidateMock).toHaveBeenCalledWith("/u/alice");
    expect(revalidateMock).toHaveBeenCalledWith("/settings/profile");
  });
});

describe("updateBio", () => {
  it("rejects strings over 500 chars", async () => {
    const { updateBio } = await import("@/lib/profile/server-actions");
    const result = await updateBio("a".repeat(501));
    expect(result).toEqual(expect.objectContaining({ error: expect.any(String) }));
    expect(updateMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Verify tests fail**

Run: `pnpm vitest run tests/unit/profile-extras.test.ts`
Expected: failures complaining `updateDisplayName is not a function` (or similar).

- [ ] **Step 3: Implement the server actions**

Edit `lib/profile/server-actions.ts`. Add two exports modeled on the existing `updateDiscordUsername`:

```ts
"use server";
// ... existing imports ...

const DISPLAY_NAME_MAX = 64;
const BIO_MAX = 500;

export async function updateDisplayName(input: string) {
  const user = await getCachedUser();
  if (!user) return { error: "Not signed in" };
  const trimmed = input.trim();
  if (trimmed.length > DISPLAY_NAME_MAX) {
    return { error: `Display name must be ${DISPLAY_NAME_MAX} characters or fewer` };
  }
  await db
    .update(schema.profiles)
    .set({ displayName: trimmed })
    .where(eq(schema.profiles.userId, user.id));
  const profile = await getProfileByUserId(user.id);
  if (profile?.username) revalidatePath(`/u/${profile.username}`);
  revalidatePath("/settings/profile");
  return { ok: true as const };
}

export async function updateBio(input: string) {
  const user = await getCachedUser();
  if (!user) return { error: "Not signed in" };
  const trimmed = input.trim();
  if (trimmed.length > BIO_MAX) {
    return { error: `Bio must be ${BIO_MAX} characters or fewer` };
  }
  await db
    .update(schema.profiles)
    .set({ bio: trimmed })
    .where(eq(schema.profiles.userId, user.id));
  const profile = await getProfileByUserId(user.id);
  if (profile?.username) revalidatePath(`/u/${profile.username}`);
  revalidatePath("/settings/profile");
  return { ok: true as const };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/unit/profile-extras.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Wire up the UI**

Edit `app/(app)/settings/profile/page.tsx`. Below the existing Discord row, add two new rows. Look at the existing Discord input pattern (probably uses an `onBlur` handler that calls the server action) and copy the structure for both new fields. Show character counters (e.g. `{value.length} / 64`).

- [ ] **Step 6: TS + visual smoke**

Run: `pnpm tsc --noEmit`
Visit `/settings/profile` → confirm Display name + Bio fields render below Discord, save on blur, and remain after a page reload.

- [ ] **Step 7: Commit**

```bash
git add lib/profile/server-actions.ts app/\(app\)/settings/profile/page.tsx tests/unit/profile-extras.test.ts
git commit -m "feat(settings): display name + bio editors"
```

```json:metadata
{"files":["lib/profile/server-actions.ts","app/(app)/settings/profile/page.tsx","tests/unit/profile-extras.test.ts"],"verifyCommand":"pnpm vitest run tests/unit/profile-extras.test.ts","acceptanceCriteria":["64-char cap on displayName","500-char cap on bio","trim before persist","revalidate /u/[username] + /settings/profile","4 tests green"]}
```

---

### Task 5: `userHasPassword()` — admin SDK helper + tests

**Goal:** Server-side helper that reads `auth.users.encrypted_password` for the current user and returns boolean. Per-request memoized via React `cache()`.

**Files:**
- Create: `lib/auth/admin-client.ts` (service-role Supabase client factory; server-only)
- Create: `lib/auth/user-has-password.ts`
- Create: `tests/unit/user-has-password.test.ts`

**Acceptance Criteria:**
- [ ] `userHasPassword(userId): Promise<boolean>` returns `true` when `encrypted_password` is set, `false` when null/missing
- [ ] Per-request cached via React's `cache()` — second call within same request does not re-hit the admin SDK
- [ ] Throws if `SUPABASE_SERVICE_ROLE_KEY` is missing (fast-fail in dev)
- [ ] 3 unit tests pass

**Verify:** `pnpm vitest run tests/unit/user-has-password.test.ts`

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/user-has-password.test.ts`:

```ts
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
```

- [ ] **Step 2: Verify tests fail**

Run: `pnpm vitest run tests/unit/user-has-password.test.ts`
Expected: failures (module doesn't exist yet).

- [ ] **Step 3: Build admin-client factory**

Create `lib/auth/admin-client.ts`:

```ts
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Service-role Supabase client. NEVER import this from a client component
 * or pass results to one — the service-role key bypasses RLS.
 *
 * Used by:
 *  - lib/auth/user-has-password.ts (read auth.users.encrypted_password)
 *  - lib/settings/account-deletion-actions.ts (purge-time auth.admin.deleteUser)
 *  - supabase/functions/account-purge/ (Deno equivalent — separate file)
 */

let cached: SupabaseClient | null = null;

export function getAdminClient(): SupabaseClient {
  if (cached) return cached;
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY missing — cannot build admin client");
  }
  cached = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}
```

- [ ] **Step 4: Build the helper**

Create `lib/auth/user-has-password.ts`:

```ts
import "server-only";
import { cache } from "react";
import { getAdminClient } from "./admin-client";

/**
 * True iff the auth.users row for `userId` has encrypted_password set.
 * Used by /settings/account to branch "Change password" (has password)
 * vs "Set password" (magic-link-only) UI, and by the reauth-actions to
 * decide whether to accept a password or only OTP code.
 *
 * Per-request memoized via React's cache() — same request multiple
 * consumers hit one admin SDK call.
 *
 * Fail-closed: any error from the admin SDK returns false. The downstream
 * UX falls back to OTP reauth, which is strictly safer than assuming the
 * user has a password they don't actually have.
 */
export const userHasPassword = cache(async (userId: string): Promise<boolean> => {
  const admin = getAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user) return false;
  // The Supabase types omit encrypted_password from the public surface,
  // but the admin endpoint returns it. Narrow with an explicit cast.
  const u = data.user as { encrypted_password?: string | null };
  return Boolean(u.encrypted_password);
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run tests/unit/user-has-password.test.ts`
Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/auth/admin-client.ts lib/auth/user-has-password.ts tests/unit/user-has-password.test.ts
git commit -m "feat(settings): userHasPassword admin-SDK helper + per-request cache"
```

```json:metadata
{"files":["lib/auth/admin-client.ts","lib/auth/user-has-password.ts","tests/unit/user-has-password.test.ts"],"verifyCommand":"pnpm vitest run tests/unit/user-has-password.test.ts","acceptanceCriteria":["userHasPassword returns true when encrypted_password set, false when not","Per-request memoized via React cache()","Fail-closed on admin SDK errors"]}
```

---

### Task 6: Reauth server actions — verify password / send OTP / verify OTP

**Goal:** Three server actions used by all three sensitive flows (change password, change email, delete account). One file. No UI yet.

**Files:**
- Create: `lib/auth/reauth-actions.ts`
- Create: `tests/unit/reauth-actions.test.ts`

**Acceptance Criteria:**
- [ ] `verifyCurrentPassword(password)` — calls `signInWithPassword(currentEmail, password)`, discards returned session, throws `ReauthFailedError` on mismatch
- [ ] `sendReauthOtp()` — calls `signInWithOtp({ email: currentEmail, options: { shouldCreateUser: false } })`; rate-limited via existing `rate-limit.ts`
- [ ] `verifyReauthOtp(code)` — calls `verifyOtp({ email: currentEmail, token: code, type: "email" })`, throws `ReauthFailedError` on bad/expired code
- [ ] `ReauthFailedError` exported (so caller flows can catch and surface a friendly message)
- [ ] 6 unit tests cover happy + error paths for all three actions

**Verify:** `pnpm vitest run tests/unit/reauth-actions.test.ts`

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/reauth-actions.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Reauth is the gate in front of password change, email change, and
 * account deletion. These tests pin the contract:
 *  - verifyCurrentPassword discards the session it receives (we only
 *    care about the boolean "is this password correct")
 *  - verifyReauthOtp accepts the email-OTP code from signInWithOtp
 *  - All three throw ReauthFailedError on rejection so consumers have
 *    a single error type to catch
 */

const signInWithPasswordMock = vi.fn();
const signInWithOtpMock = vi.fn();
const verifyOtpMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: signInWithPasswordMock,
      signInWithOtp: signInWithOtpMock,
      verifyOtp: verifyOtpMock,
    },
  }),
}));

vi.mock("@/lib/supabase/auth-cache", () => ({
  getCachedUser: vi.fn().mockResolvedValue({ id: "u1", email: "u@e.com" }),
}));

vi.mock("@/lib/security/rate-limit", () => ({
  enforceRateLimit: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  signInWithPasswordMock.mockReset();
  signInWithOtpMock.mockReset();
  verifyOtpMock.mockReset();
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
```

- [ ] **Step 2: Verify tests fail**

Run: `pnpm vitest run tests/unit/reauth-actions.test.ts`
Expected: failures (module doesn't exist).

- [ ] **Step 3: Implement**

Create `lib/auth/reauth-actions.ts`:

```ts
"use server";

import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { enforceRateLimit } from "@/lib/security/rate-limit";

/**
 * Single error type all three reauth paths throw on rejection. Consumers
 * catch this and surface "That password / code didn't match — try again."
 */
export class ReauthFailedError extends Error {
  constructor(message = "Reauthentication failed") {
    super(message);
    this.name = "ReauthFailedError";
  }
}

async function currentEmail(): Promise<string> {
  const user = await getCachedUser();
  if (!user?.email) throw new ReauthFailedError("Not signed in");
  return user.email;
}

export async function verifyCurrentPassword(password: string): Promise<void> {
  const email = await currentEmail();
  await enforceRateLimit({ key: `reauth-pwd:${email}`, max: 10, windowMs: 5 * 60 * 1000 });
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new ReauthFailedError("Wrong password");
  // We only needed to verify; the session is fine to keep (Supabase returns
  // a fresh one — that's harmless, the user is already signed in).
}

export async function sendReauthOtp(): Promise<void> {
  const email = await currentEmail();
  await enforceRateLimit({ key: `reauth-otp-send:${email}`, max: 3, windowMs: 60 * 60 * 1000 });
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });
  if (error) throw new ReauthFailedError("Could not send code");
}

export async function verifyReauthOtp(code: string): Promise<void> {
  const email = await currentEmail();
  await enforceRateLimit({ key: `reauth-otp-verify:${email}`, max: 10, windowMs: 5 * 60 * 1000 });
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
  if (error) throw new ReauthFailedError("Wrong or expired code");
}
```

(Confirm `enforceRateLimit` signature against `lib/security/rate-limit.ts`. If the actual export name differs, adjust the import; the existing `app/(auth)/login/actions.ts` is a working reference for the rate-limit call shape.)

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/unit/reauth-actions.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/auth/reauth-actions.ts tests/unit/reauth-actions.test.ts
git commit -m "feat(settings): reauth-actions — verifyCurrentPassword + send/verify OTP"
```

```json:metadata
{"files":["lib/auth/reauth-actions.ts","tests/unit/reauth-actions.test.ts"],"verifyCommand":"pnpm vitest run tests/unit/reauth-actions.test.ts","acceptanceCriteria":["verifyCurrentPassword throws on wrong password","sendReauthOtp uses shouldCreateUser:false","verifyReauthOtp throws on bad/expired code","All paths rate-limited","ReauthFailedError exported"]}
```

---

### Task 7: `<ReauthChallenge />` shared component

**Goal:** One Client Component used identically by change-password, change-email, and delete-account flows. Branches on `hasPassword` prop. Manages its own "Send code" → "Enter code" two-step state for OTP path.

**Files:**
- Create: `components/settings/reauth-challenge.tsx`

**Acceptance Criteria:**
- [ ] When `hasPassword=true`, renders a single password input
- [ ] When `hasPassword=false`, renders a "Send code" button initially; after click, shows a 6-digit code input + "Resend" button
- [ ] Exposes `name` prop so the form's outer `FormData` includes the right field name (`current_password` or `otp_code`)
- [ ] No internal submit logic — parent form handles submission

**Verify:** `pnpm tsc --noEmit` and visual check inside any consuming form (Task 9 onward)

**Steps:**

- [ ] **Step 1: Build the component**

Create `components/settings/reauth-challenge.tsx`:

```tsx
"use client";

import { useState } from "react";
import { sendReauthOtp } from "@/lib/auth/reauth-actions";

type Props = {
  /** True when the current user has a password set (change-password mode). */
  hasPassword: boolean;
  /**
   * Form-field names — the parent server action reads these from FormData.
   * Defaults match what the consuming forms in this overhaul use.
   */
  passwordFieldName?: string;
  codeFieldName?: string;
};

export function ReauthChallenge({
  hasPassword,
  passwordFieldName = "current_password",
  codeFieldName = "otp_code",
}: Props) {
  if (hasPassword) {
    return (
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">Current password</span>
        <input
          type="password"
          name={passwordFieldName}
          required
          autoComplete="current-password"
          className="rounded-md border border-input bg-background px-3 py-2"
        />
      </label>
    );
  }
  return <OtpChallenge codeFieldName={codeFieldName} />;
}

function OtpChallenge({ codeFieldName }: { codeFieldName: string }) {
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setSending(true);
    setError(null);
    try {
      await sendReauthOtp();
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send code");
    } finally {
      setSending(false);
    }
  }

  if (!sent) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-muted-foreground">
          We&apos;ll email you a 6-digit code to confirm this change.
        </p>
        <button
          type="button"
          onClick={send}
          disabled={sending}
          className="self-start rounded-md border border-input px-3 py-2"
        >
          {sending ? "Sending…" : "Send code"}
        </button>
        {error ? <p className="text-destructive">{error}</p> : null}
      </div>
    );
  }

  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">6-digit code from your email</span>
      <input
        type="text"
        name={codeFieldName}
        required
        inputMode="numeric"
        pattern="[0-9]{6}"
        maxLength={6}
        autoComplete="one-time-code"
        className="w-32 rounded-md border border-input bg-background px-3 py-2 tracking-widest"
      />
      <button
        type="button"
        onClick={send}
        disabled={sending}
        className="self-start text-xs text-muted-foreground underline"
      >
        Resend code
      </button>
    </label>
  );
}
```

- [ ] **Step 2: TS check**

Run: `pnpm tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add components/settings/reauth-challenge.tsx
git commit -m "feat(settings): ReauthChallenge shared UI primitive"
```

```json:metadata
{"files":["components/settings/reauth-challenge.tsx"],"verifyCommand":"pnpm tsc --noEmit","acceptanceCriteria":["Branches on hasPassword","OTP path manages send/sent state internally","Field names parameterizable","No internal submit"]}
```

---

### Task 8: Privacy page — visibility toggle + blocked users absorbed

**Goal:** New `/settings/privacy` page hosting the visibility toggle (`isPublic`) and the blocked-users list (relocated from `/settings/blocked`).

**Files:**
- Create: `lib/settings/visibility-actions.ts` (`toggleProfileVisibility`)
- Create: `tests/unit/visibility-actions.test.ts`
- Create: `app/(app)/settings/privacy/page.tsx`

**Acceptance Criteria:**
- [ ] `toggleProfileVisibility(isPublic: boolean)` updates `profiles.isPublic` for the current user, revalidates `/u/[username]` and `/settings/privacy`
- [ ] Page renders the toggle bound to current `isPublic` value, plus the existing blocked-users list with the same unblock action
- [ ] Blocked section has `id="blocked"` so the `/settings/blocked` redirect anchor lands at the right scroll position
- [ ] 2 unit tests pass

**Verify:** `pnpm vitest run tests/unit/visibility-actions.test.ts` + visual check at `/settings/privacy`

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `tests/unit/visibility-actions.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const updateMock = vi.fn();
const revalidateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  db: { update: () => ({ set: (v: unknown) => ({ where: () => updateMock(v) }) }) },
  schema: { profiles: { userId: "userId" } },
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));
vi.mock("@/lib/supabase/auth-cache", () => ({
  getCachedUser: vi.fn().mockResolvedValue({ id: "u1" }),
}));
vi.mock("@/lib/db/queries/profiles", () => ({
  getProfileByUserId: vi.fn().mockResolvedValue({ username: "alice" }),
}));

beforeEach(() => {
  updateMock.mockReset();
  revalidateMock.mockReset();
});

describe("toggleProfileVisibility", () => {
  it("flips isPublic to false and revalidates the public profile + settings page", async () => {
    const { toggleProfileVisibility } = await import("@/lib/settings/visibility-actions");
    await toggleProfileVisibility(false);
    expect(updateMock).toHaveBeenCalledWith({ isPublic: false });
    expect(revalidateMock).toHaveBeenCalledWith("/u/alice");
    expect(revalidateMock).toHaveBeenCalledWith("/settings/privacy");
  });

  it("flips isPublic to true", async () => {
    const { toggleProfileVisibility } = await import("@/lib/settings/visibility-actions");
    await toggleProfileVisibility(true);
    expect(updateMock).toHaveBeenCalledWith({ isPublic: true });
  });
});
```

- [ ] **Step 2: Verify tests fail**

Run: `pnpm vitest run tests/unit/visibility-actions.test.ts`
Expected: module-not-found errors.

- [ ] **Step 3: Implement the action**

Create `lib/settings/visibility-actions.ts`:

```ts
"use server";

import "server-only";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { getProfileByUserId } from "@/lib/db/queries/profiles";

export async function toggleProfileVisibility(isPublic: boolean) {
  const user = await getCachedUser();
  if (!user) return { error: "Not signed in" };
  await db
    .update(schema.profiles)
    .set({ isPublic })
    .where(eq(schema.profiles.userId, user.id));
  const profile = await getProfileByUserId(user.id);
  if (profile?.username) revalidatePath(`/u/${profile.username}`);
  revalidatePath("/settings/privacy");
  return { ok: true as const };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/unit/visibility-actions.test.ts`
Expected: 2 tests pass.

- [ ] **Step 5: Build the page**

Create `app/(app)/settings/privacy/page.tsx`:

```tsx
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { getProfileByUserId } from "@/lib/db/queries/profiles";
import { getBlocked } from "@/lib/social/blocks/server-actions";
import { VisibilityToggle } from "./visibility-toggle";
import { BlockedList } from "./blocked-list";
import { redirect } from "next/navigation";

export default async function PrivacyPage() {
  const user = await getCachedUser();
  if (!user) redirect("/login");
  const profile = await getProfileByUserId(user.id);
  const blocked = await getBlocked();

  return (
    <div className="flex flex-col gap-10">
      <section>
        <h2 className="text-lg font-medium">Profile visibility</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Private hides your library, reviews, and lists from anyone who doesn&apos;t already
          follow you. People who already follow you keep their access.
        </p>
        <div className="mt-4">
          <VisibilityToggle initial={profile?.isPublic ?? true} />
        </div>
      </section>
      <section id="blocked">
        <h2 className="text-lg font-medium">Blocked users</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Blocked users can&apos;t see your content, and you won&apos;t see theirs.
        </p>
        <div className="mt-4">
          <BlockedList initial={blocked} />
        </div>
      </section>
    </div>
  );
}
```

Create `app/(app)/settings/privacy/visibility-toggle.tsx` as a small Client Component that calls `toggleProfileVisibility` on change. Create `app/(app)/settings/privacy/blocked-list.tsx` by copy-extracting from the existing `/settings/blocked` page and adapting to receive `initial` as props (since the parent already loaded the data).

- [ ] **Step 6: Visual smoke**

Visit `/settings/privacy` → toggle works (refresh to confirm persistence), blocked list renders, unblock works. Visit `/settings/blocked` → 301 to `/settings/privacy#blocked` → page scrolls to the blocked section.

- [ ] **Step 7: Commit**

```bash
git add lib/settings/visibility-actions.ts app/\(app\)/settings/privacy tests/unit/visibility-actions.test.ts
git commit -m "feat(settings): privacy page — visibility toggle + blocked users absorbed"
```

```json:metadata
{"files":["lib/settings/visibility-actions.ts","app/(app)/settings/privacy/page.tsx","app/(app)/settings/privacy/visibility-toggle.tsx","app/(app)/settings/privacy/blocked-list.tsx","tests/unit/visibility-actions.test.ts"],"verifyCommand":"pnpm vitest run tests/unit/visibility-actions.test.ts","acceptanceCriteria":["toggleProfileVisibility persists isPublic + revalidates","Page renders toggle + blocked list","#blocked anchor matches the redirect target","2 tests green"]}
```

---

### Task 9: Notifications page — cadence + per-type opt-outs + digest filter

**Goal:** New `/settings/notifications` page with cadence dropdown + 4 per-type checkboxes. Update `buildDigest` to filter notification rows by per-type opt-outs.

**Files:**
- Create: `lib/settings/notification-prefs-actions.ts` (`updateCadence`, `updateEmailType`)
- Create: `tests/unit/notification-prefs.test.ts`
- Modify: `lib/social/notifications/digest.ts` (filter notifications by `email_*` prefs)
- Modify: `tests/unit/digest-builder.test.ts` (add per-type filter coverage)
- Create: `app/(app)/settings/notifications/page.tsx`

**Acceptance Criteria:**
- [ ] `updateCadence("off" | "daily" | "weekly")` persists to `profiles.emailDigestCadence`
- [ ] `updateEmailType(type, enabled)` persists to the matching `email_*` boolean column
- [ ] `buildDigest` filters out notification rows for types the user has opted out of (e.g. `emailFollows=false` → no `new_follower` rows in the digest)
- [ ] Page renders cadence dropdown + 4 checkboxes bound to current values; saves on change
- [ ] 4 unit tests on prefs actions + 2 added tests in digest-builder pass

**Verify:** `pnpm vitest run tests/unit/notification-prefs.test.ts tests/unit/digest-builder.test.ts`

**Steps:**

- [ ] **Step 1: Write the failing prefs tests**

Create `tests/unit/notification-prefs.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const updateMock = vi.fn();
const revalidateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  db: { update: () => ({ set: (v: unknown) => ({ where: () => updateMock(v) }) }) },
  schema: { profiles: { userId: "userId" } },
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));
vi.mock("@/lib/supabase/auth-cache", () => ({
  getCachedUser: vi.fn().mockResolvedValue({ id: "u1" }),
}));

beforeEach(() => {
  updateMock.mockReset();
  revalidateMock.mockReset();
});

describe("updateCadence", () => {
  it("persists 'daily' to emailDigestCadence", async () => {
    const { updateCadence } = await import("@/lib/settings/notification-prefs-actions");
    await updateCadence("daily");
    expect(updateMock).toHaveBeenCalledWith({ emailDigestCadence: "daily" });
  });

  it("rejects an unknown cadence value", async () => {
    const { updateCadence } = await import("@/lib/settings/notification-prefs-actions");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await updateCadence("yearly" as any);
    expect(result).toEqual(expect.objectContaining({ error: expect.any(String) }));
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("updateEmailType", () => {
  it("persists email_follows = false", async () => {
    const { updateEmailType } = await import("@/lib/settings/notification-prefs-actions");
    await updateEmailType("follows", false);
    expect(updateMock).toHaveBeenCalledWith({ emailFollows: false });
  });

  it("rejects an unknown type", async () => {
    const { updateEmailType } = await import("@/lib/settings/notification-prefs-actions");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await updateEmailType("dm" as any, true);
    expect(result).toEqual(expect.objectContaining({ error: expect.any(String) }));
    expect(updateMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement the prefs actions**

Create `lib/settings/notification-prefs-actions.ts`:

```ts
"use server";

import "server-only";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";

const CADENCE_VALUES = ["off", "daily", "weekly"] as const;
type Cadence = (typeof CADENCE_VALUES)[number];

const TYPE_TO_COLUMN = {
  follows: "emailFollows",
  reactions: "emailReactions",
  comments: "emailComments",
  wishlist: "emailWishlist",
} as const;
type EmailType = keyof typeof TYPE_TO_COLUMN;

export async function updateCadence(value: Cadence) {
  const user = await getCachedUser();
  if (!user) return { error: "Not signed in" };
  if (!CADENCE_VALUES.includes(value)) return { error: "Invalid cadence" };
  await db
    .update(schema.profiles)
    .set({ emailDigestCadence: value })
    .where(eq(schema.profiles.userId, user.id));
  revalidatePath("/settings/notifications");
  return { ok: true as const };
}

export async function updateEmailType(type: EmailType, enabled: boolean) {
  const user = await getCachedUser();
  if (!user) return { error: "Not signed in" };
  const column = TYPE_TO_COLUMN[type];
  if (!column) return { error: "Invalid type" };
  await db
    .update(schema.profiles)
    .set({ [column]: enabled })
    .where(eq(schema.profiles.userId, user.id));
  revalidatePath("/settings/notifications");
  return { ok: true as const };
}
```

Run tests: `pnpm vitest run tests/unit/notification-prefs.test.ts` → expect 4 passing.

- [ ] **Step 3: Update `buildDigest` to filter by per-type opt-outs**

Edit `lib/social/notifications/digest.ts`. The existing `findFirst` already pulls `emailDigestCadence`; extend the `columns` selection to also pull the 4 booleans:

```ts
columns: {
  userId: true,
  username: true,
  displayName: true,
  lastDigestSentAt: true,
  emailDigestCadence: true,
  emailFollows: true,       // NEW
  emailReactions: true,     // NEW
  emailComments: true,      // NEW
  emailWishlist: true,      // NEW
},
```

After the existing notifications query returns rows, filter them:

```ts
const NOTIF_TYPE_TO_PREF: Record<string, keyof typeof profile> = {
  new_follower: "emailFollows",
  review_liked: "emailReactions",
  list_liked: "emailReactions",
  review_commented: "emailComments",
  comment_replied: "emailComments",
  wishlist_logged_by_friend: "emailWishlist",
};

const allowed = rawNotifications.filter((n) => {
  const prefKey = NOTIF_TYPE_TO_PREF[n.type];
  if (!prefKey) return true;  // unknown type: include (don't silently drop)
  return profile[prefKey] === true;
});
```

Use `allowed` instead of `rawNotifications` in the rest of the grouping logic.

- [ ] **Step 4: Add filter coverage to `digest-builder.test.ts`**

Open `tests/unit/digest-builder.test.ts` and read the existing `vi.mock("@/lib/db", ...)` block to understand how the test currently surfaces a fake profile + notifications stream. The new tests reuse those primitives and only vary the per-type opt-out values.

Add this block after the existing tests (adapt the `setupMocks` helper name to whatever the file actually uses; the principle is "set per-type prefs on the profile mock, then assert the digest's grouped sections"):

```ts
describe("buildDigest — per-type email opt-outs (T9)", () => {
  it("excludes new_follower notifications when emailFollows is false", async () => {
    // Profile has follows opted-out; reactions opted-in.
    setupMocks({
      profile: {
        userId: "u1",
        username: "alice",
        displayName: "Alice",
        emailDigestCadence: "weekly",
        lastDigestSentAt: null,
        emailFollows: false,
        emailReactions: true,
        emailComments: true,
        emailWishlist: true,
      },
      notifications: [
        { type: "new_follower", actorId: "u2", targetId: null, createdAt: new Date() },
        { type: "review_liked", actorId: "u3", targetId: "rev-1", createdAt: new Date() },
      ],
      // Ancillary fixtures (reviews/lists for hydration) — match the file's pattern.
      reviewsForHydration: [{ id: "rev-1", gameTitle: "Hades" }],
    });

    const { buildDigest } = await import("@/lib/social/notifications/digest");
    const payload = await buildDigest("u1");
    expect(payload).not.toBeNull();
    expect(payload!.newFollowers).toEqual([]);            // filtered out
    expect(payload!.reactions).toHaveLength(1);            // kept
    expect(payload!.reactions[0]).toMatchObject({ kind: "review_liked" });
  });

  it("excludes both review_liked AND list_liked when emailReactions is false (one toggle, two types)", async () => {
    setupMocks({
      profile: {
        userId: "u1",
        username: "alice",
        displayName: "Alice",
        emailDigestCadence: "weekly",
        lastDigestSentAt: null,
        emailFollows: true,
        emailReactions: false,
        emailComments: true,
        emailWishlist: true,
      },
      notifications: [
        { type: "review_liked", actorId: "u2", targetId: "rev-1", createdAt: new Date() },
        { type: "list_liked",   actorId: "u3", targetId: "list-1", createdAt: new Date() },
        { type: "new_follower", actorId: "u4", targetId: null,    createdAt: new Date() },
      ],
      reviewsForHydration: [{ id: "rev-1", gameTitle: "Hades" }],
      listsForHydration:   [{ id: "list-1", title: "Top RPGs" }],
    });

    const { buildDigest } = await import("@/lib/social/notifications/digest");
    const payload = await buildDigest("u1");
    expect(payload).not.toBeNull();
    expect(payload!.reactions).toEqual([]);                 // both reaction types filtered
    expect(payload!.newFollowers).toHaveLength(1);          // follows kept
  });
});
```

If the existing file doesn't have a `setupMocks` helper, factor one out as part of this step (the existing per-test mock setup is presumably duplicated already — extracting is a good cleanup that keeps the new tests legible). The shape of the helper is whatever the existing tests already wire up; the new tests just override the relevant fields.

Run: `pnpm vitest run tests/unit/digest-builder.test.ts` → expect all existing tests still pass plus 2 new ones.

- [ ] **Step 5: Build the notifications page**

Create `app/(app)/settings/notifications/page.tsx`:

```tsx
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { NotificationPrefsForm } from "./prefs-form";

export default async function NotificationsSettingsPage() {
  const user = await getCachedUser();
  if (!user) redirect("/login");
  const profile = await db.query.profiles.findFirst({
    where: eq(schema.profiles.userId, user.id),
    columns: {
      emailDigestCadence: true,
      emailFollows: true,
      emailReactions: true,
      emailComments: true,
      emailWishlist: true,
    },
  });
  if (!profile) redirect("/login");

  return (
    <div className="flex flex-col gap-8">
      <h2 className="text-lg font-medium">Notifications</h2>
      <NotificationPrefsForm initial={profile} />
    </div>
  );
}
```

Create `app/(app)/settings/notifications/prefs-form.tsx` as a Client Component with a `<select>` for cadence and 4 `<input type="checkbox">` for the email types. On change, call the server actions. Layout:

```
Email digest cadence:  [select: Off / Daily / Weekly]

Email me when…
  [x] Someone follows me
  [x] Someone reacts to my review
  [x] Someone comments on me
  [x] Someone wishlists from my list
```

- [ ] **Step 6: Visual smoke + commit**

Visit `/settings/notifications` → toggle works, refresh persists.

```bash
git add lib/settings/notification-prefs-actions.ts lib/social/notifications/digest.ts \
        app/\(app\)/settings/notifications tests/unit/notification-prefs.test.ts \
        tests/unit/digest-builder.test.ts
git commit -m "feat(settings): notifications page — cadence + per-type opt-outs"
```

```json:metadata
{"files":["lib/settings/notification-prefs-actions.ts","lib/social/notifications/digest.ts","app/(app)/settings/notifications/page.tsx","app/(app)/settings/notifications/prefs-form.tsx","tests/unit/notification-prefs.test.ts","tests/unit/digest-builder.test.ts"],"verifyCommand":"pnpm vitest run tests/unit/notification-prefs.test.ts tests/unit/digest-builder.test.ts","acceptanceCriteria":["updateCadence + updateEmailType validate input","buildDigest filters by per-type opt-outs","Page renders + saves on change","6 tests green (4 prefs + 2 digest)"]}
```

---

### Task 10: Account page — change-password flow + sessions

**Goal:** `/settings/account` renders Email + Password + Sessions subsections. Implement the Password subsection (branches on `userHasPassword`) and the Sessions subsection ("Sign out other sessions" button). Email subsection arrives in Task 11.

**Files:**
- Create: `app/(app)/settings/account/page.tsx`
- Create: `app/(app)/settings/account/_components/change-password-form.tsx`
- Create: `app/(app)/settings/account/_components/sign-out-others-button.tsx`
- Create: `lib/auth/password-actions.ts` (`updatePassword`)

**Acceptance Criteria:**
- [ ] `userHasPassword=true` users see "Change password" form (current pwd + new pwd + confirm)
- [ ] `userHasPassword=false` users see "Set password" form, expanded by default, with explanatory callout
- [ ] Submit triggers reauth → `auth.updateUser({ password })` → success toast
- [ ] "Sign out other sessions" button → confirm → `signOut({ scope: 'others' })` → success toast
- [ ] Page TS-clean

**Verify:** Manual smoke per acceptance criteria + `pnpm tsc --noEmit`

**Steps:**

- [ ] **Step 1: Implement `updatePassword` server action**

Create `lib/auth/password-actions.ts`:

```ts
"use server";

import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { userHasPassword } from "./user-has-password";
import { verifyCurrentPassword, verifyReauthOtp, ReauthFailedError } from "./reauth-actions";

const MIN_PASSWORD = 8;

export async function updatePassword(form: FormData) {
  const user = await getCachedUser();
  if (!user) return { error: "Not signed in" };

  const newPassword = String(form.get("new_password") ?? "");
  const confirm = String(form.get("new_password_confirm") ?? "");
  if (newPassword.length < MIN_PASSWORD) {
    return { error: `Password must be at least ${MIN_PASSWORD} characters` };
  }
  if (newPassword !== confirm) return { error: "Passwords don't match" };

  // Reauth gate — branches on whether the user currently has a password.
  const hasPwd = await userHasPassword(user.id);
  try {
    if (hasPwd) {
      await verifyCurrentPassword(String(form.get("current_password") ?? ""));
    } else {
      await verifyReauthOtp(String(form.get("otp_code") ?? ""));
    }
  } catch (e) {
    if (e instanceof ReauthFailedError) return { error: e.message };
    throw e;
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { error: error.message };
  return { ok: true as const };
}
```

- [ ] **Step 2: Build the change-password form**

Create `app/(app)/settings/account/_components/change-password-form.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { ReauthChallenge } from "@/components/settings/reauth-challenge";
import { updatePassword } from "@/lib/auth/password-actions";

export function ChangePasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  return (
    <form
      action={(fd) => {
        setMessage(null);
        startTransition(async () => {
          const result = await updatePassword(fd);
          if ("error" in result) setMessage({ kind: "err", text: result.error });
          else setMessage({ kind: "ok", text: hasPassword ? "Password changed." : "Password set." });
        });
      }}
      className="flex flex-col gap-4"
    >
      {hasPassword ? null : (
        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
          You sign in with magic links. Adding a password gives you a faster login option
          without losing the magic-link option.
        </div>
      )}
      <ReauthChallenge hasPassword={hasPassword} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">New password</span>
        <input type="password" name="new_password" required minLength={8}
               autoComplete="new-password"
               className="rounded-md border border-input bg-background px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">Confirm new password</span>
        <input type="password" name="new_password_confirm" required minLength={8}
               autoComplete="new-password"
               className="rounded-md border border-input bg-background px-3 py-2" />
      </label>
      <button type="submit" disabled={pending}
              className="self-start rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">
        {pending ? "Saving…" : hasPassword ? "Change password" : "Set password"}
      </button>
      {message ? (
        <p className={message.kind === "ok" ? "text-sm text-green-600" : "text-sm text-destructive"}>
          {message.text}
        </p>
      ) : null}
    </form>
  );
}
```

- [ ] **Step 3: Build the sign-out-others button**

Create `app/(app)/settings/account/_components/sign-out-others-button.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { signOutOtherSessions } from "@/lib/auth/sessions-actions";

export function SignOutOthersButton() {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);

  if (done) return <p className="text-sm text-green-600">Signed out everywhere except this browser.</p>;

  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)}
              className="self-start rounded-md border border-input px-3 py-2 text-sm">
        Sign out other sessions
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <p className="text-sm">This signs you out everywhere except this browser. Continue?</p>
      <div className="flex gap-2">
        <button disabled={pending}
                onClick={() => start(async () => {
                  await signOutOtherSessions();
                  setDone(true);
                })}
                className="rounded-md bg-destructive px-3 py-2 text-sm text-destructive-foreground">
          {pending ? "Signing out…" : "Yes, sign out others"}
        </button>
        <button onClick={() => setConfirming(false)}
                className="rounded-md border border-input px-3 py-2 text-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}
```

Create the matching server action in `lib/auth/sessions-actions.ts`:

```ts
"use server";
import "server-only";
import { createClient } from "@/lib/supabase/server";

export async function signOutOtherSessions() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 4: Build the page (with Password + Sessions wired; Email placeholder)**

Create `app/(app)/settings/account/page.tsx`:

```tsx
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { userHasPassword } from "@/lib/auth/user-has-password";
import { redirect } from "next/navigation";
import { ChangePasswordForm } from "./_components/change-password-form";
import { SignOutOthersButton } from "./_components/sign-out-others-button";

export default async function AccountSettingsPage() {
  const user = await getCachedUser();
  if (!user) redirect("/login");
  const hasPassword = await userHasPassword(user.id);

  return (
    <div className="flex flex-col gap-12">
      <section>
        <h2 className="text-lg font-medium">Email</h2>
        <p className="mt-1 text-sm text-muted-foreground">Current: {user.email}</p>
        {/* Email change form arrives in Task 11 */}
      </section>
      <section>
        <h2 className="text-lg font-medium">{hasPassword ? "Change password" : "Set a password"}</h2>
        <div className="mt-4">
          <ChangePasswordForm hasPassword={hasPassword} />
        </div>
      </section>
      <section>
        <h2 className="text-lg font-medium">Sessions</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign out everywhere else. Useful if you logged in on a shared device.
        </p>
        <div className="mt-4">
          <SignOutOthersButton />
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Manual smoke**

Run: `pnpm tsc --noEmit` → zero errors.
Run: `pnpm dev`. Sign in with a password user, visit `/settings/account` → "Change password" form. Sign in with a magic-link-only user → "Set a password" form expanded with callout.

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/settings/account lib/auth/password-actions.ts lib/auth/sessions-actions.ts
git commit -m "feat(settings): account page — change/set password + sign-out-others"
```

```json:metadata
{"files":["app/(app)/settings/account/page.tsx","app/(app)/settings/account/_components/change-password-form.tsx","app/(app)/settings/account/_components/sign-out-others-button.tsx","lib/auth/password-actions.ts","lib/auth/sessions-actions.ts"],"verifyCommand":"pnpm tsc --noEmit","acceptanceCriteria":["Branches on userHasPassword","Reauth gates the change","sign-out-others button uses scope:'others'","Email subsection placeholder pending Task 11"]}
```

---

### Task 11: Account page — change-email flow + live-actual poll

**Goal:** Email subsection of `/settings/account` — change-email form with reauth + live polling for the actual current email (since Supabase's both-confirm flow means there's a window where the change is pending).

**Files:**
- Create: `app/(app)/settings/account/_components/change-email-form.tsx`
- Create: `lib/auth/email-actions.ts` (`updateEmailAddress`)
- Modify: `app/(app)/settings/account/page.tsx` (replace placeholder with the form)

**Acceptance Criteria:**
- [ ] Form: new email + reauth challenge; submit triggers reauth → `auth.updateUser({ email })`
- [ ] Success toast: *"Confirmation links sent to both your old email and your new one. The change applies once you click both."*
- [ ] When the local copy of `user.email` differs from the live admin-SDK value (during the pending window), a "Pending change" callout shows the live actual current email
- [ ] Email format validated client-side (`type="email"`) and server-side (zod)

**Verify:** Manual smoke + `pnpm tsc --noEmit`

**Steps:**

- [ ] **Step 1: Implement `updateEmailAddress` server action**

Create `lib/auth/email-actions.ts`:

```ts
"use server";

import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { userHasPassword } from "./user-has-password";
import { verifyCurrentPassword, verifyReauthOtp, ReauthFailedError } from "./reauth-actions";
import { getAdminClient } from "./admin-client";

const emailSchema = z.string().email();

export async function updateEmailAddress(form: FormData) {
  const user = await getCachedUser();
  if (!user) return { error: "Not signed in" };

  const newEmail = String(form.get("new_email") ?? "");
  const parsed = emailSchema.safeParse(newEmail);
  if (!parsed.success) return { error: "Enter a valid email" };

  const hasPwd = await userHasPassword(user.id);
  try {
    if (hasPwd) await verifyCurrentPassword(String(form.get("current_password") ?? ""));
    else await verifyReauthOtp(String(form.get("otp_code") ?? ""));
  } catch (e) {
    if (e instanceof ReauthFailedError) return { error: e.message };
    throw e;
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ email: parsed.data });
  if (error) return { error: error.message };
  return { ok: true as const };
}

/**
 * Returns the live-actual auth.users.email for the current user.
 * Used by the pending-change poll: when this differs from the locally
 * cached user.email, the change has been confirmed somewhere.
 */
export async function getLiveCurrentEmail(): Promise<string | null> {
  const user = await getCachedUser();
  if (!user) return null;
  const admin = getAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(user.id);
  if (error || !data?.user) return null;
  return data.user.email ?? null;
}
```

- [ ] **Step 2: Build the form**

Create `app/(app)/settings/account/_components/change-email-form.tsx`:

```tsx
"use client";

import { useState, useTransition, useEffect } from "react";
import { ReauthChallenge } from "@/components/settings/reauth-challenge";
import { updateEmailAddress, getLiveCurrentEmail } from "@/lib/auth/email-actions";

type Props = { hasPassword: boolean; cachedEmail: string };

export function ChangeEmailForm({ hasPassword, cachedEmail }: Props) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [liveEmail, setLiveEmail] = useState(cachedEmail);

  // Poll the live-actual email every 30s while a change is pending.
  useEffect(() => {
    if (!pendingEmail) return;
    const interval = setInterval(async () => {
      const live = await getLiveCurrentEmail();
      if (live && live !== liveEmail) {
        setLiveEmail(live);
        if (live === pendingEmail) {
          setPendingEmail(null);
          setMessage("Email change confirmed.");
        }
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [pendingEmail, liveEmail]);

  return (
    <div className="flex flex-col gap-3">
      {pendingEmail ? (
        <div className="rounded-md border border-amber-500/50 bg-amber-50 p-3 text-sm dark:bg-amber-950/20">
          Change pending. Current email is still <strong>{liveEmail}</strong>. Click the
          confirmation links sent to both <strong>{liveEmail}</strong> and{" "}
          <strong>{pendingEmail}</strong> to complete the change.
        </div>
      ) : null}
      <form
        action={(fd) => {
          setMessage(null);
          const newEmail = String(fd.get("new_email") ?? "");
          start(async () => {
            const result = await updateEmailAddress(fd);
            if ("error" in result) setMessage(result.error);
            else {
              setPendingEmail(newEmail);
              setMessage("Confirmation links sent to both your old email and your new one.");
            }
          });
        }}
        className="flex flex-col gap-4"
      >
        <ReauthChallenge hasPassword={hasPassword} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">New email</span>
          <input type="email" name="new_email" required
                 autoComplete="email"
                 className="rounded-md border border-input bg-background px-3 py-2" />
        </label>
        <button type="submit" disabled={pending}
                className="self-start rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">
          {pending ? "Sending…" : "Change email"}
        </button>
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Wire into the page**

Edit `app/(app)/settings/account/page.tsx`. Replace the Email section's placeholder comment with the form:

```tsx
<section>
  <h2 className="text-lg font-medium">Email</h2>
  <p className="mt-1 text-sm text-muted-foreground">Current: {user.email}</p>
  <div className="mt-4">
    <ChangeEmailForm hasPassword={hasPassword} cachedEmail={user.email ?? ""} />
  </div>
</section>
```

(Add the import.)

- [ ] **Step 4: Manual smoke**

Run: `pnpm tsc --noEmit`. Visit `/settings/account` → change email form renders. Submit with a real second email → check both inboxes for confirmation links.

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/settings/account/_components/change-email-form.tsx \
        app/\(app\)/settings/account/page.tsx lib/auth/email-actions.ts
git commit -m "feat(settings): change-email flow + pending-change polling"
```

```json:metadata
{"files":["app/(app)/settings/account/_components/change-email-form.tsx","app/(app)/settings/account/page.tsx","lib/auth/email-actions.ts"],"verifyCommand":"pnpm tsc --noEmit","acceptanceCriteria":["Form gates on reauth + zod email validation","Toast explains both-inbox confirmation","Pending callout shows live-actual email","Polling every 30s detects when change finalizes"]}
```

---

### Task 12: Data export — JSON .zip download

**Goal:** "Download my data" button serializes profile + logs + reviews + lists + comments + last-90-days notifications into a JSON `.zip`, streamed as a download.

**Files:**
- Create: `lib/settings/data-export.ts`
- Create: `tests/unit/data-export.test.ts`
- Create: `app/api/settings/export/route.ts` (GET handler that returns the blob)
- Create: `app/(app)/settings/danger/_components/export-data-button.tsx`

**Acceptance Criteria:**
- [ ] `exportUserData(userId)` returns an object with 6 sections: `profile`, `logs`, `reviews`, `lists`, `comments_authored`, `comments_received` (the latter with redacted commenter PII — display name + user_id only)
- [ ] GET `/api/settings/export` requires authentication, serializes the current user's data, returns a `.zip` with one `data.json` inside
- [ ] Filename: `letterboxd-for-games-{username}-{YYYY-MM-DD}.zip`
- [ ] Button triggers a browser download
- [ ] 3 unit tests pass (shape, comments_received PII redaction, includes own-comments verbatim)

**Verify:** `pnpm vitest run tests/unit/data-export.test.ts` + manual download

**Steps:**

- [ ] **Step 1: Add JSZip dependency**

Run: `pnpm add jszip`

- [ ] **Step 2: Write the failing tests**

Create `tests/unit/data-export.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const queryMock = {
  profiles: { findFirst: vi.fn() },
  logs: { findMany: vi.fn() },
  reviews: { findMany: vi.fn() },
  lists: { findMany: vi.fn() },
  comments: { findMany: vi.fn() },
  notifications: { findMany: vi.fn() },
};

vi.mock("@/lib/db", () => ({
  db: { query: queryMock },
  schema: { profiles: {}, logs: {}, reviews: {}, lists: {}, comments: {}, notifications: {} },
}));

beforeEach(() => {
  Object.values(queryMock).forEach((q) => q.findFirst?.mockReset?.() ?? q.findMany?.mockReset?.());
});

describe("exportUserData", () => {
  it("returns 6 sections in the expected shape", async () => {
    queryMock.profiles.findFirst.mockResolvedValue({ userId: "u1", username: "alice", displayName: "Alice", bio: "hi" });
    queryMock.logs.findMany.mockResolvedValue([]);
    queryMock.reviews.findMany.mockResolvedValue([]);
    queryMock.lists.findMany.mockResolvedValue([]);
    queryMock.comments.findMany
      .mockResolvedValueOnce([])  // authored
      .mockResolvedValueOnce([]); // received
    queryMock.notifications.findMany.mockResolvedValue([]);

    const { exportUserData } = await import("@/lib/settings/data-export");
    const result = await exportUserData("u1");
    expect(Object.keys(result).sort()).toEqual([
      "comments_authored", "comments_received", "lists", "logs", "notifications", "profile", "reviews",
    ].sort());
  });

  it("redacts commenter PII in comments_received (display_name + user_id only)", async () => {
    queryMock.profiles.findFirst.mockResolvedValue({ userId: "u1", username: "alice" });
    queryMock.logs.findMany.mockResolvedValue([]);
    queryMock.reviews.findMany.mockResolvedValue([]);
    queryMock.lists.findMany.mockResolvedValue([]);
    queryMock.comments.findMany
      .mockResolvedValueOnce([])  // authored
      .mockResolvedValueOnce([{    // received
        id: "c1",
        body: "nice review!",
        authorUserId: "u2",
        authorDisplayName: "Bob",
        authorEmail: "bob@example.com",  // present in DB but should be stripped
        authorIp: "1.2.3.4",              // anything else PII
      }]);
    queryMock.notifications.findMany.mockResolvedValue([]);

    const { exportUserData } = await import("@/lib/settings/data-export");
    const result = await exportUserData("u1");
    expect(result.comments_received[0]).toEqual({
      id: "c1",
      body: "nice review!",
      author: { user_id: "u2", display_name: "Bob" },
    });
    expect(JSON.stringify(result.comments_received)).not.toContain("bob@example.com");
    expect(JSON.stringify(result.comments_received)).not.toContain("1.2.3.4");
  });

  it("includes own-authored comments verbatim", async () => {
    queryMock.profiles.findFirst.mockResolvedValue({ userId: "u1", username: "alice" });
    queryMock.logs.findMany.mockResolvedValue([]);
    queryMock.reviews.findMany.mockResolvedValue([]);
    queryMock.lists.findMany.mockResolvedValue([]);
    queryMock.comments.findMany
      .mockResolvedValueOnce([{ id: "c1", body: "my own comment", authorUserId: "u1", reviewId: "r1" }])
      .mockResolvedValueOnce([]);
    queryMock.notifications.findMany.mockResolvedValue([]);

    const { exportUserData } = await import("@/lib/settings/data-export");
    const result = await exportUserData("u1");
    expect(result.comments_authored[0]).toMatchObject({ id: "c1", body: "my own comment", reviewId: "r1" });
  });
});
```

- [ ] **Step 3: Implement the serializer**

Create `lib/settings/data-export.ts`:

```ts
import "server-only";
import { and, eq, gte, inArray, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export type DataExport = {
  profile: unknown;
  logs: unknown[];
  reviews: unknown[];
  lists: unknown[];
  comments_authored: unknown[];
  comments_received: unknown[];
  notifications: unknown[];
};

const NOTIF_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

export async function exportUserData(userId: string): Promise<DataExport> {
  const profile = await db.query.profiles.findFirst({ where: eq(schema.profiles.userId, userId) });
  if (!profile) throw new Error("Profile not found");

  const logs = await db.query.logs.findMany({ where: eq(schema.logs.userId, userId) });
  const reviews = await db.query.reviews.findMany({ where: eq(schema.reviews.userId, userId) });
  const lists = await db.query.lists.findMany({ where: eq(schema.lists.userId, userId) });
  const commentsAuthored = await db.query.comments.findMany({
    where: eq(schema.comments.userId, userId),
  });

  // comments_received: comments left BY others ON the user's content (their reviews
  // and their lists). Two-step query because the comments table holds either
  // reviewId or listId (not both). First collect the user's review/list IDs;
  // then SELECT comments where (reviewId IN userReviews OR listId IN userLists)
  // AND userId != userId.
  //
  // Implementer note: confirm the comments table column names against
  // lib/db/schema.ts before writing the WHERE — the existing
  // lib/social/comments/server-actions.ts already does this kind of filter
  // and is the canonical reference.
  const userReviewIds = (await db.query.reviews.findMany({
    where: eq(schema.reviews.userId, userId),
    columns: { id: true },
  })).map((r) => r.id);
  const userListIds = (await db.query.lists.findMany({
    where: eq(schema.lists.userId, userId),
    columns: { id: true },
  })).map((l) => l.id);

  const commentsReceivedRaw = await db
    .select({
      id: schema.comments.id,
      body: schema.comments.body,
      authorUserId: schema.comments.userId,
      authorDisplayName: schema.profiles.displayName,
      authorUsername: schema.profiles.username,
      reviewId: schema.comments.reviewId,
      listId: schema.comments.listId,
      createdAt: schema.comments.createdAt,
    })
    .from(schema.comments)
    .innerJoin(schema.profiles, eq(schema.profiles.userId, schema.comments.userId))
    .where(
      and(
        ne(schema.comments.userId, userId),  // exclude self-authored
        or(
          userReviewIds.length > 0 ? inArray(schema.comments.reviewId, userReviewIds) : sql`false`,
          userListIds.length > 0 ? inArray(schema.comments.listId, userListIds) : sql`false`,
        ),
      ),
    );

  const commentsReceived = commentsReceivedRaw.map((c) => ({
    id: c.id,
    body: c.body,
    author: {
      user_id: c.authorUserId,
      display_name: c.authorDisplayName ?? c.authorUsername,
    },
  }));

  const cutoff = new Date(Date.now() - NOTIF_LOOKBACK_MS);
  const notifications = await db.query.notifications.findMany({
    where: and(eq(schema.notifications.userId, userId), gte(schema.notifications.createdAt, cutoff)),
  });

  return {
    profile,
    logs,
    reviews,
    lists,
    comments_authored: commentsAuthored,
    comments_received: commentsReceived,
    notifications,
  };
}
```

(The `commentsReceivedRaw` query needs the implementer to write the proper join — the comment exists alongside `reviews` and `lists`; both have a `userId` indicating the content owner. Use Drizzle's `inArray` after fetching the user's review IDs and list IDs. The shape contract above is what matters for the export.)

Run: `pnpm vitest run tests/unit/data-export.test.ts` → expect 3 passing.

- [ ] **Step 4: Build the API route**

Create `app/api/settings/export/route.ts`:

```ts
import "server-only";
import { NextResponse } from "next/server";
import JSZip from "jszip";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { getProfileByUserId } from "@/lib/db/queries/profiles";
import { exportUserData } from "@/lib/settings/data-export";

export async function GET() {
  const user = await getCachedUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const profile = await getProfileByUserId(user.id);
  const username = profile?.username ?? "unknown";
  const data = await exportUserData(user.id);

  const zip = new JSZip();
  zip.file("data.json", JSON.stringify(data, null, 2));
  const blob = await zip.generateAsync({ type: "uint8array" });

  const today = new Date().toISOString().slice(0, 10);
  const filename = `letterboxd-for-games-${username}-${today}.zip`;

  return new NextResponse(blob, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
```

- [ ] **Step 5: Build the button**

Create `app/(app)/settings/danger/_components/export-data-button.tsx`:

```tsx
"use client";

export function ExportDataButton() {
  return (
    <a href="/api/settings/export" download
       className="inline-block self-start rounded-md border border-input px-3 py-2 text-sm">
      Download my data
    </a>
  );
}
```

(A simple `<a download>` — the browser handles the download from the GET response.)

- [ ] **Step 6: Manual smoke**

Visit `/settings/danger` (page comes in Task 13; for now temporarily render the button somewhere, OR wait to verify until Task 13).

Run: `pnpm vitest run tests/unit/data-export.test.ts` → 3 passing.

- [ ] **Step 7: Commit**

```bash
git add lib/settings/data-export.ts app/api/settings/export/route.ts \
        app/\(app\)/settings/danger/_components/export-data-button.tsx \
        tests/unit/data-export.test.ts package.json pnpm-lock.yaml
git commit -m "feat(settings): data export — JSON .zip download endpoint"
```

```json:metadata
{"files":["lib/settings/data-export.ts","app/api/settings/export/route.ts","app/(app)/settings/danger/_components/export-data-button.tsx","tests/unit/data-export.test.ts"],"verifyCommand":"pnpm vitest run tests/unit/data-export.test.ts","acceptanceCriteria":["6 sections in shape","comments_received redacts PII","comments_authored verbatim","Filename letterboxd-for-games-{username}-{date}.zip","3 tests green"]}
```

---

### Task 13: Soft-delete + cancel-deletion flow + post-delete pages + layout guard

**Goal:** End-to-end soft-delete: from clicking "Delete account" through `/account-deleted` landing, login-callback intercept, `/cancel-deletion` page, layout-level guard for soft-deleted users.

**Files:**
- Create: `lib/settings/account-deletion-actions.ts` (`softDeleteAccount`, `cancelDeletion`, `isAccountSoftDeleted`)
- Create: `tests/unit/account-deletion-actions.test.ts`
- Create: `app/(app)/settings/danger/page.tsx`
- Create: `app/(app)/settings/danger/_components/delete-account-flow.tsx`
- Create: `app/account-deleted/page.tsx` (public, NOT under `(app)`)
- Create: `app/(app)/cancel-deletion/page.tsx`
- Modify: `app/auth/callback/route.ts` (post-exchange: detect `deleted_at`, redirect to `/cancel-deletion`)
- Modify: `app/(app)/layout.tsx` (guard: redirect to `/cancel-deletion` if `deleted_at` is set, except when already on that path)

**Acceptance Criteria:**
- [ ] `softDeleteAccount(form)` reauths, sets `profiles.deleted_at = NOW()`, signs out globally, returns success (redirect happens client-side)
- [ ] `cancelDeletion()` sets `deleted_at = NULL`, returns success
- [ ] Login callback redirects to `/cancel-deletion` when target user has `deleted_at` non-null and within 30 days
- [ ] (app) layout redirects to `/cancel-deletion` for soft-deleted users on any other (app) path
- [ ] Delete modal requires typed username confirmation (case-insensitive match)
- [ ] 4 unit tests pass

**Verify:** `pnpm vitest run tests/unit/account-deletion-actions.test.ts`

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/account-deletion-actions.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const updateMock = vi.fn();
const signOutMock = vi.fn().mockResolvedValue({ error: null });

vi.mock("@/lib/db", () => ({
  db: { update: () => ({ set: (v: unknown) => ({ where: () => updateMock(v) }) }) },
  schema: { profiles: { userId: "userId" } },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { signOut: signOutMock } }),
}));
vi.mock("@/lib/supabase/auth-cache", () => ({
  getCachedUser: vi.fn().mockResolvedValue({ id: "u1", email: "u@e.com" }),
}));
vi.mock("@/lib/db/queries/profiles", () => ({
  getProfileByUserId: vi.fn().mockResolvedValue({ username: "alice" }),
}));
vi.mock("@/lib/auth/user-has-password", () => ({ userHasPassword: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/auth/reauth-actions", () => ({
  verifyCurrentPassword: vi.fn().mockResolvedValue(undefined),
  verifyReauthOtp: vi.fn().mockResolvedValue(undefined),
  ReauthFailedError: class extends Error {},
}));

beforeEach(() => {
  updateMock.mockReset();
  signOutMock.mockClear();
});

describe("softDeleteAccount", () => {
  it("rejects when typed username doesn't match (case-insensitive)", async () => {
    const fd = new FormData();
    fd.set("confirm_username", "wrong");
    fd.set("current_password", "pwd");
    const { softDeleteAccount } = await import("@/lib/settings/account-deletion-actions");
    const result = await softDeleteAccount(fd);
    expect(result).toEqual(expect.objectContaining({ error: expect.stringContaining("username") }));
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("accepts case-insensitive username match", async () => {
    const fd = new FormData();
    fd.set("confirm_username", "ALICE");
    fd.set("current_password", "pwd");
    const { softDeleteAccount } = await import("@/lib/settings/account-deletion-actions");
    await softDeleteAccount(fd);
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ deletedAt: expect.any(Date) }));
  });

  it("signs out globally on success", async () => {
    const fd = new FormData();
    fd.set("confirm_username", "alice");
    fd.set("current_password", "pwd");
    const { softDeleteAccount } = await import("@/lib/settings/account-deletion-actions");
    await softDeleteAccount(fd);
    expect(signOutMock).toHaveBeenCalledWith({ scope: "global" });
  });
});

describe("cancelDeletion", () => {
  it("clears deletedAt", async () => {
    const { cancelDeletion } = await import("@/lib/settings/account-deletion-actions");
    await cancelDeletion();
    expect(updateMock).toHaveBeenCalledWith({ deletedAt: null });
  });
});
```

- [ ] **Step 2: Implement the actions**

Create `lib/settings/account-deletion-actions.ts`:

```ts
"use server";

import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { getProfileByUserId } from "@/lib/db/queries/profiles";
import { userHasPassword } from "@/lib/auth/user-has-password";
import {
  verifyCurrentPassword,
  verifyReauthOtp,
  ReauthFailedError,
} from "@/lib/auth/reauth-actions";

export async function softDeleteAccount(form: FormData) {
  const user = await getCachedUser();
  if (!user) return { error: "Not signed in" };
  const profile = await getProfileByUserId(user.id);
  if (!profile) return { error: "Profile not found" };

  const typed = String(form.get("confirm_username") ?? "").trim();
  if (typed.toLowerCase() !== profile.username.toLowerCase()) {
    return { error: "Typed username doesn't match — try again" };
  }

  const hasPwd = await userHasPassword(user.id);
  try {
    if (hasPwd) await verifyCurrentPassword(String(form.get("current_password") ?? ""));
    else await verifyReauthOtp(String(form.get("otp_code") ?? ""));
  } catch (e) {
    if (e instanceof ReauthFailedError) return { error: e.message };
    throw e;
  }

  await db
    .update(schema.profiles)
    .set({ deletedAt: new Date() })
    .where(eq(schema.profiles.userId, user.id));

  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "global" });

  return { ok: true as const };
}

export async function cancelDeletion() {
  const user = await getCachedUser();
  if (!user) return { error: "Not signed in" };
  await db
    .update(schema.profiles)
    .set({ deletedAt: null })
    .where(eq(schema.profiles.userId, user.id));
  return { ok: true as const };
}

export async function isAccountSoftDeleted(userId: string): Promise<Date | null> {
  const profile = await db.query.profiles.findFirst({
    where: eq(schema.profiles.userId, userId),
    columns: { deletedAt: true },
  });
  return profile?.deletedAt ?? null;
}
```

Run: `pnpm vitest run tests/unit/account-deletion-actions.test.ts` → expect 4 passing.

- [ ] **Step 3: Build the danger page**

Create `app/(app)/settings/danger/page.tsx`:

```tsx
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { userHasPassword } from "@/lib/auth/user-has-password";
import { getProfileByUserId } from "@/lib/db/queries/profiles";
import { redirect } from "next/navigation";
import { ExportDataButton } from "./_components/export-data-button";
import { DeleteAccountFlow } from "./_components/delete-account-flow";

export default async function DangerPage() {
  const user = await getCachedUser();
  if (!user) redirect("/login");
  const [hasPassword, profile] = await Promise.all([
    userHasPassword(user.id),
    getProfileByUserId(user.id),
  ]);
  if (!profile) redirect("/login");

  return (
    <div className="flex flex-col gap-12">
      <section>
        <h2 className="text-lg font-medium">Export your data</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Download a JSON archive of your profile, library, reviews, lists, and comments.
        </p>
        <div className="mt-4">
          <ExportDataButton />
        </div>
      </section>
      <hr className="border-border" />
      <section>
        <h2 className="text-lg font-medium text-destructive">Delete your account</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your account will be marked deleted immediately. You have 30 days to sign back in
          and cancel before everything is permanently removed.
        </p>
        <div className="mt-4">
          <DeleteAccountFlow hasPassword={hasPassword} username={profile.username} />
        </div>
      </section>
    </div>
  );
}
```

Create `app/(app)/settings/danger/_components/delete-account-flow.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ReauthChallenge } from "@/components/settings/reauth-challenge";
import { softDeleteAccount } from "@/lib/settings/account-deletion-actions";

type Props = { hasPassword: boolean; username: string };

export function DeleteAccountFlow({ hasPassword, username }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
              className="rounded-md bg-destructive px-3 py-2 text-sm text-destructive-foreground">
        Delete my account
      </button>
    );
  }

  return (
    <form
      action={(fd) => {
        setError(null);
        start(async () => {
          const result = await softDeleteAccount(fd);
          if ("error" in result) setError(result.error);
          else router.push("/account-deleted");
        });
      }}
      className="flex flex-col gap-4 rounded-md border border-destructive/50 p-4"
    >
      <div className="text-sm">
        <p className="font-medium">This will:</p>
        <ul className="mt-2 list-disc pl-5 text-muted-foreground">
          <li>Hide your reviews and ratings from the feed immediately</li>
          <li>Remove your taste fingerprint from your followers&apos; recommendations</li>
          <li>Hide your imported library</li>
          <li>Permanently delete everything in 30 days unless you sign back in to cancel</li>
        </ul>
      </div>
      <ReauthChallenge hasPassword={hasPassword} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">
          Type your username (<code>{username}</code>) to confirm
        </span>
        <input type="text" name="confirm_username" required autoComplete="off"
               className="rounded-md border border-input bg-background px-3 py-2" />
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={pending}
                className="rounded-md bg-destructive px-3 py-2 text-sm text-destructive-foreground">
          {pending ? "Deleting…" : "Delete my account"}
        </button>
        <button type="button" onClick={() => setOpen(false)}
                className="rounded-md border border-input px-3 py-2 text-sm">
          Cancel
        </button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </form>
  );
}
```

- [ ] **Step 4: Build the post-delete public page**

Create `app/account-deleted/page.tsx` (note: NOT under `(app)` — public, no auth required):

```tsx
import Link from "next/link";

export default function AccountDeletedPage() {
  const restoreBy = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString();
  return (
    <main className="container mx-auto max-w-lg px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Your account is scheduled for deletion</h1>
      <p className="mt-4 text-muted-foreground">
        We&apos;ll permanently remove your data on or around <strong>{restoreBy}</strong>.
      </p>
      <p className="mt-2 text-muted-foreground">
        If you change your mind, just sign in within the next 30 days and we&apos;ll restore everything.
      </p>
      <Link href="/login" className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">
        Sign in to cancel
      </Link>
    </main>
  );
}
```

- [ ] **Step 5: Build the cancel-deletion page**

Create `app/(app)/cancel-deletion/page.tsx`:

```tsx
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { isAccountSoftDeleted, cancelDeletion } from "@/lib/settings/account-deletion-actions";
import { redirect } from "next/navigation";

export default async function CancelDeletionPage() {
  const user = await getCachedUser();
  if (!user) redirect("/login");
  const deletedAt = await isAccountSoftDeleted(user.id);
  if (!deletedAt) redirect("/home");

  async function cancel() {
    "use server";
    await cancelDeletion();
    redirect("/home");
  }

  const restoreBy = new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString();

  return (
    <main className="container mx-auto max-w-lg px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Welcome back</h1>
      <p className="mt-4 text-muted-foreground">
        Your account is scheduled for deletion on <strong>{restoreBy}</strong>.
      </p>
      <form action={cancel} className="mt-6">
        <button type="submit"
                className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">
          Cancel deletion and restore my account
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 6: Augment the auth callback**

Edit `app/auth/callback/route.ts`. After the existing successful `exchangeCodeForSession` + `ensureMyProfile()`, add:

```ts
import { isAccountSoftDeleted } from "@/lib/settings/account-deletion-actions";

// ... after session exchange + ensureMyProfile() ...

const { data: { user } } = await supabase.auth.getUser();
if (user) {
  const deletedAt = await isAccountSoftDeleted(user.id);
  if (deletedAt) {
    const ageMs = Date.now() - deletedAt.getTime();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    if (ageMs < thirtyDaysMs) {
      // Within grace — offer cancel UI. Suppress any ?next= override.
      return NextResponse.redirect(new URL("/cancel-deletion", req.url));
    }
    // Past grace: shouldn't happen (purge cron would have removed auth.users),
    // but if we hit a race, surface a friendly page.
    return NextResponse.redirect(new URL("/account-deleted", req.url));
  }
}

// ... existing redirect to ?next= or /home ...
```

- [ ] **Step 7: Add layout-level guard**

Edit `app/(app)/layout.tsx`. After fetching the current user (already done for the navbar):

```tsx
import { headers } from "next/headers";
import { isAccountSoftDeleted } from "@/lib/settings/account-deletion-actions";

// ... inside the layout component, after getCachedUser() returns user ...

if (user) {
  const deletedAt = await isAccountSoftDeleted(user.id);
  if (deletedAt) {
    const pathname = (await headers()).get("x-pathname") ?? "";
    if (!pathname.startsWith("/cancel-deletion")) {
      redirect("/cancel-deletion");
    }
  }
}
```

(If `x-pathname` isn't already set by middleware, set it there. The Next.js 16 pattern is to read pathname via headers in a Server Component layout. Confirm against the existing middleware in `lib/supabase/middleware.ts` — if pathname propagation isn't already there, add it.)

- [ ] **Step 8: Manual smoke**

End-to-end: visit `/settings/danger` → click delete → modal opens → reauth + type username → submit → land on `/account-deleted`. Sign back in → land on `/cancel-deletion` → click Cancel → restored to `/home` and content visible again.

Run: `pnpm vitest run tests/unit/account-deletion-actions.test.ts` → 4 passing.

- [ ] **Step 9: Commit**

```bash
git add lib/settings/account-deletion-actions.ts \
        app/\(app\)/settings/danger \
        app/\(app\)/cancel-deletion \
        app/account-deleted \
        app/auth/callback/route.ts \
        app/\(app\)/layout.tsx \
        tests/unit/account-deletion-actions.test.ts
git commit -m "feat(settings): soft-delete + cancel + post-delete pages + layout guard"
```

```json:metadata
{"files":["lib/settings/account-deletion-actions.ts","app/(app)/settings/danger/page.tsx","app/(app)/settings/danger/_components/delete-account-flow.tsx","app/(app)/cancel-deletion/page.tsx","app/account-deleted/page.tsx","app/auth/callback/route.ts","app/(app)/layout.tsx","tests/unit/account-deletion-actions.test.ts"],"verifyCommand":"pnpm vitest run tests/unit/account-deletion-actions.test.ts","acceptanceCriteria":["softDelete reauths + sets deleted_at + signs out globally","cancelDeletion clears deleted_at","Login callback intercepts soft-deleted users","(app) layout guard restricts navigation to /cancel-deletion","Username confirm is case-insensitive","4 tests green"]}
```

---

### Task 14: Account-purge nightly cron + cascade-delete audit

**Goal:** Supabase Edge Function that runs nightly, hard-deletes any `auth.users` row whose profile has `deleted_at < NOW() - 30 days`. Audit ON DELETE CASCADE coverage before deploy.

**Files:**
- Create: `supabase/functions/account-purge/index.ts`
- Audit: `lib/db/schema.ts` for any FK referencing `auth.users.id` or `profiles.userId` without `onDelete: "cascade"`

**Acceptance Criteria:**
- [ ] Edge function is deployed (mcp__supabase__deploy_edge_function) and ACTIVE
- [ ] Function is scheduled (cron — daily at off-peak local time, e.g. 03:00 UTC)
- [ ] Manual invoke with a test user whose `deleted_at` is backdated to 31 days deletes the auth.users row + cascades through all dependent tables
- [ ] No FK in `lib/db/schema.ts` references the user without `onDelete: "cascade"` (or the exception is documented)

**Verify:** `mcp__supabase__list_edge_functions` (account-purge ACTIVE) + manual cron invoke

**Steps:**

- [ ] **Step 1: Audit cascade coverage**

```bash
grep -n "userId" lib/db/schema.ts | grep -v "//\|^[[:space:]]*\*"
grep -n "references" lib/db/schema.ts
```

For each FK referencing `auth.users.id` or `profiles.userId`, confirm `onDelete: "cascade"`. If any are missing, add a follow-up migration to alter the constraint (Drizzle: `.references(() => target.col, { onDelete: "cascade" })`). Memory suggests Phase 5 already tightened these — list any exceptions discovered.

- [ ] **Step 2: Build the cron function**

Create `supabase/functions/account-purge/index.ts`:

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.9";
import { createClient } from "npm:@supabase/supabase-js@2";

// Service-role auth gate — same convention as taste-drift-cron, daily-sync.
function requireServiceRole(req: Request): Response | null {
  const got = req.headers.get("apikey");
  if (got !== Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
    return new Response("forbidden", { status: 403 });
  }
  return null;
}

Deno.serve(async (req) => {
  const unauthorized = requireServiceRole(req);
  if (unauthorized) return unauthorized;

  const sql = postgres(Deno.env.get("DATABASE_URL")!, { prepare: false });
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  try {
    // 30-day grace window — keep in sync with the Next-side constant
    // and the cancel-deletion page copy.
    const stale = await sql<Array<{ user_id: string }>>`
      SELECT user_id FROM profiles
      WHERE deleted_at IS NOT NULL
        AND deleted_at < NOW() - INTERVAL '30 days'
    `;

    let purged = 0;
    let failed = 0;
    for (const row of stale) {
      const { error } = await admin.auth.admin.deleteUser(row.user_id);
      if (error) {
        console.error("account-purge: failed", row.user_id, error.message);
        failed++;
      } else {
        purged++;
      }
    }

    const summary = { scanned: stale.length, purged, failed };
    console.log("account-purge:", JSON.stringify(summary));
    return Response.json(summary);
  } finally {
    await sql.end({ timeout: 5 });
  }
});
```

- [ ] **Step 3: Deploy**

```
mcp__supabase__deploy_edge_function
  name: "account-purge"
  files: [{ name: "index.ts", content: <contents above> }]
```

Verify with `mcp__supabase__list_edge_functions` — `account-purge` should show `ACTIVE`.

- [ ] **Step 4: Schedule the cron**

Use Supabase pg_cron (same pattern as the existing daily-sync cron):

```sql
SELECT cron.schedule(
  'account-purge-daily',
  '0 3 * * *',  -- 03:00 UTC daily
  $$ SELECT net.http_post(
       url := 'https://<project>.supabase.co/functions/v1/account-purge',
       headers := jsonb_build_object('apikey', '<service-role-key>')
     ) $$
);
```

Apply via `mcp__supabase__execute_sql`. Replace `<project>` with the actual project ref and `<service-role-key>` from env. The user will need to confirm the SQL before applying since it includes a secret in literal SQL — alternative is to use Supabase's vault for the key.

- [ ] **Step 5: End-to-end manual test**

In a non-production environment (or with a dedicated test user):

```sql
-- Backdate a test user's deleted_at to past the grace window
UPDATE profiles
   SET deleted_at = NOW() - INTERVAL '31 days'
 WHERE user_id = '<test-user-uuid>';
```

Manually invoke the function: `curl -H "apikey: <service-role-key>" https://<project>.supabase.co/functions/v1/account-purge` → JSON response shows `purged: 1`. Verify with `SELECT FROM auth.users WHERE id = '<test-user-uuid>'` → no row.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/account-purge/index.ts
git commit -m "feat(settings): account-purge nightly cron + cascade audit"
```

```json:metadata
{"files":["supabase/functions/account-purge/index.ts"],"verifyCommand":"mcp__supabase__list_edge_functions","acceptanceCriteria":["account-purge function ACTIVE","Scheduled daily at 03:00 UTC","Manual invoke purges past-grace test user + cascades","Cascade audit complete or documented exceptions"]}
```

---

### Task 15: End-to-end verification + final commit

**Goal:** Run the full verification gate from the spec. Tag the branch.

**Files:** None (verification only).

**Acceptance Criteria:**
- [ ] All automated tests pass: `pnpm vitest run` zero failures
- [ ] All manual gate items from the spec's "Verification plan" section pass
- [ ] Branch ready for merge to main

**Verify:** Manual

**Steps:**

- [ ] **Step 1: Full Vitest run**

Run: `pnpm vitest run`
Expected: zero failures. New tests added in this plan: profile-extras, user-has-password, reauth-actions, visibility-actions, notification-prefs (+ digest-builder additions), data-export, account-deletion-actions.

- [ ] **Step 2: TS clean**

Run: `pnpm tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Manual gate — sidebar nav + redirects**

Sign in. Visit:
- `/settings` → 307 to `/settings/profile` ✓
- All 6 sidebar links navigate correctly; active state highlights ✓
- `/settings/blocked` → 301 to `/settings/privacy#blocked`, scrolls to blocked section ✓

- [ ] **Step 4: Manual gate — magic-link user sets password**

Sign in via magic link with a test account that has no password set. Visit `/settings/account` → Password section shows "Set a password" form expanded with the callout. Click "Send code" → email arrives with 6-digit code. Enter code + new password → submit → "Password set" toast. Sign out. Sign in with new password on a fresh browser → success.

- [ ] **Step 5: Manual gate — password user changes email**

Sign in with a test password user. Visit `/settings/account` → Email section. Click "Change email" → form. Enter new email + current password → submit. Both inboxes (old + new) receive Supabase confirmation links. Click both → page polls and shows "Email change confirmed."

- [ ] **Step 6: Manual gate — visibility toggle**

Open another browser/incognito. Visit `/u/<test-username>` → renders. In the original browser, flip `/settings/privacy` toggle to private. Refresh other browser → `/u/<test-username>` returns 404.

- [ ] **Step 7: Manual gate — notification opt-out**

Toggle off "Someone follows me." Have a test second account follow the first. Trigger digest (`pnpm tsx scripts/...` or wait for next cron) → digest does NOT include the new-follower row. In-app `/notifications` inbox still shows the row.

- [ ] **Step 8: Manual gate — sign out other sessions**

Sign in on a second browser. On the first browser, click "Sign out other sessions" → confirm. Refresh second browser → it's signed out. First browser remains signed in.

- [ ] **Step 9: Manual gate — soft delete + cancel**

Sign in. Visit `/settings/danger` → delete flow → reauth + type username → submit → land on `/account-deleted`. From another browser, visit `/u/<test-username>` → 404. Sign back in (within 30 days) → redirect to `/cancel-deletion` → click Cancel → land on `/home`. Visit `/u/<test-username>` from other browser → renders again.

- [ ] **Step 10: Manual gate — data export**

Click "Download my data" on `/settings/danger` → `.zip` downloads. Unzip → `data.json` contains 7 keys (profile, logs, reviews, lists, comments_authored, comments_received, notifications). `comments_received` entries don't contain emails or other PII beyond display name + user_id.

- [ ] **Step 11: Production purge gate**

In a non-prod environment (or with a dedicated test user), backdate `deleted_at` to NOW() - 31 days, manually invoke account-purge function → confirm `auth.users` row deleted + cascade flowed through dependent tables.

- [ ] **Step 12: Memory + final commit**

Update memory with a `settings_overhaul_complete.md` entry: branch tag, commit count, manual gate results, any deferred items. Add to `MEMORY.md` index.

```bash
git tag -a settings-overhaul-complete -m "Settings overhaul shipped — 14 implementation tasks"
git log --oneline main..HEAD  # confirm commit count
```

```json:metadata
{"files":[],"verifyCommand":"manual","acceptanceCriteria":["All Vitest tests green","All 9 manual gate items pass","Production purge gate confirmed","Memory updated","Branch tagged"]}
```

---
