-- ============================================================================
-- 0003_phase5_prep — Defense-in-depth RLS for Phase 5 social tables.
--
-- Our server code uses service_role (which bypasses RLS by design), so these
-- policies are belt-and-suspenders for any future direct anon/authenticated
-- access. Same posture as 0002_phase5_prep.sql.
--
-- This is NOT applied via drizzle-kit migrate — apply via Supabase MCP
-- (mcp__supabase__apply_migration) and re-apply on fresh restore.
-- ============================================================================

-- ─── blocks: own rows only ────────────────────────────────────────────
ALTER TABLE "public"."blocks" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "blocks_select_own" ON "public"."blocks"
  FOR SELECT TO authenticated
  USING (auth.uid() = blocker_id);

CREATE POLICY "blocks_insert_own" ON "public"."blocks"
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = blocker_id);

CREATE POLICY "blocks_delete_own" ON "public"."blocks"
  FOR DELETE TO authenticated
  USING (auth.uid() = blocker_id);

-- ─── list_likes: SELECT to all, mutate own ────────────────────────────
ALTER TABLE "public"."list_likes" ENABLE ROW LEVEL SECURITY;

-- Public read for like counts (anon can see total reactions).
CREATE POLICY "list_likes_select_all" ON "public"."list_likes"
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "list_likes_insert_own" ON "public"."list_likes"
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "list_likes_delete_own" ON "public"."list_likes"
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ─── reports: insert anywhere, read own + admin ──────────────────────
ALTER TABLE "public"."reports" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reports_insert_authenticated" ON "public"."reports"
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = reporter_id);

-- Reporters can see their own reports. Admin role evaluated server-side via
-- ADMIN_USER_IDS env (lib/social/moderation/admin.ts); RLS here only gates
-- the cookie-authenticated client path, not the service_role server reads
-- that drive /admin/reports.
CREATE POLICY "reports_select_own" ON "public"."reports"
  FOR SELECT TO authenticated
  USING (auth.uid() = reporter_id);
