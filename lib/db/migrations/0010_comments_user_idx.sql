-- ============================================================================
-- 0010_comments_user_idx — secondary index on comments.user_id
--
-- T7's cascadeBlock step (d) deletes comments matching
--   WHERE comments.user_id = $blockedId AND comments.review_id IN (...)
-- without an index on user_id this scans the entire comments table.
-- comments_review_created_idx leads with review_id so it doesn't help
-- the user_id predicate.
--
-- Discovered during T7 code-quality review (analogous to the
-- follows.followed_id gap fixed in migration 0009).
-- ============================================================================

CREATE INDEX IF NOT EXISTS "comments_user_idx" ON "comments" USING btree ("user_id");--> statement-breakpoint
