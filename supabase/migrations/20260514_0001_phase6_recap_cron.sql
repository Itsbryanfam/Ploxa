-- ============================================================================
-- Phase 6: Recap email cron schedule + Jan 5 year-locking.
--
-- Three HTTP cron jobs that POST to /api/internal/recap-email/run on Vercel
-- with a mode payload telling the worker which cohort to send:
--
--   1. phase6-recap-annual-preview   — Dec 1, 12:00 UTC. Year preview.
--   2. phase6-recap-annual-locked    — Jan 5, 12:00 UTC. Locked year.
--   3. phase6-recap-monthly          — 1st of each month, 12:00 UTC. Monthly.
--
-- Plus one standalone pure-SQL cron that bulk-locks the previous year's
-- year_in_reviews rows on Jan 5 — defense-in-depth with the annual_locked
-- email worker's per-user lock update (worker locks user-by-user as it sends;
-- this bulk job covers users not in the email cohort).
--
--   4. phase6-yir-lock-jan5          — Jan 5, 12:00 UTC.
--
-- Auth: workers read X-Cron-Secret from phase6_cron_secret Vault secret.
-- Mirrors Phase 5 — Vercel env CRON_SECRET must match the Vault value.
--
-- URL: ploxa.vercel.app (per 2026-05-14 brand rename from
-- letterboxd-for-games.vercel.app — see memory entry brand_rename_ploxa).
--
-- Apply via Supabase MCP (mcp__supabase__apply_migration).
-- ============================================================================

-- 1. Ensure extensions are enabled (idempotent — Phase 3/4/5 already did this).
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Cron secret stored in Supabase Vault. Run once externally (Supabase MCP
--    execute_sql or dashboard SQL Editor) with the same 32+ char value as
--    Vercel env CRON_SECRET:
--
--    SELECT vault.create_secret(
--      '<32-char-secret-matching-Vercel-CRON_SECRET-env>',
--      'phase6_cron_secret',
--      'X-Cron-Secret header value for /api/internal/recap-email/run'
--    );
--
--    The Phase 6 worker reads the same Vercel CRON_SECRET env as Phase 5,
--    so a single value covers both — but we keep separate Vault secrets so
--    rotating one doesn't accidentally lock the other out.

-- 3. Idempotent unschedule-then-schedule so this migration can be re-applied.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'phase6-recap-annual-preview') THEN
    PERFORM cron.unschedule('phase6-recap-annual-preview');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'phase6-recap-annual-locked') THEN
    PERFORM cron.unschedule('phase6-recap-annual-locked');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'phase6-recap-monthly') THEN
    PERFORM cron.unschedule('phase6-recap-monthly');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'phase6-yir-lock-jan5') THEN
    PERFORM cron.unschedule('phase6-yir-lock-jan5');
  END IF;
END $$;

-- 4. Annual preview — Dec 1 at 12:00 UTC.
SELECT cron.schedule(
  'phase6-recap-annual-preview',
  '0 12 1 12 *',
  $$
    SELECT net.http_post(
      url     := 'https://ploxa.vercel.app/api/internal/recap-email/run',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'phase6_cron_secret' LIMIT 1)
      ),
      body    := '{"mode":"annual_preview"}'::jsonb
    ) AS request_id;
  $$
);

-- 5. Annual locked — Jan 5 at 12:00 UTC. Year is now finalized; the worker
--    also stamps locked_at on each user's row as it sends.
SELECT cron.schedule(
  'phase6-recap-annual-locked',
  '0 12 5 1 *',
  $$
    SELECT net.http_post(
      url     := 'https://ploxa.vercel.app/api/internal/recap-email/run',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'phase6_cron_secret' LIMIT 1)
      ),
      body    := '{"mode":"annual_locked"}'::jsonb
    ) AS request_id;
  $$
);

-- 6. Monthly recap — 1st of each month at 12:00 UTC. Targets cadence='monthly'
--    users; the worker computes the previous month internally.
SELECT cron.schedule(
  'phase6-recap-monthly',
  '0 12 1 * *',
  $$
    SELECT net.http_post(
      url     := 'https://ploxa.vercel.app/api/internal/recap-email/run',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'phase6_cron_secret' LIMIT 1)
      ),
      body    := '{"mode":"monthly"}'::jsonb
    ) AS request_id;
  $$
);

-- 7. Jan 5 bulk lock — pure SQL, no HTTP. Covers users not in the email
--    cohort (cadence='never') who still have a recap row from a previous
--    refresh. Idempotent: locked_at IS NULL filter means re-running on
--    later Jan 5s is a no-op for already-locked rows. The annual_locked
--    email worker also locks per-user, so this fires AFTER that one
--    in a same-minute schedule — but pg_cron does not guarantee
--    ordering across separate jobs, so we accept the harmless race
--    (worker locks row → bulk job's WHERE filter excludes it; or
--    bulk locks first → worker's WHERE IS NULL excludes it). Either
--    way the row ends up locked exactly once.
SELECT cron.schedule(
  'phase6-yir-lock-jan5',
  '0 12 5 1 *',
  $$
    UPDATE year_in_reviews
    SET locked_at = now()
    WHERE year = (EXTRACT(YEAR FROM now())::int - 1)
      AND locked_at IS NULL;
  $$
);

-- Verify after apply:
--   SELECT jobid, jobname, schedule, active FROM cron.job
--   WHERE jobname LIKE 'phase6-%' ORDER BY jobname;
-- Expected: 4 rows, all active=true.
