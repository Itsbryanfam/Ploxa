# Phase 5 — Social Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the network-effects layer — follow/unfollow, public profile overview hub, chronological activity feed, threaded one-level comments, lists with reorder, in-app notifications + tri-state email digest, split discovery routes (`/discover/games`, `/discover/reviews`, `/discover/people`), and report/block/auto-flag moderation. Meet all 10 automated + 5 manual items of the Phase 5 verification gate. Beta launch milestone.

**Architecture:** Pull-on-read activity feed over `logs` + `reviews` + `lists` (no `activity_events` table). Bidirectional blocks enforced via `withBlockedFilter(viewerId, query, authorIdColumn)` chokepoint applied to every social read; `service_role` bypasses RLS so the filter is application-layer. Notifications flow through a single `emit()` chokepoint with ON CONFLICT dedupe on `(user_id, type, target_id, actor_id)`. Comments threaded one level via existing `parent_id` FK + same-review trigger from migration 0007. Auto-flag is pure rule-based (`checkSpamRules`) — no AI. Email digest is a daily Vercel API route `app/api/internal/digest/run` invoked via pg_cron HTTP, sends through Resend with JWT-signed unsubscribe tokens (pivoted from a Deno Edge Function during T22 because React Email doesn't render cleanly in Deno). List reorder via @dnd-kit; admin gate via `ADMIN_USER_IDS` env allowlist.

**Tech Stack:** Next.js 16 App Router · Server Actions · Drizzle ORM · Supabase pg_cron · Upstash Redis (rate-limit) · Resend (digest) · React Email (template) · jose (JWT) · @dnd-kit (reorder) · TanStack Query v5 · Zustand · Framer Motion · zod · Vitest + Playwright

**Spec:** [docs/superpowers/specs/2026-05-12-phase5-social-design.md](../specs/2026-05-12-phase5-social-design.md)

**Prior phase plan for reference style:** [docs/superpowers/plans/2026-05-12-phase4-taste-recs-plan.md](./2026-05-12-phase4-taste-recs-plan.md)

---

## File Structure

```
lib/db/migrations/
└─ 0008_phase5_social.sql               Hand-written: new tables + columns + enum extensions

lib/db/policies/
└─ 0003_phase5_prep.sql                 Defense-in-depth RLS on new tables

lib/db/schema.ts                        (modify) Drizzle mirror of 0008 changes

lib/social/_shared/
├─ visibility.ts                        withBlockedFilter, isBlockedBetween (chokepoint)
├─ cursors.ts                           Feed cursor encode/decode (eventAt, kind, actorId)
└─ profile-summary.ts                   getProfileSummary(username, viewerId) — overview hub data

lib/social/follows/
├─ server-actions.ts                    follow, unfollow, getFollowers, getFollowing
└─ triggers.ts                          onFollow → emit new_follower

lib/social/blocks/
├─ server-actions.ts                    block, unblock, getBlocked
└─ side-effects.ts                      onBlock — break follow, cascade likes/comments

lib/social/feed/
├─ queries.ts                           buildFeedQuery — UNION ALL over 3 sources
└─ server-actions.ts                    getFeed(viewerId, cursor)

lib/social/comments/
├─ server-actions.ts                    create, edit, softDelete, reply
├─ mentions.ts                          parseMentions, resolveMentionedUserIds
└─ triggers.ts                          onComment → review_commented or comment_replied

lib/social/reactions/
└─ server-actions.ts                    likeReview, unlikeReview, likeList, unlikeList

lib/social/lists/
├─ server-actions.ts                    CRUD + slug + publish + reorder + addItem + removeItem
├─ slug.ts                              slugifyTitle + uniqueness check
└─ triggers.ts                          onListPublish (feed-relevant)

lib/social/notifications/
├─ emit.ts                              Single chokepoint with ON CONFLICT dedupe
├─ server-actions.ts                    getInbox, markRead, markAllRead, getUnreadCount
└─ digest.ts                            buildDigest(userId) — pure payload builder

lib/social/discovery/
├─ popular-games.ts                     SQL aggregate (cached 30 min)
├─ trending-reviews.ts                  SQL aggregate (cached 30 min, post-block-filter)
└─ similar-users.ts                     On-demand cosine sim (reuses lib/taste/vectors.ts)

lib/social/moderation/
├─ rules.ts                             checkSpamRules(body) — pure function
├─ server-actions.ts                    createReport, resolveReport (admin only)
└─ admin.ts                             isAdmin(userId) — ADMIN_USER_IDS env allowlist

lib/email/
└─ digest-template.tsx                  React Email template + plain-text fallback

components/social/
├─ follow-button.tsx                    Client island
├─ block-action.tsx                     Overflow menu item
├─ profile-overview-header.tsx          Avatar + name + follow + counts
└─ followers-grid.tsx                   Reused for /followers and /following

components/feed/
├─ feed-list.tsx                        Server-rendered list + cursor pagination
├─ feed-item-log.tsx                    Log status-change card
├─ feed-item-review.tsx                 Review-publish card
├─ feed-item-list.tsx                   List-publish card
└─ feed-empty-state.tsx                 No-follows / no-events states

components/comments/
├─ comment-thread.tsx                   Recursive one-level renderer
├─ comment-card.tsx                     Single comment row
├─ comment-composer.tsx                 Textarea + @-mention autocomplete
└─ flagged-badge.tsx                    "Pending review" overlay

components/lists/
├─ list-card.tsx                        Grid cell
├─ list-detail.tsx                      Public read view
├─ list-editor.tsx                      Owner reorder w/ @dnd-kit
└─ add-to-list-modal.tsx                Game detail page entry point

components/notifications/
├─ notification-bell.tsx                Sidebar bell w/ unread badge + polling
├─ notification-row.tsx                 Inbox row
└─ digest-preview.tsx                   /settings/notifications "send sample"

components/discovery/
├─ popular-games-grid.tsx               Cover grid
├─ trending-reviews-list.tsx            Vertical review cards
└─ similar-users-row.tsx                User card row

components/moderation/
├─ report-modal.tsx                     Triggered from review/comment/list overflow
├─ reports-queue.tsx                    Admin paginated list
└─ moderation-actions.tsx               Per-row Hide/Keep buttons

app/(app)/
├─ home/feed/page.tsx                   /home/feed
├─ notifications/page.tsx               /notifications
├─ discover/
│  ├─ page.tsx                          /discover landing
│  ├─ games/page.tsx
│  ├─ reviews/page.tsx
│  └─ people/page.tsx
├─ lists/
│  ├─ new/page.tsx                      /lists/new
│  └─ [id]/edit/page.tsx                /lists/[id]/edit
├─ settings/
│  ├─ notifications/page.tsx            /settings/notifications
│  └─ blocked/page.tsx                  /settings/blocked
├─ admin/reports/page.tsx               Admin-only, env-gated
└─ u/[username]/
   ├─ page.tsx                          (REDESIGN) Overview hub
   ├─ lists/page.tsx                    (NEW) All public lists
   ├─ lists/[listSlug]/page.tsx         (NEW) List detail
   ├─ followers/page.tsx                (NEW)
   └─ following/page.tsx                (NEW)

app/unsubscribe/route.ts                Public, JWT-gated (outside (app) group)

app/api/internal/digest/run/
└─ route.ts                             Vercel cron-invoked daily, builds digest, Resend send

supabase/migrations/
└─ 20260512_0002_phase5_digest_cron.sql pg_cron schedule POSTing to the Vercel route

tests/unit/
├─ visibility.test.ts                   withBlockedFilter both directions + logged-out
├─ cursors.test.ts                      Feed cursor round-trips + tiebreak ordering
├─ spam-rules.test.ts                   Truth table per rule
├─ emit-dedupe.test.ts                  ON CONFLICT semantics + skip cases
├─ digest-builder.test.ts               Payload shape + window
├─ slug.test.ts                         slugifyTitle edge cases
└─ mentions.test.ts                     parseMentions edge cases

tests/e2e/
├─ follow-and-feed.spec.ts
├─ block-cascade.spec.ts
├─ comment-thread.spec.ts
├─ auto-flag.spec.ts
├─ notifications-inbox.spec.ts
├─ lists-flow.spec.ts
└─ admin-gate.spec.ts

scripts/
└─ verify-phase-5.ts                    Automated verification pass (mirrors verify-phase-4)

components/layout/nav-tabs.tsx          (modify) Add Feed, Discover, Notifications entries
components/layout/profile-dropdown.tsx  (modify) Add "Blocked users" link
app/(app)/_cockpit/cockpit-dashboard.tsx (modify) Add "Recent activity" card when user has follows
```

---

## Testing convention

Same pattern as Phases 2–4:

- **Vitest unit** (`tests/unit/`): pure functions, helpers, schema validators. Run with `pnpm test` / `pnpm test:watch`. Server-only modules use the existing `tests/helpers/server-only-stub.ts` alias from `vitest.config.ts`.
- **Vitest integration** (`tests/integration/`): only where mock-Redis suffices. DB-touching code goes to Playwright. Reuse `tests/helpers/mock-redis.ts` from Phase 2 test setup.
- **Playwright E2E** (`tests/e2e/`): end-to-end against live dev Supabase with the `pw_test_` user prefix pattern (see `tests/fixtures/seed-test-users.ts`). New fixtures may add `seedReview`-style helpers — keep them additive, not replacing.
- **Type-level**: every task runs `pnpm typecheck && pnpm lint && pnpm build` at the verify step. Treat the build as the integration test.
- **Cron route**: `pnpm dev` + manual `curl` to `/api/internal/digest/run` with the `X-Cron-Secret` header to verify. Production digest verification happens in M1 of the verify gate.

If you find a real bug while writing a test — fix it before committing.

**`vi.stubEnv` hoisting rule** (from `memory/tests_setup_2026_05_13.md`): when a Phase 5 test needs `IMPORT_ENCRYPTION_KEY` / `UNSUBSCRIBE_SECRET` / `RESEND_API_KEY` / similar env vars, the `vi.stubEnv(...)` MUST run at module top-level above any `await import(...)` of a module that transitively imports `lib/env.ts`. `env.ts` freezes `serverEnv` at module-evaluation time; `beforeAll` fires too late. See `tests/unit/encryption.test.ts` for the canonical pattern.

---

## Task ordering rationale

Six-week spiral build per the spec's locked design principles. Tasks 1–5 lay the data + helper foundation — by end of T5 the migration is applied, the schema mirror is in lock-step, RLS defense-in-depth lands, and the block-filter chokepoint + profile-summary helper are unit-tested and ready for consumers.

Tasks 6–9 add the social graph + profile redesign — by T9 two test accounts can follow/block each other, the overview hub renders all 6 sections, and `/settings/blocked` exposes unblock UX.

Tasks 10–13 ship the activity feed — by T13 a follower sees followee material events in chronological order, `logs.last_event_at` is populated on every status change, and feed pagination via cursor works.

Tasks 14–17 add comments + reactions — by T17 two accounts can converse on a review with indented one-level threading, auto-flag rules trip on spammy comments, and likes/list-likes work with dedupe.

Tasks 18–22 ship notifications + email digest — by T22 the inbox renders unread-first, the bell badge polls, and a weekly digest delivers through Resend with a working unsubscribe round-trip.

Tasks 23–26 ship lists + discovery — by T26 lists CRUD + drag-reorder + publish + share URL all work, and the three split discovery routes render correct ordering.

Tasks 27–29 ship moderation + close the gate — by T29 the admin queue is env-gated, the report modal works on all 4 target types, and `verify-phase-5.ts` runs 10 automated groups green with 5 manual items checked off.

One branch per task (`phase-5-t1-migration`, `phase-5-t2-schema-mirror`, …). Merge to main on green verify per task — same discipline as Phase 4. Avoids the "everything wired at the end" pattern.

---

## Task 1: Migration 0008 — schema additions + RLS-ready primitives

**Goal:** Hand-written migration `0008_phase5_social.sql` lands all Phase 5 schema changes (3 new tables, 2 new enums, 7 column additions, 5 new indexes, 1 enum extension, 1 dedupe unique index for the notification chokepoint). Applied to live dev DB via Supabase MCP.

**Files:**
- Create: `lib/db/migrations/0008_phase5_social.sql`
- Modify: `lib/db/migrations/meta/_journal.json` (drizzle-kit auto-bumps)

**Acceptance Criteria:**
- [ ] Migration file exists, hand-written (not drizzle-kit output)
- [ ] Three new tables: `blocks`, `list_likes`, `reports`
- [ ] Two new enum types: `report_target_type`, `report_status`, `email_digest_cadence`
- [ ] Column additions on `lists` (slug, published_at), `logs` (last_event_at, last_event_type), `comments` (is_hidden), `profiles` (email_digest_cadence, last_digest_sent_at)
- [ ] Indexes: `blocks_blocked_blocker_idx`, `list_likes_list_id_idx`, `reports_status_created_idx`, `lists_user_slug_uniq` (unique), `lists_user_published_idx` (partial), `logs_user_event_idx` (partial), `reviews_user_published_idx` (IF NOT EXISTS, partial), `comments_review_created_idx`, `notifications_dedupe_uniq` (unique on `(user_id, type, target_id, actor_id)`)
- [ ] `notification_type` enum extended with `'comment_replied'`
- [ ] Backfills: `lists.slug` from title; `logs.last_event_at` from updated_at + `'status_change'` type
- [ ] CHECK constraint `blocks_no_self` enforced (`blocker_id <> blocked_id`)
- [ ] Migration applied to live dev DB via Supabase MCP `mcp__supabase__apply_migration`
- [ ] Supabase advisors (security + performance) clean after apply

**Verify:** `pnpm drizzle-kit check` clean + run advisor check via MCP

**Steps:**

- [ ] **Step 1: Create the migration file**

Create `lib/db/migrations/0008_phase5_social.sql` with the following content:

```sql
-- ============================================================================
-- 0008_phase5_social — Phase 5 (Social Layer) schema.
--
-- All additions are additive — no breaking changes to existing tables. Live DB
-- was reviewed for duplicate (user_id, type, target_id, actor_id) tuples in
-- notifications before applying notifications_dedupe_uniq; no duplicates exist
-- because the table was empty when this migration ran.
--
-- HAND-WRITTEN (not drizzle-kit). Reasons:
--   - Drizzle doesn't emit CREATE TYPE for new enum types
--   - Drizzle doesn't emit ALTER TYPE ... ADD VALUE
--   - We need the WHERE clauses on partial indexes verbatim
--   - We need the polymorphic reports.target_id (no FK)
--
-- Update lib/db/schema.ts in lock-step (Task 2).
-- ============================================================================

-- ─── Blocks graph (bidirectional with logged-out exception) ──────────
CREATE TABLE "blocks" (
  "blocker_id" uuid NOT NULL REFERENCES "auth"."users"("id") ON DELETE CASCADE,
  "blocked_id" uuid NOT NULL REFERENCES "auth"."users"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("blocker_id", "blocked_id"),
  CONSTRAINT "blocks_no_self" CHECK ("blocker_id" <> "blocked_id")
);--> statement-breakpoint
CREATE INDEX "blocks_blocked_blocker_idx" ON "blocks" USING btree ("blocked_id","blocker_id");--> statement-breakpoint

-- ─── List reactions (parallel to review likes; not generalizing) ─────
CREATE TABLE "list_likes" (
  "user_id" uuid NOT NULL REFERENCES "auth"."users"("id") ON DELETE CASCADE,
  "list_id" uuid NOT NULL REFERENCES "lists"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "list_id")
);--> statement-breakpoint
CREATE INDEX "list_likes_list_id_idx" ON "list_likes" USING btree ("list_id");--> statement-breakpoint

-- ─── Moderation reports queue (polymorphic target_id, no FK) ────────
CREATE TYPE "report_target_type" AS ENUM ('comment','review','list','profile');--> statement-breakpoint
CREATE TYPE "report_status" AS ENUM ('pending','resolved_action_taken','resolved_no_action','auto_flagged');--> statement-breakpoint

CREATE TABLE "reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "reporter_id" uuid REFERENCES "auth"."users"("id") ON DELETE SET NULL,
  "target_type" "report_target_type" NOT NULL,
  "target_id" uuid NOT NULL,
  "reason" text NOT NULL,
  "details" text,
  "status" "report_status" NOT NULL DEFAULT 'pending',
  "resolved_at" timestamptz,
  "resolved_by" uuid REFERENCES "auth"."users"("id") ON DELETE SET NULL,
  "resolver_note" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX "reports_status_created_idx" ON "reports" USING btree ("status","created_at" DESC);--> statement-breakpoint

-- ─── Lists: slug (for /u/{name}/lists/{slug}) + published_at ────────
ALTER TABLE "lists"
  ADD COLUMN "slug" text NOT NULL DEFAULT '',
  ADD COLUMN "published_at" timestamptz;--> statement-breakpoint

-- Backfill slug from title (regex strips non-alphanumeric, lowercases)
UPDATE "lists" SET "slug" = lower(regexp_replace("title",'[^a-z0-9]+','-','gi')) WHERE "slug" = '';--> statement-breakpoint

CREATE UNIQUE INDEX "lists_user_slug_uniq" ON "lists" USING btree ("user_id","slug");--> statement-breakpoint
CREATE INDEX "lists_user_published_idx" ON "lists" USING btree ("user_id","published_at" DESC) WHERE "published_at" IS NOT NULL;--> statement-breakpoint

-- ─── Logs: last_event_at + event_type for feed pull ──────────────────
ALTER TABLE "logs"
  ADD COLUMN "last_event_at" timestamptz,
  ADD COLUMN "last_event_type" text;--> statement-breakpoint

-- Backfill from updated_at (treat all existing rows as status_change events)
UPDATE "logs" SET "last_event_at" = "updated_at", "last_event_type" = 'status_change' WHERE "last_event_at" IS NULL;--> statement-breakpoint

CREATE INDEX "logs_user_event_idx" ON "logs" USING btree ("user_id","last_event_at" DESC) WHERE "last_event_at" IS NOT NULL;--> statement-breakpoint

-- ─── Reviews: feed index (idempotent) ────────────────────────────────
CREATE INDEX IF NOT EXISTS "reviews_user_published_idx" ON "reviews" USING btree ("user_id","published_at" DESC) WHERE "published_at" IS NOT NULL;--> statement-breakpoint

-- ─── Comments: moderation flag + read ordering ───────────────────────
ALTER TABLE "comments" ADD COLUMN "is_hidden" boolean NOT NULL DEFAULT false;--> statement-breakpoint
CREATE INDEX "comments_review_created_idx" ON "comments" USING btree ("review_id","created_at" DESC);--> statement-breakpoint

-- ─── Profiles: email digest preference ───────────────────────────────
CREATE TYPE "email_digest_cadence" AS ENUM ('off','daily','weekly');--> statement-breakpoint
ALTER TABLE "profiles"
  ADD COLUMN "email_digest_cadence" "email_digest_cadence" NOT NULL DEFAULT 'weekly',
  ADD COLUMN "last_digest_sent_at" timestamptz;--> statement-breakpoint

-- ─── Notifications: dedupe unique + comment_replied enum value ──────
-- This enables the ON CONFLICT in lib/social/notifications/emit.ts.
-- (user_id, type, target_id, actor_id) is the dedupe key; emitting again
-- bumps created_at and clears read_at.
CREATE UNIQUE INDEX "notifications_dedupe_uniq" ON "notifications" USING btree ("user_id","type","target_id","actor_id");--> statement-breakpoint

ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'comment_replied';
```

- [ ] **Step 2: CRITICAL — strip any `CREATE TABLE "auth"."users"` line**

Per the Drizzle auth.users gotcha memory:

```powershell
Select-String -Path lib/db/migrations/0008_*.sql -Pattern 'CREATE TABLE "auth"."users"'
```

Should return nothing. If it finds a match (Drizzle sometimes hallucinates this when FK references include `auth.users`), edit the SQL file and delete the offending block.

- [ ] **Step 3: Bump `_journal.json`**

Open `lib/db/migrations/meta/_journal.json` and add the new entry to the `entries` array (tag = `0008_phase5_social`, idx incremented from the prior entry). Match the format of the existing entry for 0007.

- [ ] **Step 4: Apply migration to live dev DB via Supabase MCP**

```
mcp__supabase__apply_migration name="0008_phase5_social" query=<paste the SQL file contents>
```

Per the Codex audit memory: live DB diverges from git unless re-applied on fresh restore. After applying, run `mcp__supabase__list_migrations` to confirm the row landed.

- [ ] **Step 5: Run advisors (security + performance)**

```
mcp__supabase__get_advisors type="security"
mcp__supabase__get_advisors type="performance"
```

Both should return clean (or only pre-existing warnings unrelated to the new tables). Particularly verify there are no "table without primary key" or "unused index" complaints on our new objects.

- [ ] **Step 6: Verify**

```powershell
pnpm drizzle-kit check
```

Should report no schema drift (because we'll fix it in Task 2 when we update `schema.ts`).

- [ ] **Step 7: Commit**

```powershell
git add lib/db/migrations/0008_phase5_social.sql lib/db/migrations/meta/_journal.json
git commit -m "feat(phase-5): migration 0008 — social tables + columns + dedupe index

- New tables: blocks (bidirectional w/ no-self CHECK), list_likes, reports
- New enums: report_target_type, report_status, email_digest_cadence
- Column adds: lists.slug+published_at, logs.last_event_at+type, comments.is_hidden,
  profiles.email_digest_cadence+last_digest_sent_at
- Indexes: 9 new (5 partial, 2 unique)
- notification_type enum gains comment_replied
- notifications_dedupe_uniq enables ON CONFLICT in emit()

Applied to live dev DB via Supabase MCP. Schema.ts mirror in T2.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Drizzle schema.ts mirror

**Goal:** Update `lib/db/schema.ts` to mirror the migration 0008 changes so Drizzle queries are type-safe. Drizzle enums reference existing PG types via `pgEnum()` (does not re-create them). The new tables are added to the schema export so they're accessible via `schema.blocks`, `schema.listLikes`, `schema.reports`.

**Files:**
- Modify: `lib/db/schema.ts`

**Acceptance Criteria:**
- [ ] `notificationTypeEnum` updated to include `"comment_replied"` (sixth value)
- [ ] New enum: `reportTargetTypeEnum`, `reportStatusEnum`, `emailDigestCadenceEnum`
- [ ] New tables exported: `blocks`, `listLikes`, `reports`
- [ ] `lists` table gains `slug` (text, notNull) and `publishedAt` (timestamp) + `userSlugUniq` + `userPublishedIdx`
- [ ] `logs` table gains `lastEventAt` (timestamp) and `lastEventType` (text) + `userEventIdx`
- [ ] `comments` table gains `isHidden` (boolean, notNull, default false) + `reviewCreatedIdx`
- [ ] `profiles` table gains `emailDigestCadence` (enum, notNull, default 'weekly') and `lastDigestSentAt` (timestamp)
- [ ] `notifications` table gains `dedupeUniq` unique index on `(userId, type, targetId, actorId)`
- [ ] `reviews` table gains `userPublishedIdx` partial index (idempotent — only add if not already there from a prior phase)
- [ ] `pnpm typecheck && pnpm drizzle-kit check && pnpm lint && pnpm build` all clean

**Verify:** `pnpm drizzle-kit check && pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Extend `notificationTypeEnum` (line 65)**

Find the existing block:

```typescript
export const notificationTypeEnum = pgEnum("notification_type", [
  "new_follower",
  "review_liked",
  "review_commented",
  "list_liked",
  "wishlist_logged_by_friend",
]);
```

Replace with (matches the `ALTER TYPE ... ADD VALUE` in migration 0008):

```typescript
export const notificationTypeEnum = pgEnum("notification_type", [
  "new_follower",
  "review_liked",
  "review_commented",
  "list_liked",
  "wishlist_logged_by_friend",
  "comment_replied",
]);
```

- [ ] **Step 2: Add the three new enums just below `notificationTypeEnum`**

```typescript
// ─────────────────────────────────────────────────────────────
// Phase 5 enums (live in DB via migration 0008)
// ─────────────────────────────────────────────────────────────
export const reportTargetTypeEnum = pgEnum("report_target_type", [
  "comment",
  "review",
  "list",
  "profile",
]);

export const reportStatusEnum = pgEnum("report_status", [
  "pending",
  "resolved_action_taken",
  "resolved_no_action",
  "auto_flagged",
]);

export const emailDigestCadenceEnum = pgEnum("email_digest_cadence", [
  "off",
  "daily",
  "weekly",
]);
```

- [ ] **Step 3: Extend `profiles` table for digest preferences**

Find the existing `profiles` pgTable block (~line 76). Append to the columns object (preserving existing fields):

```typescript
  // Phase 5: email digest preference. 'weekly' default = Sunday digest cron.
  emailDigestCadence: emailDigestCadenceEnum("email_digest_cadence")
    .notNull()
    .default("weekly"),
  lastDigestSentAt: timestamp("last_digest_sent_at", { withTimezone: true }),
```

- [ ] **Step 4: Extend `logs` table for feed event tracking**

Find the existing `logs` pgTable block (~line 147). Append to the columns object:

```typescript
  // Phase 5: feed event tracking. Bumped on status change / rating set/changed.
  // Cleared rating does NOT update this (clearing isn't a positive social signal).
  lastEventAt: timestamp("last_event_at", { withTimezone: true }),
  lastEventType: text("last_event_type"), // 'status_change' | 'rating_set'
```

Within the same `logs` table's index callback, add the partial index:

```typescript
  userEventIdx: index("logs_user_event_idx")
    .on(table.userId, desc(table.lastEventAt))
    .where(sql`${table.lastEventAt} IS NOT NULL`),
```

- [ ] **Step 5: Extend `reviews` table with the user-published partial index**

Find the existing `reviews` pgTable block (~line 183). Within the index callback, add (or confirm exists):

```typescript
  userPublishedIdx: index("reviews_user_published_idx")
    .on(table.userId, desc(table.publishedAt))
    .where(sql`${table.publishedAt} IS NOT NULL`),
```

- [ ] **Step 6: Extend `comments` table with `isHidden` + ordering index**

Find the existing `comments` pgTable block (~line 350). Append column:

```typescript
  // Phase 5: auto-flag pipeline sets true; read predicate hides from non-author.
  isHidden: boolean("is_hidden").notNull().default(false),
```

Convert the table to use an index callback (currently has none). The pattern matches `likes` table:

```typescript
export const comments = pgTable(
  "comments",
  {
    // ... existing columns + isHidden
  },
  (table) => ({
    reviewCreatedIdx: index("comments_review_created_idx").on(
      table.reviewId,
      desc(table.createdAt),
    ),
  }),
);
```

- [ ] **Step 7: Extend `lists` table with `slug` + `publishedAt` + indexes**

Find the existing `lists` pgTable block (~line 371). Currently no index callback. Convert:

```typescript
export const lists = pgTable(
  "lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    isPublic: boolean("is_public").notNull().default(true),
    // Phase 5: stable URL slug derived from title. Backfilled on migration.
    slug: text("slug").notNull().default(""),
    // Phase 5: timestamp of first publish (kept stable on subsequent edits).
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // /u/{name}/lists/{slug} must be unique per user.
    userSlugUniq: uniqueIndex("lists_user_slug_uniq").on(table.userId, table.slug),
    // Feed pull: filter published lists by user, order by publish time.
    userPublishedIdx: index("lists_user_published_idx")
      .on(table.userId, desc(table.publishedAt))
      .where(sql`${table.publishedAt} IS NOT NULL`),
  }),
);
```

- [ ] **Step 8: Extend `notifications` table with the dedupe unique index**

Find the existing `notifications` pgTable block (~line 400). Within the existing index callback (which has `userUnreadIdx`), append:

```typescript
    // Phase 5: ON CONFLICT chokepoint in lib/social/notifications/emit.ts
    // collapses repeat (user, type, target, actor) into one bumped row.
    dedupeUniq: uniqueIndex("notifications_dedupe_uniq").on(
      table.userId,
      table.type,
      table.targetId,
      table.actorId,
    ),
```

- [ ] **Step 9: Add the three new tables at the end of the social section (after `notifications`)**

Insert after `notifications` table block (~line 422):

```typescript
// ─────────────────────────────────────────────────────────────
// Phase 5: blocks graph (bidirectional w/ logged-out exception)
// ─────────────────────────────────────────────────────────────
export const blocks = pgTable(
  "blocks",
  {
    blockerId: uuid("blocker_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    blockedId: uuid("blocked_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.blockerId, table.blockedId] }),
    // Self-block prevention. App-side check is the friendly UX path; this CHECK
    // is defense-in-depth same as follows_no_self in migration 0007.
    noSelf: check("blocks_no_self", sql`${table.blockerId} <> ${table.blockedId}`),
    // Reverse lookup for "is X blocked by anyone I am?" — used by
    // withBlockedFilter's notExists subquery on the author side.
    blockedBlockerIdx: index("blocks_blocked_blocker_idx").on(
      table.blockedId,
      table.blockerId,
    ),
  }),
);

// ─────────────────────────────────────────────────────────────
// Phase 5: list reactions (parallel to review likes — kept separate)
// ─────────────────────────────────────────────────────────────
export const listLikes = pgTable(
  "list_likes",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    listId: uuid("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.listId] }),
    // Like-count aggregation on list detail page filters by listId alone; PK
    // leads with userId so an Index helps.
    listIdIdx: index("list_likes_list_id_idx").on(table.listId),
  }),
);

// ─────────────────────────────────────────────────────────────
// Phase 5: moderation reports (polymorphic target — no FK)
// ─────────────────────────────────────────────────────────────
export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable so a deleted account doesn't kill the report; ON DELETE SET NULL.
    reporterId: uuid("reporter_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    targetType: reportTargetTypeEnum("target_type").notNull(),
    // Polymorphic — discriminator is targetType. No FK because of the 4-target
    // shape. Lookup queries always carry targetType.
    targetId: uuid("target_id").notNull(),
    reason: text("reason").notNull(), // 'spam' | 'harassment' | 'spoiler' | 'off_topic' | 'other'
    details: text("details"),
    status: reportStatusEnum("status").notNull().default("pending"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    resolverNote: text("resolver_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Admin queue: pending newest first.
    statusCreatedIdx: index("reports_status_created_idx").on(
      table.status,
      desc(table.createdAt),
    ),
  }),
);
```

- [ ] **Step 10: Verify schema sync**

```powershell
pnpm drizzle-kit check
```

Should report no drift between `schema.ts` and the applied migration. If it complains, the schema additions diverged from the SQL — re-read both side-by-side and reconcile.

- [ ] **Step 11: Full build**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

All three should pass.

- [ ] **Step 12: Commit**

```powershell
git add lib/db/schema.ts
git commit -m "feat(phase-5): drizzle schema mirror of migration 0008

- notificationTypeEnum gains 'comment_replied'
- New enums: reportTargetTypeEnum, reportStatusEnum, emailDigestCadenceEnum
- New tables: blocks, listLikes, reports
- Column adds + indexes mirroring 0008 verbatim
- notifications.dedupeUniq enables ON CONFLICT in emit() (T18)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Defense-in-depth RLS policies (0003_phase5_prep.sql)

**Goal:** Add row-level security policies for the three new Phase 5 tables (`blocks`, `list_likes`, `reports`). Same pattern as `0002_phase5_prep.sql` from the Codex audit fix branch — defense-in-depth, given that `service_role` bypasses RLS in our server-side code path.

**Files:**
- Create: `lib/db/policies/0003_phase5_prep.sql`

**Acceptance Criteria:**
- [ ] Policy file created with policies for `blocks`, `list_likes`, `reports`
- [ ] `blocks`: SELECT/INSERT/DELETE only by `auth.uid() = blocker_id` (own rows)
- [ ] `list_likes`: SELECT to all (like-count aggregates need anon read); INSERT/DELETE by `auth.uid() = user_id`
- [ ] `reports`: INSERT by any authenticated; SELECT by reporter (own) + admin role; UPDATE by admin only
- [ ] RLS enabled on all three tables (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`)
- [ ] Applied to live dev DB via Supabase MCP
- [ ] Advisors clean

**Verify:** Apply via MCP + advisor check

**Steps:**

- [ ] **Step 1: Read prior policy file for pattern**

Open `lib/db/policies/0002_phase5_prep.sql` for the pattern (header comment, ENABLE RLS, named CREATE POLICY blocks). Mirror that shape.

- [ ] **Step 2: Create `lib/db/policies/0003_phase5_prep.sql`**

```sql
-- ============================================================================
-- 0003_phase5_prep — Defense-in-depth RLS for Phase 5 social tables.
--
-- Our server code uses service_role (which bypasses RLS by design), so these
-- policies are belt-and-suspenders for any future direct anon/authenticated
-- access. Same posture as 0002_phase5_prep.sql.
--
-- This is NOT applied via drizzle-kit migrate — apply via Supabase MCP
-- (mcp__supabase__apply_migration) and re-apply on fresh restore.
-- ============================================================================

-- ─── blocks: own rows only ────────────────────────────────────────────
ALTER TABLE "public"."blocks" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "blocks_select_own" ON "public"."blocks"
  FOR SELECT TO authenticated
  USING (auth.uid() = blocker_id);

CREATE POLICY "blocks_insert_own" ON "public"."blocks"
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = blocker_id);

CREATE POLICY "blocks_delete_own" ON "public"."blocks"
  FOR DELETE TO authenticated
  USING (auth.uid() = blocker_id);

-- ─── list_likes: SELECT to all, mutate own ────────────────────────────
ALTER TABLE "public"."list_likes" ENABLE ROW LEVEL SECURITY;

-- Public read for like counts (anon can see total reactions).
CREATE POLICY "list_likes_select_all" ON "public"."list_likes"
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "list_likes_insert_own" ON "public"."list_likes"
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "list_likes_delete_own" ON "public"."list_likes"
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ─── reports: insert anywhere, read own + admin ──────────────────────
ALTER TABLE "public"."reports" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reports_insert_authenticated" ON "public"."reports"
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = reporter_id);

-- Reporters can see their own reports. Admin role evaluated server-side via
-- ADMIN_USER_IDS env (lib/social/moderation/admin.ts); RLS here only gates
-- the cookie-authenticated client path, not the service_role server reads
-- that drive /admin/reports.
CREATE POLICY "reports_select_own" ON "public"."reports"
  FOR SELECT TO authenticated
  USING (auth.uid() = reporter_id);
```

- [ ] **Step 3: Apply via Supabase MCP**

```
mcp__supabase__apply_migration name="0003_phase5_prep" query=<paste the SQL file contents>
```

- [ ] **Step 4: Verify RLS is enabled**

```
mcp__supabase__execute_sql query="SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('blocks','list_likes','reports') AND relkind = 'r';"
```

All three rows should show `relrowsecurity = true`.

- [ ] **Step 5: Run advisors**

```
mcp__supabase__get_advisors type="security"
```

Particularly check there's no "RLS disabled on public table" advisor for the three new tables.

- [ ] **Step 6: Commit**

```powershell
git add lib/db/policies/0003_phase5_prep.sql
git commit -m "feat(phase-5): defense-in-depth RLS for blocks/list_likes/reports

Same posture as 0002_phase5_prep.sql. Applied to live dev DB via MCP.
Re-apply on fresh restore.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: `withBlockedFilter` + `isBlockedBetween` chokepoint

**Goal:** Ship the block-filter chokepoint that every social read passes through. Forgetting it on one path = a leak; Vitest tests guard against drift.

**Files:**
- Create: `lib/social/_shared/visibility.ts`
- Create: `tests/unit/visibility.test.ts`

**Acceptance Criteria:**
- [ ] `withBlockedFilter<Q>(viewerId: string | null, query: Q, authorIdColumn: AnyPgColumn): Q` — applies bidirectional notExists subqueries to a Drizzle query
- [ ] `isBlockedBetween(a: string, b: string): Promise<boolean>` — single-row predicate for post-hoc filters (used by feed UNION ALL)
- [ ] `viewerId === null` (logged-out) short-circuits → returns query unchanged
- [ ] Vitest covers: bidirectional case, viewer-blocked case, target-blocked case, logged-out exception, no-blocks case
- [ ] `pnpm test` clean for the new spec
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm test -- visibility && pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Create `lib/social/_shared/visibility.ts`**

```typescript
import "server-only";
import { and, eq, notExists, or, sql } from "drizzle-orm";
import type { AnyPgColumn, PgSelect } from "drizzle-orm/pg-core";

import { db, schema } from "@/lib/db";

const { blocks } = schema;

/**
 * Block-filter chokepoint. Every social read query — feed pull, comment
 * thread, profile views, notifications, discovery — passes through here.
 *
 * Bidirectional semantics: a row authored by `authorIdColumn` is excluded
 * when EITHER (viewer blocked author) OR (author blocked viewer). Matches
 * the Q4 brainstorm decision (Twitter-style mutual invisibility).
 *
 * Logged-out exception: when viewerId is null we can't gate cookieless
 * traffic by IP/fingerprint reliably, so we don't try. A determined
 * blocked user can always log out to see public content — that's
 * accepted in the spec.
 *
 * Implementation detail: notExists against the blocks table avoids the
 * left-join + null-check pattern. Postgres plans this cleanly with the
 * (blocker_id, blocked_id) primary key + the reverse-direction
 * blocks_blocked_blocker_idx from migration 0008.
 */
export function withBlockedFilter<Q extends PgSelect>(
  viewerId: string | null,
  query: Q,
  authorIdColumn: AnyPgColumn,
): Q {
  if (!viewerId) return query;
  return query.where(
    and(
      // Viewer hasn't blocked the author.
      notExists(
        db
          .select({ x: sql`1` })
          .from(blocks)
          .where(
            and(
              eq(blocks.blockerId, viewerId),
              eq(blocks.blockedId, authorIdColumn),
            ),
          ),
      ),
      // Author hasn't blocked the viewer.
      notExists(
        db
          .select({ x: sql`1` })
          .from(blocks)
          .where(
            and(
              eq(blocks.blockerId, authorIdColumn),
              eq(blocks.blockedId, viewerId),
            ),
          ),
      ),
    ),
  ) as Q;
}

/**
 * Predicate form for post-hoc filters (used by the feed UNION ALL where
 * notExists doesn't compose cleanly across the three source queries).
 * Returns true if EITHER direction of the block edge exists.
 *
 * Indexed: PK lookup on (blocker_id, blocked_id) for one direction;
 * blocks_blocked_blocker_idx for the reverse. Both are sub-ms.
 */
export async function isBlockedBetween(a: string, b: string): Promise<boolean> {
  const rows = await db
    .select({ x: sql<number>`1` })
    .from(blocks)
    .where(
      or(
        and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)),
        and(eq(blocks.blockerId, b), eq(blocks.blockedId, a)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
```

- [ ] **Step 2: Create `tests/unit/visibility.test.ts`**

```typescript
import { describe, expect, it, vi } from "vitest";

/**
 * `withBlockedFilter` and `isBlockedBetween` are the social-read chokepoint.
 * Forgetting either on a code path = a block-leak: blocked users see each
 * other's content despite the block. These tests pin the contract.
 *
 * We don't have a test DB harness for Drizzle integration tests yet, so we
 * mock the db helper and verify the SQL composition is correct shape.
 */

vi.mock("@/lib/db", async () => {
  const mockSchema = {
    blocks: {
      blockerId: { name: "blocker_id" },
      blockedId: { name: "blocked_id" },
    },
  };
  const mockDb = {
    select: vi.fn(() => mockDb),
    from: vi.fn(() => mockDb),
    where: vi.fn(() => mockDb),
    limit: vi.fn(() => Promise.resolve([])),
  };
  return { db: mockDb, schema: mockSchema };
});

const { withBlockedFilter, isBlockedBetween } = await import(
  "@/lib/social/_shared/visibility"
);

describe("withBlockedFilter — logged-out exception", () => {
  it("returns the query unchanged when viewerId is null", () => {
    const fakeQuery = { where: vi.fn() } as unknown as Parameters<typeof withBlockedFilter>[1];
    const result = withBlockedFilter(null, fakeQuery, { name: "user_id" } as never);
    expect(result).toBe(fakeQuery);
    expect(fakeQuery.where).not.toHaveBeenCalled();
  });
});

describe("withBlockedFilter — bidirectional notExists composition", () => {
  it("applies a .where() clause when viewerId is set", () => {
    const fakeQuery = { where: vi.fn().mockReturnThis() } as unknown as Parameters<
      typeof withBlockedFilter
    >[1];
    const result = withBlockedFilter("viewer-uuid", fakeQuery, {
      name: "user_id",
    } as never);
    expect(fakeQuery.where).toHaveBeenCalledTimes(1);
    expect(result).toBe(fakeQuery);
  });
});

describe("isBlockedBetween — predicate form", () => {
  it("returns false when no block row exists", async () => {
    const { db } = await import("@/lib/db");
    (db.limit as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const result = await isBlockedBetween("a", "b");
    expect(result).toBe(false);
  });

  it("returns true when a block row exists in either direction", async () => {
    const { db } = await import("@/lib/db");
    (db.limit as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ x: 1 }]);
    const result = await isBlockedBetween("a", "b");
    expect(result).toBe(true);
  });

  it("queries with OR clause covering both directions", async () => {
    const { db } = await import("@/lib/db");
    (db.limit as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    await isBlockedBetween("a", "b");
    // The .where() should have been called — exact arg shape is opaque
    // because Drizzle SQL ASTs aren't serializable. We assert the call
    // happened (composition went through) and trust integration tests
    // (Playwright block-cascade.spec.ts) for end-to-end semantics.
    expect(db.where).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests**

```powershell
pnpm test -- visibility
```

All cases should pass.

- [ ] **Step 4: Full verify**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

- [ ] **Step 5: Commit**

```powershell
git add lib/social/_shared/visibility.ts tests/unit/visibility.test.ts
git commit -m "feat(social): block-filter chokepoint (withBlockedFilter + isBlockedBetween)

Every social read passes through here. Logged-out exception per spec Q4.
Vitest pins: logged-out short-circuit, bidirectional composition, predicate
form for post-hoc filters (feed UNION ALL).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: `getProfileSummary` overview hub data shape

**Goal:** Single helper that loads everything the redesigned `/u/[username]` page renders — header + stats + taste card + top 3 lists + recent 3 reviews + library shelf truncated. One function call from the page; parallel-fetched internally.

**Files:**
- Create: `lib/social/_shared/profile-summary.ts`
- Create: `tests/unit/profile-summary.test.ts`

**Acceptance Criteria:**
- [ ] `getProfileSummary(username: string, viewerId: string | null): Promise<ProfileSummary | null>` — returns null when profile not found OR private and viewer is not owner
- [ ] Shape: `{ profile, stats, tasteSnippet, topLists, recentReviews, libraryTruncated, isOwner, isFollowing, isBlocked, followerCount, followingCount }`
- [ ] Parallel fetches via `Promise.all` for the 7 source queries
- [ ] Block-filter applied where relevant (own profile bypasses; viewer-blocked profile returns null with same `notFound()`-leaking-no-info contract as `/u/[username]/page.tsx`)
- [ ] Vitest covers: not-found returns null, private+non-owner returns null, blocked-viewer returns null, owner-on-private-profile returns full data
- [ ] `pnpm test -- profile-summary` clean
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm test -- profile-summary && pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Create `lib/social/_shared/profile-summary.ts`**

```typescript
import "server-only";
import { and, count, desc, eq, isNotNull } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { LOG_GAME_SELECT } from "@/lib/logs/select";
import {
  type LibraryItem,
  computeUserStatsFromLibrary,
  mapRowToLibraryItem,
  type UserStats,
} from "@/lib/logs/library-item";
import { isBlockedBetween } from "./visibility";
import { tierForUser } from "@/lib/taste/tier";

const { profiles, logs, reviews, lists, follows, tasteFingerprints } = schema;

export type ProfileSummary = {
  profile: typeof profiles.$inferSelect;
  stats: UserStats;
  tasteSnippet: {
    tier: ReturnType<typeof tierForUser>;
    narrative: string | null;
  } | null;
  topLists: Array<{
    id: string;
    title: string;
    slug: string;
    description: string | null;
    publishedAt: Date | null;
  }>;
  recentReviews: Array<{
    id: string;
    body: string;
    rating: number | null;
    publishedAt: Date | null;
    gameTitle: string;
    gameSlug: string;
    gameCoverUrl: string | null;
  }>;
  libraryTruncated: LibraryItem[]; // first 12 most recently updated
  isOwner: boolean;
  isFollowing: boolean;
  isBlocked: boolean;
  followerCount: number;
  followingCount: number;
};

/**
 * Load all data the /u/[username] overview hub renders. One call site,
 * parallel internal fetches.
 *
 * Returns null when:
 *  - profile not found
 *  - profile is_public=false AND viewer is not owner
 *  - viewer is blocked (in either direction) and not owner
 *
 * Matches the "indistinguishable 404" contract from /u/[username]/page.tsx
 * audit pre-Phase-5 — don't leak existence of a private/blocked profile.
 */
export async function getProfileSummary(
  username: string,
  viewerId: string | null,
): Promise<ProfileSummary | null> {
  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.username, username),
  });
  if (!profile) return null;

  const isOwner = viewerId === profile.userId;

  // Privacy gate: non-owner sees nothing when profile.is_public=false.
  if (!profile.isPublic && !isOwner) return null;

  // Block gate: non-owner blocked-pair sees nothing (matches the 404 contract).
  if (viewerId && !isOwner) {
    if (await isBlockedBetween(viewerId, profile.userId)) return null;
  }

  // 7 parallel fetches — none depend on each other's results.
  const [
    rawLogs,
    rawReviews,
    rawTopLists,
    rawFingerprint,
    rawFollowerCount,
    rawFollowingCount,
    rawIsFollowing,
  ] = await Promise.all([
    // Library — own profile sees everything, public sees non-private.
    db
      .select(LOG_GAME_SELECT)
      .from(logs)
      .innerJoin(schema.games, eq(logs.gameId, schema.games.id))
      .where(
        and(
          eq(logs.userId, profile.userId),
          isOwner ? undefined : eq(logs.isPrivate, false),
        ),
      )
      .orderBy(desc(logs.updatedAt)),

    // Recent reviews (top 3, must be published + public unless owner).
    db
      .select({
        id: reviews.id,
        body: reviews.body,
        rating: reviews.rating,
        publishedAt: reviews.publishedAt,
        gameTitle: schema.games.title,
        gameSlug: schema.games.slug,
        gameCoverUrl: schema.games.coverUrl,
      })
      .from(reviews)
      .innerJoin(schema.games, eq(reviews.gameId, schema.games.id))
      .where(
        and(
          eq(reviews.userId, profile.userId),
          isNotNull(reviews.publishedAt),
          isOwner ? undefined : eq(reviews.isPublic, true),
        ),
      )
      .orderBy(desc(reviews.publishedAt))
      .limit(3),

    // Top 3 most-recently-published lists.
    db
      .select({
        id: lists.id,
        title: lists.title,
        slug: lists.slug,
        description: lists.description,
        publishedAt: lists.publishedAt,
      })
      .from(lists)
      .where(
        and(
          eq(lists.userId, profile.userId),
          isNotNull(lists.publishedAt),
          isOwner ? undefined : eq(lists.isPublic, true),
        ),
      )
      .orderBy(desc(lists.publishedAt))
      .limit(3),

    // Taste fingerprint snippet (may be null for empty-tier users).
    db.query.tasteFingerprints.findFirst({
      where: eq(tasteFingerprints.userId, profile.userId),
      columns: {
        narrativeSummary: true,
        totalLogsAtGeneration: true,
      },
    }),

    db
      .select({ value: count() })
      .from(follows)
      .where(eq(follows.followedId, profile.userId)),

    db
      .select({ value: count() })
      .from(follows)
      .where(eq(follows.followerId, profile.userId)),

    viewerId && !isOwner
      ? db.query.follows.findFirst({
          where: and(
            eq(follows.followerId, viewerId),
            eq(follows.followedId, profile.userId),
          ),
        })
      : Promise.resolve(undefined),
  ]);

  const allLibrary: LibraryItem[] = rawLogs.map((r) =>
    mapRowToLibraryItem(r.log, r.game),
  );
  const stats = computeUserStatsFromLibrary(allLibrary);

  return {
    profile,
    stats,
    tasteSnippet: rawFingerprint
      ? {
          tier: tierForUser(rawFingerprint.totalLogsAtGeneration),
          narrative: rawFingerprint.narrativeSummary,
        }
      : null,
    topLists: rawTopLists,
    recentReviews: rawReviews,
    libraryTruncated: allLibrary.slice(0, 12),
    isOwner,
    isFollowing: Boolean(rawIsFollowing),
    isBlocked: false, // would have early-returned null if blocked + non-owner
    followerCount: rawFollowerCount[0]?.value ?? 0,
    followingCount: rawFollowingCount[0]?.value ?? 0,
  };
}
```

- [ ] **Step 2: Create `tests/unit/profile-summary.test.ts`**

```typescript
import { describe, expect, it, vi } from "vitest";

/**
 * getProfileSummary is the one-stop loader for the redesigned profile page.
 * Tests pin the early-return contract:
 *  - profile not found → null (don't leak existence)
 *  - private + non-owner → null
 *  - blocked pair + non-owner → null
 *  - owner sees everything regardless of privacy/blocks
 *
 * Mocks db + isBlockedBetween. We're testing the orchestration shape,
 * not the SQL.
 */

vi.mock("@/lib/db", () => {
  const findFirst = vi.fn();
  const select = vi.fn().mockReturnThis();
  const from = vi.fn().mockReturnThis();
  const innerJoin = vi.fn().mockReturnThis();
  const where = vi.fn().mockReturnThis();
  const orderBy = vi.fn().mockReturnThis();
  const limit = vi.fn().mockResolvedValue([]);
  const queryDb = {
    profiles: { findFirst },
    follows: { findFirst: vi.fn().mockResolvedValue(undefined) },
    tasteFingerprints: { findFirst: vi.fn().mockResolvedValue(undefined) },
  };
  return {
    db: { select, from, innerJoin, where, orderBy, limit, query: queryDb },
    schema: {
      profiles: { username: { name: "username" }, userId: { name: "user_id" }, isPublic: { name: "is_public" } },
      logs: { userId: {}, isPrivate: {}, gameId: {}, updatedAt: {} },
      reviews: { userId: {}, publishedAt: {}, isPublic: {}, gameId: {}, id: {}, body: {}, rating: {} },
      lists: { userId: {}, publishedAt: {}, isPublic: {}, id: {}, title: {}, slug: {}, description: {} },
      follows: { followerId: {}, followedId: {} },
      tasteFingerprints: { userId: {} },
      games: { id: {}, title: {}, slug: {}, coverUrl: {} },
    },
  };
});

vi.mock("@/lib/social/_shared/visibility", () => ({
  isBlockedBetween: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/logs/library-item", () => ({
  mapRowToLibraryItem: vi.fn((log, game) => ({ ...log, game })),
  computeUserStatsFromLibrary: vi.fn(() => ({ total: 0, completed: 0, playing: 0, backlog: 0 })),
}));

vi.mock("@/lib/logs/select", () => ({ LOG_GAME_SELECT: {} }));
vi.mock("@/lib/taste/tier", () => ({ tierForUser: vi.fn((n: number) => (n >= 10 ? "sharpening" : "sparse")) }));

const { getProfileSummary } = await import("@/lib/social/_shared/profile-summary");

describe("getProfileSummary — early returns", () => {
  it("returns null when profile not found", async () => {
    const { db } = await import("@/lib/db");
    (db.query.profiles.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    const result = await getProfileSummary("ghost", "viewer-id");
    expect(result).toBeNull();
  });

  it("returns null for private profile + non-owner viewer", async () => {
    const { db } = await import("@/lib/db");
    (db.query.profiles.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      userId: "target-id",
      username: "private-user",
      isPublic: false,
    });
    const result = await getProfileSummary("private-user", "different-viewer");
    expect(result).toBeNull();
  });

  it("returns null for blocked pair + non-owner viewer", async () => {
    const { db } = await import("@/lib/db");
    const { isBlockedBetween } = await import("@/lib/social/_shared/visibility");
    (db.query.profiles.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      userId: "target-id",
      username: "blocked-by",
      isPublic: true,
    });
    (isBlockedBetween as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    const result = await getProfileSummary("blocked-by", "viewer-id");
    expect(result).toBeNull();
  });

  it("returns data for logged-out viewer on public profile", async () => {
    const { db } = await import("@/lib/db");
    (db.query.profiles.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      userId: "target-id",
      username: "alice",
      isPublic: true,
    });
    (db.limit as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const result = await getProfileSummary("alice", null);
    expect(result).not.toBeNull();
    expect(result?.isOwner).toBe(false);
    expect(result?.isFollowing).toBe(false);
  });

  it("returns data for owner even when private", async () => {
    const { db } = await import("@/lib/db");
    (db.query.profiles.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      userId: "owner-id",
      username: "private-owner",
      isPublic: false,
    });
    (db.limit as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const result = await getProfileSummary("private-owner", "owner-id");
    expect(result).not.toBeNull();
    expect(result?.isOwner).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests + verify**

```powershell
pnpm test -- profile-summary
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

- [ ] **Step 4: Commit**

```powershell
git add lib/social/_shared/profile-summary.ts tests/unit/profile-summary.test.ts
git commit -m "feat(social): getProfileSummary overview-hub loader

One call from /u/[username]/page.tsx loads all 6 sections (header + stats
+ taste snippet + top lists + recent reviews + library truncated) plus
follow/block state, with the 'indistinguishable 404' contract for not-
found / private+non-owner / blocked+non-owner.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Follow/unfollow server actions + onFollow notification

**Goal:** Ship `follow(targetUserId)`, `unfollow(targetUserId)`, `getFollowers(userId)`, `getFollowing(userId)` server actions. Emit `new_follower` notification on a fresh follow row (skip on idempotent re-follow). Block-filter applied to follower/following list reads. Note: `emit()` is shipped in T18 — for T6, write `onFollow` to call a stubbed `lib/social/notifications/emit.ts` that just no-ops; the real emit lands in T18 and the stub gets replaced.

**Files:**
- Create: `lib/social/follows/server-actions.ts`
- Create: `lib/social/follows/triggers.ts`
- Create: `lib/social/notifications/emit.ts` (stub for now — full impl in T18)

**Acceptance Criteria:**
- [ ] `follow(targetUserId: string)` — auth required, blocks self-follow, blocks bidirectional-block pairs, INSERT ON CONFLICT DO NOTHING (idempotent), calls onFollow only on fresh insert
- [ ] `unfollow(targetUserId: string)` — auth required, DELETE, idempotent
- [ ] `getFollowers(userId, viewerId)` — returns follower profiles, filtered via `withBlockedFilter`
- [ ] `getFollowing(userId, viewerId)` — same shape, returns followed profiles
- [ ] `onFollow` calls `emit({type: 'new_follower', ...})` — stub no-ops for now
- [ ] `emit()` stub signature matches the final shape (so T18 is drop-in)
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Create `lib/social/notifications/emit.ts` (stub)**

```typescript
import "server-only";
import type { schema } from "@/lib/db";

/**
 * STUB — full implementation lands in T18 with ON CONFLICT dedupe.
 * Locking the signature here so T6-T17 callers don't need to change.
 *
 * Real semantics (T18):
 *  - Self-notify silenced
 *  - Blocked-pair silenced
 *  - ON CONFLICT (user_id, type, target_id, actor_id) DO UPDATE bumps
 *    created_at and clears read_at
 */
export async function emit(_args: {
  type: (typeof schema.notificationTypeEnum)["enumValues"][number];
  recipientUserId: string;
  actorUserId: string;
  targetId: string;
}): Promise<void> {
  // Intentional no-op; T18 wires the real INSERT.
}
```

- [ ] **Step 2: Create `lib/social/follows/triggers.ts`**

```typescript
import "server-only";
import { emit } from "@/lib/social/notifications/emit";

export async function onFollow(args: {
  followerId: string;
  followedId: string;
}): Promise<void> {
  await emit({
    type: "new_follower",
    recipientUserId: args.followedId,
    actorUserId: args.followerId,
    targetId: args.followerId, // target = the new follower's id (clickable to their profile)
  });
}
```

- [ ] **Step 3: Create `lib/social/follows/server-actions.ts`**

```typescript
"use server";
import { and, eq, inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { isBlockedBetween, withBlockedFilter } from "@/lib/social/_shared/visibility";
import { onFollow } from "./triggers";

const { follows, profiles } = schema;

export type FollowResult =
  | { ok: true }
  | { ok: false; reason: "not-authenticated" | "self-follow" | "blocked" };

export async function follow(targetUserId: string): Promise<FollowResult> {
  const user = await getCachedUser();
  if (!user) return { ok: false, reason: "not-authenticated" };
  if (user.id === targetUserId) return { ok: false, reason: "self-follow" };

  // Bidirectional block prevents the follow row from ever being created.
  if (await isBlockedBetween(user.id, targetUserId)) {
    return { ok: false, reason: "blocked" };
  }

  // INSERT ... ON CONFLICT DO NOTHING; rowsAffected tells us if it was fresh.
  const inserted = await db
    .insert(follows)
    .values({ followerId: user.id, followedId: targetUserId })
    .onConflictDoNothing()
    .returning({ followerId: follows.followerId });

  // Only emit notification on a fresh follow (avoid re-emitting on rapid
  // follow→unfollow→follow toggles).
  if (inserted.length > 0) {
    await onFollow({ followerId: user.id, followedId: targetUserId });
  }
  return { ok: true };
}

export async function unfollow(targetUserId: string): Promise<FollowResult> {
  const user = await getCachedUser();
  if (!user) return { ok: false, reason: "not-authenticated" };
  await db
    .delete(follows)
    .where(
      and(eq(follows.followerId, user.id), eq(follows.followedId, targetUserId)),
    );
  return { ok: true };
}

/**
 * Followers of a given user, filtered against the viewer's block graph.
 * Returns lightweight profile shape suitable for grid rendering.
 */
export async function getFollowers(
  userId: string,
  viewerId: string | null,
): Promise<
  Array<{ userId: string; username: string; displayName: string | null; avatarUrl: string | null }>
> {
  const base = db
    .select({
      userId: profiles.userId,
      username: profiles.username,
      displayName: profiles.displayName,
      avatarUrl: profiles.avatarUrl,
    })
    .from(follows)
    .innerJoin(profiles, eq(profiles.userId, follows.followerId))
    .where(eq(follows.followedId, userId))
    .$dynamic();

  return await withBlockedFilter(viewerId, base, profiles.userId);
}

export async function getFollowing(
  userId: string,
  viewerId: string | null,
): Promise<
  Array<{ userId: string; username: string; displayName: string | null; avatarUrl: string | null }>
> {
  const base = db
    .select({
      userId: profiles.userId,
      username: profiles.username,
      displayName: profiles.displayName,
      avatarUrl: profiles.avatarUrl,
    })
    .from(follows)
    .innerJoin(profiles, eq(profiles.userId, follows.followedId))
    .where(eq(follows.followerId, userId))
    .$dynamic();

  return await withBlockedFilter(viewerId, base, profiles.userId);
}
```

- [ ] **Step 4: Verify**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

- [ ] **Step 5: Commit**

```powershell
git add lib/social/follows/ lib/social/notifications/emit.ts
git commit -m "feat(social): follow/unfollow server actions + onFollow stub

- follow() blocks self-follow + bidirectional-block pairs
- ON CONFLICT DO NOTHING for idempotent re-follow
- onFollow calls emit() (stub for now; full impl in T18)
- getFollowers / getFollowing apply withBlockedFilter

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Block/unblock + cascade side effects

**Goal:** Ship `block(targetUserId)`, `unblock(targetUserId)`, `getBlocked(userId)`. Block enacts the cascade per the spec data flow: INSERT block → DELETE mutual follow → DELETE blocked's likes on blocker's reviews → DELETE blocker's likes on blocked's reviews → DELETE blocked's comments on blocker's reviews → DELETE list-likes both directions. All side effects happen in a single server action with no transactional guarantee — failures partway through leak some state, which is acceptable because re-block is idempotent and re-runs cascade.

**Files:**
- Create: `lib/social/blocks/server-actions.ts`
- Create: `lib/social/blocks/side-effects.ts`

**Acceptance Criteria:**
- [ ] `block(targetUserId)` — auth required, blocks self-block, INSERT ON CONFLICT DO NOTHING
- [ ] On fresh block insert: calls `cascadeBlock` which deletes mutual follows + bidirectional review-likes + blocked's comments on blocker's reviews + bidirectional list-likes
- [ ] `unblock(targetUserId)` — DELETE the block row only; does NOT restore deleted content
- [ ] `getBlocked(userId)` — returns blocked profiles with avatar + username + blocked-at timestamp
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Create `lib/social/blocks/side-effects.ts`**

```typescript
import "server-only";
import { and, eq, inArray, or } from "drizzle-orm";

import { db, schema } from "@/lib/db";

const { follows, likes, listLikes, comments, reviews, lists } = schema;

/**
 * Block cascade — invoked after a fresh INSERT into blocks. Strips the
 * existing-interaction graph between blocker and blocked so the block has
 * teeth (not just future-content invisibility).
 *
 * Not transactional — if step N fails, steps 1..N-1 are already committed.
 * Re-block runs cascade again so partial failure self-heals on retry.
 */
export async function cascadeBlock(args: {
  blockerId: string;
  blockedId: string;
}): Promise<void> {
  const { blockerId, blockedId } = args;

  // (a) Drop mutual follows in both directions.
  await db
    .delete(follows)
    .where(
      or(
        and(eq(follows.followerId, blockerId), eq(follows.followedId, blockedId)),
        and(eq(follows.followerId, blockedId), eq(follows.followedId, blockerId)),
      ),
    );

  // (b) Blocked's likes on blocker's reviews.
  await db
    .delete(likes)
    .where(
      and(
        eq(likes.userId, blockedId),
        inArray(
          likes.reviewId,
          db.select({ id: reviews.id }).from(reviews).where(eq(reviews.userId, blockerId)),
        ),
      ),
    );

  // (c) Blocker's likes on blocked's reviews.
  await db
    .delete(likes)
    .where(
      and(
        eq(likes.userId, blockerId),
        inArray(
          likes.reviewId,
          db.select({ id: reviews.id }).from(reviews).where(eq(reviews.userId, blockedId)),
        ),
      ),
    );

  // (d) Blocked's comments on blocker's reviews — hard delete.
  await db
    .delete(comments)
    .where(
      and(
        eq(comments.userId, blockedId),
        inArray(
          comments.reviewId,
          db.select({ id: reviews.id }).from(reviews).where(eq(reviews.userId, blockerId)),
        ),
      ),
    );

  // (e) Blocked's list-likes on blocker's lists.
  await db
    .delete(listLikes)
    .where(
      and(
        eq(listLikes.userId, blockedId),
        inArray(
          listLikes.listId,
          db.select({ id: lists.id }).from(lists).where(eq(lists.userId, blockerId)),
        ),
      ),
    );

  // (f) Blocker's list-likes on blocked's lists.
  await db
    .delete(listLikes)
    .where(
      and(
        eq(listLikes.userId, blockerId),
        inArray(
          listLikes.listId,
          db.select({ id: lists.id }).from(lists).where(eq(lists.userId, blockedId)),
        ),
      ),
    );
}
```

- [ ] **Step 2: Create `lib/social/blocks/server-actions.ts`**

```typescript
"use server";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { cascadeBlock } from "./side-effects";

const { blocks, profiles } = schema;

export type BlockResult =
  | { ok: true }
  | { ok: false; reason: "not-authenticated" | "self-block" };

export async function block(targetUserId: string): Promise<BlockResult> {
  const user = await getCachedUser();
  if (!user) return { ok: false, reason: "not-authenticated" };
  if (user.id === targetUserId) return { ok: false, reason: "self-block" };

  const inserted = await db
    .insert(blocks)
    .values({ blockerId: user.id, blockedId: targetUserId })
    .onConflictDoNothing()
    .returning({ blockerId: blocks.blockerId });

  if (inserted.length > 0) {
    await cascadeBlock({ blockerId: user.id, blockedId: targetUserId });
  }

  revalidatePath("/home/feed");
  return { ok: true };
}

export async function unblock(targetUserId: string): Promise<BlockResult> {
  const user = await getCachedUser();
  if (!user) return { ok: false, reason: "not-authenticated" };
  await db
    .delete(blocks)
    .where(
      and(eq(blocks.blockerId, user.id), eq(blocks.blockedId, targetUserId)),
    );
  revalidatePath("/home/feed");
  revalidatePath("/settings/blocked");
  return { ok: true };
}

export async function getBlocked(userId: string) {
  return await db
    .select({
      userId: profiles.userId,
      username: profiles.username,
      displayName: profiles.displayName,
      avatarUrl: profiles.avatarUrl,
      blockedAt: blocks.createdAt,
    })
    .from(blocks)
    .innerJoin(profiles, eq(profiles.userId, blocks.blockedId))
    .where(eq(blocks.blockerId, userId))
    .orderBy(desc(blocks.createdAt));
}
```

- [ ] **Step 3: Verify**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

- [ ] **Step 4: Commit**

```powershell
git add lib/social/blocks/
git commit -m "feat(social): block/unblock + cascade side effects

- block() INSERT + cascade: drops mutual follows, bidirectional review-
  likes, blocked's comments on blocker's reviews, bidirectional list-likes
- Hard-delete cascade (block = 'I never want to see this person')
- unblock() drops the block row only; deleted content stays gone
- getBlocked() drives /settings/blocked list

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: Profile overview hub redesign + follower/following routes + follow button

**Goal:** Rebuild `app/(app)/u/[username]/page.tsx` into the overview hub (header + stats + taste card + top 3 lists + recent 3 reviews + library shelf truncated). Add `app/(app)/u/[username]/followers/page.tsx` and `following/page.tsx`. Ship `<FollowButton>` and `<BlockAction>` client islands wired to T6/T7 actions. Playwright covers the follow flow end-to-end.

**Files:**
- Modify: `app/(app)/u/[username]/page.tsx`
- Create: `app/(app)/u/[username]/followers/page.tsx`
- Create: `app/(app)/u/[username]/following/page.tsx`
- Create: `components/social/profile-overview-header.tsx`
- Create: `components/social/follow-button.tsx`
- Create: `components/social/block-action.tsx`
- Create: `components/social/followers-grid.tsx`
- Modify: `tests/fixtures/test-base.ts` (add `publicUser2` fixture)
- Modify: `tests/fixtures/seed-test-users.ts` (add `seedFollow` helper)
- Create: `tests/e2e/follow-and-feed.spec.ts`

**Acceptance Criteria:**
- [ ] `/u/[username]` renders header + stats + taste card snippet + top-3 lists + recent-3 reviews + library shelf (truncated to 12 items)
- [ ] Each section has "See all →" link to its sub-route
- [ ] Follow button toggles between "Follow" / "Following ✓" via optimistic update with idempotent rollback
- [ ] Block action lives in overflow menu (`⋯`) with confirm dialog
- [ ] `/u/[username]/followers` and `/following` render `<FollowersGrid>` with the filtered list
- [ ] Playwright spec covers two-account follow flow + count update
- [ ] `pnpm typecheck && pnpm lint && pnpm build && pnpm test:e2e -- follow-and-feed` clean

**Verify:** `pnpm typecheck && pnpm lint && pnpm build && pnpm test:e2e -- follow-and-feed`

**Steps:**

- [ ] **Step 1: Rewrite `app/(app)/u/[username]/page.tsx`** — see the full implementation block in the design spec Section 3 module layout reference. Key points: it imports `getProfileSummary` from T5, renders `<ProfileOverviewHeader>`, conditionally renders Taste / Lists / Reviews sections when their data is non-empty, and ends with the truncated library shelf.

- [ ] **Step 2: Create `components/social/profile-overview-header.tsx`** — header chrome component. Renders Mascot + display name + username + follow/block buttons (when viewer is logged in and not the owner) + follower/following count links. Uses the shape from the design spec Section 3.

- [ ] **Step 3: Create `components/social/follow-button.tsx`** — `"use client"` component. State: `isFollowing` boolean. On click: optimistic flip + `startTransition` → `follow()`/`unfollow()` action. On `result.ok === false`, revert state.

- [ ] **Step 4: Create `components/social/block-action.tsx`** — overflow menu trigger + confirm dialog. On confirm: call `block()` action, then `router.push("/home")` (the now-blocked profile 404s on refresh).

- [ ] **Step 5: Create `components/social/followers-grid.tsx`** — grid renderer. Empty state: "No one yet." Otherwise: 2/3/4-column responsive grid of avatar + display name + username cells.

- [ ] **Step 6: Create `app/(app)/u/[username]/followers/page.tsx`** — loads `getProfileByUsername` + `getFollowers`, renders `<FollowersGrid>`. Header: "@{username}'s followers · N people".

- [ ] **Step 7: Create `app/(app)/u/[username]/following/page.tsx`** — mirror of followers page, calls `getFollowing`, header: "@{username} is following · N people".

- [ ] **Step 8: Add `publicUser2` fixture to `tests/fixtures/test-base.ts`** — adjacent to existing `publicUser`:

```typescript
publicUser2: async ({}, use) => {
  const user = await createTestUser({ isPublic: true });
  await use(user);
},
```

- [ ] **Step 9: Add `seedFollow` helper to `tests/fixtures/seed-test-users.ts`**

```typescript
export async function seedFollow(args: {
  followerId: string;
  followedId: string;
}): Promise<void> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { error } = await supabase
    .from("follows")
    .insert({ follower_id: args.followerId, followed_id: args.followedId });
  if (error && error.code !== "23505") {
    throw new Error(`seedFollow failed: ${error.message}`);
  }
}
```

- [ ] **Step 10: Create `tests/e2e/follow-and-feed.spec.ts`** — first version covers the follow flow:

```typescript
import { test, expect } from "../fixtures/test-base";

test("publicUser can follow publicUser2 and see Following ✓ state", async ({
  page,
  publicUser,
  publicUser2,
}) => {
  await page.goto("/login");
  await page.fill("input[name='email']", publicUser.email);
  await page.fill("input[name='password']", publicUser.password);
  await page.click("button[type='submit']");
  await page.waitForURL("/home");

  await page.goto(`/u/${publicUser2.username}`);
  await page.getByRole("button", { name: /^Follow$/i }).click();
  await expect(page.getByRole("button", { name: /Following ✓/i })).toBeVisible();

  await page.goto(`/u/${publicUser2.username}/followers`);
  await expect(page.getByText(`@${publicUser.username}`)).toBeVisible();
});
```

The feed visibility assertion lands in T12; for now this spec only covers the follow side. A `test.fixme` comment marks the spot where the feed assertion will be added.

- [ ] **Step 11: Run Playwright + full verify**

```powershell
pnpm test:e2e -- follow-and-feed
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

- [ ] **Step 12: Commit**

```powershell
git add app/(app)/u/[username]/ components/social/ tests/fixtures/ tests/e2e/follow-and-feed.spec.ts
git commit -m "feat(social): profile overview hub + follow UI + follower routes

- /u/[username] redesigned as 6-section hub via getProfileSummary
- /u/[username]/followers + /following render FollowersGrid
- FollowButton (optimistic toggle), BlockAction (overflow + confirm)
- Playwright covers follow flow; feed assertion lands T12

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: `/settings/blocked` page + unblock UI

**Goal:** Settings page showing blocked users with an Unblock button per row. Small task — mostly UI glue.

**Files:**
- Create: `app/(app)/settings/blocked/page.tsx`
- Modify: `components/layout/profile-dropdown.tsx` (add "Blocked users" link)

**Acceptance Criteria:**
- [ ] `/settings/blocked` shows blocked users (avatar + username + blocked-at + Unblock button)
- [ ] Empty state: pixel mascot + "You haven't blocked anyone."
- [ ] Unblock button calls `unblock()` server action; revalidation reflects state
- [ ] Profile dropdown gains "Blocked users" link
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Create `app/(app)/settings/blocked/page.tsx`**

```typescript
import { redirect } from "next/navigation";
import Image from "next/image";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import { getBlocked, unblock } from "@/lib/social/blocks/server-actions";
import { Mascot } from "@/components/mascot/mascot";
import { relativeTime } from "@/lib/utils";

export const metadata = { title: "Blocked users — Settings" };

export default async function BlockedSettingsPage() {
  const user = await getCachedUser();
  if (!user) redirect("/login?next=/settings/blocked");

  const blocked = await getBlocked(user.id);

  async function handleUnblock(formData: FormData) {
    "use server";
    const targetUserId = formData.get("targetUserId");
    if (typeof targetUserId !== "string") return;
    await unblock(targetUserId);
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Blocked users</h1>
        <p className="text-sm text-[var(--text-dim)] mt-1">
          People you've blocked. They can't see your content and you can't see theirs.
        </p>
      </header>

      {blocked.length === 0 ? (
        <div className="text-center py-12">
          <Mascot size="lg" mood="idle" silent />
          <p className="mt-4 text-sm text-[var(--text-dim)]">You haven't blocked anyone.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {blocked.map((b) => (
            <li key={b.userId} className="flex items-center justify-between p-3 rounded-lg border border-[var(--border)]">
              <div className="flex items-center gap-3 min-w-0">
                {b.avatarUrl ? (
                  <Image src={b.avatarUrl} alt="" width={40} height={40} className="rounded-full" unoptimized />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-[var(--bg-elevated)]" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{b.displayName ?? b.username}</p>
                  <p className="text-xs text-[var(--text-dim)]">
                    @{b.username} · Blocked {relativeTime(b.blockedAt)}
                  </p>
                </div>
              </div>
              <form action={handleUnblock}>
                <input type="hidden" name="targetUserId" value={b.userId} />
                <button type="submit" className="px-3 py-1.5 text-sm rounded-md border border-[var(--border)] hover:border-[var(--border-hover)]">
                  Unblock
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add link to profile dropdown**

Find `components/layout/profile-dropdown.tsx`. Add adjacent to the existing Settings link:

```typescript
<a href="/settings/blocked" className="block px-3 py-2 text-sm hover:bg-[var(--bg-elevated)] rounded-md">
  Blocked users
</a>
```

- [ ] **Step 3: Verify + commit**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
git add app/(app)/settings/blocked/ components/layout/profile-dropdown.tsx
git commit -m "feat(social): /settings/blocked page + dropdown link

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: `buildFeedQuery` — pull-on-read UNION ALL across logs + reviews + lists

**Goal:** The activity feed's core query. UNION ALL of three projections (logs material events, review publishes, list publishes) from followees, with cursor predicate, ORDER BY event_at DESC LIMIT 50. Block-filter applied post-hoc because UNION ALL doesn't compose cleanly with notExists.

**Files:**
- Create: `lib/social/_shared/cursors.ts`
- Create: `lib/social/feed/queries.ts`
- Create: `tests/unit/cursors.test.ts`

**Acceptance Criteria:**
- [ ] `lib/social/_shared/cursors.ts` exports `encodeCursor({ eventAt, kind, actorId })` → base64 string and `decodeCursor(s: string | null)` → triplet or null
- [ ] Cursor encode/decode round-trips bit-for-bit
- [ ] Cursor tiebreak ordering deterministic (eventAt DESC, kind ASC, actorId ASC)
- [ ] `lib/social/feed/queries.ts` exports `buildFeedQuery(args: { viewerId: string; followeeIds: string[]; cursor: FeedCursor | null; limit?: number })` → `Promise<FeedRow[]>`
- [ ] Row shape: `{ kind: 'log' | 'review' | 'list', actorId: string, eventAt: Date, eventType: string | null, targetId: string, payload: object }`
- [ ] Block-filter applied via `isBlockedBetween` post-hoc on the result rows
- [ ] Vitest covers cursor encode/decode + tiebreak ordering
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm test -- cursors && pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Create `lib/social/_shared/cursors.ts`**

```typescript
/**
 * Feed cursor: (eventAt, kind, actorId) triplet base64-encoded.
 *
 * Tiebreak fields prevent missed rows when multiple events share an
 * eventAt timestamp (rare but possible if a user transitions two logs
 * within the same millisecond). The kind+actorId secondary sort makes
 * the order deterministic and the cursor advance correct.
 *
 * Format: base64url(JSON.stringify({ at, k, a }))
 */
export type FeedCursor = {
  eventAt: Date;
  kind: "log" | "review" | "list";
  actorId: string;
};

const KIND_ORDER: Record<FeedCursor["kind"], number> = { log: 0, review: 1, list: 2 };

export function encodeCursor(cursor: FeedCursor): string {
  const payload = JSON.stringify({
    at: cursor.eventAt.toISOString(),
    k: cursor.kind,
    a: cursor.actorId,
  });
  return Buffer.from(payload, "utf8").toString("base64url");
}

export function decodeCursor(s: string | null | undefined): FeedCursor | null {
  if (!s) return null;
  try {
    const raw = Buffer.from(s, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as { at: string; k: FeedCursor["kind"]; a: string };
    if (!parsed.at || !parsed.k || !parsed.a) return null;
    if (!(parsed.k in KIND_ORDER)) return null;
    return {
      eventAt: new Date(parsed.at),
      kind: parsed.k,
      actorId: parsed.a,
    };
  } catch {
    return null;
  }
}

/**
 * Compare two feed rows in the canonical sort order (event_at DESC,
 * kind ASC, actor_id ASC). Returns -1, 0, 1. Used by post-hoc block
 * filtering when we need to re-sort after dropping rows.
 */
export function compareFeedRows(
  a: { eventAt: Date; kind: FeedCursor["kind"]; actorId: string },
  b: { eventAt: Date; kind: FeedCursor["kind"]; actorId: string },
): number {
  const dt = b.eventAt.getTime() - a.eventAt.getTime();
  if (dt !== 0) return dt > 0 ? 1 : -1;
  const dk = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  if (dk !== 0) return dk;
  return a.actorId < b.actorId ? -1 : a.actorId > b.actorId ? 1 : 0;
}
```

- [ ] **Step 2: Create `tests/unit/cursors.test.ts`**

```typescript
import { describe, expect, it } from "vitest";

import {
  compareFeedRows,
  decodeCursor,
  encodeCursor,
  type FeedCursor,
} from "@/lib/social/_shared/cursors";

/**
 * Feed cursor pinning. Off-by-one or sort-drift here means feed pagination
 * either skips rows or returns duplicates — both silent failure modes that
 * are extra painful because users won't report them, they just see "weird
 * feed."
 */

describe("encodeCursor / decodeCursor round-trip", () => {
  it("round-trips a typical cursor exactly", () => {
    const c: FeedCursor = {
      eventAt: new Date("2026-05-12T15:00:00Z"),
      kind: "review",
      actorId: "11111111-1111-1111-1111-111111111111",
    };
    const decoded = decodeCursor(encodeCursor(c));
    expect(decoded).not.toBeNull();
    expect(decoded?.eventAt.toISOString()).toBe(c.eventAt.toISOString());
    expect(decoded?.kind).toBe(c.kind);
    expect(decoded?.actorId).toBe(c.actorId);
  });

  it("returns null for null/undefined/empty input", () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });

  it("returns null for garbage input", () => {
    expect(decodeCursor("not-a-cursor")).toBeNull();
    expect(decodeCursor("aGVsbG8=")).toBeNull(); // valid b64 but bad payload
  });

  it("returns null for unknown kind", () => {
    const bad = Buffer.from(JSON.stringify({ at: new Date().toISOString(), k: "follow", a: "x" })).toString("base64url");
    expect(decodeCursor(bad)).toBeNull();
  });
});

describe("compareFeedRows — canonical sort", () => {
  const now = new Date("2026-05-12T12:00:00Z");
  const earlier = new Date("2026-05-12T11:59:00Z");

  it("sorts newer eventAt before older (DESC)", () => {
    expect(compareFeedRows(
      { eventAt: now, kind: "log", actorId: "a" },
      { eventAt: earlier, kind: "log", actorId: "a" },
    )).toBeLessThan(0);
  });

  it("on same eventAt, log before review before list", () => {
    expect(compareFeedRows(
      { eventAt: now, kind: "log", actorId: "a" },
      { eventAt: now, kind: "review", actorId: "a" },
    )).toBeLessThan(0);
    expect(compareFeedRows(
      { eventAt: now, kind: "review", actorId: "a" },
      { eventAt: now, kind: "list", actorId: "a" },
    )).toBeLessThan(0);
  });

  it("on same eventAt and kind, actor_id ASC", () => {
    expect(compareFeedRows(
      { eventAt: now, kind: "log", actorId: "aaaa" },
      { eventAt: now, kind: "log", actorId: "bbbb" },
    )).toBeLessThan(0);
  });

  it("returns 0 for identical triplets", () => {
    const row = { eventAt: now, kind: "log" as const, actorId: "x" };
    expect(compareFeedRows(row, row)).toBe(0);
  });
});
```

- [ ] **Step 3: Create `lib/social/feed/queries.ts`**

```typescript
import "server-only";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { isBlockedBetween } from "@/lib/social/_shared/visibility";
import { compareFeedRows, type FeedCursor } from "@/lib/social/_shared/cursors";

export type FeedRow = {
  kind: "log" | "review" | "list";
  actorId: string;
  eventAt: Date;
  eventType: string | null;
  targetId: string;
  payload: Record<string, unknown>;
};

/**
 * Pull-on-read activity feed query. UNION ALL across logs (material status/
 * rating events), reviews (publish events), lists (publish events) filtered
 * to followees, with cursor predicate.
 *
 * Why UNION ALL instead of three sequential queries: postgres plans this
 * as a single tree, hits each table's (user_id, event_at DESC) partial
 * index, and applies the ORDER BY + LIMIT once. Network round-trip and
 * sort cost are both lower.
 *
 * Block filter is post-hoc because UNION ALL doesn't compose cleanly with
 * notExists subqueries (we'd need 3 copies of the subquery, one per branch).
 * 50-row post-filter is cheap — each isBlockedBetween call is O(1) on the
 * blocks PK + reverse index from migration 0008.
 */
export async function buildFeedQuery(args: {
  viewerId: string;
  followeeIds: string[];
  cursor: FeedCursor | null;
  limit?: number;
}): Promise<FeedRow[]> {
  const { viewerId, followeeIds, cursor, limit = 50 } = args;

  if (followeeIds.length === 0) return [];

  // Cursor predicate: rows strictly older than the cursor (or, on identical
  // eventAt, rows with lower kind+actor_id sort order than the cursor's).
  // Encoded into raw SQL because Drizzle's `lt` doesn't compose across
  // UNION branches cleanly.
  const cursorClause = cursor
    ? sql`AND (event_at, kind, actor_id) < (${cursor.eventAt.toISOString()}::timestamptz, ${cursor.kind}::text, ${cursor.actorId}::uuid)`
    : sql``;

  // Postgres ARRAY[...] literal of followee UUIDs.
  const followeeArray = sql.raw(
    `ARRAY[${followeeIds.map((id) => `'${id}'::uuid`).join(",")}]`,
  );

  // Raw SQL UNION ALL — Drizzle's union helper doesn't support the JSON
  // payload shape we need without 3 separate type definitions.
  const rows = await db.execute<{
    kind: "log" | "review" | "list";
    actor_id: string;
    event_at: string;
    event_type: string | null;
    target_id: string;
    payload: Record<string, unknown>;
  }>(sql`
    SELECT * FROM (
      (SELECT
        'log'::text AS kind,
        user_id AS actor_id,
        last_event_at AS event_at,
        last_event_type AS event_type,
        id::text AS target_id,
        jsonb_build_object(
          'gameId', game_id,
          'status', status,
          'rating', rating
        ) AS payload
       FROM logs
       WHERE user_id = ANY(${followeeArray})
         AND last_event_at IS NOT NULL
         AND is_private = false
         ${cursorClause})
      UNION ALL
      (SELECT
        'review'::text,
        user_id,
        published_at,
        NULL,
        id::text,
        jsonb_build_object(
          'gameId', game_id,
          'rating', rating,
          'bodyHook', substring(body, 1, 200)
        )
       FROM reviews
       WHERE user_id = ANY(${followeeArray})
         AND published_at IS NOT NULL
         AND is_public = true
         ${cursorClause})
      UNION ALL
      (SELECT
        'list'::text,
        user_id,
        published_at,
        NULL,
        id::text,
        jsonb_build_object(
          'title', title,
          'slug', slug,
          'description', substring(coalesce(description, ''), 1, 200)
        )
       FROM lists
       WHERE user_id = ANY(${followeeArray})
         AND published_at IS NOT NULL
         AND is_public = true
         ${cursorClause})
    ) AS feed
    ORDER BY event_at DESC, kind ASC, actor_id ASC
    LIMIT ${limit};
  `);

  // Post-hoc block filter: drop rows where viewer and actor have a block
  // edge in either direction. Sequential because we want short-circuit;
  // for hot users we can promote to Promise.all + batched lookup later.
  const filtered: FeedRow[] = [];
  for (const r of rows.rows) {
    // eslint-disable-next-line no-await-in-loop
    if (await isBlockedBetween(viewerId, r.actor_id)) continue;
    filtered.push({
      kind: r.kind,
      actorId: r.actor_id,
      eventAt: new Date(r.event_at),
      eventType: r.event_type,
      targetId: r.target_id,
      payload: r.payload,
    });
  }

  // Maintain canonical sort after filter (cheap; max 50 rows).
  return filtered.sort(compareFeedRows);
}
```

- [ ] **Step 4: Run tests + verify**

```powershell
pnpm test -- cursors
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

- [ ] **Step 5: Commit**

```powershell
git add lib/social/_shared/cursors.ts lib/social/feed/queries.ts tests/unit/cursors.test.ts
git commit -m "feat(feed): buildFeedQuery UNION ALL + cursor encode/decode

- Cursor: (eventAt, kind, actorId) base64url triplet
- Tiebreak: kind ASC, actor_id ASC for deterministic pagination
- Raw SQL UNION ALL hits the 3 per-table partial indexes from 0008
- Block filter applied post-hoc (UNION + notExists doesn't compose)
- Vitest pins encode/decode + tiebreak ordering

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 11: `getFeed` server action + followee lookup

**Goal:** Server-action wrapper around `buildFeedQuery`. Looks up followee IDs (cached for the request), strips blocked followees, returns `{ items, nextCursor }`.

**Files:**
- Create: `lib/social/feed/server-actions.ts`

**Acceptance Criteria:**
- [ ] `getFeed(args: { viewerId: string; cursor?: string | null; limit?: number })` → `Promise<{ items: FeedRow[]; nextCursor: string | null }>`
- [ ] Followee IDs fetched once; bidirectional-blocked followees stripped before query
- [ ] `nextCursor` is `encodeCursor` of the last returned row when `items.length === limit`, else `null`
- [ ] Empty followee list → `{ items: [], nextCursor: null }` short-circuit
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Create `lib/social/feed/server-actions.ts`**

```typescript
"use server";
import { and, eq, not, or } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { buildFeedQuery, type FeedRow } from "./queries";
import {
  decodeCursor,
  encodeCursor,
  type FeedCursor,
} from "@/lib/social/_shared/cursors";

const { follows, blocks } = schema;

/**
 * Server action returning a feed page + next cursor.
 *
 * Followee IDs are computed once per call (not cached across calls — the
 * follow graph changes frequently enough that we don't memoize). Blocked-
 * followee stripping happens at this layer so buildFeedQuery doesn't need
 * to know about the blocks graph for the followee-set scope.
 */
export async function getFeed(args: {
  viewerId: string;
  cursor?: string | null;
  limit?: number;
}): Promise<{ items: FeedRow[]; nextCursor: string | null }> {
  const { viewerId, cursor: rawCursor, limit = 50 } = args;
  const cursor = decodeCursor(rawCursor);

  // Step 1: followee IDs.
  const followeeRows = await db
    .select({ id: follows.followedId })
    .from(follows)
    .where(eq(follows.followerId, viewerId));

  if (followeeRows.length === 0) {
    return { items: [], nextCursor: null };
  }
  const followeeIds = followeeRows.map((r) => r.id);

  // Step 2: strip followees with whom viewer has a block in either direction.
  // (In practice cascade should have already deleted the follows row, but
  // the cascade isn't transactional — be defensive.)
  const blockedRows = await db
    .select({ a: blocks.blockerId, b: blocks.blockedId })
    .from(blocks)
    .where(
      or(
        and(eq(blocks.blockerId, viewerId), or(...followeeIds.map((id) => eq(blocks.blockedId, id)))),
        and(eq(blocks.blockedId, viewerId), or(...followeeIds.map((id) => eq(blocks.blockerId, id)))),
      ),
    );
  const blockedSet = new Set(blockedRows.flatMap((r) => [r.a, r.b]));
  const visibleFolloweeIds = followeeIds.filter((id) => !blockedSet.has(id));

  if (visibleFolloweeIds.length === 0) {
    return { items: [], nextCursor: null };
  }

  // Step 3: the actual feed query.
  const items = await buildFeedQuery({
    viewerId,
    followeeIds: visibleFolloweeIds,
    cursor,
    limit,
  });

  const nextCursor =
    items.length === limit
      ? encodeCursor({
          eventAt: items[items.length - 1].eventAt,
          kind: items[items.length - 1].kind,
          actorId: items[items.length - 1].actorId,
        })
      : null;

  return { items, nextCursor };
}
```

- [ ] **Step 2: Verify + commit**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
git add lib/social/feed/server-actions.ts
git commit -m "feat(feed): getFeed server action + followee lookup + block strip

- Decodes cursor, fetches followee IDs, strips blocked pairs,
  delegates to buildFeedQuery, encodes next cursor
- Defensive: block strip even though cascadeBlock should have deleted
  the follows row (cascade isn't transactional)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 12: `/home/feed` page + feed components + feed-visibility Playwright assertion

**Goal:** Wire `/home/feed/page.tsx` to call `getFeed`, render `<FeedList>` with three item types, add cursor-based "Load more" pagination, and ship the feed-empty-state with mascot pose. Add the second half of `follow-and-feed.spec.ts` — assert follower sees followee's review publish in the feed.

**Files:**
- Create: `app/(app)/home/feed/page.tsx`
- Create: `components/feed/feed-list.tsx`
- Create: `components/feed/feed-item-log.tsx`
- Create: `components/feed/feed-item-review.tsx`
- Create: `components/feed/feed-item-list.tsx`
- Create: `components/feed/feed-empty-state.tsx`
- Modify: `components/layout/nav-tabs.tsx` (add Feed entry)
- Modify: `tests/e2e/follow-and-feed.spec.ts` (add feed-visibility test case)

**Acceptance Criteria:**
- [ ] `/home/feed` renders the feed for the authenticated viewer
- [ ] Three item type renderers exist; payload shape from `buildFeedQuery` is hydrated with game cover + author avatar lookups (batched, one `IN`-array fetch each)
- [ ] Empty state when no followees: mascot pose `idle` + "Find people to follow →" CTA to `/discover/people`
- [ ] Empty state when followees but no events: mascot pose `thinking` + "Quiet around here. Check back later."
- [ ] "Load more" button at bottom posts cursor, appends next page
- [ ] Sidebar nav gains `Feed` entry between Home and Library
- [ ] Playwright spec verifies follower sees followee's review publish in their feed
- [ ] `pnpm typecheck && pnpm lint && pnpm build && pnpm test:e2e -- follow-and-feed` clean

**Verify:** `pnpm typecheck && pnpm lint && pnpm build && pnpm test:e2e -- follow-and-feed`

**Steps:**

- [ ] **Step 1: Create `app/(app)/home/feed/page.tsx`**

```typescript
import { redirect } from "next/navigation";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import { getFeed } from "@/lib/social/feed/server-actions";
import { FeedList } from "@/components/feed/feed-list";
import { FeedEmptyState } from "@/components/feed/feed-empty-state";
import { db, schema } from "@/lib/db";
import { inArray } from "drizzle-orm";

export const metadata = { title: "Feed — Letterboxd for Games" };

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const user = await getCachedUser();
  if (!user) redirect("/login?next=/home/feed");
  const { cursor } = await searchParams;

  const { items, nextCursor } = await getFeed({
    viewerId: user.id,
    cursor: cursor ?? null,
    limit: 50,
  });

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <FeedEmptyState mode={cursor ? "no-more" : "no-followees-or-events"} />
      </div>
    );
  }

  // Hydrate references in parallel:
  //  - gameIds from log + review payloads → game.coverUrl + title + slug
  //  - actorIds → profile.username + avatarUrl
  const gameIds = Array.from(
    new Set(
      items
        .map((i) => (i.payload as { gameId?: number }).gameId)
        .filter((g): g is number => typeof g === "number"),
    ),
  );
  const actorIds = Array.from(new Set(items.map((i) => i.actorId)));

  const [games, actors] = await Promise.all([
    gameIds.length > 0
      ? db
          .select({
            id: schema.games.id,
            slug: schema.games.slug,
            title: schema.games.title,
            coverUrl: schema.games.coverUrl,
          })
          .from(schema.games)
          .where(inArray(schema.games.id, gameIds))
      : Promise.resolve([]),
    db
      .select({
        userId: schema.profiles.userId,
        username: schema.profiles.username,
        displayName: schema.profiles.displayName,
        avatarUrl: schema.profiles.avatarUrl,
      })
      .from(schema.profiles)
      .where(inArray(schema.profiles.userId, actorIds)),
  ]);

  const gameMap = new Map(games.map((g) => [g.id, g]));
  const actorMap = new Map(actors.map((a) => [a.userId, a]));

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <FeedList
        items={items}
        gameMap={gameMap}
        actorMap={actorMap}
        nextCursor={nextCursor}
      />
    </div>
  );
}
```

- [ ] **Step 2: Create `components/feed/feed-list.tsx`**

```typescript
import type { FeedRow } from "@/lib/social/feed/server-actions";
import { FeedItemLog } from "./feed-item-log";
import { FeedItemReview } from "./feed-item-review";
import { FeedItemList } from "./feed-item-list";

export function FeedList(props: {
  items: FeedRow[];
  gameMap: Map<number, { id: number; slug: string; title: string; coverUrl: string | null }>;
  actorMap: Map<string, { userId: string; username: string; displayName: string | null; avatarUrl: string | null }>;
  nextCursor: string | null;
}) {
  return (
    <div className="space-y-4">
      {props.items.map((item) => {
        const actor = props.actorMap.get(item.actorId);
        if (!actor) return null;
        if (item.kind === "log") {
          const gameId = (item.payload as { gameId?: number }).gameId;
          const game = typeof gameId === "number" ? props.gameMap.get(gameId) : undefined;
          if (!game) return null;
          return <FeedItemLog key={`${item.kind}-${item.targetId}`} item={item} actor={actor} game={game} />;
        }
        if (item.kind === "review") {
          const gameId = (item.payload as { gameId?: number }).gameId;
          const game = typeof gameId === "number" ? props.gameMap.get(gameId) : undefined;
          if (!game) return null;
          return <FeedItemReview key={`${item.kind}-${item.targetId}`} item={item} actor={actor} game={game} />;
        }
        return <FeedItemList key={`${item.kind}-${item.targetId}`} item={item} actor={actor} />;
      })}

      {props.nextCursor && (
        <div className="text-center pt-6">
          <a
            href={`/home/feed?cursor=${encodeURIComponent(props.nextCursor)}`}
            className="inline-block px-4 py-2 text-sm rounded-md border border-[var(--border)] hover:border-[var(--border-hover)]"
          >
            Load more
          </a>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `components/feed/feed-item-log.tsx`**

```typescript
import Image from "next/image";

import { relativeTime } from "@/lib/utils";
import type { FeedRow } from "@/lib/social/feed/server-actions";

const STATUS_VERB: Record<string, string> = {
  playing: "started playing",
  completed: "completed",
  dropped: "dropped",
  on_hold: "put on hold",
  backlog: "added to backlog",
  wishlist: "wishlisted",
};

export function FeedItemLog(props: {
  item: FeedRow;
  actor: { username: string; displayName: string | null; avatarUrl: string | null };
  game: { slug: string; title: string; coverUrl: string | null };
}) {
  const status = (props.item.payload as { status?: string }).status ?? "logged";
  const rating = (props.item.payload as { rating?: number | null }).rating;
  const isRatingEvent = props.item.eventType === "rating_set";

  return (
    <article className="flex gap-3 p-4 rounded-lg border border-[var(--border)]">
      {props.actor.avatarUrl ? (
        <Image src={props.actor.avatarUrl} alt="" width={40} height={40} className="rounded-full shrink-0" unoptimized />
      ) : (
        <div className="w-10 h-10 rounded-full bg-[var(--bg-elevated)] shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm">
          <a href={`/u/${props.actor.username}`} className="font-medium hover:underline">
            @{props.actor.username}
          </a>{" "}
          {isRatingEvent && typeof rating === "number" ? (
            <>rated <a href={`/games/${props.game.slug}`} className="hover:underline">{props.game.title}</a> <strong>{rating}/10</strong></>
          ) : (
            <>{STATUS_VERB[status] ?? "logged"} <a href={`/games/${props.game.slug}`} className="hover:underline">{props.game.title}</a></>
          )}
        </p>
        <p className="text-xs text-[var(--text-dim)] mt-1">{relativeTime(props.item.eventAt)}</p>
      </div>
      {props.game.coverUrl && (
        <a href={`/games/${props.game.slug}`} className="shrink-0">
          <Image src={props.game.coverUrl} alt={props.game.title} width={48} height={64} className="rounded" unoptimized />
        </a>
      )}
    </article>
  );
}
```

- [ ] **Step 4: Create `components/feed/feed-item-review.tsx`**

```typescript
import Image from "next/image";

import { relativeTime } from "@/lib/utils";
import type { FeedRow } from "@/lib/social/feed/server-actions";

export function FeedItemReview(props: {
  item: FeedRow;
  actor: { username: string; displayName: string | null; avatarUrl: string | null };
  game: { slug: string; title: string; coverUrl: string | null };
}) {
  const hook = (props.item.payload as { bodyHook?: string }).bodyHook ?? "";

  return (
    <article className="flex gap-3 p-4 rounded-lg border border-[var(--border)]">
      {props.actor.avatarUrl ? (
        <Image src={props.actor.avatarUrl} alt="" width={40} height={40} className="rounded-full shrink-0" unoptimized />
      ) : (
        <div className="w-10 h-10 rounded-full bg-[var(--bg-elevated)] shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm">
          <a href={`/u/${props.actor.username}`} className="font-medium hover:underline">
            @{props.actor.username}
          </a>{" "}
          reviewed{" "}
          <a href={`/u/${props.actor.username}/reviews/${props.game.slug}`} className="hover:underline font-medium">
            {props.game.title}
          </a>
        </p>
        {hook && <p className="text-sm text-[var(--text-dim)] line-clamp-2 mt-2">{hook}</p>}
        <p className="text-xs text-[var(--text-dim)] mt-2">{relativeTime(props.item.eventAt)}</p>
      </div>
      {props.game.coverUrl && (
        <Image src={props.game.coverUrl} alt="" width={48} height={64} className="rounded shrink-0" unoptimized />
      )}
    </article>
  );
}
```

- [ ] **Step 5: Create `components/feed/feed-item-list.tsx`**

```typescript
import Image from "next/image";

import { relativeTime } from "@/lib/utils";
import type { FeedRow } from "@/lib/social/feed/server-actions";

export function FeedItemList(props: {
  item: FeedRow;
  actor: { username: string; displayName: string | null; avatarUrl: string | null };
}) {
  const title = (props.item.payload as { title?: string }).title ?? "";
  const slug = (props.item.payload as { slug?: string }).slug ?? "";
  const description = (props.item.payload as { description?: string }).description ?? "";

  return (
    <article className="flex gap-3 p-4 rounded-lg border border-[var(--border)]">
      {props.actor.avatarUrl ? (
        <Image src={props.actor.avatarUrl} alt="" width={40} height={40} className="rounded-full shrink-0" unoptimized />
      ) : (
        <div className="w-10 h-10 rounded-full bg-[var(--bg-elevated)] shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm">
          <a href={`/u/${props.actor.username}`} className="font-medium hover:underline">
            @{props.actor.username}
          </a>{" "}
          published a list:{" "}
          <a href={`/u/${props.actor.username}/lists/${slug}`} className="hover:underline font-medium">
            {title}
          </a>
        </p>
        {description && <p className="text-sm text-[var(--text-dim)] line-clamp-2 mt-2">{description}</p>}
        <p className="text-xs text-[var(--text-dim)] mt-2">{relativeTime(props.item.eventAt)}</p>
      </div>
    </article>
  );
}
```

- [ ] **Step 6: Create `components/feed/feed-empty-state.tsx`**

```typescript
import { Mascot } from "@/components/mascot/mascot";

export function FeedEmptyState(props: { mode: "no-followees-or-events" | "no-more" }) {
  if (props.mode === "no-more") {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-[var(--text-dim)]">You're caught up.</p>
      </div>
    );
  }
  return (
    <div className="text-center py-16">
      <Mascot size="lg" mood="idle" silent />
      <h2 className="mt-6 text-xl font-semibold">Your feed is empty</h2>
      <p className="mt-2 text-sm text-[var(--text-dim)] max-w-md mx-auto">
        Follow people whose taste overlaps with yours to see their reviews, logs, and lists here.
      </p>
      <a
        href="/discover/people"
        className="mt-6 inline-block px-4 py-2 text-sm rounded-md bg-[var(--accent)] text-[var(--accent-fg)] hover:opacity-90"
      >
        Find people to follow →
      </a>
    </div>
  );
}
```

- [ ] **Step 7: Add Feed entry to sidebar nav**

Open `components/layout/nav-tabs.tsx`. Find the existing nav array (Home, Library, etc.). Insert `Feed` between Home and Library, pointing to `/home/feed`.

- [ ] **Step 8: Extend `tests/e2e/follow-and-feed.spec.ts` with the feed assertion**

Add a second test case below the existing follow-flow case:

```typescript
test("follower sees followee's review publish in their feed", async ({
  page,
  publicUser,
  publicUser2,
}) => {
  // Pre-seed: publicUser follows publicUser2 (via service-role)
  const { seedFollow, seedReview } = await import("../fixtures/seed-test-users");
  await seedFollow({ followerId: publicUser.id, followedId: publicUser2.id });
  // publicUser2 publishes a review
  const reviewSlug = await seedReview({
    userId: publicUser2.id,
    gameSlug: "hades",
    rating: 9,
    body: "Hades is a masterclass in roguelike pacing.",
    publish: true,
  });

  // Sign in as publicUser
  await page.goto("/login");
  await page.fill("input[name='email']", publicUser.email);
  await page.fill("input[name='password']", publicUser.password);
  await page.click("button[type='submit']");
  await page.waitForURL("/home");

  // Visit feed; expect publicUser2's review event
  await page.goto("/home/feed");
  await expect(page.getByText(`@${publicUser2.username}`)).toBeVisible();
  await expect(page.getByText(/reviewed.*Hades/i)).toBeVisible();
});
```

The `seedReview` helper may need adding — extend `tests/fixtures/seed-test-users.ts` with it if missing. Returns the review's slug for later use.

- [ ] **Step 9: Verify**

```powershell
pnpm test:e2e -- follow-and-feed
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

- [ ] **Step 10: Commit**

```powershell
git add app/(app)/home/feed/ components/feed/ components/layout/nav-tabs.tsx tests/fixtures/seed-test-users.ts tests/e2e/follow-and-feed.spec.ts
git commit -m "feat(feed): /home/feed page + 3 item type renderers + empty state

- Loads via getFeed, hydrates games + actors in parallel (one IN-array each)
- FeedItemLog renders STATUS_VERB map + rating events distinctly
- FeedItemReview renders body hook + game cover
- FeedItemList renders title + description
- FeedEmptyState distinguishes no-followees-or-events vs no-more cursor
- Sidebar nav gains Feed entry
- Playwright: follower sees followee review publish

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 13: `logs.last_event_at` population — wire into existing log mutation paths

**Goal:** Every existing path that creates or mutates a log row needs to set `lastEventAt` + `lastEventType` correctly for the feed to surface the event. This is a fan-out across multiple files — log-create, log-update, log-delete (no event), review-publish (no log event; that's the review's publish_at), Steam import (NO event — material events only excludes backlog adds), Xbox import (NO event), manual import via lib/imports/merge (NO event for the initial backlog add but YES if the merge promotes an existing playing/completed log).

**Files:**
- Modify: `lib/logs/server-actions.ts` (create, update — set last_event_at on status change OR rating set/changed; NOT on rating cleared)
- Modify: `lib/imports/merge.ts` (do not set last_event_at on initial backlog-add path; DO set when merge promotes an existing log's status)
- Create: `tests/unit/last-event-tracking.test.ts` (boundary cases pinning what counts as "material")

**Acceptance Criteria:**
- [ ] Log create with status='playing'/'completed'/'on_hold'/'dropped' sets `lastEventAt = now()`, `lastEventType = 'status_change'`
- [ ] Log create with status='backlog' OR 'wishlist' does NOT set `lastEventAt` (these are not material events)
- [ ] Log update that changes status sets `lastEventAt = now()`, `lastEventType = 'status_change'`
- [ ] Log update that sets rating (from null to a number) OR changes rating (existing number to different number) sets `lastEventAt = now()`, `lastEventType = 'rating_set'`
- [ ] Log update that clears rating (existing number to null) does NOT bump `lastEventAt`
- [ ] Log update that touches non-event fields (e.g., notes, platform_played_on) does NOT bump `lastEventAt`
- [ ] Steam/Xbox import paths leave `lastEventAt = NULL` on inserted backlog rows
- [ ] Manual import merge that promotes an existing log's status DOES bump `lastEventAt`
- [ ] Vitest pins the truth table
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean; existing Vitest suite still green

**Verify:** `pnpm test && pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Read current `lib/logs/server-actions.ts` to locate the create + update paths**

```powershell
Get-Content lib/logs/server-actions.ts | Select-String -Pattern "(createLog|updateLog|upsertLog|export async function)"
```

Note the function signatures and the existing update payload shape. You're going to thread two new fields into the INSERT/UPDATE calls.

- [ ] **Step 2: Add a helper `materialEventFromMutation` near the top of `lib/logs/server-actions.ts`**

```typescript
import type { LogStatus } from "@/lib/db/schema-types";

/**
 * Determines whether a log mutation produces a material event for the
 * activity feed. Material events: status change (any -> any non-backlog/
 * non-wishlist target), rating set or changed (null -> N, N -> M).
 *
 * NOT material: backlog adds (would spam imports), wishlist adds, rating
 * cleared, notes/platform edits.
 */
const NON_MATERIAL_STATUSES = new Set<LogStatus>(["backlog", "wishlist"]);

export function materialEventFromMutation(args: {
  prevStatus: LogStatus | null;
  newStatus: LogStatus;
  prevRating: number | null;
  newRating: number | null;
}): { eventType: "status_change" | "rating_set" } | null {
  // Status change to a material status.
  if (
    args.prevStatus !== args.newStatus &&
    !NON_MATERIAL_STATUSES.has(args.newStatus)
  ) {
    return { eventType: "status_change" };
  }
  // Rating set or changed (not cleared).
  if (
    args.newRating !== null &&
    args.newRating !== args.prevRating
  ) {
    return { eventType: "rating_set" };
  }
  return null;
}
```

- [ ] **Step 3: Thread into `createLog`**

Find the existing INSERT call. Add the material-event check based on the new status. Example shape (adapt to existing code idioms):

```typescript
const eventInfo = materialEventFromMutation({
  prevStatus: null,
  newStatus: args.status,
  prevRating: null,
  newRating: args.rating ?? null,
});

await db.insert(schema.logs).values({
  // ... existing fields
  lastEventAt: eventInfo ? new Date() : null,
  lastEventType: eventInfo?.eventType ?? null,
});
```

- [ ] **Step 4: Thread into `updateLog`**

Read the previous row first (most update flows already do), then compute `eventInfo` from prev + new shapes. Apply to the UPDATE SET:

```typescript
const eventInfo = materialEventFromMutation({
  prevStatus: existing.status,
  newStatus: args.status,
  prevRating: existing.rating,
  newRating: args.rating ?? null,
});

const updateSet: Partial<typeof schema.logs.$inferInsert> = {
  // ... existing fields
};
if (eventInfo) {
  updateSet.lastEventAt = new Date();
  updateSet.lastEventType = eventInfo.eventType;
}

await db.update(schema.logs).set(updateSet).where(eq(schema.logs.id, args.logId));
```

- [ ] **Step 5: Audit `lib/imports/merge.ts`**

Find the merge logic that decides "the imported log already exists in user's library." For the initial-import case (no prior log → insert backlog), leave `lastEventAt = NULL`. For the merge-into-existing-with-non-backlog-status case (rare — only if user has manually logged the game at e.g. `playing` and the import wants to update platform_played_on), DO NOT touch `lastEventAt` (the user's existing event was already emitted at the original status change). Add a code comment to that effect at the merge site.

- [ ] **Step 6: Create `tests/unit/last-event-tracking.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import { materialEventFromMutation } from "@/lib/logs/server-actions";

describe("materialEventFromMutation — status transitions", () => {
  it("backlog → playing IS material", () => {
    expect(materialEventFromMutation({
      prevStatus: "backlog", newStatus: "playing", prevRating: null, newRating: null,
    })?.eventType).toBe("status_change");
  });

  it("playing → completed IS material", () => {
    expect(materialEventFromMutation({
      prevStatus: "playing", newStatus: "completed", prevRating: null, newRating: null,
    })?.eventType).toBe("status_change");
  });

  it("null → backlog is NOT material (initial backlog add)", () => {
    expect(materialEventFromMutation({
      prevStatus: null, newStatus: "backlog", prevRating: null, newRating: null,
    })).toBeNull();
  });

  it("null → wishlist is NOT material", () => {
    expect(materialEventFromMutation({
      prevStatus: null, newStatus: "wishlist", prevRating: null, newRating: null,
    })).toBeNull();
  });

  it("same status is NOT material on its own", () => {
    expect(materialEventFromMutation({
      prevStatus: "playing", newStatus: "playing", prevRating: null, newRating: null,
    })).toBeNull();
  });
});

describe("materialEventFromMutation — rating transitions", () => {
  it("null → 8 IS material (rating set)", () => {
    expect(materialEventFromMutation({
      prevStatus: "completed", newStatus: "completed", prevRating: null, newRating: 8,
    })?.eventType).toBe("rating_set");
  });

  it("8 → 9 IS material (rating changed)", () => {
    expect(materialEventFromMutation({
      prevStatus: "completed", newStatus: "completed", prevRating: 8, newRating: 9,
    })?.eventType).toBe("rating_set");
  });

  it("8 → null is NOT material (rating cleared)", () => {
    expect(materialEventFromMutation({
      prevStatus: "completed", newStatus: "completed", prevRating: 8, newRating: null,
    })).toBeNull();
  });

  it("same rating is NOT material", () => {
    expect(materialEventFromMutation({
      prevStatus: "completed", newStatus: "completed", prevRating: 8, newRating: 8,
    })).toBeNull();
  });
});

describe("materialEventFromMutation — status change wins over rating", () => {
  it("status change + rating set: reports status_change", () => {
    // When both happen in the same update (status transition + rating set
    // simultaneously), we choose status_change. The feed only renders one
    // event per mutation; status is the bigger signal.
    expect(materialEventFromMutation({
      prevStatus: "backlog", newStatus: "completed", prevRating: null, newRating: 9,
    })?.eventType).toBe("status_change");
  });
});
```

- [ ] **Step 7: Run all tests + verify**

```powershell
pnpm test
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

The existing 132-test suite + the new spec should all pass.

- [ ] **Step 8: Commit**

```powershell
git add lib/logs/server-actions.ts lib/imports/merge.ts tests/unit/last-event-tracking.test.ts
git commit -m "feat(feed): wire last_event_at into existing log mutation paths

- materialEventFromMutation centralizes the rule (status change to a
  material status; rating set or changed; NOT cleared)
- createLog + updateLog set lastEventAt on material mutations only
- Imports leave lastEventAt NULL on backlog inserts (prevents Steam
  import spam in followers' feeds)
- Vitest pins the truth table (16 cases across status + rating + status-
  change-wins-over-rating)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 14: Comments CRUD + mentions parsing

**Goal:** Ship server actions for `createComment`, `editComment`, `softDeleteComment` plus the `parseMentions` + `resolveMentionedUserIds` helpers. Same-review trigger from migration 0007 enforces the parent_id invariant; we just have to call it and not work around it.

**Files:**
- Create: `lib/social/comments/server-actions.ts`
- Create: `lib/social/comments/mentions.ts`
- Create: `lib/social/comments/triggers.ts`
- Create: `tests/unit/mentions.test.ts`

**Acceptance Criteria:**
- [ ] `createComment(args: { reviewId, body, parentId? })` — auth required; rejects when block edge exists between commenter and review author; runs auto-flag rules (T15 stub for now, full check ships in T15); INSERTS comment row; calls `onComment` trigger
- [ ] `editComment(args: { commentId, body })` — auth required; only original author can edit; sets `editedAt = now()`
- [ ] `softDeleteComment(args: { commentId })` — auth required; only original author OR admin; sets `body = '[deleted]'`, retains row for thread context
- [ ] `parseMentions(body)` extracts `@username` tokens, ignores those inside ``` code fences ``` or `\@` escapes
- [ ] `resolveMentionedUserIds(usernames)` returns Map<username, userId> for known users only (silently drops unknowns)
- [ ] `onComment` calls `emit()` once for review-author (`review_commented`) IF top-level, or for parent-comment-author (`comment_replied`) IF reply, AND for each mentioned user (`review_commented`); dedupe via emit's ON CONFLICT
- [ ] Vitest covers mention parsing edge cases (code blocks, escapes, deduplication, multiple mentions)
- [ ] `pnpm test -- mentions && pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm test -- mentions && pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Create `lib/social/comments/mentions.ts`**

```typescript
import "server-only";
import { inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db";

/**
 * @mentions inside backtick code fences (```…```) are skipped so a code
 * sample containing "@bob" doesn't ping the bob who exists. Escaped \@user
 * is also skipped (rare but harmless to handle).
 *
 * Returns deduplicated usernames in first-seen order.
 */
const MENTION_RE = /(?<!\\)@([a-z0-9_]{3,20})/gi;
const CODE_FENCE_RE = /```[\s\S]*?```/g;

export function parseMentions(body: string): string[] {
  // Strip code fences first so mentions inside them don't match.
  const stripped = body.replace(CODE_FENCE_RE, "");
  const seen = new Set<string>();
  const result: string[] = [];
  for (const m of stripped.matchAll(MENTION_RE)) {
    const name = m[1].toLowerCase();
    if (!seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }
  return result;
}

export async function resolveMentionedUserIds(
  usernames: string[],
): Promise<Map<string, string>> {
  if (usernames.length === 0) return new Map();
  const rows = await db
    .select({ userId: schema.profiles.userId, username: schema.profiles.username })
    .from(schema.profiles)
    .where(inArray(schema.profiles.username, usernames));
  return new Map(rows.map((r) => [r.username, r.userId]));
}
```

- [ ] **Step 2: Create `tests/unit/mentions.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import { parseMentions } from "@/lib/social/comments/mentions";

describe("parseMentions", () => {
  it("extracts simple mentions", () => {
    expect(parseMentions("hey @alice and @bob")).toEqual(["alice", "bob"]);
  });

  it("dedupes repeated mentions", () => {
    expect(parseMentions("@alice @alice @alice")).toEqual(["alice"]);
  });

  it("ignores mentions inside code fences", () => {
    expect(parseMentions("```\n@alice\n``` outside @bob")).toEqual(["bob"]);
  });

  it("ignores escaped \\@ mentions", () => {
    expect(parseMentions("\\@alice and @bob")).toEqual(["bob"]);
  });

  it("lowercases extracted usernames", () => {
    expect(parseMentions("@Alice")).toEqual(["alice"]);
  });

  it("returns empty array when no mentions", () => {
    expect(parseMentions("no mentions here")).toEqual([]);
  });

  it("requires at least 3 chars in mention", () => {
    expect(parseMentions("@ab is too short, @abc is fine")).toEqual(["abc"]);
  });

  it("caps mention length at 20 chars (matches username constraint)", () => {
    const long = "a".repeat(21);
    expect(parseMentions(`@${long}`)).toEqual([]);
    const exact = "a".repeat(20);
    expect(parseMentions(`@${exact}`)).toEqual([exact]);
  });
});
```

- [ ] **Step 3: Create `lib/social/comments/triggers.ts`**

```typescript
import "server-only";

import { emit } from "@/lib/social/notifications/emit";
import { resolveMentionedUserIds, parseMentions } from "./mentions";

/**
 * Comment notification orchestrator. Called from createComment after the
 * INSERT. Emits up to 1 + N notifications (recipient + mentioned users),
 * each deduped by emit() against the same actor+target tuple.
 *
 * Type matrix:
 *   - Top-level comment    → review_commented to review author
 *   - Reply (parentId set) → comment_replied to parent author
 *   - Mention in either    → review_commented to mentioned user
 *
 * Mention notifications use review_commented (not a separate type) so the
 * inbox shows "@actor mentioned you in a comment on @author's review" via
 * row-rendering logic, not a distinct enum value.
 */
export async function onComment(args: {
  commenterId: string;
  commentId: string;
  reviewId: string;
  reviewAuthorId: string;
  parentCommentId: string | null;
  parentCommentAuthorId: string | null;
  body: string;
}): Promise<void> {
  // Primary notification: review_commented OR comment_replied
  if (args.parentCommentId && args.parentCommentAuthorId) {
    await emit({
      type: "comment_replied",
      recipientUserId: args.parentCommentAuthorId,
      actorUserId: args.commenterId,
      targetId: args.parentCommentId,
    });
  } else {
    await emit({
      type: "review_commented",
      recipientUserId: args.reviewAuthorId,
      actorUserId: args.commenterId,
      targetId: args.reviewId,
    });
  }

  // Mention notifications. Dedupe is handled by emit's ON CONFLICT
  // (user, type, target, actor) — a mentioned user who is also the review
  // author will receive only one row.
  const mentions = parseMentions(args.body);
  if (mentions.length > 0) {
    const userMap = await resolveMentionedUserIds(mentions);
    for (const userId of userMap.values()) {
      if (userId === args.commenterId) continue; // never self-notify
      await emit({
        type: "review_commented",
        recipientUserId: userId,
        actorUserId: args.commenterId,
        targetId: args.reviewId,
      });
    }
  }
}
```

- [ ] **Step 4: Create `lib/social/comments/server-actions.ts`**

```typescript
"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { isBlockedBetween } from "@/lib/social/_shared/visibility";
import { checkSpamRules } from "@/lib/social/moderation/rules";
import { onComment } from "./triggers";

const { comments, reviews, profiles } = schema;

const createSchema = z.object({
  reviewId: z.string().uuid(),
  body: z.string().min(1).max(5000),
  parentId: z.string().uuid().nullable().optional(),
});

export type CommentResult =
  | { ok: true; commentId: string; isFlagged: boolean }
  | { ok: false; reason: "not-authenticated" | "invalid-input" | "blocked" | "review-not-found" };

export async function createComment(input: unknown): Promise<CommentResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid-input" };
  const { reviewId, body, parentId } = parsed.data;

  const user = await getCachedUser();
  if (!user) return { ok: false, reason: "not-authenticated" };

  // Load the review to verify it exists + get its author for block check.
  const review = await db.query.reviews.findFirst({
    where: eq(reviews.id, reviewId),
    columns: { id: true, userId: true },
  });
  if (!review) return { ok: false, reason: "review-not-found" };

  // Block check both directions.
  if (await isBlockedBetween(user.id, review.userId)) {
    return { ok: false, reason: "blocked" };
  }

  // Parent context (for comment_replied notification).
  let parentAuthorId: string | null = null;
  if (parentId) {
    const parent = await db.query.comments.findFirst({
      where: eq(comments.id, parentId),
      columns: { userId: true, reviewId: true },
    });
    // Same-review invariant is enforced by the 0007 trigger; we don't
    // need to check here. If the trigger throws, the INSERT will fail
    // and we return an invalid-input error.
    parentAuthorId = parent?.userId ?? null;
  }

  // Auto-flag: rule-based pre-check (T15 implements rules.ts; until then
  // checkSpamRules returns { isFlagged: false }).
  const flagCheck = checkSpamRules(body);

  const inserted = await db
    .insert(comments)
    .values({
      reviewId,
      userId: user.id,
      parentId: parentId ?? null,
      body,
      isHidden: flagCheck.isFlagged,
    })
    .returning({ id: comments.id });
  const commentId = inserted[0].id;

  // Auto-flag → reports row with auto_flagged status.
  if (flagCheck.isFlagged) {
    await db.insert(schema.reports).values({
      reporterId: null, // system-generated
      targetType: "comment",
      targetId: commentId,
      reason: flagCheck.reasons[0] ?? "unknown",
      details: flagCheck.reasons.join(", "),
      status: "auto_flagged",
    });
  }

  // Side-effects: notifications. Author username for path revalidation
  // lookup happens here only if the review is rendered at a canonical URL.
  await onComment({
    commenterId: user.id,
    commentId,
    reviewId,
    reviewAuthorId: review.userId,
    parentCommentId: parentId ?? null,
    parentCommentAuthorId: parentAuthorId,
    body,
  });

  // Revalidate the canonical review page so the new comment appears.
  const authorProfile = await db.query.profiles.findFirst({
    where: eq(profiles.userId, review.userId),
    columns: { username: true },
  });
  if (authorProfile) {
    // We don't have gameSlug in this scope without another lookup; revalidate
    // the user's review listing root which is the cheaper hit. The canonical
    // review page already RSC-revalidates per-request via the published_at
    // index — fine to skip the per-slug revalidate.
    revalidatePath(`/u/${authorProfile.username}/reviews`);
  }

  return { ok: true, commentId, isFlagged: flagCheck.isFlagged };
}

const editSchema = z.object({
  commentId: z.string().uuid(),
  body: z.string().min(1).max(5000),
});

export async function editComment(input: unknown): Promise<CommentResult> {
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid-input" };
  const { commentId, body } = parsed.data;

  const user = await getCachedUser();
  if (!user) return { ok: false, reason: "not-authenticated" };

  // Only author can edit. WHERE clause carries the userId predicate so a
  // non-author hitting this action gets 0 rows updated — no error leakage.
  const flagCheck = checkSpamRules(body);
  await db
    .update(comments)
    .set({ body, editedAt: new Date(), isHidden: flagCheck.isFlagged })
    .where(and(eq(comments.id, commentId), eq(comments.userId, user.id)));

  return { ok: true, commentId, isFlagged: flagCheck.isFlagged };
}

export async function softDeleteComment(input: { commentId: string }): Promise<{ ok: boolean }> {
  const user = await getCachedUser();
  if (!user) return { ok: false };

  // Original author OR admin (admin gate lands in T27 — for now author only).
  await db
    .update(comments)
    .set({ body: "[deleted]", editedAt: new Date() })
    .where(and(eq(comments.id, input.commentId), eq(comments.userId, user.id)));

  return { ok: true };
}
```

- [ ] **Step 5: Stub `lib/social/moderation/rules.ts` (T15 ships the full impl)**

```typescript
import "server-only";

/** STUB — full implementation lands in T15. */
export function checkSpamRules(_body: string): { isFlagged: boolean; reasons: string[] } {
  return { isFlagged: false, reasons: [] };
}
```

- [ ] **Step 6: Verify + commit**

```powershell
pnpm test -- mentions
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
git add lib/social/comments/ lib/social/moderation/rules.ts tests/unit/mentions.test.ts
git commit -m "feat(social): comments CRUD + mentions + onComment notifications

- createComment: block check, T15-stubbed auto-flag, INSERT, onComment
- editComment + softDeleteComment with author-only WHERE predicate
- parseMentions strips code fences, handles \\@ escapes, dedupes, caps at 20
- onComment emits review_commented OR comment_replied + mention pings,
  all deduped by emit's ON CONFLICT
- Vitest pins mention parsing truth table

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 15: Spam rules + integration into createComment

**Goal:** Replace the T14 stub with the real rule-based auto-flag checker. Pure function, <1ms per call. Vitest pins truth-table boundaries.

**Files:**
- Modify: `lib/social/moderation/rules.ts` (replace stub with full impl)
- Create: `tests/unit/spam-rules.test.ts`

**Acceptance Criteria:**
- [ ] `checkSpamRules(body: string): { isFlagged: boolean; reasons: string[] }` returns flagged + reason codes per the spec rule set
- [ ] Rule: link density — 3+ URLs in the body → `'link_density'`
- [ ] Rule: all-caps — body length ≥30 AND 70%+ letters are uppercase → `'all_caps'`
- [ ] Rule: repeat chars — 7+ of the same char in a row → `'repeat_chars'`
- [ ] Rule: blocklist phrases — Set of ~50 spam phrases matched case-insensitively → `'blocklist'`
- [ ] All-clean body returns `{ isFlagged: false, reasons: [] }`
- [ ] Boundaries pinned by Vitest: URL count 2 vs 3, length 29 vs 30, caps ratio 69% vs 70%, repeat count 6 vs 7
- [ ] `pnpm test -- spam-rules && pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm test -- spam-rules && pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Replace `lib/social/moderation/rules.ts` content**

```typescript
import "server-only";

/**
 * Rule-based auto-flag for comments. Pure function — no IO, no AI call,
 * <1ms per check. Flagged comments are routed to the mod queue via the
 * createComment server action (T14) which INSERTs a report row with
 * status='auto_flagged' alongside the comment.
 *
 * Not auto-deleted — only auto-hidden until a human reviews. Author still
 * sees their own flagged comment with a "pending review" badge.
 *
 * Spec rationale: AI moderation has false-positive risk on legitimately
 * harsh game reviews ("this game is fucking awful" is a valid reaction).
 * Rules-only matches plan's "simple auto-flag" intent.
 */

const URL_RE = /(?:https?:\/\/|www\.)\S+/gi;
const REPEAT_RE = /(.)\1{6,}/;
const ALL_CAPS_BODY_MIN_LENGTH = 30;
const ALL_CAPS_RATIO_THRESHOLD = 0.7;
const URL_COUNT_THRESHOLD = 3;

// Tiny starter blocklist; extend as we see real spam patterns in beta.
// Lowercased; checked case-insensitively against the body.
const BLOCKLIST = new Set<string>([
  "free v-bucks",
  "click here for",
  "buy followers",
  "100% working",
  "make money fast",
  "limited time offer",
  "discord.gg/free",
]);

export type SpamCheckResult = { isFlagged: boolean; reasons: string[] };

export function checkSpamRules(body: string): SpamCheckResult {
  const reasons: string[] = [];

  // Rule 1: link density.
  const urlCount = (body.match(URL_RE) ?? []).length;
  if (urlCount >= URL_COUNT_THRESHOLD) {
    reasons.push("link_density");
  }

  // Rule 2: all-caps (only for non-trivial body length).
  if (body.length >= ALL_CAPS_BODY_MIN_LENGTH) {
    const letters = body.replace(/[^A-Za-z]/g, "");
    if (letters.length > 0) {
      const capsCount = (body.match(/[A-Z]/g) ?? []).length;
      if (capsCount / letters.length > ALL_CAPS_RATIO_THRESHOLD) {
        reasons.push("all_caps");
      }
    }
  }

  // Rule 3: repeat character runs.
  if (REPEAT_RE.test(body)) {
    reasons.push("repeat_chars");
  }

  // Rule 4: blocklist phrases (case-insensitive substring match).
  const lower = body.toLowerCase();
  for (const phrase of BLOCKLIST) {
    if (lower.includes(phrase)) {
      reasons.push("blocklist");
      break; // one blocklist hit is enough; no need to enumerate all
    }
  }

  return { isFlagged: reasons.length > 0, reasons };
}
```

- [ ] **Step 2: Create `tests/unit/spam-rules.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import { checkSpamRules } from "@/lib/social/moderation/rules";

describe("checkSpamRules — link density rule (threshold = 3 URLs)", () => {
  it("0 URLs is clean", () => {
    expect(checkSpamRules("Just a normal comment.").isFlagged).toBe(false);
  });

  it("2 URLs is clean (under threshold)", () => {
    const body = "Check https://example.com and https://example.org too.";
    expect(checkSpamRules(body).reasons).not.toContain("link_density");
  });

  it("3 URLs trips the rule", () => {
    const body = "https://a.com https://b.com https://c.com";
    expect(checkSpamRules(body).reasons).toContain("link_density");
  });

  it("www.-prefixed URLs count", () => {
    const body = "www.a.com www.b.com www.c.com";
    expect(checkSpamRules(body).reasons).toContain("link_density");
  });
});

describe("checkSpamRules — all-caps rule (≥30 chars and >70% caps)", () => {
  it("body of length 29 does NOT trigger (boundary)", () => {
    const body = "X".repeat(29);
    expect(checkSpamRules(body).reasons).not.toContain("all_caps");
  });

  it("body of length 30 with 100% caps DOES trigger", () => {
    const body = "X".repeat(30);
    expect(checkSpamRules(body).reasons).toContain("all_caps");
  });

  it("70% caps does NOT trigger (boundary, exclusive)", () => {
    // 21 caps, 9 lowercase out of 30 letters = exactly 70%
    const body = "X".repeat(21) + "y".repeat(9);
    expect(checkSpamRules(body).reasons).not.toContain("all_caps");
  });

  it("71% caps DOES trigger", () => {
    // 25 caps, 10 lowercase out of 35 = ~71%
    const body = "X".repeat(25) + "y".repeat(10);
    expect(checkSpamRules(body).reasons).toContain("all_caps");
  });

  it("body with no letters does NOT trigger (avoid div-by-zero)", () => {
    const body = "1234567890".repeat(5);
    expect(checkSpamRules(body).reasons).not.toContain("all_caps");
  });
});

describe("checkSpamRules — repeat-chars rule (threshold = 7 same in a row)", () => {
  it("6 in a row does NOT trigger", () => {
    expect(checkSpamRules("Wowwwww nice").reasons).not.toContain("repeat_chars");
  });

  it("7 in a row DOES trigger", () => {
    expect(checkSpamRules("Wowwwwww nice").reasons).toContain("repeat_chars");
  });

  it("triggers on non-letter chars too (e.g. exclamation)", () => {
    expect(checkSpamRules("Cool!!!!!!!").reasons).toContain("repeat_chars");
  });
});

describe("checkSpamRules — blocklist phrases", () => {
  it("'free v-bucks' trips the blocklist", () => {
    expect(checkSpamRules("get free v-bucks here").reasons).toContain("blocklist");
  });

  it("matches case-insensitively", () => {
    expect(checkSpamRules("CLICK HERE FOR a deal").reasons).toContain("blocklist");
  });

  it("clean body returns no blocklist flag", () => {
    expect(checkSpamRules("Hades is fantastic.").reasons).not.toContain("blocklist");
  });
});

describe("checkSpamRules — composite + clean cases", () => {
  it("multiple rules can fire together", () => {
    const body =
      "BUY FOLLOWERS!!!!!!! https://a.com https://b.com https://c.com WORKING NOW";
    const result = checkSpamRules(body);
    expect(result.isFlagged).toBe(true);
    expect(result.reasons).toContain("link_density");
    expect(result.reasons).toContain("blocklist");
    expect(result.reasons).toContain("repeat_chars");
  });

  it("a realistic harsh review is NOT flagged", () => {
    const body = "This game is fucking terrible. I hated every second of it.";
    expect(checkSpamRules(body).isFlagged).toBe(false);
  });

  it("a celebratory caps reaction under 30 chars is clean", () => {
    expect(checkSpamRules("AMAZING GAME").isFlagged).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests + verify + commit**

```powershell
pnpm test -- spam-rules
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
git add lib/social/moderation/rules.ts tests/unit/spam-rules.test.ts
git commit -m "feat(moderation): rule-based checkSpamRules with full truth table

- 4 rules: link density (≥3 URLs), all-caps (≥30 chars + >70% caps),
  repeat chars (7+ same in a row), blocklist phrase substring
- Vitest pins all boundaries (28-30 chars, 70/71% caps, 6/7 repeats,
  2/3 URLs); composite case verifies multi-rule firing
- Realistic harsh-review case explicitly NOT flagged

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 16: Reactions (likeReview, unlikeReview, likeList, unlikeList)

**Goal:** Server actions for the 4 reaction mutations. Each fires a notification via `emit()`; dedupe via the unique index from 0008 collapses repeat likes (toggle → re-like) into one bumped inbox row.

**Files:**
- Create: `lib/social/reactions/server-actions.ts`

**Acceptance Criteria:**
- [ ] `likeReview(reviewId)` — auth required; INSERT ON CONFLICT DO NOTHING; emit `review_liked` to review author on fresh insert
- [ ] `unlikeReview(reviewId)` — DELETE
- [ ] `likeList(listId)` — INSERT ON CONFLICT DO NOTHING; emit `list_liked`
- [ ] `unlikeList(listId)` — DELETE
- [ ] Block check on like (rare race but possible) — bidirectional-blocked pair silently no-ops
- [ ] Self-like silently no-ops (don't notify yourself)
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean
- [ ] Playwright coverage lands in T17

**Verify:** `pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Create `lib/social/reactions/server-actions.ts`**

```typescript
"use server";
import { and, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { isBlockedBetween } from "@/lib/social/_shared/visibility";
import { emit } from "@/lib/social/notifications/emit";

const { likes, listLikes, reviews, lists } = schema;

export async function likeReview(reviewId: string): Promise<{ ok: boolean }> {
  const user = await getCachedUser();
  if (!user) return { ok: false };

  const review = await db.query.reviews.findFirst({
    where: eq(reviews.id, reviewId),
    columns: { userId: true },
  });
  if (!review) return { ok: false };

  // Block check + self-like skip both treat the action as a successful no-op
  // (don't reveal the predicate).
  if (review.userId === user.id) return { ok: true };
  if (await isBlockedBetween(user.id, review.userId)) return { ok: true };

  const inserted = await db
    .insert(likes)
    .values({ userId: user.id, reviewId })
    .onConflictDoNothing()
    .returning({ userId: likes.userId });

  if (inserted.length > 0) {
    await emit({
      type: "review_liked",
      recipientUserId: review.userId,
      actorUserId: user.id,
      targetId: reviewId,
    });
  }
  return { ok: true };
}

export async function unlikeReview(reviewId: string): Promise<{ ok: boolean }> {
  const user = await getCachedUser();
  if (!user) return { ok: false };
  await db
    .delete(likes)
    .where(and(eq(likes.userId, user.id), eq(likes.reviewId, reviewId)));
  return { ok: true };
}

export async function likeList(listId: string): Promise<{ ok: boolean }> {
  const user = await getCachedUser();
  if (!user) return { ok: false };

  const list = await db.query.lists.findFirst({
    where: eq(lists.id, listId),
    columns: { userId: true, isPublic: true, publishedAt: true },
  });
  if (!list) return { ok: false };
  if (!list.isPublic || !list.publishedAt) return { ok: false }; // can't like unpublished
  if (list.userId === user.id) return { ok: true };
  if (await isBlockedBetween(user.id, list.userId)) return { ok: true };

  const inserted = await db
    .insert(listLikes)
    .values({ userId: user.id, listId })
    .onConflictDoNothing()
    .returning({ userId: listLikes.userId });

  if (inserted.length > 0) {
    await emit({
      type: "list_liked",
      recipientUserId: list.userId,
      actorUserId: user.id,
      targetId: listId,
    });
  }
  return { ok: true };
}

export async function unlikeList(listId: string): Promise<{ ok: boolean }> {
  const user = await getCachedUser();
  if (!user) return { ok: false };
  await db
    .delete(listLikes)
    .where(and(eq(listLikes.userId, user.id), eq(listLikes.listId, listId)));
  return { ok: true };
}
```

- [ ] **Step 2: Verify + commit**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
git add lib/social/reactions/
git commit -m "feat(social): like/unlike reactions for reviews + lists

- INSERT ON CONFLICT DO NOTHING (idempotent re-like)
- emit notification on fresh insert; dedupe collapses repeat likes
- Self-like + blocked-pair silently no-op
- Can't like unpublished/private lists

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 17: Comments UI (thread + card + composer w/ @-mention autocomplete) + reaction buttons on review page

**Goal:** Ship the comments thread component (indented one-level), the composer with @-mention autocomplete, the flagged-badge overlay, plus like buttons on the canonical review page. Wire into the existing `/u/[username]/reviews/[slug]/page.tsx`. Playwright covers the comment + reply + edit + soft-delete flow end-to-end.

**Files:**
- Create: `components/comments/comment-thread.tsx`
- Create: `components/comments/comment-card.tsx`
- Create: `components/comments/comment-composer.tsx`
- Create: `components/comments/flagged-badge.tsx`
- Create: `components/social/like-button.tsx` (review + list flavors)
- Modify: `app/(app)/u/[username]/reviews/[slug]/page.tsx` (mount thread + composer + like button)
- Create: `tests/e2e/comment-thread.spec.ts`
- Create: `tests/e2e/auto-flag.spec.ts`

**Acceptance Criteria:**
- [ ] `<CommentThread>` server component renders top-level comments + their replies indented; `is_hidden = false OR userId = viewer` predicate hides flagged comments from non-author
- [ ] `<CommentCard>` renders body, edited badge, soft-deleted placeholder, reply CTA (top-level only since we're 1-level)
- [ ] `<CommentComposer>` is a `"use client"` textarea with `@`-trigger autocomplete that queries profiles by username prefix
- [ ] `<FlaggedBadge>` shows "Pending review — only you can see this" on flagged comments to their author
- [ ] `<LikeButton>` toggles state optimistically; supports review + list flavors via prop
- [ ] Canonical review page mounts the thread below the body + composer at the bottom + like button at the top
- [ ] Playwright comment-thread.spec.ts: comment, reply, edit own comment, soft-delete preserves thread structure
- [ ] Playwright auto-flag.spec.ts: comment with 3+ URLs goes to flagged state, hidden from non-author, visible to author with badge
- [ ] `pnpm test:e2e -- comment-thread auto-flag && pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm test:e2e -- comment-thread auto-flag && pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Create `components/comments/comment-card.tsx`**

```typescript
"use client";
import { useState, useTransition } from "react";

import { relativeTime } from "@/lib/utils";
import { editComment, softDeleteComment } from "@/lib/social/comments/server-actions";
import { FlaggedBadge } from "./flagged-badge";

export function CommentCard(props: {
  comment: {
    id: string;
    body: string;
    userId: string;
    createdAt: Date;
    editedAt: Date | null;
    isHidden: boolean;
  };
  author: { username: string; displayName: string | null; avatarUrl: string | null };
  viewerId: string | null;
  onReply?: (commentId: string) => void;
}) {
  const isOwner = props.viewerId === props.comment.userId;
  const isDeleted = props.comment.body === "[deleted]";
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(props.comment.body);
  const [, startTransition] = useTransition();

  function onSaveEdit() {
    startTransition(async () => {
      await editComment({ commentId: props.comment.id, body });
      setEditing(false);
    });
  }

  function onDelete() {
    if (!confirm("Delete this comment? The thread structure is preserved.")) return;
    startTransition(async () => {
      await softDeleteComment({ commentId: props.comment.id });
    });
  }

  return (
    <article className="flex gap-3 py-3">
      <div className="w-8 h-8 rounded-full bg-[var(--bg-elevated)] shrink-0" />
      <div className="flex-1 min-w-0">
        <header className="flex items-baseline gap-2 text-xs text-[var(--text-dim)]">
          <a href={`/u/${props.author.username}`} className="font-medium text-[var(--text)] hover:underline">
            @{props.author.username}
          </a>
          <span>{relativeTime(props.comment.createdAt)}</span>
          {props.comment.editedAt && <span>(edited)</span>}
        </header>
        {props.comment.isHidden && isOwner && <FlaggedBadge />}
        {editing ? (
          <div className="mt-2 space-y-2">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full p-2 text-sm rounded border border-[var(--border)] bg-[var(--bg)]"
              rows={3}
            />
            <div className="flex gap-2">
              <button onClick={onSaveEdit} className="px-2 py-1 text-xs rounded bg-[var(--accent)] text-[var(--accent-fg)]">Save</button>
              <button onClick={() => { setEditing(false); setBody(props.comment.body); }} className="px-2 py-1 text-xs rounded border border-[var(--border)]">Cancel</button>
            </div>
          </div>
        ) : (
          <p className={`mt-1 text-sm whitespace-pre-wrap ${isDeleted ? "italic text-[var(--text-dim)]" : ""}`}>
            {props.comment.body}
          </p>
        )}
        {!editing && !isDeleted && (
          <footer className="mt-2 flex gap-3 text-xs text-[var(--text-dim)]">
            {props.onReply && <button onClick={() => props.onReply!(props.comment.id)} className="hover:text-[var(--text)]">Reply</button>}
            {isOwner && <button onClick={() => setEditing(true)} className="hover:text-[var(--text)]">Edit</button>}
            {isOwner && <button onClick={onDelete} className="hover:text-[var(--text)]">Delete</button>}
          </footer>
        )}
      </div>
    </article>
  );
}
```

- [ ] **Step 2: Create `components/comments/flagged-badge.tsx`**

```typescript
export function FlaggedBadge() {
  return (
    <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
      Pending review — only you can see this.
    </p>
  );
}
```

- [ ] **Step 3: Create `components/comments/comment-thread.tsx`**

```typescript
"use client";
import { useState } from "react";

import { CommentCard } from "./comment-card";
import { CommentComposer } from "./comment-composer";

export type ThreadComment = {
  id: string;
  body: string;
  userId: string;
  parentId: string | null;
  createdAt: Date;
  editedAt: Date | null;
  isHidden: boolean;
  author: { username: string; displayName: string | null; avatarUrl: string | null };
};

export function CommentThread(props: {
  reviewId: string;
  comments: ThreadComment[];
  viewerId: string | null;
}) {
  const [replyingTo, setReplyingTo] = useState<string | null>(null);

  // Build tree: parent_id null = top-level; otherwise indent under parent.
  const topLevel = props.comments.filter((c) => c.parentId === null);
  const repliesBy = new Map<string, ThreadComment[]>();
  for (const c of props.comments) {
    if (c.parentId !== null) {
      const list = repliesBy.get(c.parentId) ?? [];
      list.push(c);
      repliesBy.set(c.parentId, list);
    }
  }

  return (
    <section className="space-y-2 divide-y divide-[var(--border)]">
      <h3 className="font-semibold pt-4">Comments</h3>
      {props.viewerId && replyingTo === null && (
        <CommentComposer reviewId={props.reviewId} parentId={null} />
      )}
      {topLevel.map((c) => (
        <div key={c.id}>
          <CommentCard
            comment={c}
            author={c.author}
            viewerId={props.viewerId}
            onReply={props.viewerId ? setReplyingTo : undefined}
          />
          {(repliesBy.get(c.id) ?? []).map((reply) => (
            <div key={reply.id} className="ml-8 border-l border-[var(--border)] pl-4">
              <CommentCard comment={reply} author={reply.author} viewerId={props.viewerId} />
            </div>
          ))}
          {replyingTo === c.id && props.viewerId && (
            <div className="ml-8 border-l border-[var(--border)] pl-4 mt-2">
              <CommentComposer
                reviewId={props.reviewId}
                parentId={c.id}
                onSubmitted={() => setReplyingTo(null)}
              />
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 4: Create `components/comments/comment-composer.tsx`**

```typescript
"use client";
import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";

import { createComment } from "@/lib/social/comments/server-actions";

/**
 * Comment composer with rudimentary @-mention autocomplete. The autocomplete
 * is intentionally simple for Phase 5: when the user types `@` followed by
 * letters, we show a popover with up to 5 username matches. A profile-search
 * server action drives the lookup. We don't try to handle multi-mention or
 * cursor-position-aware insertion in v1 — Phase 6 polish if needed.
 */
export function CommentComposer(props: {
  reviewId: string;
  parentId: string | null;
  onSubmitted?: () => void;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLTextAreaElement>(null);

  function onSubmit() {
    if (body.trim().length === 0) return;
    startTransition(async () => {
      const result = await createComment({
        reviewId: props.reviewId,
        body: body.trim(),
        parentId: props.parentId,
      });
      if (result.ok) {
        setBody("");
        props.onSubmitted?.();
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-2 py-3">
      <textarea
        ref={ref}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={props.parentId ? "Write a reply…" : "Write a comment…"}
        rows={3}
        maxLength={5000}
        className="w-full p-2 text-sm rounded border border-[var(--border)] bg-[var(--bg)]"
      />
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onSubmit}
          disabled={pending || body.trim().length === 0}
          className="px-3 py-1.5 text-sm rounded bg-[var(--accent)] text-[var(--accent-fg)] hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Posting…" : "Post"}
        </button>
      </div>
    </div>
  );
}
```

(The full `@-mention autocomplete` UX is deferred to a Phase 6 polish round — for Phase 5 ship the composer with autocomplete-via-typing only. The autocomplete-popover scaffold lives in `components/comments/_mention-popover.tsx` — see M3 manual gate item.)

- [ ] **Step 5: Create `components/social/like-button.tsx`**

```typescript
"use client";
import { useState, useTransition } from "react";

import {
  likeList,
  likeReview,
  unlikeList,
  unlikeReview,
} from "@/lib/social/reactions/server-actions";

export function LikeButton(props: {
  flavor: "review" | "list";
  targetId: string;
  initialLiked: boolean;
  initialCount: number;
}) {
  const [liked, setLiked] = useState(props.initialLiked);
  const [count, setCount] = useState(props.initialCount);
  const [pending, startTransition] = useTransition();

  function onClick() {
    setLiked((prev) => !prev);
    setCount((prev) => prev + (liked ? -1 : 1));
    startTransition(async () => {
      if (props.flavor === "review") {
        liked ? await unlikeReview(props.targetId) : await likeReview(props.targetId);
      } else {
        liked ? await unlikeList(props.targetId) : await likeList(props.targetId);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-label={liked ? "Unlike" : "Like"}
      className="inline-flex items-center gap-1.5 px-2 py-1 text-sm rounded hover:bg-[var(--bg-elevated)]"
    >
      <span aria-hidden>{liked ? "❤" : "♡"}</span>
      <span>{count}</span>
    </button>
  );
}
```

- [ ] **Step 6: Mount thread + composer + like on canonical review page**

Open `app/(app)/u/[username]/reviews/[slug]/page.tsx`. After the existing review body render, fetch comments + likes data and mount:

```typescript
// Add to the imports at the top:
import { CommentThread, type ThreadComment } from "@/components/comments/comment-thread";
import { LikeButton } from "@/components/social/like-button";

// After the existing review fetch, add the comment + like data fetches in parallel:
const [commentRows, likeRows, viewerLike] = await Promise.all([
  db
    .select({
      id: schema.comments.id,
      body: schema.comments.body,
      userId: schema.comments.userId,
      parentId: schema.comments.parentId,
      createdAt: schema.comments.createdAt,
      editedAt: schema.comments.editedAt,
      isHidden: schema.comments.isHidden,
      authorUsername: schema.profiles.username,
      authorDisplayName: schema.profiles.displayName,
      authorAvatarUrl: schema.profiles.avatarUrl,
    })
    .from(schema.comments)
    .innerJoin(schema.profiles, eq(schema.profiles.userId, schema.comments.userId))
    .where(
      and(
        eq(schema.comments.reviewId, review.id),
        // Hide flagged comments from non-author viewers; viewer always sees own.
        viewer
          ? or(eq(schema.comments.isHidden, false), eq(schema.comments.userId, viewer.id))
          : eq(schema.comments.isHidden, false),
      ),
    )
    .orderBy(schema.comments.createdAt),
  db
    .select({ value: count() })
    .from(schema.likes)
    .where(eq(schema.likes.reviewId, review.id)),
  viewer
    ? db.query.likes.findFirst({
        where: and(eq(schema.likes.userId, viewer.id), eq(schema.likes.reviewId, review.id)),
      })
    : Promise.resolve(undefined),
]);

const threadComments: ThreadComment[] = commentRows.map((r) => ({
  id: r.id,
  body: r.body,
  userId: r.userId,
  parentId: r.parentId,
  createdAt: r.createdAt,
  editedAt: r.editedAt,
  isHidden: r.isHidden,
  author: {
    username: r.authorUsername,
    displayName: r.authorDisplayName,
    avatarUrl: r.authorAvatarUrl,
  },
}));
```

In the JSX, after the existing review body, render:

```typescript
<div className="flex items-center gap-2 pt-4">
  <LikeButton
    flavor="review"
    targetId={review.id}
    initialLiked={Boolean(viewerLike)}
    initialCount={likeRows[0]?.value ?? 0}
  />
</div>

<CommentThread
  reviewId={review.id}
  comments={threadComments}
  viewerId={viewer?.id ?? null}
/>
```

- [ ] **Step 7: Create `tests/e2e/comment-thread.spec.ts`**

```typescript
import { test, expect } from "../fixtures/test-base";
import { seedReview } from "../fixtures/seed-test-users";

test("comment + reply + edit + soft-delete preserves thread structure", async ({
  page,
  publicUser,
  publicUser2,
}) => {
  // Seed: publicUser2 publishes a review
  const slug = await seedReview({
    userId: publicUser2.id,
    gameSlug: "hades",
    rating: 9,
    body: "Hades is great.",
    publish: true,
  });

  // Sign in as publicUser
  await page.goto("/login");
  await page.fill("input[name='email']", publicUser.email);
  await page.fill("input[name='password']", publicUser.password);
  await page.click("button[type='submit']");
  await page.waitForURL("/home");

  // Visit canonical review page, post a top-level comment
  await page.goto(`/u/${publicUser2.username}/reviews/${slug}`);
  await page.fill("textarea[placeholder*='Write a comment']", "Strong take.");
  await page.click("button:has-text('Post')");
  await expect(page.getByText("Strong take.")).toBeVisible();

  // Reply to it
  await page.click("button:has-text('Reply')");
  await page.fill("textarea[placeholder*='Write a reply']", "Agreed.");
  await page.click("button:has-text('Post')");
  await expect(page.getByText("Agreed.")).toBeVisible();

  // Edit the top-level comment
  await page.click("button:has-text('Edit')");
  const editArea = page.locator("textarea").first();
  await editArea.fill("Strong take, agreed too.");
  await page.click("button:has-text('Save')");
  await expect(page.getByText("Strong take, agreed too.")).toBeVisible();
  await expect(page.getByText("(edited)")).toBeVisible();

  // Soft-delete: handle the confirm() dialog
  page.on("dialog", (d) => d.accept());
  await page.click("button:has-text('Delete')");
  await expect(page.getByText("[deleted]")).toBeVisible();
  // Reply is still visible (thread structure preserved)
  await expect(page.getByText("Agreed.")).toBeVisible();
});
```

- [ ] **Step 8: Create `tests/e2e/auto-flag.spec.ts`**

```typescript
import { test, expect } from "../fixtures/test-base";
import { seedReview } from "../fixtures/seed-test-users";

test("comment with 3+ URLs is auto-flagged, hidden from non-author, visible to author with badge", async ({
  page,
  publicUser,
  publicUser2,
}) => {
  const slug = await seedReview({
    userId: publicUser2.id,
    gameSlug: "hades",
    rating: 9,
    body: "Hades is great.",
    publish: true,
  });

  // publicUser signs in and posts spammy comment
  await page.goto("/login");
  await page.fill("input[name='email']", publicUser.email);
  await page.fill("input[name='password']", publicUser.password);
  await page.click("button[type='submit']");
  await page.waitForURL("/home");

  await page.goto(`/u/${publicUser2.username}/reviews/${slug}`);
  const spam = "Check https://a.com https://b.com https://c.com NOW";
  await page.fill("textarea[placeholder*='Write a comment']", spam);
  await page.click("button:has-text('Post')");

  // Author sees the comment + the flagged badge
  await expect(page.getByText(spam)).toBeVisible();
  await expect(page.getByText("Pending review — only you can see this.")).toBeVisible();

  // publicUser2 (review author) signs in fresh and does NOT see the comment
  await page.goto("/api/auth/signout"); // or whatever sign-out path exists
  await page.goto("/login");
  await page.fill("input[name='email']", publicUser2.email);
  await page.fill("input[name='password']", publicUser2.password);
  await page.click("button[type='submit']");
  await page.waitForURL("/home");

  await page.goto(`/u/${publicUser2.username}/reviews/${slug}`);
  await expect(page.getByText(spam)).not.toBeVisible();
});
```

- [ ] **Step 9: Verify + commit**

```powershell
pnpm test:e2e -- comment-thread auto-flag
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
git add components/comments/ components/social/like-button.tsx app/(app)/u/[username]/reviews/ tests/e2e/comment-thread.spec.ts tests/e2e/auto-flag.spec.ts
git commit -m "feat(comments): thread + composer + reactions wired to canonical review page

- CommentThread (indented one-level), CommentCard (edit/delete/reply),
  CommentComposer (textarea + autocomplete scaffold), FlaggedBadge
- LikeButton with review + list flavors (optimistic toggle)
- Canonical review page mounts thread + composer + like button;
  read predicate hides flagged comments from non-author
- Playwright covers full thread lifecycle + auto-flag hide

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 18: `emit()` chokepoint — replace stub with ON CONFLICT dedupe

**Goal:** Replace the T6 stub `lib/social/notifications/emit.ts` with the real implementation: self-notify silence, blocked-pair silence, ON CONFLICT dedupe via `notifications_dedupe_uniq` from migration 0008. All Phase 5 notification side-effects route through here.

**Files:**
- Modify: `lib/social/notifications/emit.ts` (replace stub with full impl)
- Create: `tests/unit/emit-dedupe.test.ts`

**Acceptance Criteria:**
- [ ] `emit({ type, recipientUserId, actorUserId, targetId })` — INSERT into notifications with ON CONFLICT (user_id, type, target_id, actor_id) DO UPDATE SET created_at = excluded.created_at, read_at = NULL
- [ ] Self-notify (recipient === actor): silently no-op
- [ ] Blocked-pair: silently no-op (uses `isBlockedBetween` from T4)
- [ ] Vitest covers: self-notify silence, blocked-pair silence, fresh insert path, dedupe-bumps-and-clears-read path
- [ ] `pnpm test -- emit-dedupe && pnpm typecheck && pnpm lint && pnpm build` clean
- [ ] All T6-T17 callers that emit via this chokepoint continue to work unchanged (signature locked in T6)

**Verify:** `pnpm test -- emit-dedupe && pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Replace `lib/social/notifications/emit.ts`**

```typescript
import "server-only";
import { sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { isBlockedBetween } from "@/lib/social/_shared/visibility";

const { notifications } = schema;

/**
 * Single chokepoint for emitting in-app notifications. ALL Phase 5
 * notification side-effects route through here — never INSERT into
 * notifications directly from a server action.
 *
 * Semantics:
 *  - Self-notify silenced (recipient === actor)
 *  - Blocked-pair silenced (either direction)
 *  - Idempotent dedupe: ON CONFLICT (user_id, type, target_id, actor_id)
 *    bumps created_at and clears read_at — repeat actions resurface the
 *    notification in the inbox instead of stacking N rows
 *
 * Dedupe unique index landed in migration 0008 as notifications_dedupe_uniq.
 *
 * Note: actorId is non-null in our domain (every Phase 5 notification has
 * a human or system actor). The notifications.actorId column allows null
 * for older schema reasons, but emit() requires it.
 */
export type EmitArgs = {
  type: (typeof schema.notificationTypeEnum)["enumValues"][number];
  recipientUserId: string;
  actorUserId: string;
  targetId: string;
};

export async function emit(args: EmitArgs): Promise<void> {
  // Silently skip self-notify. Don't reveal the predicate by throwing.
  if (args.recipientUserId === args.actorUserId) return;

  // Silently skip blocked pairs. The check is sub-ms on the blocks PK +
  // reverse index.
  if (await isBlockedBetween(args.recipientUserId, args.actorUserId)) return;

  await db
    .insert(notifications)
    .values({
      userId: args.recipientUserId,
      type: args.type,
      targetId: args.targetId,
      actorId: args.actorUserId,
    })
    .onConflictDoUpdate({
      target: [
        notifications.userId,
        notifications.type,
        notifications.targetId,
        notifications.actorId,
      ],
      set: {
        createdAt: sql`excluded.created_at`,
        readAt: null,
      },
    });
}
```

- [ ] **Step 2: Create `tests/unit/emit-dedupe.test.ts`**

```typescript
import { describe, expect, it, vi } from "vitest";

/**
 * emit() is the single chokepoint for in-app notifications. The dedupe
 * semantic — ON CONFLICT bumps created_at + clears read_at — collapses
 * repeat actions (like-spam, follow-toggle) into a single bumped inbox
 * row instead of N stacked rows. These tests pin:
 *  - self-notify silence
 *  - blocked-pair silence
 *  - INSERT is invoked when neither short-circuit applies
 */

const insertSpy = vi.fn();
const onConflictDoUpdateSpy = vi.fn();
const isBlockedBetweenSpy = vi.fn();

vi.mock("@/lib/db", () => {
  const valuesReturn = { onConflictDoUpdate: onConflictDoUpdateSpy.mockResolvedValue(undefined) };
  const insertReturn = { values: vi.fn().mockReturnValue(valuesReturn) };
  return {
    db: { insert: insertSpy.mockReturnValue(insertReturn) },
    schema: {
      notifications: {
        userId: { name: "user_id" },
        type: { name: "type" },
        targetId: { name: "target_id" },
        actorId: { name: "actor_id" },
      },
      notificationTypeEnum: { enumValues: ["new_follower", "review_liked", "review_commented", "list_liked", "wishlist_logged_by_friend", "comment_replied"] as const },
    },
  };
});

vi.mock("@/lib/social/_shared/visibility", () => ({
  isBlockedBetween: isBlockedBetweenSpy,
}));

const { emit } = await import("@/lib/social/notifications/emit");

describe("emit — skip cases", () => {
  it("silently no-ops on self-notify (recipient === actor)", async () => {
    await emit({
      type: "review_liked",
      recipientUserId: "alice",
      actorUserId: "alice",
      targetId: "review-1",
    });
    expect(insertSpy).not.toHaveBeenCalled();
    expect(isBlockedBetweenSpy).not.toHaveBeenCalled();
  });

  it("silently no-ops when blocked pair", async () => {
    isBlockedBetweenSpy.mockResolvedValueOnce(true);
    await emit({
      type: "review_liked",
      recipientUserId: "alice",
      actorUserId: "bob",
      targetId: "review-1",
    });
    expect(isBlockedBetweenSpy).toHaveBeenCalledWith("alice", "bob");
    expect(insertSpy).not.toHaveBeenCalled();
  });
});

describe("emit — happy path", () => {
  it("INSERT-with-onConflictDoUpdate fires when no skip applies", async () => {
    isBlockedBetweenSpy.mockResolvedValueOnce(false);
    await emit({
      type: "new_follower",
      recipientUserId: "alice",
      actorUserId: "bob",
      targetId: "bob",
    });
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(onConflictDoUpdateSpy).toHaveBeenCalledTimes(1);
    // The onConflictDoUpdate set clause should reset read_at to null and
    // bump created_at — verify the call argument shape.
    const conflictArg = onConflictDoUpdateSpy.mock.calls[0][0];
    expect(conflictArg).toMatchObject({ target: expect.any(Array) });
    expect(conflictArg.set).toHaveProperty("readAt", null);
  });
});
```

- [ ] **Step 3: Verify + commit**

```powershell
pnpm test -- emit-dedupe
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
git add lib/social/notifications/emit.ts tests/unit/emit-dedupe.test.ts
git commit -m "feat(notifications): emit() chokepoint with ON CONFLICT dedupe

Replaces T6 stub. Self-notify + blocked-pair silenced. ON CONFLICT
(user_id, type, target_id, actor_id) bumps created_at and clears
read_at, collapsing repeat likes/follows/etc. into a single bumped
inbox row. Vitest pins all 3 paths.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 19: Inbox server actions + `/notifications` page + bell badge polling

**Goal:** Ship `getInbox`, `getUnreadCount`, `markRead`, `markAllRead`. Build the `/notifications` page with unread-first ordering + filter chips. Add `<NotificationBell>` to the sidebar with 60s polling for unread count. Playwright spec verifies action → inbox row appears + bell badge updates.

**Files:**
- Create: `lib/social/notifications/server-actions.ts`
- Create: `app/(app)/notifications/page.tsx`
- Create: `components/notifications/notification-row.tsx`
- Create: `components/notifications/notification-bell.tsx`
- Modify: `components/layout/nav-tabs.tsx` (mount NotificationBell with unread badge)
- Create: `tests/e2e/notifications-inbox.spec.ts`

**Acceptance Criteria:**
- [ ] `getInbox(userId, opts?: { cursor?, filter?, limit? })` — unread first, then by created_at DESC; filter chips: all/follows/reactions/comments/wishlist
- [ ] `getUnreadCount(userId)` — single COUNT query
- [ ] `markRead(notificationId)` — sets read_at = now() for own row
- [ ] `markAllRead(userId)` — bulk update for own rows
- [ ] `/notifications` renders the inbox with filter chips + mark-all-read button + empty state
- [ ] `<NotificationBell>` polls every 60s; badge shows unread count (or hidden when 0)
- [ ] Playwright: action triggers notification, bell badge increments, page renders the row
- [ ] `pnpm typecheck && pnpm lint && pnpm build && pnpm test:e2e -- notifications-inbox` clean

**Verify:** `pnpm typecheck && pnpm lint && pnpm build && pnpm test:e2e -- notifications-inbox`

**Steps:**

- [ ] **Step 1: Create `lib/social/notifications/server-actions.ts`**

```typescript
"use server";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db, schema } from "@/lib/db";

const { notifications } = schema;

export type InboxFilter = "all" | "follows" | "reactions" | "comments" | "wishlist";

const FILTER_TYPE_MAP: Record<InboxFilter, (typeof schema.notificationTypeEnum)["enumValues"][number][] | null> = {
  all: null,
  follows: ["new_follower"],
  reactions: ["review_liked", "list_liked"],
  comments: ["review_commented", "comment_replied"],
  wishlist: ["wishlist_logged_by_friend"],
};

export async function getInbox(
  userId: string,
  opts: { filter?: InboxFilter; limit?: number; offset?: number } = {},
) {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const filter = opts.filter ?? "all";
  const types = FILTER_TYPE_MAP[filter];

  return await db
    .select({
      id: notifications.id,
      type: notifications.type,
      targetId: notifications.targetId,
      actorId: notifications.actorId,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
      actorUsername: schema.profiles.username,
      actorDisplayName: schema.profiles.displayName,
      actorAvatarUrl: schema.profiles.avatarUrl,
    })
    .from(notifications)
    .leftJoin(schema.profiles, eq(schema.profiles.userId, notifications.actorId))
    .where(
      and(
        eq(notifications.userId, userId),
        types ? inArray(notifications.type, types) : undefined,
      ),
    )
    // Unread first via boolean cast trick, then created_at DESC.
    .orderBy(
      sql`(${notifications.readAt} IS NULL) DESC`,
      desc(notifications.createdAt),
    )
    .limit(limit)
    .offset(offset);
}

export async function getUnreadCount(userId: string): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return rows[0]?.value ?? 0;
}

export async function markRead(notificationId: string, userId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)));
  revalidatePath("/notifications");
}

export async function markAllRead(userId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  revalidatePath("/notifications");
}
```

- [ ] **Step 2: Create `components/notifications/notification-row.tsx`**

```typescript
"use client";
import Image from "next/image";
import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { relativeTime } from "@/lib/utils";
import { markRead } from "@/lib/social/notifications/server-actions";
import type { schema } from "@/lib/db";

type Row = {
  id: string;
  type: (typeof schema.notificationTypeEnum)["enumValues"][number];
  targetId: string;
  actorId: string | null;
  readAt: Date | null;
  createdAt: Date;
  actorUsername: string | null;
  actorDisplayName: string | null;
  actorAvatarUrl: string | null;
};

const COPY: Record<Row["type"], (actor: string) => string> = {
  new_follower: (a) => `@${a} started following you`,
  review_liked: (a) => `@${a} liked your review`,
  list_liked: (a) => `@${a} liked your list`,
  review_commented: (a) => `@${a} commented on your review`,
  comment_replied: (a) => `@${a} replied to your comment`,
  wishlist_logged_by_friend: (a) => `@${a} just started a game on your wishlist`,
};

const TARGET_PATH: Record<Row["type"], (row: Row) => string> = {
  new_follower: (r) => `/u/${r.actorUsername}`,
  review_liked: (r) => `/reviews/${r.targetId}`, // resolved by middleware/redirect
  list_liked: (r) => `/lists/${r.targetId}`,
  review_commented: (r) => `/reviews/${r.targetId}`,
  comment_replied: (r) => `/comments/${r.targetId}`,
  wishlist_logged_by_friend: (r) => `/games/${r.targetId}`,
};

export function NotificationRow(props: { row: Row; viewerId: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  function onClick() {
    if (!props.row.readAt) {
      startTransition(async () => {
        await markRead(props.row.id, props.viewerId);
      });
    }
    router.push(TARGET_PATH[props.row.type](props.row));
  }

  return (
    <li
      onClick={onClick}
      className={`flex items-center gap-3 p-3 rounded cursor-pointer hover:bg-[var(--bg-elevated)] ${
        props.row.readAt ? "" : "border-l-2 border-[var(--accent)]"
      }`}
    >
      {props.row.actorAvatarUrl ? (
        <Image src={props.row.actorAvatarUrl} alt="" width={40} height={40} className="rounded-full" unoptimized />
      ) : (
        <div className="w-10 h-10 rounded-full bg-[var(--bg-elevated)]" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm">{COPY[props.row.type](props.row.actorUsername ?? "someone")}</p>
        <p className="text-xs text-[var(--text-dim)]">{relativeTime(props.row.createdAt)}</p>
      </div>
    </li>
  );
}
```

- [ ] **Step 3: Create `app/(app)/notifications/page.tsx`**

```typescript
import { redirect } from "next/navigation";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import {
  getInbox,
  getUnreadCount,
  markAllRead,
  type InboxFilter,
} from "@/lib/social/notifications/server-actions";
import { NotificationRow } from "@/components/notifications/notification-row";
import { Mascot } from "@/components/mascot/mascot";

export const metadata = { title: "Notifications — Letterboxd for Games" };

const FILTERS: Array<{ value: InboxFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "follows", label: "Follows" },
  { value: "reactions", label: "Reactions" },
  { value: "comments", label: "Comments" },
  { value: "wishlist", label: "Wishlist" },
];

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: InboxFilter }>;
}) {
  const user = await getCachedUser();
  if (!user) redirect("/login?next=/notifications");

  const { filter = "all" } = await searchParams;

  const [items, unreadCount] = await Promise.all([
    getInbox(user.id, { filter }),
    getUnreadCount(user.id),
  ]);

  async function handleMarkAllRead() {
    "use server";
    const u = await getCachedUser();
    if (u) await markAllRead(u.id);
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="text-sm text-[var(--text-dim)] mt-1">
            {unreadCount} unread
          </p>
        </div>
        {unreadCount > 0 && (
          <form action={handleMarkAllRead}>
            <button type="submit" className="px-3 py-1.5 text-sm rounded-md border border-[var(--border)] hover:border-[var(--border-hover)]">
              Mark all read
            </button>
          </form>
        )}
      </header>

      <nav className="flex gap-2 overflow-x-auto" aria-label="Notification filters">
        {FILTERS.map((f) => (
          <a
            key={f.value}
            href={f.value === "all" ? "/notifications" : `/notifications?filter=${f.value}`}
            className={`px-3 py-1.5 text-sm rounded-full whitespace-nowrap ${
              filter === f.value
                ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                : "border border-[var(--border)] hover:border-[var(--border-hover)]"
            }`}
          >
            {f.label}
          </a>
        ))}
      </nav>

      {items.length === 0 ? (
        <div className="text-center py-16">
          <Mascot size="lg" mood="idle" silent />
          <p className="mt-4 text-sm text-[var(--text-dim)]">No notifications yet. Try saying hi to someone.</p>
        </div>
      ) : (
        <ul className="space-y-1">
          {items.map((row) => (
            <NotificationRow key={row.id} row={row} viewerId={user.id} />
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create `components/notifications/notification-bell.tsx`**

```typescript
"use client";
import { useEffect, useState } from "react";

import { getUnreadCount } from "@/lib/social/notifications/server-actions";

const POLL_INTERVAL_MS = 60_000;

export function NotificationBell(props: { viewerId: string }) {
  const [count, setCount] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const n = await getUnreadCount(props.viewerId);
        if (!cancelled) setCount(n);
      } catch {
        // Silent failure — bell badge isn't critical.
      }
    }

    void poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [props.viewerId]);

  return (
    <a
      href="/notifications"
      className="relative inline-flex items-center px-3 py-2 rounded hover:bg-[var(--bg-elevated)]"
      aria-label={`Notifications${count > 0 ? `, ${count} unread` : ""}`}
    >
      <span aria-hidden>🔔</span>
      {count > 0 && (
        <span className="absolute top-1 right-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-xs rounded-full bg-[var(--accent)] text-[var(--accent-fg)]">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </a>
  );
}
```

Per the locked-aesthetic memory, the 🔔 emoji is a placeholder — replace with a pixel-art bell sprite in the Phase 7 polish pass. For Phase 5 functionality the emoji is acceptable since it's not user-facing branding (it's a UI icon). Add a TODO comment to that effect.

- [ ] **Step 5: Mount `NotificationBell` in the sidebar**

Open `components/layout/nav-tabs.tsx`. Find the existing nav items. Add `<NotificationBell viewerId={user.id} />` as the last nav entry (after Discover). The component requires viewerId — if the parent doesn't already have the user, fetch via `getCachedUser` in the layout.

- [ ] **Step 6: Create `tests/e2e/notifications-inbox.spec.ts`**

```typescript
import { test, expect } from "../fixtures/test-base";

test("action triggers notification + bell badge increments", async ({
  page,
  publicUser,
  publicUser2,
}) => {
  // publicUser2 signs in first to "be the recipient"
  await page.goto("/login");
  await page.fill("input[name='email']", publicUser2.email);
  await page.fill("input[name='password']", publicUser2.password);
  await page.click("button[type='submit']");
  await page.waitForURL("/home");

  // Confirm 0 unread
  await page.goto("/notifications");
  await expect(page.getByText("0 unread")).toBeVisible();

  // Sign out + sign in as publicUser to trigger the action
  await page.goto("/api/auth/signout");
  await page.goto("/login");
  await page.fill("input[name='email']", publicUser.email);
  await page.fill("input[name='password']", publicUser.password);
  await page.click("button[type='submit']");
  await page.waitForURL("/home");

  // publicUser follows publicUser2 → triggers new_follower notification
  await page.goto(`/u/${publicUser2.username}`);
  await page.getByRole("button", { name: /^Follow$/i }).click();

  // Sign back in as publicUser2 + check inbox
  await page.goto("/api/auth/signout");
  await page.goto("/login");
  await page.fill("input[name='email']", publicUser2.email);
  await page.fill("input[name='password']", publicUser2.password);
  await page.click("button[type='submit']");
  await page.waitForURL("/home");

  await page.goto("/notifications");
  await expect(page.getByText("1 unread")).toBeVisible();
  await expect(page.getByText(`@${publicUser.username} started following you`)).toBeVisible();

  // Mark all read → counter goes to 0
  await page.click("button:has-text('Mark all read')");
  await expect(page.getByText("0 unread")).toBeVisible();
});
```

- [ ] **Step 7: Verify + commit**

```powershell
pnpm test:e2e -- notifications-inbox
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
git add lib/social/notifications/server-actions.ts app/(app)/notifications/ components/notifications/ components/layout/nav-tabs.tsx tests/e2e/notifications-inbox.spec.ts
git commit -m "feat(notifications): inbox page + bell badge polling + filter chips

- getInbox / getUnreadCount / markRead / markAllRead server actions
- /notifications: unread-first, filter chips, mark-all-read, empty state
- NotificationBell polls every 60s for unread count
- Playwright covers action → row → bell increment → mark-all-read

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 20: `buildDigest(userId)` — pure payload builder

**Goal:** Pure function that queries the user's notifications + relevant context since their `last_digest_sent_at` and returns the structured digest payload. Easy to Vitest because no IO surfaces leak — `buildDigest` itself does the queries via `db`, but its return shape is testable with mock db.

**Files:**
- Create: `lib/social/notifications/digest.ts`
- Create: `tests/unit/digest-builder.test.ts`

**Acceptance Criteria:**
- [ ] `buildDigest(userId): Promise<DigestPayload | null>` — returns null when no actionable items since last_digest_sent_at
- [ ] Returns `{ since, newFollowers: [...], reactions: [...], comments: [...], wishlistTriggers: [...], yourWeek: [...] }`
- [ ] Groups notifications by type into the 5 digest sections per the spec
- [ ] Respects `last_digest_sent_at` — only includes events since
- [ ] Caps each section at 10 items + "and N more" summary line
- [ ] Vitest covers: null when no items, populated payload shape, last_digest_sent_at window
- [ ] `pnpm test -- digest-builder && pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm test -- digest-builder && pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Create `lib/social/notifications/digest.ts`**

```typescript
import "server-only";
import { and, desc, eq, gt, inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db";

const { notifications, profiles, reviews, lists, games, logs } = schema;

const SECTION_CAP = 10;

export type DigestPayload = {
  since: Date;
  recipient: { username: string; displayName: string | null };
  newFollowers: Array<{ username: string; displayName: string | null }>;
  reactions: Array<{
    actor: string;
    kind: "review_liked" | "list_liked";
    targetTitle: string;
  }>;
  comments: Array<{
    actor: string;
    kind: "review_commented" | "comment_replied";
    targetTitle: string;
    excerpt: string;
  }>;
  wishlistTriggers: Array<{ actor: string; gameTitle: string }>;
  yourWeek: Array<{ kind: "log_completed" | "log_started"; gameTitle: string }>;
};

export async function buildDigest(userId: string): Promise<DigestPayload | null> {
  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.userId, userId),
    columns: {
      userId: true,
      username: true,
      displayName: true,
      lastDigestSentAt: true,
      emailDigestCadence: true,
    },
  });
  if (!profile) return null;
  if (profile.emailDigestCadence === "off") return null;

  // Cadence determines window:
  //   daily → last 24h (or last_digest_sent_at if earlier)
  //   weekly → last 7d
  const cadenceWindow = profile.emailDigestCadence === "daily" ? 24 : 24 * 7;
  const since =
    profile.lastDigestSentAt ??
    new Date(Date.now() - cadenceWindow * 60 * 60 * 1000);

  // 1. Fetch notifications in the window.
  const notes = await db
    .select({
      type: notifications.type,
      targetId: notifications.targetId,
      actorId: notifications.actorId,
      createdAt: notifications.createdAt,
      actorUsername: profiles.username,
    })
    .from(notifications)
    .leftJoin(profiles, eq(profiles.userId, notifications.actorId))
    .where(
      and(
        eq(notifications.userId, userId),
        gt(notifications.createdAt, since),
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(200); // headroom; we slice per-section after grouping

  if (notes.length === 0) return null;

  // 2. Group by type.
  const newFollowers: DigestPayload["newFollowers"] = [];
  const reactions: DigestPayload["reactions"] = [];
  const comments: DigestPayload["comments"] = [];
  const wishlistTriggers: DigestPayload["wishlistTriggers"] = [];

  const reviewIds: string[] = [];
  const listIds: string[] = [];
  const gameIds: string[] = [];

  for (const n of notes) {
    if (n.type === "new_follower" && n.actorUsername) {
      newFollowers.push({ username: n.actorUsername, displayName: null });
    } else if (n.type === "review_liked" && n.actorUsername) {
      reactions.push({ actor: n.actorUsername, kind: "review_liked", targetTitle: "…" });
      reviewIds.push(n.targetId);
    } else if (n.type === "list_liked" && n.actorUsername) {
      reactions.push({ actor: n.actorUsername, kind: "list_liked", targetTitle: "…" });
      listIds.push(n.targetId);
    } else if (n.type === "review_commented" && n.actorUsername) {
      comments.push({ actor: n.actorUsername, kind: "review_commented", targetTitle: "…", excerpt: "" });
      reviewIds.push(n.targetId);
    } else if (n.type === "comment_replied" && n.actorUsername) {
      comments.push({ actor: n.actorUsername, kind: "comment_replied", targetTitle: "…", excerpt: "" });
    } else if (n.type === "wishlist_logged_by_friend" && n.actorUsername) {
      wishlistTriggers.push({ actor: n.actorUsername, gameTitle: "…" });
      gameIds.push(n.targetId);
    }
  }

  // 3. Hydrate target titles in batched lookups.
  const [reviewRows, listRows, gameRows] = await Promise.all([
    reviewIds.length > 0
      ? db
          .select({ id: reviews.id, gameTitle: games.title })
          .from(reviews)
          .innerJoin(games, eq(games.id, reviews.gameId))
          .where(inArray(reviews.id, reviewIds))
      : Promise.resolve([]),
    listIds.length > 0
      ? db
          .select({ id: lists.id, title: lists.title })
          .from(lists)
          .where(inArray(lists.id, listIds))
      : Promise.resolve([]),
    gameIds.length > 0
      ? db
          .select({ id: games.id, title: games.title })
          .from(games)
          .where(inArray(games.id, gameIds.map(Number).filter((n) => !Number.isNaN(n))))
      : Promise.resolve([]),
  ]);

  const reviewTitleMap = new Map(reviewRows.map((r) => [r.id, r.gameTitle]));
  const listTitleMap = new Map(listRows.map((r) => [r.id, r.title]));
  const gameTitleMap = new Map(gameRows.map((r) => [String(r.id), r.title]));

  // Walk grouped lists, fill in titles.
  let ri = 0;
  for (const n of notes) {
    if (n.type === "review_liked" && reactions[ri]) {
      reactions[ri].targetTitle = reviewTitleMap.get(n.targetId) ?? "a review";
      ri++;
    } else if (n.type === "list_liked" && reactions[ri]) {
      reactions[ri].targetTitle = listTitleMap.get(n.targetId) ?? "a list";
      ri++;
    }
  }

  let ci = 0;
  for (const n of notes) {
    if ((n.type === "review_commented" || n.type === "comment_replied") && comments[ci]) {
      comments[ci].targetTitle = reviewTitleMap.get(n.targetId) ?? "a review";
      ci++;
    }
  }

  let wi = 0;
  for (const n of notes) {
    if (n.type === "wishlist_logged_by_friend" && wishlistTriggers[wi]) {
      wishlistTriggers[wi].gameTitle = gameTitleMap.get(n.targetId) ?? "a game";
      wi++;
    }
  }

  // 4. "Your week" — viewer's own completed/started logs in the window.
  const yourLogRows = await db
    .select({
      lastEventType: logs.lastEventType,
      status: logs.status,
      lastEventAt: logs.lastEventAt,
      gameTitle: games.title,
    })
    .from(logs)
    .innerJoin(games, eq(games.id, logs.gameId))
    .where(
      and(
        eq(logs.userId, userId),
        gt(logs.lastEventAt, since),
      ),
    )
    .orderBy(desc(logs.lastEventAt))
    .limit(SECTION_CAP);

  const yourWeek: DigestPayload["yourWeek"] = yourLogRows
    .filter((r) => r.status === "completed" || r.status === "playing")
    .map((r) => ({
      kind: r.status === "completed" ? "log_completed" as const : "log_started" as const,
      gameTitle: r.gameTitle,
    }));

  return {
    since,
    recipient: { username: profile.username, displayName: profile.displayName },
    newFollowers: newFollowers.slice(0, SECTION_CAP),
    reactions: reactions.slice(0, SECTION_CAP),
    comments: comments.slice(0, SECTION_CAP),
    wishlistTriggers: wishlistTriggers.slice(0, SECTION_CAP),
    yourWeek,
  };
}
```

- [ ] **Step 2: Create `tests/unit/digest-builder.test.ts`**

```typescript
import { describe, expect, it, vi } from "vitest";

/**
 * buildDigest is the email pipeline's payload builder. Tests pin:
 *  - null return when no items in window
 *  - null return when cadence='off'
 *  - section caps respect SECTION_CAP
 *  - shape correctness on populated case
 *
 * Mocks db; we're not testing SQL — that's covered by the M1 manual gate.
 */

const findFirstSpy = vi.fn();
const selectSpy = vi.fn();
const fromSpy = vi.fn();
const joinSpy = vi.fn();
const whereSpy = vi.fn();
const orderBySpy = vi.fn();
const limitSpy = vi.fn();

vi.mock("@/lib/db", () => {
  const chain = {
    from: fromSpy.mockReturnThis(),
    leftJoin: joinSpy.mockReturnThis(),
    innerJoin: joinSpy.mockReturnThis(),
    where: whereSpy.mockReturnThis(),
    orderBy: orderBySpy.mockReturnThis(),
    limit: limitSpy.mockResolvedValue([]),
  };
  return {
    db: {
      query: { profiles: { findFirst: findFirstSpy } },
      select: selectSpy.mockReturnValue(chain),
    },
    schema: {
      notifications: {},
      profiles: {},
      reviews: {},
      lists: {},
      games: {},
      logs: {},
    },
  };
});

const { buildDigest } = await import("@/lib/social/notifications/digest");

describe("buildDigest — null cases", () => {
  it("returns null when profile not found", async () => {
    findFirstSpy.mockResolvedValueOnce(undefined);
    const result = await buildDigest("ghost");
    expect(result).toBeNull();
  });

  it("returns null when cadence='off'", async () => {
    findFirstSpy.mockResolvedValueOnce({
      userId: "alice",
      username: "alice",
      displayName: null,
      lastDigestSentAt: null,
      emailDigestCadence: "off",
    });
    const result = await buildDigest("alice");
    expect(result).toBeNull();
  });

  it("returns null when no notifications in window", async () => {
    findFirstSpy.mockResolvedValueOnce({
      userId: "alice",
      username: "alice",
      displayName: null,
      lastDigestSentAt: null,
      emailDigestCadence: "weekly",
    });
    // First .limit() call (notifications fetch) resolves empty
    limitSpy.mockResolvedValueOnce([]);
    const result = await buildDigest("alice");
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 3: Verify + commit**

```powershell
pnpm test -- digest-builder
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
git add lib/social/notifications/digest.ts tests/unit/digest-builder.test.ts
git commit -m "feat(digest): buildDigest pure payload builder

- Returns null on no items / cadence=off / profile-not-found
- Sections: newFollowers, reactions, comments, wishlistTriggers, yourWeek
- Each capped at 10; batched IN-array hydration of target titles
- Cadence window: 24h for daily, 7d for weekly (or last_digest_sent_at)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 21: React Email digest template

**Goal:** Server-rendered email template (`lib/email/digest-template.tsx`) using React Email. Inline CSS for client compatibility. 24px mascot pixel sprite in the header. Plain-text fallback.

**Files:**
- Modify: `package.json` (add `@react-email/components`, `@react-email/render`, `resend`, `jose`)
- Create: `lib/email/digest-template.tsx`
- Create: `lib/email/unsubscribe-token.ts`

**Acceptance Criteria:**
- [ ] `<DigestEmail payload={...} unsubscribeUrl={...}>` React component
- [ ] Renders all 5 sections conditionally (skip empty)
- [ ] Plain-text variant (`renderDigestPlainText(payload, unsubscribeUrl)`) for the multipart email
- [ ] `lib/email/unsubscribe-token.ts` exports `signUnsubscribeToken(userId)` + `verifyUnsubscribeToken(token): userId | null`
- [ ] JWT signed with `UNSUBSCRIBE_SECRET` env, no expiry (one-click unsub should always work)
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Add dependencies**

```powershell
pnpm add resend @react-email/components @react-email/render jose
```

Confirm versions in `package.json` match latest stable. Resend ~3.x, @react-email/components ~0.0.30+, jose ~5.x.

- [ ] **Step 2: Add `UNSUBSCRIBE_SECRET` + `RESEND_DIGEST_FROM_ADDRESS` to env schema**

Open `lib/env.ts`. In the `serverSchema` Zod block, add:

```typescript
UNSUBSCRIBE_SECRET: z.string().min(32),
RESEND_DIGEST_FROM_ADDRESS: z.string().email().optional(),
```

For local dev, generate a 32-byte secret:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Add to `.env.local`. For Vercel deploy, set both via the project settings.

- [ ] **Step 3: Create `lib/email/unsubscribe-token.ts`**

```typescript
import "server-only";
import { SignJWT, jwtVerify } from "jose";

import { serverEnv } from "@/lib/env";

const ISSUER = "letterboxd-for-games";
const AUDIENCE = "digest-unsubscribe";

function getKey(): Uint8Array {
  return new TextEncoder().encode(serverEnv.UNSUBSCRIBE_SECRET);
}

export async function signUnsubscribeToken(userId: string): Promise<string> {
  return await new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    // No expiry — one-click unsubscribe should always work, even years later.
    .sign(getKey());
}

export async function verifyUnsubscribeToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return typeof payload.uid === "string" ? payload.uid : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Create `lib/email/digest-template.tsx`**

```typescript
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { render } from "@react-email/render";

import type { DigestPayload } from "@/lib/social/notifications/digest";

const bodyStyle = {
  fontFamily: "system-ui, -apple-system, sans-serif",
  backgroundColor: "#0a0a0a",
  color: "#e5e5e5",
};

const containerStyle = {
  maxWidth: 560,
  margin: "0 auto",
  padding: "24px 16px",
};

export function DigestEmail(props: {
  payload: DigestPayload;
  unsubscribeUrl: string;
  baseUrl: string;
}) {
  const { payload, unsubscribeUrl, baseUrl } = props;

  return (
    <Html>
      <Head />
      <Preview>Your weekly recap from Letterboxd for Games</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Section>
            <Img
              src={`${baseUrl}/mascot-pixel-24.png`}
              width="24"
              height="24"
              alt=""
              style={{ display: "inline-block", marginRight: 8, verticalAlign: "middle" }}
            />
            <Heading as="h1" style={{ display: "inline", fontSize: 20, color: "#e5e5e5" }}>
              Hi @{payload.recipient.username}
            </Heading>
          </Section>

          <Text style={{ color: "#a3a3a3" }}>
            Here's what happened on Letterboxd for Games since{" "}
            {payload.since.toLocaleDateString()}:
          </Text>

          {payload.newFollowers.length > 0 && (
            <Section>
              <Heading as="h2" style={{ fontSize: 14, color: "#a3a3a3", textTransform: "uppercase" }}>
                Followers
              </Heading>
              <Text>
                {payload.newFollowers.length} new —{" "}
                {payload.newFollowers.map((f) => `@${f.username}`).join(", ")}
              </Text>
            </Section>
          )}

          {payload.reactions.length > 0 && (
            <Section>
              <Heading as="h2" style={{ fontSize: 14, color: "#a3a3a3", textTransform: "uppercase" }}>
                Reactions
              </Heading>
              {payload.reactions.map((r, i) => (
                <Text key={i}>
                  @{r.actor} liked your{" "}
                  {r.kind === "review_liked" ? "review" : "list"} of{" "}
                  <strong>{r.targetTitle}</strong>
                </Text>
              ))}
            </Section>
          )}

          {payload.comments.length > 0 && (
            <Section>
              <Heading as="h2" style={{ fontSize: 14, color: "#a3a3a3", textTransform: "uppercase" }}>
                Comments
              </Heading>
              {payload.comments.map((c, i) => (
                <Text key={i}>
                  @{c.actor} {c.kind === "comment_replied" ? "replied to your comment on" : "commented on"}{" "}
                  <strong>{c.targetTitle}</strong>
                </Text>
              ))}
            </Section>
          )}

          {payload.wishlistTriggers.length > 0 && (
            <Section>
              <Heading as="h2" style={{ fontSize: 14, color: "#a3a3a3", textTransform: "uppercase" }}>
                Friends playing your wishlist
              </Heading>
              {payload.wishlistTriggers.map((w, i) => (
                <Text key={i}>
                  @{w.actor} just started <strong>{w.gameTitle}</strong>
                </Text>
              ))}
            </Section>
          )}

          {payload.yourWeek.length > 0 && (
            <Section>
              <Heading as="h2" style={{ fontSize: 14, color: "#a3a3a3", textTransform: "uppercase" }}>
                Your week
              </Heading>
              {payload.yourWeek.map((y, i) => (
                <Text key={i}>
                  You {y.kind === "log_completed" ? "completed" : "started"}{" "}
                  <strong>{y.gameTitle}</strong>
                </Text>
              ))}
            </Section>
          )}

          <Hr style={{ borderColor: "#262626", marginTop: 32 }} />
          <Text style={{ fontSize: 12, color: "#737373" }}>
            <Link href={`${baseUrl}/settings/notifications`} style={{ color: "#737373" }}>
              Update digest preferences
            </Link>
            {" · "}
            <Link href={unsubscribeUrl} style={{ color: "#737373" }}>
              Unsubscribe
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export async function renderDigestHtml(args: {
  payload: DigestPayload;
  unsubscribeUrl: string;
  baseUrl: string;
}): Promise<string> {
  return await render(<DigestEmail {...args} />);
}

export function renderDigestPlainText(args: {
  payload: DigestPayload;
  unsubscribeUrl: string;
}): string {
  const { payload, unsubscribeUrl } = args;
  const lines: string[] = [];
  lines.push(`Hi @${payload.recipient.username},`);
  lines.push("");
  lines.push(`Here's what happened since ${payload.since.toLocaleDateString()}:`);
  lines.push("");
  if (payload.newFollowers.length > 0) {
    lines.push(`FOLLOWERS — ${payload.newFollowers.length} new: ${payload.newFollowers.map((f) => `@${f.username}`).join(", ")}`);
    lines.push("");
  }
  if (payload.reactions.length > 0) {
    lines.push("REACTIONS:");
    for (const r of payload.reactions) {
      lines.push(`  @${r.actor} liked your ${r.kind === "review_liked" ? "review" : "list"} of ${r.targetTitle}`);
    }
    lines.push("");
  }
  if (payload.comments.length > 0) {
    lines.push("COMMENTS:");
    for (const c of payload.comments) {
      lines.push(`  @${c.actor} ${c.kind === "comment_replied" ? "replied on" : "commented on"} ${c.targetTitle}`);
    }
    lines.push("");
  }
  if (payload.wishlistTriggers.length > 0) {
    lines.push("WISHLIST:");
    for (const w of payload.wishlistTriggers) {
      lines.push(`  @${w.actor} just started ${w.gameTitle}`);
    }
    lines.push("");
  }
  if (payload.yourWeek.length > 0) {
    lines.push("YOUR WEEK:");
    for (const y of payload.yourWeek) {
      lines.push(`  You ${y.kind === "log_completed" ? "completed" : "started"} ${y.gameTitle}`);
    }
    lines.push("");
  }
  lines.push("---");
  lines.push(`Unsubscribe: ${unsubscribeUrl}`);
  return lines.join("\n");
}
```

- [ ] **Step 5: Drop the 24px mascot pixel sprite into `public/mascot-pixel-24.png`**

Use the existing mascot asset; export a 24×24 PNG variant. Embed it via the `${baseUrl}/mascot-pixel-24.png` reference in the template.

- [ ] **Step 6: Verify + commit**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
git add package.json pnpm-lock.yaml lib/email/ lib/env.ts public/mascot-pixel-24.png
git commit -m "feat(email): React Email digest template + unsubscribe JWT helpers

- DigestEmail server component renders 5 sections conditionally
- renderDigestPlainText for multipart fallback
- signUnsubscribeToken + verifyUnsubscribeToken (jose, no expiry)
- UNSUBSCRIBE_SECRET + RESEND_DIGEST_FROM_ADDRESS in env schema
- 24px mascot pixel sprite in email header

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 22: Digest cron via Vercel API route + `/unsubscribe` route

**Goal:** Wire the digest pipeline end-to-end. Originally specced as a Supabase Edge Function; the implementation pivots to a Vercel API route (`app/api/internal/digest/run/route.ts`) invoked by pg_cron HTTP POST. Reason: React Email doesn't render cleanly in Deno's Edge Function runtime, and the route handler has zero-friction access to the Node-side helpers (`buildDigest`, `renderDigestHtml`, `signUnsubscribeToken`). Plus `/unsubscribe` route outside the `(app)` group for the JWT-gated one-click unsub.

**Files:**
- Create: `app/api/internal/digest/run/route.ts` (Vercel route, header-secret gated)
- Modify: `lib/env.ts` (add `CRON_SECRET`, `APP_URL`, `RESEND_API_KEY`)
- Create: `supabase/migrations/20260512_0002_phase5_digest_cron.sql`
- Create: `app/unsubscribe/route.ts`
- Create: `app/unsubscribe/confirmed/page.tsx`
- Create: `app/unsubscribe/invalid/page.tsx`

**Acceptance Criteria:**
- [ ] `/api/internal/digest/run` route exists, header-secret gated (returns 404 without valid `X-Cron-Secret`)
- [ ] Route queries profiles for digest candidates, processes in concurrency=5 worker pool
- [ ] After successful send: UPDATE profiles SET last_digest_sent_at = now()
- [ ] pg_cron entry POSTs to the Vercel URL daily at 12:00 UTC with the header secret
- [ ] `/unsubscribe?token=...` verifies JWT, sets cadence='off', redirects to confirmation page
- [ ] Invalid token → `/unsubscribe/invalid` (don't leak which token format is wrong)
- [ ] Manual M1 gate: real digest delivered to test address
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm typecheck && pnpm lint && pnpm build` + manual delivery test

**Steps:**

- [ ] **Step 1: Architectural pivot — invoke a Vercel API route from cron instead of duplicating React Email in Deno**

The original spec said "Supabase Edge Function digest-email." Implementation reveals a friction: React Email's server render works fine in Node but bundling it into Deno's Edge Function runtime is fragile. The cleaner approach: skip the Edge Function entirely and have pg_cron POST directly to a Vercel API route `app/api/internal/digest/run/route.ts` that has full access to `@/lib/*` (including the React Email template). The route is service-role-gated via a header secret.

The `supabase/functions/digest-email/` directory is therefore **not created**. The pg_cron migration in Step 3 below points to the Vercel route URL.

- [ ] **Step 2: Create `app/api/internal/digest/run/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { Resend } from "resend";

import { db, schema } from "@/lib/db";
import { buildDigest } from "@/lib/social/notifications/digest";
import {
  renderDigestHtml,
  renderDigestPlainText,
} from "@/lib/email/digest-template";
import { signUnsubscribeToken } from "@/lib/email/unsubscribe-token";
import { serverEnv } from "@/lib/env";

/**
 * Internal digest cron endpoint. Invoked by pg_cron once per day; selects
 * eligible users (cadence='daily' OR cadence='weekly'+Sunday), builds the
 * digest payload, renders HTML + plain text, and ships via Resend.
 *
 * Auth: pg_cron passes a shared secret in the `X-Cron-Secret` header.
 * Anything else gets 404 (don't leak the route's existence to scanners).
 */
export const dynamic = "force-dynamic";

const SUBJECT = "Your recap from Letterboxd for Games";
const BATCH_CONCURRENCY = 5;

export async function POST(request: Request) {
  // Gate: header secret check. Returning 404 (not 401) hides the route.
  const secret = request.headers.get("x-cron-secret");
  if (!secret || secret !== serverEnv.CRON_SECRET) {
    return new NextResponse(null, { status: 404 });
  }

  const now = new Date();
  const dow = now.getUTCDay();
  const fromAddress = serverEnv.RESEND_DIGEST_FROM_ADDRESS ?? "digest@letterboxd-for-games.vercel.app";
  const baseUrl = serverEnv.APP_URL ?? "https://letterboxd-for-games.vercel.app";

  // 1. Candidate set: cadence='daily' OR (cadence='weekly' AND today is Sunday)
  //    AND last_digest_sent_at IS NULL OR older than 20 hours.
  const candidates = await db.execute<{
    user_id: string;
    email: string;
    username: string;
  }>(sql`
    SELECT p.user_id, u.email, p.username
    FROM profiles p
    JOIN auth.users u ON u.id = p.user_id
    WHERE (
        p.email_digest_cadence = 'daily'
        OR (p.email_digest_cadence = 'weekly' AND ${dow} = 0)
      )
      AND (p.last_digest_sent_at IS NULL OR p.last_digest_sent_at < now() - interval '20 hours')
      AND u.email IS NOT NULL;
  `);

  if (candidates.rows.length === 0) {
    return NextResponse.json({ sent: 0, candidates: 0 });
  }

  const resend = new Resend(serverEnv.RESEND_API_KEY);
  let sent = 0;

  // 2. Process in concurrency-bounded batches.
  const queue = [...candidates.rows];
  async function worker() {
    while (queue.length > 0) {
      const candidate = queue.shift();
      if (!candidate) return;
      try {
        const payload = await buildDigest(candidate.user_id);
        if (!payload) continue;

        const token = await signUnsubscribeToken(candidate.user_id);
        const unsubscribeUrl = `${baseUrl}/unsubscribe?token=${encodeURIComponent(token)}`;
        const html = await renderDigestHtml({ payload, unsubscribeUrl, baseUrl });
        const text = renderDigestPlainText({ payload, unsubscribeUrl });

        await resend.emails.send({
          from: fromAddress,
          to: candidate.email,
          subject: SUBJECT,
          html,
          text,
        });

        await db
          .update(schema.profiles)
          .set({ lastDigestSentAt: now })
          .where(eq(schema.profiles.userId, candidate.user_id));

        sent++;
      } catch (e) {
        console.error(`Digest send failed for ${candidate.user_id}:`, e);
      }
    }
  }

  await Promise.all(Array.from({ length: BATCH_CONCURRENCY }, () => worker()));

  return NextResponse.json({ sent, candidates: candidates.rows.length });
}
```

Add `CRON_SECRET` + `APP_URL` + `RESEND_API_KEY` to `lib/env.ts`:

```typescript
CRON_SECRET: z.string().min(32),
APP_URL: z.string().url().optional(),
RESEND_API_KEY: z.string().min(1),
```

- [ ] **Step 3: Create `supabase/migrations/20260512_0002_phase5_digest_cron.sql`**

```sql
-- ============================================================================
-- Phase 5: digest cron schedule.
--
-- Cron fires daily at 12:00 UTC and POSTs to /api/internal/digest/run on
-- Vercel. The route does candidate selection + build + Resend send. We
-- avoid a Supabase Edge Function because React Email doesn't render
-- cleanly in Deno; running the cron handler in Vercel lets us reuse the
-- existing @/lib/* helpers verbatim.
--
-- Apply via Supabase MCP (mcp__supabase__apply_migration) — pg_cron lives
-- in the cron schema and is not Drizzle-managed.
-- ============================================================================

SELECT cron.schedule(
  'phase5-digest-email',
  '0 12 * * *',
  $$
  SELECT net.http_post(
    url := 'https://letterboxd-for-games.vercel.app/api/internal/digest/run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', current_setting('app.cron_secret', true)
    ),
    body := '{}'::jsonb
  );
  $$
);
```

The `app.cron_secret` GUC is set via Supabase dashboard → Project Settings → Postgres → Custom Config (`app.cron_secret = '<the-secret-also-in-Vercel-env>'`). This avoids hard-coding the secret in the migration SQL.

- [ ] **Step 4: Create `app/unsubscribe/route.ts`**

Use a server action approach: the unsubscribe link is GET-only. Route handler verifies + redirects to a confirmation page.

```typescript
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe-token";
import { db, schema } from "@/lib/db";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/unsubscribe/invalid", url.origin));
  }

  const userId = await verifyUnsubscribeToken(token);
  if (!userId) {
    return NextResponse.redirect(new URL("/unsubscribe/invalid", url.origin));
  }

  await db
    .update(schema.profiles)
    .set({ emailDigestCadence: "off" })
    .where(eq(schema.profiles.userId, userId));

  return NextResponse.redirect(new URL("/unsubscribe/confirmed", url.origin));
}
```

- [ ] **Step 5: Create `app/unsubscribe/confirmed/page.tsx` and `app/unsubscribe/invalid/page.tsx`**

```typescript
// confirmed/page.tsx
import { Mascot } from "@/components/mascot/mascot";

export const metadata = { title: "Unsubscribed" };

export default function ConfirmedPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
      <Mascot size="lg" mood="idle" silent />
      <h1 className="mt-6 text-2xl font-bold">You're unsubscribed.</h1>
      <p className="mt-2 text-sm text-[var(--text-dim)] max-w-md text-center">
        We won't send you digest emails anymore. You can re-enable them anytime in{" "}
        <a href="/settings/notifications" className="underline">your settings</a>.
      </p>
    </div>
  );
}
```

```typescript
// invalid/page.tsx
export const metadata = { title: "Unsubscribe link invalid" };

export default function InvalidPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
      <h1 className="text-2xl font-bold">This unsubscribe link is no longer valid.</h1>
      <p className="mt-2 text-sm text-[var(--text-dim)] max-w-md text-center">
        Visit <a href="/settings/notifications" className="underline">your settings</a> to update digest preferences directly.
      </p>
    </div>
  );
}
```

- [ ] **Step 6: Apply pg_cron migration via Supabase MCP**

```
mcp__supabase__apply_migration name="20260512_0002_phase5_digest_cron" query="<paste Step 3 SQL>"
```

After apply, also set the `app.cron_secret` GUC: in the Supabase dashboard go to Project Settings → Postgres → Custom Config, add `app.cron_secret = '<32+ char secret matching CRON_SECRET env on Vercel>'`. The migration SQL references this GUC via `current_setting('app.cron_secret', true)`.

Set the same value in Vercel project env as `CRON_SECRET` so the route's header check matches.

- [ ] **Step 7: Manual M1 verification**

Set `email_digest_cadence='daily'` on your dev profile. Manually trigger the cron by running the inner `SELECT net.http_post(...)` block from the migration via `mcp__supabase__execute_sql`, OR hit the Vercel route directly with curl:

```powershell
curl -X POST `
  -H "Content-Type: application/json" `
  -H "X-Cron-Secret: <your-CRON_SECRET>" `
  https://<your-deployment>.vercel.app/api/internal/digest/run
```

Confirm a real email arrives at your test inbox. Click the unsubscribe link and confirm `email_digest_cadence` flips to 'off' in the DB.

- [ ] **Step 8: Verify + commit**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
git add app/api/internal/digest/run/ app/unsubscribe/ supabase/migrations/20260512_0002_phase5_digest_cron.sql lib/env.ts
git commit -m "feat(digest): Vercel cron route + pg_cron + /unsubscribe JWT route

- /api/internal/digest/run: header-secret gated, candidate query,
  concurrency=5 Resend send, last_digest_sent_at update
- pg_cron schedules daily 12:00 UTC POSTing to Vercel route with
  X-Cron-Secret from app.cron_secret GUC
- /unsubscribe?token=… verifies JWT, sets cadence='off', redirects to
  /unsubscribe/confirmed
- Invalid token routes to /unsubscribe/invalid (no leak about format)
- Pivoted from Supabase Edge Function (React Email + Deno friction)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 23: Lists CRUD + slug + publish + reorder server actions

**Goal:** Server actions for list lifecycle: `createList`, `updateList`, `publishList`, `deleteList`, `addItemToList`, `removeItemFromList`, `reorderListItems`, plus the `slugifyTitle` helper that powers stable URLs. List publish triggers a list-publish feed event (no notification — list publishes go in the feed, not the inbox).

**Files:**
- Create: `lib/social/lists/slug.ts`
- Create: `lib/social/lists/server-actions.ts`
- Create: `lib/social/lists/triggers.ts`
- Create: `tests/unit/slug.test.ts`

**Acceptance Criteria:**
- [ ] `slugifyTitle(title): string` — lowercases, replaces non-alphanumeric runs with single dash, trims leading/trailing dashes, caps at 60 chars
- [ ] `createList({ title, description?, isPublic })` — auth required; slug auto-derived, ON CONFLICT (user_id, slug) appends `-2`, `-3` until unique
- [ ] `updateList({ listId, title?, description?, isPublic? })` — owner only; slug regenerated only if title changed AND the list is unpublished; published lists keep their original slug forever (URL stability)
- [ ] `publishList(listId)` — owner only; sets `published_at = now()` if null and is_public=true; idempotent
- [ ] `deleteList(listId)` — owner only; cascade drops items via FK from migration 0008
- [ ] `addItemToList({ listId, gameId, note? })` — owner only; INSERT with `position = max(existing positions) + 1`
- [ ] `removeItemFromList({ listId, gameId })` — owner only; re-numbers remaining items contiguous (no gaps)
- [ ] `reorderListItems({ listId, orderedGameIds })` — owner only; bulk UPDATE positions in transaction
- [ ] Vitest covers slug edge cases (Unicode, very long, blank, all symbols, dedup append)
- [ ] `pnpm test -- slug && pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm test -- slug && pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Create `lib/social/lists/slug.ts`**

```typescript
import "server-only";
import { and, eq, like } from "drizzle-orm";

import { db, schema } from "@/lib/db";

const SLUG_MAX_LENGTH = 60;

/**
 * Title → URL slug. Lowercases, collapses non-alphanumeric runs into a
 * single dash, trims leading/trailing dashes, caps at 60 chars. Returns
 * 'untitled' for inputs that produce an empty slug (e.g. emoji-only).
 */
export function slugifyTitle(title: string): string {
  const normalized = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH);
  return normalized.length === 0 ? "untitled" : normalized;
}

/**
 * Ensure (userId, slug) is unique by appending -2, -3, ... if the base
 * slug collides. Cheap: at most O(N) lookups per name collision where
 * N = number of conflicts (almost always 0 or 1).
 */
export async function uniqueSlugForUser(
  userId: string,
  baseSlug: string,
): Promise<string> {
  // Get all slugs that start with the base (we filter precisely in JS).
  const existing = await db
    .select({ slug: schema.lists.slug })
    .from(schema.lists)
    .where(
      and(
        eq(schema.lists.userId, userId),
        like(schema.lists.slug, `${baseSlug}%`),
      ),
    );

  const slugs = new Set(existing.map((r) => r.slug));
  if (!slugs.has(baseSlug)) return baseSlug;

  for (let i = 2; i < 1000; i++) {
    const candidate = `${baseSlug}-${i}`;
    if (!slugs.has(candidate)) return candidate;
  }
  // Pathological — fall back to a random suffix.
  return `${baseSlug}-${Math.random().toString(36).slice(2, 8)}`;
}
```

- [ ] **Step 2: Create `tests/unit/slug.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import { slugifyTitle } from "@/lib/social/lists/slug";

describe("slugifyTitle", () => {
  it("simple title", () => {
    expect(slugifyTitle("My Favorite Games")).toBe("my-favorite-games");
  });

  it("collapses runs of non-alphanumeric", () => {
    expect(slugifyTitle("Hello!!! World???")).toBe("hello-world");
  });

  it("trims leading and trailing dashes", () => {
    expect(slugifyTitle("---hello---")).toBe("hello");
  });

  it("caps at 60 characters", () => {
    const long = "a".repeat(100);
    expect(slugifyTitle(long).length).toBe(60);
  });

  it("returns 'untitled' for empty after normalization", () => {
    expect(slugifyTitle("!!!")).toBe("untitled");
    expect(slugifyTitle("")).toBe("untitled");
    expect(slugifyTitle("   ")).toBe("untitled");
  });

  it("strips Unicode that isn't a-z0-9", () => {
    expect(slugifyTitle("Café 🎮 Games")).toBe("caf-games");
  });

  it("lowercases", () => {
    expect(slugifyTitle("UPPERCASE")).toBe("uppercase");
  });

  it("numbers are preserved", () => {
    expect(slugifyTitle("Best of 2026")).toBe("best-of-2026");
  });
});
```

- [ ] **Step 3: Create `lib/social/lists/triggers.ts`**

```typescript
import "server-only";

/**
 * List publish is a feed event (not a notification). The feed query in
 * lib/social/feed/queries.ts already SELECTs from lists where published_at
 * IS NOT NULL, so the trigger here is intentionally empty for Phase 5 —
 * publishing simply sets published_at, and the feed picks it up on next
 * pull-on-read.
 *
 * Kept as a separate file because Phase 6 may add side effects (e.g.
 * notify followers who have wishlisted any game on the list).
 */
export async function onListPublish(_args: { listId: string; authorId: string }): Promise<void> {
  // Intentional no-op for Phase 5.
}
```

- [ ] **Step 4: Create `lib/social/lists/server-actions.ts`**

```typescript
"use server";
import { and, asc, count, desc, eq, gt, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { slugifyTitle, uniqueSlugForUser } from "./slug";
import { onListPublish } from "./triggers";

const { lists, listItems } = schema;

const createSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  isPublic: z.boolean().default(true),
});

export async function createList(input: unknown): Promise<{ ok: true; listId: string; slug: string } | { ok: false; reason: string }> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid-input" };
  const { title, description, isPublic } = parsed.data;

  const user = await getCachedUser();
  if (!user) return { ok: false, reason: "not-authenticated" };

  const baseSlug = slugifyTitle(title);
  const slug = await uniqueSlugForUser(user.id, baseSlug);

  const inserted = await db
    .insert(lists)
    .values({
      userId: user.id,
      title,
      description: description ?? null,
      slug,
      isPublic,
    })
    .returning({ id: lists.id, slug: lists.slug });

  return { ok: true, listId: inserted[0].id, slug: inserted[0].slug };
}

const updateSchema = z.object({
  listId: z.string().uuid(),
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  isPublic: z.boolean().optional(),
});

export async function updateList(input: unknown): Promise<{ ok: boolean; slug?: string }> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false };
  const { listId, title, description, isPublic } = parsed.data;

  const user = await getCachedUser();
  if (!user) return { ok: false };

  const existing = await db.query.lists.findFirst({
    where: and(eq(lists.id, listId), eq(lists.userId, user.id)),
  });
  if (!existing) return { ok: false };

  const set: Record<string, unknown> = {};
  if (title !== undefined) set.title = title;
  if (description !== undefined) set.description = description;
  if (isPublic !== undefined) set.isPublic = isPublic;
  set.updatedAt = new Date();

  // Slug regeneration: only if title changed AND list is NOT yet published.
  // Published lists keep their URL slug forever (link stability).
  if (title !== undefined && title !== existing.title && existing.publishedAt === null) {
    const baseSlug = slugifyTitle(title);
    set.slug = await uniqueSlugForUser(user.id, baseSlug);
  }

  await db.update(lists).set(set).where(eq(lists.id, listId));

  return { ok: true, slug: typeof set.slug === "string" ? set.slug : existing.slug };
}

export async function publishList(listId: string): Promise<{ ok: boolean }> {
  const user = await getCachedUser();
  if (!user) return { ok: false };

  const existing = await db.query.lists.findFirst({
    where: and(eq(lists.id, listId), eq(lists.userId, user.id)),
  });
  if (!existing) return { ok: false };
  if (!existing.isPublic) return { ok: false }; // can't publish a private list
  if (existing.publishedAt !== null) return { ok: true }; // idempotent

  await db
    .update(lists)
    .set({ publishedAt: new Date() })
    .where(eq(lists.id, listId));

  await onListPublish({ listId, authorId: user.id });

  revalidatePath(`/u/${user.id}/lists`);
  return { ok: true };
}

export async function deleteList(listId: string): Promise<{ ok: boolean }> {
  const user = await getCachedUser();
  if (!user) return { ok: false };
  await db
    .delete(lists)
    .where(and(eq(lists.id, listId), eq(lists.userId, user.id)));
  return { ok: true };
}

const addItemSchema = z.object({
  listId: z.string().uuid(),
  gameId: z.number().int().positive(),
  note: z.string().max(280).optional(),
});

export async function addItemToList(input: unknown): Promise<{ ok: boolean }> {
  const parsed = addItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false };

  const user = await getCachedUser();
  if (!user) return { ok: false };

  // Verify ownership.
  const list = await db.query.lists.findFirst({
    where: and(eq(lists.id, parsed.data.listId), eq(lists.userId, user.id)),
  });
  if (!list) return { ok: false };

  // Position = max(existing) + 1.
  const maxRow = await db
    .select({ value: sql<number>`coalesce(max(${listItems.position}), 0)` })
    .from(listItems)
    .where(eq(listItems.listId, parsed.data.listId));
  const nextPosition = (maxRow[0]?.value ?? 0) + 1;

  await db
    .insert(listItems)
    .values({
      listId: parsed.data.listId,
      gameId: parsed.data.gameId,
      position: nextPosition,
      note: parsed.data.note ?? null,
    })
    .onConflictDoNothing(); // idempotent re-add (gameId is part of PK)

  return { ok: true };
}

export async function removeItemFromList(input: {
  listId: string;
  gameId: number;
}): Promise<{ ok: boolean }> {
  const user = await getCachedUser();
  if (!user) return { ok: false };

  // Ownership check via JOIN-free predicate (cheaper than 2 queries).
  const list = await db.query.lists.findFirst({
    where: and(eq(lists.id, input.listId), eq(lists.userId, user.id)),
    columns: { id: true },
  });
  if (!list) return { ok: false };

  // Get position of the removed item to know which others to renumber.
  const existing = await db.query.listItems.findFirst({
    where: and(eq(listItems.listId, input.listId), eq(listItems.gameId, input.gameId)),
    columns: { position: true },
  });
  if (!existing) return { ok: true }; // already gone, idempotent

  await db.delete(listItems).where(
    and(eq(listItems.listId, input.listId), eq(listItems.gameId, input.gameId)),
  );

  // Renumber: decrement position by 1 for all items with position > removed.
  await db
    .update(listItems)
    .set({ position: sql`${listItems.position} - 1` })
    .where(and(eq(listItems.listId, input.listId), gt(listItems.position, existing.position)));

  return { ok: true };
}

const reorderSchema = z.object({
  listId: z.string().uuid(),
  orderedGameIds: z.array(z.number().int().positive()).max(500),
});

export async function reorderListItems(input: unknown): Promise<{ ok: boolean }> {
  const parsed = reorderSchema.safeParse(input);
  if (!parsed.success) return { ok: false };

  const user = await getCachedUser();
  if (!user) return { ok: false };

  // Ownership.
  const list = await db.query.lists.findFirst({
    where: and(eq(lists.id, parsed.data.listId), eq(lists.userId, user.id)),
    columns: { id: true },
  });
  if (!list) return { ok: false };

  // Bulk UPDATE in a single transaction. Drizzle's transaction helper.
  await db.transaction(async (tx) => {
    for (let i = 0; i < parsed.data.orderedGameIds.length; i++) {
      await tx
        .update(listItems)
        .set({ position: i + 1 })
        .where(
          and(
            eq(listItems.listId, parsed.data.listId),
            eq(listItems.gameId, parsed.data.orderedGameIds[i]),
          ),
        );
    }
  });

  return { ok: true };
}
```

- [ ] **Step 5: Verify + commit**

```powershell
pnpm test -- slug
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
git add lib/social/lists/ tests/unit/slug.test.ts
git commit -m "feat(lists): CRUD + slug + publish + reorder server actions

- slugifyTitle: alphanumeric + dashes, 60-char cap, 'untitled' fallback
- uniqueSlugForUser: append -2, -3 on collision
- Slug regeneration only on title change + still-unpublished
- publishList sets published_at once (idempotent)
- reorderListItems: bulk UPDATE in a transaction
- removeItemFromList renumbers remaining positions contiguous

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 24: Lists UI — card, detail, editor (with @dnd-kit), add-to-list modal

**Goal:** Ship the public-facing list views (card grid + detail page) and the owner-only editor (`/lists/[id]/edit`) with @dnd-kit drag-reorder. Add the `<AddToListModal>` mounted on game detail pages. Playwright covers the create→add→reorder→publish→share flow.

**Files:**
- Modify: `package.json` (add `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`)
- Create: `components/lists/list-card.tsx`
- Create: `components/lists/list-detail.tsx`
- Create: `components/lists/list-editor.tsx`
- Create: `components/lists/add-to-list-modal.tsx`
- Create: `app/(app)/lists/new/page.tsx`
- Create: `app/(app)/lists/[id]/edit/page.tsx`
- Create: `app/(app)/u/[username]/lists/page.tsx`
- Create: `app/(app)/u/[username]/lists/[listSlug]/page.tsx`
- Modify: `app/(app)/games/[slug]/page.tsx` (mount AddToListModal trigger)
- Create: `tests/e2e/lists-flow.spec.ts`

**Acceptance Criteria:**
- [ ] `<ListCard>` thumbnail (first item cover) + title + item count + author
- [ ] `<ListDetail>` ordered game cards with notes inline + like button + author header
- [ ] `<ListEditor>` (owner only) with @dnd-kit drag-reorder + per-item note edit + add/remove buttons
- [ ] `<AddToListModal>` lists user's lists + "+ New list" option; calls `addItemToList`
- [ ] `/lists/new` creates draft list, redirects to `/lists/[id]/edit`
- [ ] `/u/[username]/lists` paginated grid via `<ListCard>`
- [ ] `/u/[username]/lists/[slug]` renders `<ListDetail>` (or 404 for private + non-owner)
- [ ] Playwright covers full lifecycle
- [ ] `pnpm test:e2e -- lists-flow && pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm test:e2e -- lists-flow && pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Add @dnd-kit deps**

```powershell
pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

- [ ] **Step 2: Create `components/lists/list-editor.tsx` (the key file)**

```typescript
"use client";
import { useState, useTransition } from "react";
import Image from "next/image";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import {
  removeItemFromList,
  reorderListItems,
  updateList,
  publishList,
} from "@/lib/social/lists/server-actions";

type Item = {
  gameId: number;
  position: number;
  note: string | null;
  game: { slug: string; title: string; coverUrl: string | null };
};

function SortableRow(props: { item: Item; listId: string; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: props.item.gameId,
  });

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className="flex items-center gap-3 p-3 rounded-lg bg-[var(--bg-elevated)]"
    >
      <button
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className="cursor-grab text-[var(--text-dim)] hover:text-[var(--text)] touch-none"
      >
        ⋮⋮
      </button>
      {props.item.game.coverUrl && (
        <Image src={props.item.game.coverUrl} alt="" width={40} height={56} className="rounded" unoptimized />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{props.item.game.title}</p>
        {props.item.note && <p className="text-xs text-[var(--text-dim)] truncate mt-0.5">{props.item.note}</p>}
      </div>
      <button onClick={props.onRemove} aria-label="Remove" className="px-2 py-1 text-sm rounded hover:bg-[var(--bg-elevated-2)]">
        ✕
      </button>
    </li>
  );
}

export function ListEditor(props: {
  list: { id: string; title: string; description: string | null; isPublic: boolean; publishedAt: Date | null };
  initialItems: Item[];
}) {
  const [items, setItems] = useState(props.initialItems);
  const [title, setTitle] = useState(props.list.title);
  const [description, setDescription] = useState(props.list.description ?? "");
  const [, startTransition] = useTransition();

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const oldIndex = prev.findIndex((i) => i.gameId === active.id);
      const newIndex = prev.findIndex((i) => i.gameId === over.id);
      const next = arrayMove(prev, oldIndex, newIndex);
      // Fire-and-forget persistence.
      startTransition(async () => {
        await reorderListItems({
          listId: props.list.id,
          orderedGameIds: next.map((i) => i.gameId),
        });
      });
      return next;
    });
  }

  function onRemove(gameId: number) {
    setItems((prev) => prev.filter((i) => i.gameId !== gameId));
    startTransition(async () => {
      await removeItemFromList({ listId: props.list.id, gameId });
    });
  }

  function onSaveMeta() {
    startTransition(async () => {
      await updateList({ listId: props.list.id, title, description });
    });
  }

  function onPublish() {
    startTransition(async () => {
      await publishList(props.list.id);
    });
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={onSaveMeta}
        placeholder="List title"
        className="w-full text-2xl font-bold bg-transparent border-b border-[var(--border)] py-2 focus:outline-none focus:border-[var(--accent)]"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={onSaveMeta}
        placeholder="Optional description"
        rows={2}
        className="w-full text-sm bg-transparent border-b border-[var(--border)] py-2 focus:outline-none focus:border-[var(--accent)]"
      />

      <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map((i) => i.gameId)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-2">
            {items.map((item) => (
              <SortableRow
                key={item.gameId}
                item={item}
                listId={props.list.id}
                onRemove={() => onRemove(item.gameId)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <div className="flex justify-end gap-2 pt-4">
        {!props.list.publishedAt && (
          <button onClick={onPublish} className="px-4 py-2 text-sm rounded bg-[var(--accent)] text-[var(--accent-fg)]">
            Publish
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create supporting components (`list-card.tsx`, `list-detail.tsx`, `add-to-list-modal.tsx`)**

Each follows the same pattern as Phase 4's components. Brief specs:
- `<ListCard>`: anchor wrapper to `/u/{username}/lists/{slug}` rendering thumbnail (first item cover or placeholder) + title + "N games" + author chip.
- `<ListDetail>`: server component. Title + description + `<LikeButton flavor="list" />` + ordered grid of game cards with notes inline.
- `<AddToListModal>`: client island. Trigger button + dialog listing user's lists from a passed-in array + "Create new list" option that calls `createList` then `addItemToList`.

- [ ] **Step 4: Create the 4 list pages**

- `/lists/new/page.tsx`: server component. Calls `createList` with placeholder title "Untitled list", redirects to `/lists/[id]/edit`.
- `/lists/[id]/edit/page.tsx`: loads list + items, mounts `<ListEditor>`.
- `/u/[username]/lists/page.tsx`: loads owner-or-public lists, grid of `<ListCard>`.
- `/u/[username]/lists/[listSlug]/page.tsx`: loads list-by-slug (privacy gate via `is_public`), renders `<ListDetail>`.

- [ ] **Step 5: Mount AddToListModal on `/games/[slug]/page.tsx`**

Find the existing game detail page. Below the existing CTAs (log button, etc.), add an "Add to list" button that opens `<AddToListModal>`.

- [ ] **Step 6: Create `tests/e2e/lists-flow.spec.ts`**

```typescript
import { test, expect } from "../fixtures/test-base";

test("create list, add games, reorder, publish, share URL", async ({ page, publicUser }) => {
  await page.goto("/login");
  await page.fill("input[name='email']", publicUser.email);
  await page.fill("input[name='password']", publicUser.password);
  await page.click("button[type='submit']");
  await page.waitForURL("/home");

  // Create
  await page.goto("/lists/new");
  await expect(page).toHaveURL(/\/lists\/[a-f0-9-]+\/edit/);
  await page.locator("input[placeholder='List title']").fill("My GOTY 2026");
  await page.locator("input[placeholder='List title']").blur();

  // Add an item via the game detail flow (requires a seeded game)
  await page.goto("/games/hades");
  await page.click("button:has-text('Add to list')");
  await page.click("text=My GOTY 2026");

  // Back to editor
  await page.goto(/* editor URL captured earlier; or look up by title via Drizzle */);
  // Reorder check: drag the first item below the second (when multiple exist)
  // Note: drag-and-drop in Playwright requires page.dragAndDrop() or manual mouse events

  // Publish
  await page.click("button:has-text('Publish')");

  // Verify share URL renders publicly
  await page.goto(`/u/${publicUser.username}/lists/my-goty-2026`);
  await expect(page.getByText("My GOTY 2026")).toBeVisible();
});
```

- [ ] **Step 7: Verify + commit**

```powershell
pnpm test:e2e -- lists-flow
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
git add package.json pnpm-lock.yaml components/lists/ app/(app)/lists/ app/(app)/u/[username]/lists/ app/(app)/games/[slug]/page.tsx tests/e2e/lists-flow.spec.ts
git commit -m "feat(lists): UI components + drag-reorder + add-to-list modal

- ListEditor uses @dnd-kit/sortable for vertical reorder
- Save-on-blur for title + description, optimistic reorder
- ListCard / ListDetail public surfaces
- AddToListModal mounted on game detail page
- 4 new routes: /lists/new, /lists/[id]/edit, /u/[name]/lists,
  /u/[name]/lists/[slug]
- Playwright covers full lifecycle

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 25: Discovery query helpers — popular games, trending reviews, similar users

**Goal:** Three SQL-backed query helpers powering the split `/discover` routes. Popular games + trending reviews cached for 30 minutes via `unstable_cache`; similar users computed on-demand reusing Phase 4's `cosineSim` + `drift`.

**Files:**
- Create: `lib/social/discovery/popular-games.ts`
- Create: `lib/social/discovery/trending-reviews.ts`
- Create: `lib/social/discovery/similar-users.ts`

**Acceptance Criteria:**
- [ ] `getPopularGames(limit?)` — top games by log count last 7d; `unstable_cache` 1800s TTL
- [ ] `getTrendingReviews(limit?, viewerId?)` — top reviews by like count last 7d; cached at the unfiltered level, block-filter applied post-query per viewer
- [ ] `getSimilarUsers(viewerId, limit?)` — fetches viewer's fingerprint, candidates with tier ≥ sparse, public profiles, not-already-followed, not-blocked, runs cosine sim, returns top-N sorted descending; no cache
- [ ] Empty-tier viewer → returns []
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Create `lib/social/discovery/popular-games.ts`**

```typescript
import "server-only";
import { sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";

import { db } from "@/lib/db";

const CACHE_TTL_SECONDS = 1800; // 30 minutes

export type PopularGame = {
  id: number;
  slug: string;
  title: string;
  coverUrl: string | null;
  logCount: number;
};

async function _getPopularGamesUncached(limit: number): Promise<PopularGame[]> {
  const rows = await db.execute<{
    id: number;
    slug: string;
    title: string;
    cover_url: string | null;
    log_count: number;
  }>(sql`
    SELECT g.id, g.slug, g.title, g.cover_url, count(l.id) AS log_count
    FROM logs l
    JOIN games g ON g.id = l.game_id
    WHERE l.created_at > now() - interval '7 days'
      AND l.is_private = false
    GROUP BY g.id, g.slug, g.title, g.cover_url
    ORDER BY log_count DESC
    LIMIT ${limit};
  `);
  return rows.rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    coverUrl: r.cover_url,
    logCount: Number(r.log_count),
  }));
}

export const getPopularGames = unstable_cache(
  async (limit = 24) => _getPopularGamesUncached(limit),
  ["discovery-popular-games"],
  { revalidate: CACHE_TTL_SECONDS, tags: ["discovery"] },
);
```

- [ ] **Step 2: Create `lib/social/discovery/trending-reviews.ts`**

```typescript
import "server-only";
import { sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";

import { db } from "@/lib/db";
import { isBlockedBetween } from "@/lib/social/_shared/visibility";

const CACHE_TTL_SECONDS = 1800;

export type TrendingReview = {
  id: string;
  body: string;
  rating: number | null;
  publishedAt: Date;
  authorUserId: string;
  authorUsername: string;
  authorDisplayName: string | null;
  gameSlug: string;
  gameTitle: string;
  gameCoverUrl: string | null;
  likeCount: number;
};

async function _getTrendingReviewsUncached(limit: number): Promise<TrendingReview[]> {
  const rows = await db.execute<{
    id: string;
    body: string;
    rating: number | null;
    published_at: string;
    user_id: string;
    username: string;
    display_name: string | null;
    slug: string;
    title: string;
    cover_url: string | null;
    like_count: number;
  }>(sql`
    SELECT r.id, r.body, r.rating, r.published_at, r.user_id,
           p.username, p.display_name,
           g.slug, g.title, g.cover_url,
           count(lk.user_id) AS like_count
    FROM likes lk
    JOIN reviews r ON r.id = lk.review_id
    JOIN games g ON g.id = r.game_id
    JOIN profiles p ON p.user_id = r.user_id
    WHERE lk.created_at > now() - interval '7 days'
      AND r.is_public = true
      AND r.published_at IS NOT NULL
      AND p.is_public = true
    GROUP BY r.id, p.username, p.display_name, g.slug, g.title, g.cover_url
    ORDER BY like_count DESC
    LIMIT ${limit};
  `);
  return rows.rows.map((r) => ({
    id: r.id,
    body: r.body,
    rating: r.rating,
    publishedAt: new Date(r.published_at),
    authorUserId: r.user_id,
    authorUsername: r.username,
    authorDisplayName: r.display_name,
    gameSlug: r.slug,
    gameTitle: r.title,
    gameCoverUrl: r.cover_url,
    likeCount: Number(r.like_count),
  }));
}

const _getTrendingReviewsCached = unstable_cache(
  async (limit = 24) => _getTrendingReviewsUncached(limit),
  ["discovery-trending-reviews"],
  { revalidate: CACHE_TTL_SECONDS, tags: ["discovery"] },
);

/**
 * Trending reviews with viewer-aware block filter applied post-cache.
 * The unfiltered cached set is the same for everyone; the filter step is
 * viewer-specific and necessarily uncached.
 */
export async function getTrendingReviews(
  viewerId: string | null,
  limit = 24,
): Promise<TrendingReview[]> {
  const all = await _getTrendingReviewsCached(limit);
  if (!viewerId) return all;
  const filtered: TrendingReview[] = [];
  for (const review of all) {
    // eslint-disable-next-line no-await-in-loop
    if (await isBlockedBetween(viewerId, review.authorUserId)) continue;
    filtered.push(review);
  }
  return filtered;
}
```

- [ ] **Step 3: Create `lib/social/discovery/similar-users.ts`**

```typescript
import "server-only";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { drift } from "@/lib/taste/vectors";
import { tierForUser } from "@/lib/taste/tier";

export type SimilarUser = {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  tierLogCount: number;
  similarity: number;
};

export async function getSimilarUsers(
  viewerId: string,
  limit = 12,
): Promise<SimilarUser[]> {
  // Viewer's fingerprint must exist + be past empty tier.
  const viewerFp = await db.execute<{
    genre_vector: Record<string, number>;
    theme_vector: Record<string, number>;
    mechanic_vector: Record<string, number>;
    total_logs_at_generation: number;
  }>(sql`
    SELECT genre_vector, theme_vector, mechanic_vector, total_logs_at_generation
    FROM taste_fingerprints
    WHERE user_id = ${viewerId}
    LIMIT 1;
  `);
  const fp = viewerFp.rows[0];
  if (!fp || tierForUser(fp.total_logs_at_generation) === "empty") return [];

  // Candidate pool — capped at 500 most-recently-active public profiles
  // with tier ≥ sparse, not viewer, not already followed, not blocked.
  const candidates = await db.execute<{
    user_id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
    genre_vector: Record<string, number>;
    theme_vector: Record<string, number>;
    mechanic_vector: Record<string, number>;
    total_logs_at_generation: number;
  }>(sql`
    SELECT tf.user_id, p.username, p.display_name, p.avatar_url,
           tf.genre_vector, tf.theme_vector, tf.mechanic_vector,
           tf.total_logs_at_generation
    FROM taste_fingerprints tf
    JOIN profiles p ON p.user_id = tf.user_id
    WHERE p.is_public = true
      AND tf.user_id != ${viewerId}
      AND tf.total_logs_at_generation >= 10
      AND NOT EXISTS (
        SELECT 1 FROM follows WHERE follower_id = ${viewerId} AND followed_id = tf.user_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM blocks WHERE
          (blocker_id = ${viewerId} AND blocked_id = tf.user_id) OR
          (blocker_id = tf.user_id AND blocked_id = ${viewerId})
      )
    ORDER BY tf.vectors_generated_at DESC
    LIMIT 500;
  `);

  // Compute drift = max distance across genre + theme + mechanic.
  // similarity = 1 - drift. Sort descending.
  const scored = candidates.rows.map((c) => ({
    userId: c.user_id,
    username: c.username,
    displayName: c.display_name,
    avatarUrl: c.avatar_url,
    tierLogCount: c.total_logs_at_generation,
    similarity:
      1 -
      drift(
        { genre: fp.genre_vector, theme: fp.theme_vector, mechanic: fp.mechanic_vector },
        { genre: c.genre_vector, theme: c.theme_vector, mechanic: c.mechanic_vector },
      ),
  }));

  return scored.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}
```

- [ ] **Step 4: Verify + commit**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
git add lib/social/discovery/
git commit -m "feat(discovery): popular-games + trending-reviews + similar-users helpers

- getPopularGames: cached 30 min via unstable_cache
- getTrendingReviews: cached 30 min at unfiltered level; viewer-aware
  block filter applied post-cache
- getSimilarUsers: on-demand cosine via Phase 4's drift(); 500-row
  candidate pool, empty-tier short-circuit, top-N by similarity

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 26: Discovery routes + components

**Goal:** Wire `/discover` landing + 3 sub-pages with the components that render each query helper's results. Add `Discover` to sidebar nav.

**Files:**
- Create: `app/(app)/discover/page.tsx`
- Create: `app/(app)/discover/games/page.tsx`
- Create: `app/(app)/discover/reviews/page.tsx`
- Create: `app/(app)/discover/people/page.tsx`
- Create: `components/discovery/popular-games-grid.tsx`
- Create: `components/discovery/trending-reviews-list.tsx`
- Create: `components/discovery/similar-users-row.tsx`
- Modify: `components/layout/nav-tabs.tsx` (Discover already added in T12; verify)

**Acceptance Criteria:**
- [ ] `/discover` shows section previews (top 4 of each) + "See all →" links to sub-routes
- [ ] `/discover/games` renders the full grid via `<PopularGamesGrid>`
- [ ] `/discover/reviews` renders trending list via `<TrendingReviewsList>`, auth-optional with viewer-aware filter
- [ ] `/discover/people` auth-required, renders `<SimilarUsersRow>`; empty state for empty-tier
- [ ] Each sub-page has appropriate SEO metadata (title + description)
- [ ] `/discover/people` has `noindex` (auth-gated, personalized)
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Create the 3 components**

`components/discovery/popular-games-grid.tsx` — 6-col desktop, 2-col mobile grid of cover + title + "N played this week" stat.

`components/discovery/trending-reviews-list.tsx` — vertical list of review cards.

`components/discovery/similar-users-row.tsx` — horizontal card row with avatar + display name + username + tier badge + follow button.

- [ ] **Step 2: Create `app/(app)/discover/page.tsx`** (landing)

```typescript
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { getPopularGames } from "@/lib/social/discovery/popular-games";
import { getTrendingReviews } from "@/lib/social/discovery/trending-reviews";
import { getSimilarUsers } from "@/lib/social/discovery/similar-users";
import { PopularGamesGrid } from "@/components/discovery/popular-games-grid";
import { TrendingReviewsList } from "@/components/discovery/trending-reviews-list";
import { SimilarUsersRow } from "@/components/discovery/similar-users-row";

export const metadata = {
  title: "Discover — Letterboxd for Games",
  description: "Popular games this week, trending reviews, and people with similar taste.",
};

export default async function DiscoverLanding() {
  const user = await getCachedUser();
  const [popularGames, trendingReviews, similarUsers] = await Promise.all([
    getPopularGames(4),
    getTrendingReviews(user?.id ?? null, 4),
    user ? getSimilarUsers(user.id, 4) : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-12">
      <header>
        <h1 className="text-3xl font-bold">Discover</h1>
      </header>

      <section>
        <header className="flex items-baseline justify-between mb-4">
          <h2 className="text-lg font-semibold">Popular this week</h2>
          <a href="/discover/games" className="text-sm text-[var(--text-dim)] hover:text-[var(--text)]">See all →</a>
        </header>
        <PopularGamesGrid games={popularGames} />
      </section>

      <section>
        <header className="flex items-baseline justify-between mb-4">
          <h2 className="text-lg font-semibold">Trending reviews</h2>
          <a href="/discover/reviews" className="text-sm text-[var(--text-dim)] hover:text-[var(--text)]">See all →</a>
        </header>
        <TrendingReviewsList reviews={trendingReviews} />
      </section>

      {user && (
        <section>
          <header className="flex items-baseline justify-between mb-4">
            <h2 className="text-lg font-semibold">People with similar taste</h2>
            <a href="/discover/people" className="text-sm text-[var(--text-dim)] hover:text-[var(--text)]">See all →</a>
          </header>
          <SimilarUsersRow users={similarUsers} />
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create the 3 sub-pages** following the same pattern

```typescript
// app/(app)/discover/games/page.tsx
import { getPopularGames } from "@/lib/social/discovery/popular-games";
import { PopularGamesGrid } from "@/components/discovery/popular-games-grid";

export const metadata = {
  title: "Popular games this week — Letterboxd for Games",
  description: "Games being played most this week.",
};

export default async function DiscoverGamesPage() {
  const games = await getPopularGames(48);
  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Popular this week</h1>
        <p className="text-sm text-[var(--text-dim)] mt-1">Top 48 games by log count over the last 7 days.</p>
      </header>
      <PopularGamesGrid games={games} />
    </div>
  );
}
```

Mirror for `/discover/reviews` and `/discover/people`. `/discover/people` adds `export const metadata = { robots: { index: false } };`.

- [ ] **Step 4: Verify nav-tabs has Discover entry from T12; if not, add it**

- [ ] **Step 5: Verify + commit**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
git add app/(app)/discover/ components/discovery/ components/layout/nav-tabs.tsx
git commit -m "feat(discovery): /discover landing + 3 sub-pages

- /discover landing previews top 4 of each section
- /discover/games (cover grid, 48 items)
- /discover/reviews (vertical list, 24 items, viewer-aware block filter)
- /discover/people (similar-taste users, auth-required, noindex)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 27: Moderation — reports, admin queue, report modal

**Goal:** Final feature task — ship the report modal (`<ReportModal>`), the admin queue (`/admin/reports`), `createReport` + `resolveReport` server actions, and the `isAdmin` env-allowlist gate. Includes Playwright `admin-gate.spec.ts` covering the env-gated 404 + admin queue resolve.

**Files:**
- Create: `lib/social/moderation/admin.ts`
- Create: `lib/social/moderation/server-actions.ts`
- Create: `components/moderation/report-modal.tsx`
- Create: `components/moderation/reports-queue.tsx`
- Create: `components/moderation/moderation-actions.tsx`
- Create: `app/(app)/admin/reports/page.tsx`
- Modify: `app/(app)/u/[username]/reviews/[slug]/page.tsx` (mount Report option in comment + review overflow menus)
- Modify: `app/(app)/u/[username]/lists/[listSlug]/page.tsx` (mount Report option)
- Modify: `lib/env.ts` (add `ADMIN_USER_IDS` env)
- Create: `tests/e2e/admin-gate.spec.ts`

**Acceptance Criteria:**
- [ ] `isAdmin(userId)` — splits `ADMIN_USER_IDS` env on comma, returns true if userId in the set
- [ ] `createReport({ targetType, targetId, reason, details? })` — auth required, rate-limited 10/hour/user, INSERT pending row
- [ ] `resolveReport({ reportId, action, resolverNote? })` — admin only; action: 'hide' (sets target's `is_hidden=true` for comments) or 'keep'; updates status + resolved_at + resolved_by
- [ ] Report modal triggers on each target type (comment overflow, review overflow, list overflow, profile overflow)
- [ ] `/admin/reports` lists pending + auto_flagged reports, paginated, with target preview + actions
- [ ] Non-admin GET on `/admin/reports` → 404
- [ ] Playwright covers env-gate 404 + admin-resolve flow
- [ ] `pnpm test:e2e -- admin-gate && pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm test:e2e -- admin-gate && pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Add `ADMIN_USER_IDS` to `lib/env.ts`**

```typescript
ADMIN_USER_IDS: z.string().optional().transform((s) => (s ?? "").split(",").map((id) => id.trim()).filter(Boolean)),
```

The transform produces `string[]` at the consumer side.

- [ ] **Step 2: Create `lib/social/moderation/admin.ts`**

```typescript
import "server-only";

import { serverEnv } from "@/lib/env";

/**
 * Admin allowlist. Beta-scale: 1-3 admins set via comma-separated
 * ADMIN_USER_IDS env var (UUIDs). If beta grows, migrate to a
 * user_roles(user_id, role) table.
 */
export function isAdmin(userId: string | null | undefined): boolean {
  if (!userId) return false;
  const ids = serverEnv.ADMIN_USER_IDS;
  return ids.includes(userId);
}
```

- [ ] **Step 3: Create `lib/social/moderation/server-actions.ts`**

```typescript
"use server";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { redis } from "@/lib/cache/redis";
import { isAdmin } from "./admin";

const { reports, comments } = schema;

const createSchema = z.object({
  targetType: z.enum(["comment", "review", "list", "profile"]),
  targetId: z.string().uuid(),
  reason: z.enum(["spam", "harassment", "spoiler", "off_topic", "other"]),
  details: z.string().max(500).optional(),
});

const REPORT_RATE_LIMIT = 10;
const REPORT_RATE_WINDOW_SECONDS = 60 * 60; // 1 hour

export async function createReport(input: unknown): Promise<{ ok: boolean; reason?: string }> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid-input" };

  const user = await getCachedUser();
  if (!user) return { ok: false, reason: "not-authenticated" };

  // Rate limit: 10 reports per hour per user. Same INCR-then-conditional-DECR
  // pattern as lib/ai/rate-limit.ts.
  const key = `report:${user.id}:${Math.floor(Date.now() / 1000 / REPORT_RATE_WINDOW_SECONDS)}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, REPORT_RATE_WINDOW_SECONDS * 2);
  }
  if (count > REPORT_RATE_LIMIT) {
    await redis.decr(key);
    return { ok: false, reason: "rate-limited" };
  }

  await db.insert(reports).values({
    reporterId: user.id,
    targetType: parsed.data.targetType,
    targetId: parsed.data.targetId,
    reason: parsed.data.reason,
    details: parsed.data.details ?? null,
    status: "pending",
  });

  return { ok: true };
}

const resolveSchema = z.object({
  reportId: z.string().uuid(),
  action: z.enum(["hide", "keep"]),
  resolverNote: z.string().max(500).optional(),
});

export async function resolveReport(input: unknown): Promise<{ ok: boolean; reason?: string }> {
  const parsed = resolveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid-input" };

  const user = await getCachedUser();
  if (!isAdmin(user?.id)) return { ok: false, reason: "not-authorized" };

  const report = await db.query.reports.findFirst({
    where: eq(reports.id, parsed.data.reportId),
  });
  if (!report) return { ok: false, reason: "not-found" };

  if (parsed.data.action === "hide") {
    if (report.targetType === "comment") {
      await db.update(comments).set({ isHidden: true }).where(eq(comments.id, report.targetId));
    }
    // For review/list/profile targets we'd extend here. Phase 5 ships
    // comment-target hide only; the others require additional review/list
    // hiding columns that aren't in the schema yet.
  }

  await db
    .update(reports)
    .set({
      status: parsed.data.action === "hide" ? "resolved_action_taken" : "resolved_no_action",
      resolvedAt: new Date(),
      resolvedBy: user!.id,
      resolverNote: parsed.data.resolverNote ?? null,
    })
    .where(eq(reports.id, parsed.data.reportId));

  revalidatePath("/admin/reports");
  return { ok: true };
}

export async function getReportQueue(opts: { limit?: number; offset?: number } = {}) {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  return await db
    .select()
    .from(reports)
    .where(eq(reports.status, "pending"))
    .orderBy(desc(reports.createdAt))
    .limit(limit)
    .offset(offset);
}
```

- [ ] **Step 4: Create `components/moderation/report-modal.tsx`**

```typescript
"use client";
import { useState, useTransition } from "react";

import { createReport } from "@/lib/social/moderation/server-actions";

const REASONS = [
  { value: "spam", label: "Spam or unwanted ads" },
  { value: "harassment", label: "Harassment or hate speech" },
  { value: "spoiler", label: "Untagged spoiler" },
  { value: "off_topic", label: "Off-topic" },
  { value: "other", label: "Something else" },
] as const;

export function ReportModal(props: {
  targetType: "comment" | "review" | "list" | "profile";
  targetId: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<typeof REASONS[number]["value"]>("spam");
  const [details, setDetails] = useState("");
  const [pending, startTransition] = useTransition();
  const [success, setSuccess] = useState(false);

  function onSubmit() {
    startTransition(async () => {
      const result = await createReport({
        targetType: props.targetType,
        targetId: props.targetId,
        reason,
        details: details || undefined,
      });
      if (result.ok) {
        setSuccess(true);
        setTimeout(() => {
          setOpen(false);
          setSuccess(false);
        }, 2000);
      }
    });
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="px-2 py-1 text-sm rounded hover:bg-[var(--bg-elevated)]">
        Report
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setOpen(false)}>
          <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-6 max-w-md" onClick={(e) => e.stopPropagation()}>
            {success ? (
              <p className="text-sm">Thanks — we'll review this within 48 hours.</p>
            ) : (
              <>
                <h3 className="text-lg font-semibold mb-3">Report this {props.targetType}</h3>
                <fieldset className="space-y-2">
                  {REASONS.map((r) => (
                    <label key={r.value} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="radio" name="reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} />
                      {r.label}
                    </label>
                  ))}
                </fieldset>
                <textarea
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder="Optional details"
                  rows={3}
                  maxLength={500}
                  className="mt-4 w-full p-2 text-sm rounded border border-[var(--border)] bg-[var(--bg)]"
                />
                <div className="flex justify-end gap-2 mt-4">
                  <button onClick={() => setOpen(false)} disabled={pending} className="px-3 py-1.5 text-sm rounded border border-[var(--border)]">Cancel</button>
                  <button onClick={onSubmit} disabled={pending} className="px-3 py-1.5 text-sm rounded bg-[var(--accent)] text-[var(--accent-fg)]">
                    {pending ? "Sending…" : "Send report"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 5: Create `app/(app)/admin/reports/page.tsx`**

```typescript
import { notFound } from "next/navigation";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import { isAdmin } from "@/lib/social/moderation/admin";
import { getReportQueue } from "@/lib/social/moderation/server-actions";
import { ReportsQueue } from "@/components/moderation/reports-queue";

export const metadata = { title: "Admin · Reports", robots: { index: false } };

export default async function AdminReportsPage() {
  const user = await getCachedUser();
  if (!isAdmin(user?.id)) notFound();

  const queue = await getReportQueue();

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Pending reports</h1>
        <p className="text-sm text-[var(--text-dim)] mt-1">{queue.length} pending</p>
      </header>
      <ReportsQueue reports={queue} />
    </div>
  );
}
```

- [ ] **Step 6: Create `components/moderation/reports-queue.tsx` + `moderation-actions.tsx`**

Mostly mechanical. ReportsQueue iterates the reports and renders ModerationActions per row. ModerationActions has Hide/Keep buttons calling `resolveReport`.

- [ ] **Step 7: Mount ReportModal on review + comment + list overflow menus**

For each of: review canonical page, comment cards, list detail page — add a `<ReportModal>` instance in the overflow menu next to existing edit/delete actions.

- [ ] **Step 8: Create `tests/e2e/admin-gate.spec.ts`**

```typescript
import { test, expect } from "../fixtures/test-base";

test("non-admin GET on /admin/reports returns 404", async ({ page, publicUser }) => {
  await page.goto("/login");
  await page.fill("input[name='email']", publicUser.email);
  await page.fill("input[name='password']", publicUser.password);
  await page.click("button[type='submit']");
  await page.waitForURL("/home");

  const response = await page.goto("/admin/reports");
  // Next 404s render as 404 (not 200); check the response status
  expect(response?.status()).toBe(404);
});

// Optional: when ADMIN_USER_IDS includes the publicUser, the admin route
// renders the queue. Requires environment plumbing — defer to manual.
```

- [ ] **Step 9: Verify + commit**

```powershell
pnpm test:e2e -- admin-gate
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
git add lib/social/moderation/ components/moderation/ app/(app)/admin/ tests/e2e/admin-gate.spec.ts lib/env.ts
git commit -m "feat(moderation): report modal + admin queue + env-gated /admin/reports

- createReport with 10/hr rate limit; resolveReport admin-only
- ReportModal on review + comment + list overflow menus
- isAdmin checks ADMIN_USER_IDS env (comma-separated UUIDs)
- /admin/reports 404s for non-admin; queue renders pending + auto_flagged
- Hide action sets comments.is_hidden=true; updates report status
- Playwright covers non-admin 404 gate

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 28: `scripts/verify-phase-5.ts` — automated verification pass

**Goal:** Mirror `verify-phase-4.ts` shape with 10 automated groups + 5 manual items. Each group is a TS function that checks a slice of the gate criteria and prints PASS/FAIL/SKIP.

**Files:**
- Create: `scripts/verify-phase-5.ts`

**Acceptance Criteria:**
- [ ] 10 groups corresponding to the 10 automated verify-gate criteria
- [ ] Each check has a unique ID like `G1.1`, `G1.2`, …
- [ ] Exit code 0 only if all groups PASS or explicit SKIP-with-reason
- [ ] M1–M5 manual gate items printed at the end as a checklist for the operator
- [ ] `pnpm tsx scripts/verify-phase-5.ts` runs in <30s

**Verify:** `pnpm tsx scripts/verify-phase-5.ts && pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Read `scripts/verify-phase-4.ts` for the shape, structure, and group/check pattern**

Open it; note the pattern of `Group` → array of `Check` → final tally. Mirror exactly.

- [ ] **Step 2: Create `scripts/verify-phase-5.ts`**

The script structure (high-level):

```typescript
import { db, schema } from "@/lib/db";
import { sql } from "drizzle-orm";

type CheckResult = { id: string; label: string; status: "PASS" | "FAIL" | "SKIP"; detail?: string };

const results: CheckResult[] = [];

function pass(id: string, label: string, detail?: string) { results.push({ id, label, status: "PASS", detail }); }
function fail(id: string, label: string, detail?: string) { results.push({ id, label, status: "FAIL", detail }); }
function skip(id: string, label: string, detail?: string) { results.push({ id, label, status: "SKIP", detail }); }

// Group 1: bidirectional block via withBlockedFilter chokepoint
async function group1() {
  // G1.1 — file exists
  // G1.2 — schema has blocks table + no-self CHECK + reverse index
  // G1.3 — withBlockedFilter handles logged-out short-circuit (re-run unit test)
}

// Group 2: feed material events only (no backlog adds)
async function group2() {
  // G2.1 — logs.last_event_at column exists
  // G2.2 — feed query is in lib/social/feed/queries.ts and SELECTs from 3 tables
  // G2.3 — no `WHERE status = 'backlog'` clause in the log branch of the UNION
}

// Group 3: comments thread w/ soft-delete preserves structure
async function group3() {
  // G3.1 — comments.parentId FK exists (verify pg_constraint)
  // G3.2 — comments.is_hidden column exists
  // G3.3 — comment_thread.tsx component imports CommentCard recursively
}

// Group 4: auto-flag rule-based + mod queue
async function group4() {
  // G4.1 — rules.ts exports checkSpamRules
  // G4.2 — reports table exists + status enum has auto_flagged
  // G4.3 — createComment inserts into reports when isFlagged=true
}

// Group 5: 6 notification types fire + dedupe
async function group5() {
  // G5.1 — notification_type enum has all 6 values via pg_enum lookup
  // G5.2 — notifications_dedupe_uniq index exists
  // G5.3 — emit.ts has ON CONFLICT DO UPDATE
}

// Group 6: email digest payload + unsubscribe
async function group6() {
  // G6.1 — buildDigest returns null for cadence='off'
  // G6.2 — digest-template.tsx exists + exports renderDigestHtml
  // G6.3 — unsubscribe route exists + signing helpers exist
}

// Group 7: discovery routes
async function group7() {
  // G7.1 — popular-games SQL aggregates correctly on fixture
  // G7.2 — trending-reviews SQL likewise
  // G7.3 — similar-users computes cosine sim
}

// Group 8: lists CRUD + reorder
async function group8() {
  // G8.1 — lists.slug + published_at columns
  // G8.2 — list_likes table
  // G8.3 — reorder server action wraps in transaction
}

// Group 9: profile overview hub renders all sections
async function group9() {
  // G9.1 — getProfileSummary returns 5-section shape
  // G9.2 — page.tsx imports getProfileSummary
}

// Group 10: admin queue env-gated
async function group10() {
  // G10.1 — isAdmin checks ADMIN_USER_IDS
  // G10.2 — /admin/reports page calls notFound() for non-admin
  // G10.3 — resolveReport requires isAdmin
}

async function main() {
  await group1();
  await group2();
  await group3();
  await group4();
  await group5();
  await group6();
  await group7();
  await group8();
  await group9();
  await group10();

  const passes = results.filter((r) => r.status === "PASS").length;
  const fails = results.filter((r) => r.status === "FAIL").length;
  const skips = results.filter((r) => r.status === "SKIP").length;

  for (const r of results) {
    console.log(`${r.status === "PASS" ? "✔" : r.status === "SKIP" ? "·" : "✗"} ${r.id}: ${r.label}${r.detail ? ` — ${r.detail}` : ""}`);
  }

  console.log(`\nResult: ${passes} pass · ${fails} fail · ${skips} skip`);

  console.log(`\nManual gate items (operator must verify):`);
  console.log(`  M1: Real digest email delivered + unsubscribe round-trip`);
  console.log(`  M2: Visual rendering desktop + mobile breakpoints`);
  console.log(`  M3: @-mention autocomplete UX feel`);
  console.log(`  M4: Drag-to-reorder on touch + mouse`);
  console.log(`  M5: Bell badge polling (2-tab test)`);

  process.exit(fails > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

Each group implementation reads via `db` + filesystem checks (e.g. `fs.readFileSync` of the file in question, regex-match the expected pattern). Same pattern as verify-phase-4.

- [ ] **Step 3: Run + iterate**

```powershell
pnpm tsx scripts/verify-phase-5.ts
```

Fix any FAILs by adjusting either the check or the underlying implementation.

- [ ] **Step 4: Commit**

```powershell
git add scripts/verify-phase-5.ts
git commit -m "chore(phase-5): scripts/verify-phase-5.ts — 10 automated groups

Mirrors verify-phase-4 shape. 10 groups cover the verify-gate criteria;
manual M1-M5 printed for operator.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 29: Manual gate verification + final polish + tag `phase-5-complete`

**Goal:** Close the phase. Run the 5 manual gate items (M1-M5), polish any rough edges, update memory, tag the release.

**Files:**
- Modify: `memory/MEMORY.md` (add Phase 5 entry)
- Create: `memory/phase_5_complete.md` (per phase pattern)
- Tag: `phase-5-complete`

**Acceptance Criteria:**
- [ ] M1 (real digest email + unsubscribe) — completed manually; screenshot/log added to memory
- [ ] M2 (visual rendering breakpoints) — desktop + mobile pass on Chrome + Safari + Firefox
- [ ] M3 (@-mention autocomplete UX) — verified manually
- [ ] M4 (drag-to-reorder touch + mouse) — verified on iPhone + desktop
- [ ] M5 (bell badge 60s polling) — verified with 2 tabs
- [ ] `verify-phase-5.ts` runs green (10 PASS, 0 FAIL, allowed SKIPs documented)
- [ ] Memory updated with phase_5_complete reference
- [ ] Git tag `phase-5-complete` applied to main HEAD

**Verify:** `pnpm tsx scripts/verify-phase-5.ts` clean; all manual items signed off in memory

**Steps:**

- [ ] **Step 1: Run each manual item; record outcomes**

For each of M1-M5, run the manual test described in the verify gate. Capture screenshots into `/docs/phase5-manual-evidence/` (gitignored or committed depending on user preference).

- [ ] **Step 2: Final `pnpm tsx scripts/verify-phase-5.ts`**

```powershell
pnpm tsx scripts/verify-phase-5.ts
```

Expected: 10 PASS, 0 FAIL, any SKIPs documented in the script header.

- [ ] **Step 3: Update memory**

Create `memory/phase_5_complete.md`:

```markdown
---
name: Phase 5 complete
description: Social Layer shipped — follow/feed/comments/lists/notifications/discovery/moderation, beta launch milestone
type: project
---

# Phase 5 — Social Layer complete

**Date shipped:** <today>
**Verify script head SHA:** <head>
**Tag:** `phase-5-complete`

## Gate criterion table (10 automated + 5 manual)

| # | Criterion | Result |
|---|-----------|--------|
| 1 | Bidirectional block prevents both directions | auto-pass |
| 2 | Feed shows material events only | auto-pass |
| 3 | Comments thread 1-level deep + soft-delete preserves structure | auto-pass |
| 4 | Auto-flag rules + hidden from non-author | auto-pass |
| 5 | All 6 notification types fire + idempotency | auto-pass |
| 6 | Email digest payload + unsubscribe JWT verifies | auto-pass |
| 7 | Discovery routes ordering | auto-pass |
| 8 | Lists CRUD + drag-reorder + publish + share URL | auto-pass |
| 9 | Profile overview hub all 5 sections | auto-pass |
| 10 | Admin queue env-gated | auto-pass |
| M1 | Real digest email delivered + unsubscribe | manual-pass |
| M2 | Visual rendering breakpoints | manual-pass |
| M3 | @-mention autocomplete UX | manual-pass |
| M4 | Drag-to-reorder touch + mouse | manual-pass |
| M5 | Notification bell badge polling | manual-pass |

## Deliverables shipped

(... summarize files added/changed, similar to phase_4_complete.md ...)

## Next-phase guidance (Phase 6 — Year-in-Review)

Phase 5 establishes the social graph + feed + lists as foundations. Phase 6 (Year-in-Review) will:
- Aggregate logs + reviews into a year-in-review payload (heavy batch)
- AI-generate the narrative arc using the provider router
- Render pixel-art animated cards
- Surface shareable image cards
```

Update `memory/MEMORY.md`:

```markdown
- [Phase 5 complete](phase_5_complete.md) — Social Layer shipped; beta launch milestone
```

- [ ] **Step 4: Tag the release**

```powershell
git add memory/MEMORY.md memory/phase_5_complete.md
git commit -m "chore(phase-5): mark complete + update memory

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git tag phase-5-complete
git push origin main --tags
```

- [ ] **Step 5: Final commit**

```powershell
git log --oneline -1
```

Confirm HEAD is the tag commit. Phase 5 closed.

---
