CREATE INDEX "likes_review_id_idx" ON "likes" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "reviews_user_game_idx" ON "reviews" USING btree ("user_id","game_id");--> statement-breakpoint
CREATE INDEX "reviews_user_published_at_idx" ON "reviews" USING btree ("user_id","published_at" desc) WHERE "reviews"."published_at" IS NOT NULL;