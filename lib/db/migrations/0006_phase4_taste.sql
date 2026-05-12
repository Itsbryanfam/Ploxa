-- Phase 4: Taste Fingerprint + Recommendations schema migration
-- Rename columns, add new columns, and add partial indexes

-- tasteFingerprints table modifications
ALTER TABLE "taste_fingerprints" RENAME COLUMN "generated_at" TO "vectors_generated_at";--> statement-breakpoint
ALTER TABLE "taste_fingerprints" RENAME COLUMN "model_version" TO "narrative_model_version";--> statement-breakpoint
ALTER TABLE "taste_fingerprints" ADD COLUMN "narrative_snapshot_vectors" jsonb;--> statement-breakpoint
ALTER TABLE "taste_fingerprints" ADD COLUMN "narrative_generated_at" timestamp with time zone;--> statement-breakpoint

-- recommendations table modifications
ALTER TABLE "recommendations" ADD COLUMN "cache_key" text;--> statement-breakpoint

-- Partial indexes on recommendations
CREATE INDEX "recommendations_user_cache_key_idx" ON "recommendations" USING btree ("user_id","cache_key","generated_at" desc) WHERE "recommendations"."dismissed" = false;--> statement-breakpoint
CREATE INDEX "recommendations_user_dismissed_idx" ON "recommendations" USING btree ("user_id","generated_at" desc) WHERE "recommendations"."dismissed" = true;
