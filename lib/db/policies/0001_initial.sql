-- ============================================================================
-- 0001_initial — Phase 0 RLS policies + lock down rls_auto_enable()
--
-- Why this lives outside lib/db/migrations/:
--   Drizzle has no schema construct for RLS policies, so they aren't generated
--   by `pnpm db:generate`. We apply them via Supabase's migration tracking
--   (mcp_supabase_apply_migration) and keep this file as the source of truth
--   for code review + future audits. When you change policies, update this
--   file AND apply via `apply_migration`.
--
-- Access pattern summary:
--   Public cache (read-anyone, server-write):     games, game_aliases
--   Public-or-owner read, owner write:            profiles, lists, year_in_reviews
--   Public-or-owner read w/ visibility flags:     logs (is_private), reviews (is_public + published_at)
--   Inherits parent visibility:                   review_questions, list_items, comments
--   Public read graph, self-write:                follows, likes
--   Owner-only:                                   imports, platform_connections, notifications
--   Owner-read, server-write (AI/telemetry):      taste_fingerprints, recommendations, ai_calls
--
-- Notes:
--   - service_role bypasses RLS, so server-side code keeps full access.
--   - auth.uid() is wrapped in (SELECT ...) for Postgres plan caching
--     (Supabase-recommended performance pattern).
--   - year_in_reviews is owner-only for now; the share_image_url is hosted
--     externally so public sharing works without a public read policy. If
--     we later want embedded YIR cards on public profiles, add a policy.
-- ============================================================================

-- ─── Lock down the auto-RLS helper ──────────────────────────────────────────
-- It's an event trigger function (only meaningful when fired by DDL).
-- Exposing it via PostgREST has no functional value. Event triggers still
-- fire for DDL regardless of these grants because they're invoked by the
-- DDL system, not by role-level EXECUTE.
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 1. Public cache tables
-- ============================================================================
CREATE POLICY "games_select_all" ON public.games
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "game_aliases_select_all" ON public.game_aliases
  FOR SELECT TO anon, authenticated USING (true);

-- ============================================================================
-- 2. Profiles (public-or-owner read, owner write)
-- ============================================================================
CREATE POLICY "profiles_select_public_or_own" ON public.profiles
  FOR SELECT TO anon, authenticated
  USING (is_public OR user_id = (SELECT auth.uid()));

CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "profiles_delete_own" ON public.profiles
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ============================================================================
-- 3. Logs (own always; others' if NOT is_private AND owner profile is public)
-- ============================================================================
CREATE POLICY "logs_select_own_or_public" ON public.logs
  FOR SELECT TO anon, authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (
      NOT is_private
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.user_id = logs.user_id AND p.is_public
      )
    )
  );

CREATE POLICY "logs_insert_own" ON public.logs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "logs_update_own" ON public.logs
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "logs_delete_own" ON public.logs
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ============================================================================
-- 4. Reviews (own always; others' if is_public AND published AND owner public)
-- ============================================================================
CREATE POLICY "reviews_select_own_or_published" ON public.reviews
  FOR SELECT TO anon, authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (
      is_public AND published_at IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.user_id = reviews.user_id AND p.is_public
      )
    )
  );

CREATE POLICY "reviews_insert_own" ON public.reviews
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "reviews_update_own" ON public.reviews
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "reviews_delete_own" ON public.reviews
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ============================================================================
-- 5. Lists (public-or-owner read, owner write)
-- ============================================================================
CREATE POLICY "lists_select_public_or_own" ON public.lists
  FOR SELECT TO anon, authenticated
  USING (is_public OR user_id = (SELECT auth.uid()));

CREATE POLICY "lists_insert_own" ON public.lists
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "lists_update_own" ON public.lists
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "lists_delete_own" ON public.lists
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ============================================================================
-- 6. Inherited from parent
-- ============================================================================

-- review_questions: read inherits review visibility; write requires review ownership
CREATE POLICY "review_questions_select_via_review" ON public.review_questions
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.reviews r
      WHERE r.id = review_questions.review_id
        AND (
          r.user_id = (SELECT auth.uid())
          OR (r.is_public AND r.published_at IS NOT NULL)
        )
    )
  );

CREATE POLICY "review_questions_modify_via_review" ON public.review_questions
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.reviews r
      WHERE r.id = review_questions.review_id AND r.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.reviews r
      WHERE r.id = review_questions.review_id AND r.user_id = (SELECT auth.uid())
    )
  );

-- list_items: read inherits list visibility; write requires list ownership
CREATE POLICY "list_items_select_via_list" ON public.list_items
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.lists l
      WHERE l.id = list_items.list_id
        AND (l.is_public OR l.user_id = (SELECT auth.uid()))
    )
  );

CREATE POLICY "list_items_modify_via_list" ON public.list_items
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.lists l
      WHERE l.id = list_items.list_id AND l.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.lists l
      WHERE l.id = list_items.list_id AND l.user_id = (SELECT auth.uid())
    )
  );

-- comments: read inherits review visibility; write own only AND only on visible reviews
CREATE POLICY "comments_select_via_review" ON public.comments
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.reviews r
      WHERE r.id = comments.review_id
        AND (
          r.user_id = (SELECT auth.uid())
          OR (r.is_public AND r.published_at IS NOT NULL)
        )
    )
  );

CREATE POLICY "comments_insert_own_on_visible_review" ON public.comments
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.reviews r
      WHERE r.id = comments.review_id
        AND (
          r.user_id = (SELECT auth.uid())
          OR (r.is_public AND r.published_at IS NOT NULL)
        )
    )
  );

CREATE POLICY "comments_update_own" ON public.comments
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "comments_delete_own" ON public.comments
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ============================================================================
-- 7. Public-read social graph, self-write
-- ============================================================================

-- likes (counts are public)
CREATE POLICY "likes_select_all" ON public.likes
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "likes_insert_own" ON public.likes
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "likes_delete_own" ON public.likes
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- follows (graph is public)
CREATE POLICY "follows_select_all" ON public.follows
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "follows_insert_own" ON public.follows
  FOR INSERT TO authenticated
  WITH CHECK (follower_id = (SELECT auth.uid()));

CREATE POLICY "follows_delete_own" ON public.follows
  FOR DELETE TO authenticated
  USING (follower_id = (SELECT auth.uid()));

-- ============================================================================
-- 8. Owner-only (no public exposure)
-- ============================================================================

CREATE POLICY "imports_all_own" ON public.imports
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "platform_connections_all_own" ON public.platform_connections
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- notifications: clients can read/mark-read/delete their own; server inserts
CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "notifications_delete_own" ON public.notifications
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ============================================================================
-- 9. Owner-read, server-write (AI/telemetry tables)
-- ============================================================================

CREATE POLICY "taste_fingerprints_select_own" ON public.taste_fingerprints
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "recommendations_select_own" ON public.recommendations
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- recs: user can dismiss their own (UPDATE), but not insert/delete from client
CREATE POLICY "recommendations_update_own" ON public.recommendations
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "ai_calls_select_own" ON public.ai_calls
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "year_in_reviews_select_own" ON public.year_in_reviews
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
