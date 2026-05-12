-- Phase 3 — pg_cron + pg_net + daily-sync scheduling
-- This migration is Supabase-applied directly (NOT Drizzle-managed) because
-- pg_cron + pg_net are Supabase extensions that Drizzle introspection does
-- not model. Apply via Supabase MCP (apply_migration) or the dashboard.

-- 1. Enable required extensions (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Secrets stored in Supabase Vault (NOT committed here — set externally).
--    Run once via Supabase MCP execute_sql or the dashboard SQL Editor:
--
--    SELECT vault.create_secret(
--      'https://<project-ref>.supabase.co/functions/v1',
--      'supabase_functions_url',
--      'Supabase Functions base URL for pg_cron daily-sync job'
--    );
--    SELECT vault.create_secret(
--      '<service-role-key>',
--      'supabase_service_role_key',
--      'Supabase service role key for pg_cron daily-sync job'
--    );
--
--    Note: ALTER DATABASE SET app.* is blocked on managed Supabase (not superuser).
--    Supabase Vault (vault.decrypted_secrets) is the supported alternative.

-- 3. Schedule the daily-sync edge function call (reads secrets from Vault at runtime)
SELECT cron.schedule(
  'daily-import-sync',
  '0 4 * * *',                       -- 04:00 UTC daily
  $$
    SELECT net.http_post(
      url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_functions_url' LIMIT 1) || '/daily-sync',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key' LIMIT 1),
        'Content-Type',  'application/json'
      ),
      body    := '{}'::jsonb
    ) AS request_id;
  $$
);

-- Verify:
--   SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'daily-import-sync';
-- Expected: 1 row, active=true, schedule='0 4 * * *'
