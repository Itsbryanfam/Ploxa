-- ============================================================================
-- 0007_pre_phase5_constraints — Codex audit fixes before Phase 5 (Social).
--
-- All constraints are additive. Live DB was verified for duplicates before
-- applying the unique indexes (see audit-fixes-2026-05-13 thread).
--
-- This migration is HAND-WRITTEN, not drizzle-kit generate output. Drizzle
-- doesn't currently emit CHECK constraints, FK references where the source
-- is a self-table, or PL/pgSQL triggers, so we write them explicitly and
-- update schema.ts in lock-step.
-- ============================================================================

-- ─── #6: One review per (user, game) ─────────────────────────────────────────
-- Replaces the non-unique reviews_user_game_idx created in 0005. Postgres can
-- use the unique for the same equality lookups, and we get hard DB enforcement
-- instead of relying on the delete/insert flow in lib/reviews/server-actions.ts
-- to keep things deduped.
DROP INDEX IF EXISTS "reviews_user_game_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_user_game_uniq" ON "reviews" USING btree ("user_id","game_id");--> statement-breakpoint

-- ─── #7: One paragraph per (review, position) ────────────────────────────────
-- The review-draft flow assumes paragraphs render in `position` order; with
-- no unique, dup positions produce non-deterministic ordering.
CREATE UNIQUE INDEX "review_questions_review_position_uniq" ON "review_questions" USING btree ("review_id","position");--> statement-breakpoint

-- ─── #21: imports polling index ──────────────────────────────────────────────
-- /api/imports/latest polls every 2s during an active import and currently
-- seq-scans by user. (user_id, status, created_at DESC) is the access pattern.
CREATE INDEX "imports_user_status_created_idx" ON "imports" USING btree ("user_id","status","created_at" DESC);--> statement-breakpoint

-- ─── #22: recommendations cache uniqueness ───────────────────────────────────
-- Two concurrent cache misses for the same (user, cache_key) currently each
-- INSERT a row per recommended game. Unique partial prevents this; the
-- WHERE dismissed=false matches the live-recs query pattern.
CREATE UNIQUE INDEX "recommendations_user_cache_game_uniq"
  ON "recommendations" USING btree ("user_id","cache_key","game_id")
  WHERE "dismissed" = false;--> statement-breakpoint

-- ─── #26: prevent self-follows at the DB level ───────────────────────────────
-- App-side prevention isn't enough once the activity feed (Phase 5) starts
-- generating rows programmatically — a self-follow would create an actor=target
-- notification, ambiguous like/comment authorship, etc.
ALTER TABLE "follows" ADD CONSTRAINT "follows_no_self" CHECK ("follower_id" <> "followed_id");--> statement-breakpoint

-- ─── #27: comments.parent_id FK + same-review invariant ──────────────────────
-- The column existed but had no referential integrity. Adding the FK first;
-- a trigger enforces the parent-and-child must reference the same review
-- (CHECK can't reference another row).
ALTER TABLE "comments"
  ADD CONSTRAINT "comments_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "comments"("id") ON DELETE CASCADE;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.comments_parent_same_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.comments p
      WHERE p.id = NEW.parent_id AND p.review_id = NEW.review_id
    ) THEN
      RAISE EXCEPTION 'comments.parent_id must reference a comment on the same review (review_id=%, parent_id=%)', NEW.review_id, NEW.parent_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "comments_parent_same_review_trg"
  BEFORE INSERT OR UPDATE ON "comments"
  FOR EACH ROW EXECUTE FUNCTION public.comments_parent_same_review();--> statement-breakpoint

-- ─── #28: notifications inbox index ──────────────────────────────────────────
-- Phase 5 will want "unread count" + "recent inbox" queries. (user_id,
-- read_at, created_at DESC) covers both: read_at IS NULL for unread,
-- ordered by created_at for the inbox feed.
CREATE INDEX "notifications_user_unread_idx"
  ON "notifications" USING btree ("user_id","read_at","created_at" DESC);
