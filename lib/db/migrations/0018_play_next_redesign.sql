-- 0018 — Play-next redesign schema additions
-- Adds stratified-bucket slot + soft-negative dismissal fields to recommendations.
-- Indexes are NOT created CONCURRENTLY: the new partial index only covers rows
-- where a soft-neg flag is set, and at migration time every existing row has
-- slot DEFAULT 'comfort' / dismissed_at NULL / snoozed_until NULL /
-- never_again false, so the predicate matches zero rows and the build is
-- effectively free (no lock impact on the recommendations table).

CREATE TYPE "rec_slot" AS ENUM ('comfort', 'backlog', 'friends', 'wildcard');

ALTER TABLE "recommendations" ADD COLUMN "slot" "rec_slot" NOT NULL DEFAULT 'comfort';
ALTER TABLE "recommendations" ADD COLUMN "dismissed_at" timestamptz;
ALTER TABLE "recommendations" ADD COLUMN "snoozed_until" timestamptz;
ALTER TABLE "recommendations" ADD COLUMN "never_again" boolean NOT NULL DEFAULT false;

-- Partial index for soft-neg decay lookups (only the rows we actually filter on)
CREATE INDEX IF NOT EXISTS "recommendations_neg_lookup_idx"
  ON "recommendations" ("user_id", "game_id")
  WHERE "dismissed_at" IS NOT NULL OR "snoozed_until" IS NOT NULL OR "never_again" = true;
