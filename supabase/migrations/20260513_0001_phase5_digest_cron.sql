-- ============================================================================
-- Phase 5: digest cron schedule.
--
-- Cron fires daily at 12:00 UTC and POSTs to /api/internal/digest/run on
-- Vercel. The route does candidate selection + payload build + Resend send.
-- We avoid a Supabase Edge Function (the original spec) because React Email
-- doesn't render cleanly in Deno; running the cron handler in Vercel lets
-- us reuse @/lib/email and @/lib/social/notifications verbatim.
--
-- Apply via Supabase MCP (mcp__supabase__apply_migration) — pg_cron lives
-- in the cron schema and is not Drizzle-managed.
-- ============================================================================

-- 1. Ensure extensions are enabled (idempotent — Phase 3/4 already did this).
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Cron secret stored in Supabase Vault (NOT committed here — set externally).
--    Run once via Supabase MCP execute_sql or the dashboard SQL Editor with
--    the same 32+ char value as the Vercel env CRON_SECRET:
--
--    SELECT vault.create_secret(
--      '<32-char-secret-matching-Vercel-CRON_SECRET-env>',
--      'phase5_cron_secret',
--      'X-Cron-Secret header value for /api/internal/digest/run'
--    );
--
--    Note: ALTER DATABASE SET app.* is blocked on managed Supabase (not superuser).
--    Supabase Vault (vault.decrypted_secrets) is the supported alternative.

-- 3. Idempotent unschedule-then-schedule so this migration can be re-applied.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'phase5-digest-email') THEN
    PERFORM cron.unschedule('phase5-digest-email');
  END IF;
END $$;

-- 4. Schedule daily 12:00 UTC. Mirrors Phase 3/4 shape: read the secret from
--    Vault at runtime (NOT a hardcoded string in the cron SQL), build the
--    POST body, and fire-and-forget. The Vercel route ack lands in pg_net
--    response logs.
SELECT cron.schedule(
  'phase5-digest-email',
  '0 12 * * *',
  $$
    SELECT net.http_post(
      url     := 'https://letterboxd-for-games.vercel.app/api/internal/digest/run',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'phase5_cron_secret' LIMIT 1)
      ),
      body    := '{}'::jsonb
    ) AS request_id;
  $$
);

-- Verify:
--   SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'phase5-digest-email';
-- Expected: 1 row, active=true, schedule='0 12 * * *'
