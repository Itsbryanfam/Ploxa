-- Phase 4 — taste-drift-cron pg_cron schedule
-- This migration is Supabase-applied directly (NOT Drizzle-managed) because
-- pg_cron + pg_net are Supabase extensions that Drizzle introspection does
-- not model. Apply via Supabase MCP (apply_migration) or the dashboard.

-- 1. Ensure extensions are enabled (idempotent — Phase 3 already did this).
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Vault secrets are reused from Phase 3 (created via vault.create_secret in
--    20260511_0001_phase3_cron.sql). Same names: supabase_functions_url and
--    supabase_service_role_key. If those aren't already set, see the Phase 3
--    migration header for the one-time vault.create_secret commands.

-- 3. Idempotent unschedule-then-schedule so this migration can be re-applied.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'taste-drift-cron') THEN
    PERFORM cron.unschedule('taste-drift-cron');
  END IF;
END $$;

-- 4. Schedule daily 03:00 UTC. Mirrors the Phase 3 daily-sync shape:
--    apikey header (not Authorization: Bearer) because Supabase's
--    sb_secret_* keys aren't JWTs — Edge Functions are deployed with
--    --no-verify-jwt and validate the inbound apikey via string-equality.
SELECT cron.schedule(
  'taste-drift-cron',
  '0 3 * * *',                       -- 03:00 UTC daily
  $$
    SELECT net.http_post(
      url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url' LIMIT 1) || '/taste-drift-cron',
      headers := jsonb_build_object(
        'apikey',       (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key' LIMIT 1),
        'Content-Type', 'application/json'
      ),
      body    := '{}'::jsonb
    ) AS request_id;
  $$
);

-- Verify:
--   SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'taste-drift-cron';
-- Expected: 1 row, active=true, schedule='0 3 * * *'
