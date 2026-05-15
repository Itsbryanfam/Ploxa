-- ============================================================================
-- 0003_rls_hygiene — capture live RLS/grant state in version control + drop
-- the broad avatars listing policy.
--
-- F-003: the live DB already has RLS ENABLED (no policy ⇒ deny-all for
-- anon/authenticated) on app_secrets / featured_lists / monthly_recaps, but
-- that state was applied out-of-band and was NOT in lib/db/migrations, so a
-- fresh restore would recreate these tables UNPROTECTED. These statements are
-- idempotent (ENABLE ROW LEVEL SECURITY is a no-op when already enabled) and
-- exist purely so restore == prod. The service-role connection
-- (DATABASE_URL) bypasses RLS, which is how app/Edge code still reads them.
--
-- Advisor 0025: the avatars bucket is PUBLIC, so object-by-URL GET is served
-- by the storage CDN WITHOUT consulting storage.objects RLS. The broad
-- public SELECT policy only enabled LIST/enumeration of every avatar key —
-- drop it; direct avatar URLs are unaffected.
-- ============================================================================

ALTER TABLE "app_secrets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "featured_lists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "monthly_recaps" ENABLE ROW LEVEL SECURITY;

-- Defense-in-depth: app_secrets caches OAuth bearer tokens. Even with RLS
-- deny-all, revoke table grants from the API roles so a future accidental
-- permissive policy can't expose it.
REVOKE ALL ON TABLE "app_secrets" FROM anon, authenticated;

-- Public bucket ⇒ no storage.objects SELECT policy needed for URL fetches.
DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
