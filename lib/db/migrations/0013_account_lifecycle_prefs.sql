-- 0013_account_lifecycle_prefs.sql
-- Adds soft-delete marker + per-type email opt-out booleans + purge-cron index.
-- See: docs/superpowers/specs/2026-05-13-settings-overhaul-design.md

ALTER TABLE profiles
  ADD COLUMN deleted_at      TIMESTAMPTZ,
  ADD COLUMN email_follows   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN email_reactions BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN email_comments  BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN email_wishlist  BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX profiles_deleted_at_idx
  ON profiles (deleted_at)
  WHERE deleted_at IS NOT NULL;
