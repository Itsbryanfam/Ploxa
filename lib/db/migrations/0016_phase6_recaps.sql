-- Phase 6 — Recaps tables + column adds
-- Note: monthly_recaps + featured_lists are NEW tables; year_in_reviews + profiles
-- get column additions. Indexes are NOT created CONCURRENTLY because these are
-- brand-new tables/columns with zero existing rows, so locking impact is nil.

CREATE TABLE monthly_recaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  year integer NOT NULL,
  month_index integer NOT NULL CHECK (month_index BETWEEN 1 AND 12),
  payload jsonb NOT NULL,
  share_image_hash varchar(32),
  generated_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz
);
CREATE UNIQUE INDEX monthly_recaps_user_year_month_uniq
  ON monthly_recaps(user_id, year, month_index);

ALTER TABLE year_in_reviews
  ADD COLUMN share_image_hash varchar(32),
  ADD COLUMN locked_at timestamptz;

CREATE TABLE featured_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  surface varchar(32) NOT NULL,
  pinned_at timestamptz NOT NULL DEFAULT now(),
  pinned_until timestamptz,
  pinned_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX featured_lists_surface_active_uniq
  ON featured_lists(surface)
  WHERE pinned_until IS NULL OR pinned_until > now();

ALTER TABLE profiles
  ADD COLUMN last_recap_sent_at timestamptz;
