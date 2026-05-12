import "server-only";
import { after } from "next/server";
import { and, eq, sql as drizzleSql } from "drizzle-orm";

import { db } from "@/lib/db";
import { logs, recommendations } from "@/lib/db/schema";

const MILESTONES = [10, 25, 50, 100, 250] as const;

/**
 * Called from server actions that change a user's taste signal:
 * - lib/logs/server-actions.ts: createLog, updateLogStatus, updateLogFull,
 *   deleteLog (every log mutation shifts vector aggregation)
 * - lib/reviews/server-actions.ts: publishReview, deleteReview
 *   (publishing flips the hasPublishedReview ×1.15 weight bonus on;
 *   deleting a published review flips it back off. Draft deletes are
 *   harmless no-ops here — the DELETE-recs query is sub-millisecond
 *   when the cache is empty)
 *
 * Behavior:
 * - Always: invalidates the rec cache (deletes non-dismissed recs).
 *   Vector signal has changed → cached AI recs are stale. This DELETE
 *   is awaited (blocks the response) so the user's next render is
 *   consistent. Only the milestone fetch is deferred via after().
 * - Sometimes: fires refresh-fingerprint Edge Function if the user's
 *   total log count is now exactly one of MILESTONES.
 *
 * Errors are never thrown — the caller's transaction must not be
 * affected by trigger failures. We log and continue.
 *
 * The name `triggerOnLogWrite` is kept for cross-doc consistency with
 * the plan, but conceptually it's "trigger on taste-signal change".
 */
export async function triggerOnLogWrite(userId: string): Promise<void> {
  // Defense-in-depth: every caller derives userId from getCachedUser(),
  // but a stray empty string would silently no-op the DELETE and miss
  // milestone fires. Fail loud here so the regression is greppable.
  if (!userId) {
    console.error("triggerOnLogWrite called with empty userId — caller bug");
    return;
  }

  try {
    // 1. Invalidate rec cache (always, regardless of milestone).
    await db
      .delete(recommendations)
      .where(and(eq(recommendations.userId, userId), eq(recommendations.dismissed, false)));

    // 2. Check milestone.
    const [{ count }] = await db
      .select({ count: drizzleSql<number>`count(*)::int` })
      .from(logs)
      .where(eq(logs.userId, userId));

    if (!MILESTONES.includes(count as (typeof MILESTONES)[number])) return;

    // Defensive env-var pattern: missing config logs and returns rather
    // than throwing — trigger failures must not bubble up to the caller.
    // Do NOT use requireEnv here.
    const functionsUrl =
      process.env.SUPABASE_FUNCTIONS_URL ??
      (process.env.NEXT_PUBLIC_SUPABASE_URL
        ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1`
        : null);
    const apikey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!functionsUrl || !apikey) {
      console.error("triggerOnLogWrite milestone: missing env, skipping fetch", { userId, count });
      return;
    }

    // after() defers the fetch until after the response is sent, keeping
    // the serverless instance alive until it resolves. Mirrors the
    // pattern in lib/imports/server-actions.ts:fireImportEdge.
    after(() =>
      fetch(`${functionsUrl}/refresh-fingerprint`, {
        method: "POST",
        headers: { apikey, "Content-Type": "application/json" },
        body: JSON.stringify({ userId, reason: "milestone", logCount: count }),
      })
        .then(async (r) => {
          if (!r.ok) {
            console.error("refresh-fingerprint milestone non-OK:", r.status, await r.text());
          }
        })
        .catch((err: unknown) => {
          console.error("refresh-fingerprint milestone fetch failed:", userId, err);
        }),
    );
  } catch (err) {
    console.error("triggerOnLogWrite failed (non-fatal):", userId, err);
  }
}
