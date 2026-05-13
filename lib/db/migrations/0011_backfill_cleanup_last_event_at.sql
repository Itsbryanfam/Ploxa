-- T13: T1 universal backfill incorrectly populated last_event_at for backlog +
-- wishlist rows (those are not material events — see materialEventFromMutation).
-- One-shot cleanup so the activity feed doesn't surface bulk import history.
UPDATE "logs"
   SET "last_event_at" = NULL,
       "last_event_type" = NULL
 WHERE "status" IN ('backlog', 'wishlist');
