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
--
-- AFTER APPLY: set the GUC `app.cron_secret` via Supabase dashboard
-- (Project Settings → Postgres → Custom Config) to the same value as
-- the Vercel env CRON_SECRET. The migration SQL references this GUC
-- via current_setting('app.cron_secret', true) so the secret never
-- appears in the migration file itself.
-- ============================================================================

-- 1. Ensure extensions are enabled (idempotent — Phase 3/4 likely already did this).
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Idempotent unschedule-then-schedule so this migration can be re-applied.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'phase5-digest-email') THEN
    PERFORM cron.unschedule('phase5-digest-email');
  END IF;
END $$;

-- 3. Schedule daily 12:00 UTC. The Vercel route pulls the secret from the
--    X-Cron-Secret header; we read it here from the GUC app.cron_secret
--    (set once in Project Settings → Postgres → Custom Config).
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

-- Verify:
--   SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'phase5-digest-email';
-- Expected: 1 row, active=true, schedule='0 12 * * *'
