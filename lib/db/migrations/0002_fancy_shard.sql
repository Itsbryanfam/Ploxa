CREATE INDEX "logs_user_updated_at_idx" ON "logs" USING btree ("user_id","updated_at" desc);--> statement-breakpoint
CREATE INDEX "logs_user_status_updated_at_idx" ON "logs" USING btree ("user_id","status","updated_at" desc);
ANALYZE logs;