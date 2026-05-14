-- ============================================================================
-- 0012_igdb_facets — IGDB integration columns on games + app_secrets table.
--
-- HAND-WRITTEN (not drizzle-kit generate output). The Drizzle snapshot diverged
-- from the live DB because migrations 0008-0011 were applied directly without
-- updating the snapshot. This file contains ONLY net-new changes for Task 1 of
-- the IGDB mechanics integration; all Phase 5 tables/indexes are already live.
-- ============================================================================

-- ─── IGDB columns on games ────────────────────────────────────────────────────
ALTER TABLE "games" ADD COLUMN "steam_appid" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "game_modes" text[];--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "player_perspectives" text[];--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "igdb_id" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "igdb_resolved_at" timestamp with time zone;--> statement-breakpoint

-- ─── Partial index for Steam appid lookups ───────────────────────────────────
-- Drizzle doesn't generate partial indexes via WHERE clauses; added manually.
-- Used by the IGDB backfill to resolve Steam appid → IGDB id efficiently.
CREATE INDEX IF NOT EXISTS "games_steam_appid_idx" ON "games" ("steam_appid") WHERE "steam_appid" IS NOT NULL;--> statement-breakpoint

-- ─── App-level secret cache ───────────────────────────────────────────────────
-- Service-role-only table for caching short-lived tokens (Twitch OAuth, etc.).
-- No RLS — touched exclusively via DATABASE_URL (service-role connection).
CREATE TABLE "app_secrets" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
