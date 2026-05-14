import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.9";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireServiceRole } from "../_shared/auth.ts";

/**
 * Nightly purge cron. Hard-deletes auth.users rows whose profile has
 * deleted_at older than the 30-day grace window. The auth.users delete
 * cascades through all FK-related tables (logs, reviews, lists, comments,
 * follows, blocks, notifications, taste fingerprints, recommendations,
 * platform_connections, imports, year_in_reviews, likes, list_likes).
 *
 * Tables that intentionally survive purge (set null, not cascade):
 *   - notifications.actor_id → becomes anonymous (actor deleted, inbox intact)
 *   - reports.reporter_id   → moderation record survives for audit trail
 *   - reports.resolved_by   → admin resolver ID nulled, report intact
 *   - ai_calls.user_id      → cost telemetry row de-identified, not deleted
 *
 * These exceptions were audited at T14 and are deliberate policy choices.
 *
 * Scheduled via pg_cron at 03:00 UTC daily (SQL applied by controller).
 *
 * Auth gate: service-role key in `apikey` header — same convention as
 * taste-drift-cron, daily-sync, refresh-fingerprint, and rerank-recs.
 *
 * The partial index from migration 0013 (profiles_deleted_at_idx WHERE
 * deleted_at IS NOT NULL) makes the scan O(soft-deleted) rather than
 * O(all users) — steady-state cost is negligible even at 100 K users.
 *
 * Batch strategy: one auth.admin.deleteUser call per user rather than a
 * single DELETE FROM auth.users so that the Admin API fires any upstream
 * cleanup hooks Supabase attaches to the auth system (storage, realtime,
 * etc.). Per-user failures are logged and counted but do NOT abort the
 * rest of the batch.
 */

Deno.serve(async (req) => {
  const unauthorized = requireServiceRole(req);
  if (unauthorized) return unauthorized;

  const sql = postgres(Deno.env.get("DATABASE_URL")!, { prepare: false });
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  try {
    // 30-day grace window — keep in sync with:
    //   - The soft-delete UI copy ("Your account will be permanently deleted
    //     after 30 days" in app/(settings)/settings/account/page.tsx)
    //   - Any client-side countdown constants.
    // The partial index (WHERE deleted_at IS NOT NULL) keeps this query
    // O(soft-deleted) rather than O(all users).
    const stale = await sql<Array<{ user_id: string }>>`
      SELECT user_id FROM profiles
      WHERE deleted_at IS NOT NULL
        AND deleted_at < NOW() - INTERVAL '30 days'
    `;

    let purged = 0;
    let alreadyGone = 0;
    let failed = 0;

    for (const row of stale) {
      // admin.auth.admin.deleteUser triggers auth system cleanup hooks
      // (e.g. Supabase Storage orphan cleanup) in addition to cascading
      // the FK graph. Prefer this over a raw DELETE FROM auth.users.
      const { error } = await admin.auth.admin.deleteUser(row.user_id);
      if (!error) {
        purged++;
        continue;
      }
      // Idempotency guard: a double-run (e.g. manual invoke overlapping
      // with the pg_cron tick, or a scheduler retry) hits an already-deleted
      // user. The Supabase admin SDK returns a 404 / "User not found" error
      // in that case. Treat as a no-op success to keep the failed counter
      // honest — the user IS gone, just by an earlier run.
      const status = (error as { status?: number }).status;
      if (
        status === 404 ||
        /not.found/i.test(error.message ?? "")
      ) {
        alreadyGone++;
        continue;
      }
      console.error("account-purge: failed", row.user_id, error.message);
      failed++;
    }

    const summary = { scanned: stale.length, purged, alreadyGone, failed };
    console.log("account-purge:", JSON.stringify(summary));
    return Response.json(summary);
  } finally {
    await sql.end({ timeout: 5 });
  }
});
