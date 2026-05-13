-- ============================================================================
-- 0009_follows_followed_id_idx — secondary index on follows.followed_id
--
-- The follows table PK is (follower_id, followed_id). Queries like
-- `WHERE followed_id = $userId` cannot use the PK because followed_id is
-- not the leading column. FK constraints do NOT create indexes in Postgres.
--
-- getFollowers() (lib/social/follows/server-actions.ts) does exactly this
-- lookup. Without this index it table-scans every row. With the index it
-- becomes a sub-ms point-and-fan-out.
--
-- Discovered during T6 code-quality review.
-- ============================================================================

CREATE INDEX IF NOT EXISTS "follows_followed_id_idx" ON "follows" USING btree ("followed_id");--> statement-breakpoint
