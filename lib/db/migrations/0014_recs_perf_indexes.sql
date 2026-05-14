-- ============================================================================
-- 0014_recs_perf_indexes — GIN indexes on games array columns + rawg_rating
--                          DESC NULLS LAST for the candidatePool prefilter.
--
-- HAND-WRITTEN (not drizzle-kit generate output). The Drizzle snapshot chain
-- is already drifted (0007–0011 missing from meta/; see memory note
-- feedback_drizzle_snapshot_chain_drift.md), so the convention here is to
-- hand-author additive index migrations rather than risk regenerating ghost
-- DDL for already-applied changes.
--
-- T11 of audit-fixes-2026-05-14 push candidatePool's genre/theme/mechanic
-- overlap filter into Postgres (`games.genres && ARRAY[...]::text[]`) and
-- adds a popularity fallback (`ORDER BY rawg_rating DESC NULLS LAST LIMIT N`)
-- for cold-start users. Without indexes these queries seq-scan the games
-- table on every cache miss — fine at 10k rows, terrible at 50k.
--
-- ── CONCURRENTLY rationale ──────────────────────────────────────────────────
-- `games` is hot (read on every recs request, written by RAWG backfill).
-- Plain CREATE INDEX takes an AccessShareLock for the duration of the build
-- which briefly stalls reads on the table. CREATE INDEX CONCURRENTLY avoids
-- that but cannot run inside a transaction — Supabase's `apply_migration`
-- wraps every migration in one. So:
--
--   - This file is committed for documentation + schema parity with Drizzle.
--   - Operator applies via `mcp__supabase__execute_sql` (no transaction
--     wrapper), NOT `apply_migration`.
--
-- See lib/db/migrations/README.md "Hand-authored index migrations".
-- ============================================================================

-- GIN indexes power the `&&` array-overlap operator in candidatePool. The
-- `IF NOT EXISTS` clause is defensive — none of these exist in the live DB
-- as of audit-fixes-2026-05-14 (verified by grep), but the guard keeps the
-- migration idempotent if applied twice for any reason.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "games_genres_gin"
  ON "games" USING GIN ("genres");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "games_themes_gin"
  ON "games" USING GIN ("themes");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "games_mechanics_gin"
  ON "games" USING GIN ("mechanics");

-- Cold-start popularity fallback: `ORDER BY rawg_rating DESC NULLS LAST`.
-- DESC NULLS LAST matches the query shape in lib/recs/candidate-pool.ts so
-- the planner picks this index for the popularity branch.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "games_rawg_rating_desc"
  ON "games" ("rawg_rating" DESC NULLS LAST);
