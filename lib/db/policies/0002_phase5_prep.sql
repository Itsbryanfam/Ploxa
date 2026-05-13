-- ============================================================================
-- 0002_phase5_prep — Codex audit fix #3: defense-in-depth profile.is_public
-- check on review_questions + comments SELECT policies (and the comments
-- INSERT policy that mirrors them).
--
-- Why this exists despite RLS already cascading:
--   When a comments/review_questions query runs through anon/authenticated,
--   the inner EXISTS (SELECT 1 FROM public.reviews r ...) does re-apply
--   the reviews RLS policy, which gates profile.is_public. So the active
--   attack surface here is already closed for direct PostgREST traffic.
--
--   We add the check explicitly anyway because:
--     1. Server-side code that runs as service_role bypasses RLS on ALL
--        tables — the parent reviews policy doesn't help there, so the
--        only defense for those paths is application-layer code. This
--        amendment makes the policy self-contained for clearer review.
--     2. If a future change weakens reviews_select_own_or_published (e.g.
--        someone removes the profile.is_public branch thinking it's
--        redundant), comments/questions silently lose protection. The
--        amendment makes that coupling impossible.
--
-- Owner branch (r.user_id = auth.uid()) intentionally does NOT require
-- profile.is_public — a private user must still see their own comments
-- and questions on their own reviews.
-- ============================================================================

DROP POLICY IF EXISTS "review_questions_select_via_review" ON public.review_questions;
CREATE POLICY "review_questions_select_via_review" ON public.review_questions
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.reviews r
      WHERE r.id = review_questions.review_id
        AND (
          r.user_id = (SELECT auth.uid())
          OR (
            r.is_public AND r.published_at IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM public.profiles p
              WHERE p.user_id = r.user_id AND p.is_public
            )
          )
        )
    )
  );

DROP POLICY IF EXISTS "comments_select_via_review" ON public.comments;
CREATE POLICY "comments_select_via_review" ON public.comments
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.reviews r
      WHERE r.id = comments.review_id
        AND (
          r.user_id = (SELECT auth.uid())
          OR (
            r.is_public AND r.published_at IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM public.profiles p
              WHERE p.user_id = r.user_id AND p.is_public
            )
          )
        )
    )
  );

DROP POLICY IF EXISTS "comments_insert_own_on_visible_review" ON public.comments;
CREATE POLICY "comments_insert_own_on_visible_review" ON public.comments
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.reviews r
      WHERE r.id = comments.review_id
        AND (
          r.user_id = (SELECT auth.uid())
          OR (
            r.is_public AND r.published_at IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM public.profiles p
              WHERE p.user_id = r.user_id AND p.is_public
            )
          )
        )
    )
  );
