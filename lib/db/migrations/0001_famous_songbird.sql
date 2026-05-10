-- Phase 1.5.4: Add profile_picture_url and profile_picture_kind columns to profiles.
-- NOTE: No CREATE TABLE auth.users block present in this migration (Drizzle correctly
-- skipped it since the previous snapshot already tracked the auth schema reference).
ALTER TABLE "profiles" ADD COLUMN "profile_picture_url" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "profile_picture_kind" text CHECK ("profile_picture_kind" IN ('static', 'gif'));
