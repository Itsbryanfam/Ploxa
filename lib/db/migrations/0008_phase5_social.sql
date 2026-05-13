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
--
-- TODO(T2): regenerate drizzle-kit snapshots. lib/db/migrations/meta/
-- currently has snapshots through 0006 but lacks 0007 + 0008. T2's
-- schema.ts edits will trigger drizzle-kit; capture the resulting
-- snapshots before discarding any extraneous .sql output.
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
