# Settings Overhaul — Design Spec

| Field | Value |
|---|---|
| **Date** | 2026-05-13 |
| **Status** | Approved |
| **Goal** | Round out `/settings` from "profile + connections only" to a full account-management center: change password, change email, manage notification preferences, control profile visibility, and delete account with a 30-day grace window + JSON data export. |
| **Verification gate** | (a) `/settings` redirects to `/settings/profile`; all 6 subroutes render under the unified sidebar nav. (b) A magic-link-only user can set a password from `/settings/account`, then sign in with it on a fresh browser. (c) A password user can change their email; both old and new inboxes receive Supabase confirmation links. (d) Soft-deleted user's content disappears from feed / profile / similar-users within one request cycle; signing back in inside 30 days surfaces a "Cancel deletion?" prompt that restores everything; the nightly purge cron removes past-grace `auth.users` rows. (e) "Download my data" produces a JSON `.zip` containing profile + logs + reviews + lists + comments. |
| **Origin** | Out-of-band user request 2026-05-13: "We need some QOL things in our settings menu such as: Password Changing, Email Changing, and anything else you can think of." |
| **Companion HTML** | None — reuses the existing `/settings` shell and standard form primitives. |

---

## Context

The current `/settings` page covers two needs: profile editing (avatar, username, Discord handle) and connection management (Steam/Xbox sync history). Email is shown read-only. Magic-link-only users have no way to add a password; password users have no way to change theirs. There's no per-type opt-out for any notification stream beyond clicking the global unsubscribe link in a digest email. There is no exit door at all — users who want to leave have no UI-driven way to delete their account.

This spec adds 4 new sections (Account, Notifications, Privacy, Danger Zone) and a small extension to Profile (display name + bio fields whose schema columns have existed since Phase 1.5 but have no UI today). It touches one migration (5 added columns + one partial index), one new Edge function (nightly account-purge cron), and a handful of read-side filters to honor the soft-delete marker. No major architectural shifts — every flow uses Supabase Auth's existing primitives plus the project's existing server-action + rate-limit patterns.

---

## Locked design principles

1. **Subpath routes per section, not in-page tabs.** Every section is its own route under `/settings/*`. Deep-linkable from notification emails, separately metadata-able, separately middleware-able. Matches the pattern `/settings/blocked` already established.
2. **Hybrid reauth, inline.** Sensitive forms carry the proof in the same submission — current password if the user has one; 6-digit email-OTP code if they don't. No separate "verify your identity" page that hands you a token.
3. **Soft delete is the default; hard delete is a scheduled job.** Hitting delete starts a 30-day grace window: content immediately invisible to others, account restorable by signing back in. A nightly cron hard-deletes past-grace rows via `auth.users` cascade.
4. **Schema columns first; UI surfaces later only when a real ask appears.** Every existing-but-unused column (`displayName`, `bio`, `isPublic`, `emailDigestCadence`) gets a UI in this round; the 5 net-new columns (`deletedAt` + 4 boolean email opt-outs) are the minimum viable to support the new flows.
5. **One reauth component, three consumers.** `<ReauthChallenge />` renders the password input or OTP form based on a `userHasPassword()` server check, and is consumed identically by the change-password / change-email / delete-account flows.

---

## Decision log

| # | Question | Decision | Rationale |
|---|---|---|---|
| 1 | Scope | Tier A+B+C+D (account/security + profile completion + comms prefs + lifecycle) | User explicitly chose comprehensive; schema gaps for B and C already exist with no UI |
| 2 | Reauth model | Hybrid (current password OR email-OTP code) | Standard production practice; serves both password and magic-link audiences without forcing a "set password first" intermediate step |
| 3 | Deletion model | Soft delete + 30-day grace + JSON data export | Reversible by the user, exportable in advance, matches Letterboxd/Discord conventions |
| 4 | Notification granularity | Per-type email opt-out + cadence enum | 4 boolean columns + existing cadence enum; standard pattern, modest schema cost; in-app inbox unaffected |
| 5 | Sessions feature | Single "sign out other sessions" button (no device list) | Covers the security need without admin-SDK device-listing complexity |

| # | Section | Decision |
|---|---|---|
| S1 | Routes & navigation | Approved as proposed: 6 subpaths under `/settings/*` + 301 redirect from `/settings/blocked` to `/settings/privacy#blocked` |
| S2 | Section-by-section breakdown | Approved as proposed; absorb blocked-users into privacy; default-expand "Set password" form for magic-link users; hide soft-deleted content immediately |
| S3 | Schema + reauth architecture | Approved as proposed: 5 new columns, partial index on `deleted_at`, inline reauth via shared `<ReauthChallenge />` |
| S4 | Open question defaults | Trusted to recommendation: include comments in export (commenter PII redacted to display name + user_id only); hide soft-deleted users from followers' "following" lists; custom `/account-deleted` post-delete page |

---

## Architecture

### Route layout

```
/settings                       → 307 redirect to /settings/profile
/settings/profile               existing content moves here (avatar, username, discord, +displayName, +bio)
/settings/account               NEW — Email / Password / Sessions
/settings/notifications         NEW — Email digest cadence + 4 per-type opt-outs
/settings/privacy               NEW — Profile visibility toggle + Blocked users list
/settings/connections           existing content moves here (Steam/Xbox/manual sync)
/settings/danger                NEW — Export data + Delete account
/settings/blocked               301 redirect to /settings/privacy#blocked
/account-deleted                NEW — post-delete landing page
```

The sidebar nav becomes a simple vertical list of 6 links plus the existing active-state styling. The hub page `app/(app)/settings/page.tsx` becomes a redirect; section pages live under `app/(app)/settings/[section]/page.tsx` patterns.

### File layout

```
app/(app)/settings/
  page.tsx                                redirect to /settings/profile
  layout.tsx                              shared shell with sidebar nav (NEW)
  profile/page.tsx                        existing content extracted
  account/
    page.tsx                              Email + Password + Sessions sections
    _components/
      change-email-form.tsx
      change-password-form.tsx
      sign-out-others-button.tsx
  notifications/page.tsx                  cadence + 4 checkboxes
  privacy/page.tsx                        visibility toggle + blocked list
  connections/page.tsx                    existing content extracted
  danger/
    page.tsx                              export + delete cards
    _components/
      export-data-button.tsx
      delete-account-flow.tsx

app/(app)/account-deleted/page.tsx        warm goodbye + grace-window copy
app/(app)/cancel-deletion/page.tsx        single-button "Cancel deletion and restore my account"

components/settings/
  reauth-challenge.tsx                    NEW — branches on userHasPassword
  sidebar-nav.tsx                         NEW — extracted vertical nav

lib/auth/
  user-has-password.ts                    NEW — admin-SDK check, cached per-request
  reauth-actions.ts                       NEW — verify-current-password and send/verify-otp helpers

lib/settings/
  notification-prefs-actions.ts           NEW — server actions for cadence + opt-outs
  visibility-actions.ts                   NEW — toggle isPublic
  account-deletion-actions.ts             NEW — soft-delete, cancel, hard-delete-cascade
  data-export.ts                          NEW — JSON serializer for the user's data graph

supabase/functions/account-purge/         NEW — nightly cron, hard-deletes past-grace rows
  index.ts
```

### Code dependencies

```
components/settings/reauth-challenge.tsx ──depends on──▶ lib/auth/user-has-password.ts
                                                         lib/auth/reauth-actions.ts

app/(app)/settings/account/_components/change-password-form.tsx
app/(app)/settings/account/_components/change-email-form.tsx
app/(app)/settings/danger/_components/delete-account-flow.tsx
                                          all consume ──▶ components/settings/reauth-challenge.tsx

lib/settings/account-deletion-actions.ts ──depends on──▶ lib/auth/reauth-actions.ts
                                                         lib/settings/data-export.ts (for "export then delete" inline path)

supabase/functions/account-purge/index.ts ──independently calls──▶ admin SDK auth.admin.deleteUser
                                          (relies on profiles.deleted_at being older than 30 days)
```

---

## Schema changes — Drizzle migration `0013_account_lifecycle_prefs`

**Additions to `profiles`:**

```ts
// soft-delete marker; null = active account
deletedAt:        timestamp("deleted_at", { withTimezone: true }),

// per-type email opt-outs (in-app inbox unaffected); default-on so existing users keep current behavior
emailFollows:     boolean("email_follows").notNull().default(true),
emailReactions:   boolean("email_reactions").notNull().default(true),
emailComments:    boolean("email_comments").notNull().default(true),
emailWishlist:    boolean("email_wishlist").notNull().default(true),
```

**New index:**

```sql
CREATE INDEX profiles_deleted_at_idx
  ON profiles (deleted_at)
  WHERE deleted_at IS NOT NULL;
```

Partial index keeps the table lean — at steady state >99% of rows have `deleted_at IS NULL` and don't need to be in the index. The nightly purge cron uses this to find past-grace rows efficiently.

**Pre-merge gotcha (per project memory `feedback_drizzle_snapshot_chain_drift.md`):** Drizzle snapshots 0007–0011 are missing on disk. Generated migration may attempt to recreate Phase 5 tables and the `games_steam_appid_idx` partial index. Implementer must grep the generated SQL file for any phantom statements not corresponding to this migration's purpose and strip them before applying.

**Read-side filtering required.** Every query that surfaces another user's content must add `WHERE p.deleted_at IS NULL` (or join `profiles p` and filter). Confirmed sites needing the filter:

- `lib/feed/*` — activity feed queries
- `lib/social/follows/*` — follower/following lists
- `lib/social/similar-users.ts` — taste-similarity recs
- `app/u/[username]/page.tsx` — return 404 if profile is soft-deleted
- `lib/social/comments/*` — comment author display
- `lib/lists/*` — list owner display
- `lib/notifications/*` — notification sender display

A pre-merge grep checklist (`grep -rn "from profiles" lib/ app/`) ensures we don't miss one. The taste-fingerprint cron does NOT need filtering — it can keep refreshing soft-deleted users' fingerprints harmlessly; their fingerprints just stop being read.

---

## Section-by-section breakdown

### `/settings/profile` (existing — extend)

| Today | Adding |
|---|---|
| Avatar uploader, Username editor, Discord handle, read-only Email | **Display name** input (0–64 chars, mirrors `displayName` schema column) and **Bio** textarea (0–500 chars, mirrors `bio` schema column, plain text only for v1) |

Both new fields save on blur via the existing pattern in `app/(app)/settings/_sections/profile-section.tsx` (the `updateDiscordUsername` shape). New server actions `updateDisplayName` and `updateBio` go in `lib/profile/server-actions.ts` next to the existing `updateUsername`. Trim whitespace; reject HTML; revalidate `/u/[username]`.

### `/settings/account` — NEW

Three vertically stacked subsections inside one route:

**Email subsection.** Shows current email pulled live from `auth.users.email`. "Change email" button opens an inline form: new email + `<ReauthChallenge />`. Submit calls a server action that runs reauth, then `supabase.auth.updateUser({ email: newEmail })`. On success: toast — *"Confirmation links sent to both your old email and your new one. The change applies once you click both."* The page polls `auth.users.email` every 30s while a pending change is detected, surfacing the live-actual current address separately so users see when the change finalizes.

**Password subsection.** Branches on `userHasPassword()`:

- *Has password:* "Change password" form — current password + new password (8+ chars, matching `signup` validation) + new password confirmation. Submit → server action verifies via `signInWithPassword` (discards returned session), then `updateUser({ password: newPassword })`.
- *No password (magic-link only):* "Set password" form, **expanded by default**, with a callout: *"You sign in with magic links. Adding a password gives you a faster login option without losing the magic-link option."* Form: new password + confirmation + email-OTP code (the OTP gate is the reauth challenge here since there's no current password to verify against). Submit → verify OTP, then `updateUser({ password: newPassword })`.

**Sessions subsection.** A single button: "Sign out other sessions." Confirm modal explains the action. Click → `supabase.auth.signOut({ scope: 'others' })` → toast — *"Signed out everywhere except this browser."* No device list, no admin SDK; this is the bare-minimum security control.

### `/settings/notifications` — NEW

**Email digest cadence.** Dropdown — Off / Daily / Weekly. Bound to existing `profiles.emailDigestCadence` column (currently defaults to `weekly` for all users; first migration does not change defaults). The existing digest cron (`lib/email/digest-template.tsx` consumers) already respects this column.

**"Email me when…"** Section with 4 checkboxes:

- *Someone follows me* → `email_follows`
- *Someone reacts to my review* → `email_reactions`
- *Someone comments on me* → `email_comments`
- *Someone wishlists from my list* → `email_wishlist`

All default `true` so existing users see no behavior change without opting out. Saves on change; no save button. The digest cron must filter notification rows by these prefs before composing the digest body — implementer must locate the cron's notification-collection query and add the filter explicitly. In-app inbox display is **unaffected** by these — they're email opt-outs only.

### `/settings/privacy` — NEW

**Profile visibility.** Single toggle: "Public profile" vs "Private profile." Sub-text under the toggle explains the cascading effect: "Private hides your library, reviews, and lists from anyone who doesn't already follow you. People who already follow you keep their access." Bound to `profiles.isPublic`. Server action revalidates `/u/[username]` and the activity feed routes.

**Blocked users.** The existing `/settings/blocked` page contents move here as a section below the visibility toggle, with the same `getBlocked()` / `unblock()` server actions. The `/settings/blocked` route itself becomes a 301 redirect to `/settings/privacy#blocked` so any existing inbound links / bookmarks / notification-email deep links continue working.

### `/settings/connections` — existing, minor

Pure route move from the in-page-tab on `/settings`. No functional changes. Reconnect buttons keep doing what they do.

### `/settings/danger` — NEW

Two cards separated by a divider, with copy emphasizing "you can change your mind."

**Export your data.** Single button: "Download my data." Click → server action `exportUserData(userId)` serializes:

- Profile (display name, bio, username, email, isPublic, created_at)
- Logs (with games joined: title, status, rating, dates, hours, platforms)
- Reviews (full text, rating, published state, created/updated)
- Lists (title, description, public/private, ordered list of games)
- Comments (the user's own comments + comments others left on the user's content; for the latter, only commenter `display_name` and `user_id` — no email or other PII)
- Notification log (last 90 days of inbox, for context)

Output is a JSON `.zip` named `letterboxd-for-games-{username}-{YYYY-MM-DD}.zip`, streamed directly to the browser. Synchronous; no email-link delivery for v1. (Heavy users with >5000 logs may hit a server-side timeout; if so, we'll add a request-via-email fallback in a follow-up. Not a current-scale problem.)

**Delete account.** Red "Delete my account" button. Modal:

- Bullet list of consequences: "Your reviews and ratings will disappear from the feed immediately. Your followers will lose your taste fingerprint. Your imported library is gone. Your data will be permanently deleted in 30 days."
- `<ReauthChallenge />`
- Confirmation field: "Type your username to confirm" — must match exactly (case-insensitive)

Submit → server action `softDeleteAccount(userId)`:

1. Set `profiles.deleted_at = NOW()`
2. Call `supabase.auth.signOut({ scope: 'global' })`
3. Redirect to `/account-deleted`

The page is render-once: there's no live state polling. If the user changes their mind, they sign back in, and the login callback (described below) handles the cancel-deletion offer.

### `/account-deleted` — NEW

Public page (no auth required) shown immediately after a successful soft-delete. Warm copy:

- "Your account is scheduled for deletion."
- "Your data will be permanently removed on {dateInThirtyDays}."
- "If you change your mind, just sign in within the next 30 days."
- Sign-in link.

### Login-callback augmentation + layout guard

`app/auth/callback/route.ts` already exists. We add: after a successful session exchange, check `profiles.deleted_at` for the authenticated user. If non-null and within 30 days, redirect to `/cancel-deletion` instead of `/home` (any `?next=` parameter is suppressed — cancel-deletion takes precedence). The cancel-deletion page presents a one-button form: "Cancel deletion and restore my account" → server action sets `deleted_at = NULL`, returns to `/home`.

A complementary guard lives in `app/(app)/layout.tsx`: on every (app) request, check `profiles.deleted_at` (read from the same per-request cached profile fetch we already use for the navbar). If non-null, force-redirect to `/cancel-deletion` regardless of the requested path. This catches users who manually navigate to `/home` or any other (app) route while in the grace window — the only valid (app) destination for a soft-deleted session is `/cancel-deletion` itself. Sign-out from this state lands on the public `/account-deleted` page.

If `deleted_at` is set AND past 30 days, the auth user should already have been purged by the cron (so the session exchange would fail). If we somehow encounter that state (race window), we surface a "This account has been deleted" page instead of crashing.

---

## Re-auth flow architecture

Hybrid reauth is **inline** — no intermediate "verify your identity" page that hands the user a token. The change form itself carries the proof, and the server action verifies + applies in one round-trip. Two paths, branched by `userHasPassword()`:

```
┌─ User has password ─────────────────────────────────────┐
│ Form fields:                                             │
│   • new value (email | password | "type username to     │
│     confirm delete")                                     │
│   • current password                                     │
│ Submit → server action:                                  │
│   1. signInWithPassword(currentEmail, currentPassword)  │
│      → discard returned session; throw if invalid       │
│   2. updateUser(...) | softDeleteAccount(...)           │
│   3. revalidate, return success                         │
└──────────────────────────────────────────────────────────┘

┌─ Magic-link-only user ──────────────────────────────────┐
│ Step 1: [Send code] button                               │
│   → server action signInWithOtp({                       │
│       email: currentEmail,                              │
│       options: { shouldCreateUser: false }              │
│     })                                                   │
│   → email arrives with 6-digit code                     │
│ Step 2: form fields:                                     │
│   • new value (as above)                                 │
│   • 6-digit code                                         │
│ Submit → server action:                                  │
│   1. verifyOtp({ email: currentEmail,                   │
│       token: code, type: 'email' })                     │
│      → throw if wrong/expired                            │
│   2. updateUser(...) | softDeleteAccount(...)           │
│   3. revalidate, return success                         │
└──────────────────────────────────────────────────────────┘
```

**Detection.** `lib/auth/user-has-password.ts` exposes `userHasPassword(userId): Promise<boolean>` — uses the admin SDK (`createClient` with service-role key, in a `server-only` module) to read `auth.users.encrypted_password` for the user. Memoized per-request via React's `cache()`, alongside the existing `getCachedUser()` in `lib/supabase/auth-cache.ts`.

**Shared component.** `components/settings/reauth-challenge.tsx` is a Client Component with props `{ onPasswordChange, onCodeSubmit, hasPassword }`. The three sensitive forms wrap it identically — they don't re-implement the branching logic. The component handles the "Send code" → "Enter code" two-step state machine internally for magic-link users.

**Rate limits.** Existing buckets in `lib/security/rate-limit.ts` already cover password attempts (10/IP/5min) and OTP sends (3/email/hour). Reauth piggybacks on these.

**OTP behavior note.** `verifyOtp()` returns a fresh session and rotates auth cookies. This is mostly invisible to the user (they stay logged in), but it interacts with sign-out-others: if a user reauths via OTP and immediately clicks "Sign out other sessions," the now-orphaned previous session may briefly count as "other." Pre-merge manual test will confirm behavior.

**Set-password edge case.** When a magic-link-only user sets a password for the first time, the same OTP flow runs — except the final `updateUser({ password })` adds a password where none existed. Supabase accepts this without a separate API.

---

## Soft delete + grace window + purge cron

```
T0     User clicks "Delete account" → reauth → confirm
       ├─ profiles.deleted_at = NOW()
       ├─ sign out globally
       └─ redirect to /account-deleted

T0+ε   All read-side filters now hide the user:
       • Activity feed: WHERE p.deleted_at IS NULL added
       • Followers' "following" list: filtered out
       • similar-users recs: filtered out
       • /u/[username]: returns 404
       • Comments by this user: rendered with author label "[deleted user]"
         and a generic avatar; comment body remains visible so threads
         stay readable

T <30d User signs back in:
       ├─ login callback detects profiles.deleted_at IS NOT NULL
       ├─ redirect to /cancel-deletion
       └─ user clicks "Cancel deletion" → deleted_at = NULL
                                       → redirect to /home

T 30d  Nightly account-purge cron runs:
       ├─ SELECT user_id FROM profiles
       │  WHERE deleted_at < NOW() - INTERVAL '30 days'
       ├─ FOR EACH: auth.admin.deleteUser(user_id)
       │  → cascades through all FK ON DELETE CASCADE chains
       └─ summary log: { purged: N, started_at, finished_at }
```

The cron lives in `supabase/functions/account-purge/index.ts`, scheduled via `mcp__supabase__create_branch` cron syntax. Same auth pattern (service-role apikey header) as `taste-drift-cron` and `daily-sync`.

**Cascade-delete audit before merge.** The implementer must verify that every FK referencing `auth.users.id` or `profiles.userId` has `ON DELETE CASCADE`. Project memory suggests these were tightened during Phase 5 cleanup; final verification with `grep -rn "references.*onDelete" lib/db/schema.ts` is the pre-merge gate.

---

## Risks

**Soft-delete read coverage.** Easy to miss a query and have a "deleted" user keep haunting a feed for 30 days. Mitigation: the read-side-filtering checklist in the schema section above; pre-merge `grep` for `from profiles` across `lib/` and `app/` with the implementer auditing each match.

**Email-change Supabase behavior.** `updateUser({ email })` sends confirmation to **both** old and new addresses; the change only commits when both are clicked. Users will hit one and wonder why nothing changed. Mitigation: explicit toast copy; the Email subsection polls `auth.users.email` every 30s while a pending change is detected, so the live-actual current email is always visible.

**OTP rotates the session.** `verifyOtp()` returns a fresh session and rotates cookies. Pre-merge manual test: reauth via OTP → immediately sign-out-others → confirm current device stays logged in.

**Data export size.** A heavy user (5000+ logs, 100+ reviews) produces 30–50 MB JSON. Streaming download handles this fine at current scale; a 30-second server-side timeout buffer is the watchdog. Not a current-scale problem.

**Delete-account cascade safety.** Hard delete relies on `ON DELETE CASCADE` from `auth.users` flowing through profiles → logs → reviews → lists → comments → follows → blocks → notifications. Pre-merge audit per the cron section.

**Grace-window login race.** If a user is hard-deleted by the cron at T=30d while simultaneously trying to sign in to cancel, the session-exchange call may fail halfway. Mitigation: surface a friendly "This account has been deleted" page on auth callback failures rather than crashing.

---

## Out of scope

- Per-type **in-app** notification mute (only **email** opt-outs in this round). The inbox at `/notifications` remains a firehose.
- Active session list with device details (browser/IP/last-active). Just the single "sign out other sessions" button.
- OAuth sign-in via Steam / Xbox / Discord (those remain import-only connectors).
- Markdown bio support — plain text only for v1.
- Data export as CSV — JSON only.
- Email-link reauth (clickable magic link from email instead of pasting a code) — we use OTP-code only.
- Notification preference history / audit log.
- Bulk privacy actions ("make all my reviews private at once") — must be done per-review on existing edit pages.
- Ranges / filters on the data-export download — full export only.

---

## Verification plan

**Automated:**

- `pnpm vitest run tests/unit/auth-user-has-password.test.ts` — covers admin SDK call + per-request memoization
- `pnpm vitest run tests/unit/account-deletion-actions.test.ts` — covers soft-delete, cancel, and the grace-window check
- `pnpm vitest run tests/unit/data-export.test.ts` — covers serializer shape against a fixture user
- `pnpm vitest run tests/unit/notification-prefs.test.ts` — covers digest-cron filter respecting opt-outs

**Manual gate:**

- `/settings` → 307 redirect → `/settings/profile` renders with sidebar
- All 6 sub-sections render and the active link highlights correctly
- Magic-link user: `/settings/account` → "Set password" form expanded → set password → sign out → sign in with password on a fresh browser
- Password user: change email → both inboxes receive Supabase confirmation links → click both → email change finalizes
- Privacy toggle: flip to private → another browser hits `/u/[username]` → 404
- Notification prefs: opt out of "follows" → trigger a follow → next digest does not contain follow notifications
- Sign out other sessions: log in on second browser → click sign-out-others on first → second browser is logged out, first stays
- Soft delete: delete account → confirm `/account-deleted` page → confirm content is hidden in another user's feed → sign back in within 30 days → cancel deletion prompt appears → restore → all content visible again
- Data export: click "Download my data" → JSON `.zip` downloads → contents match fixture shape

**Production purge gate:**

- `account-purge` Edge function is deployed and active
- Cron is scheduled (verify in Supabase dashboard)
- Manually invoke once with a test user whose `deleted_at` is backdated to `NOW() - INTERVAL '31 days'` → confirm `auth.users` row is deleted and cascade flows through all dependent tables

---
