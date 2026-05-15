"use server";

/**
 * refresh-action.ts — Phase 6 T20.
 *
 * Server action that lets a signed-in user re-run `cacheOrBuildYearly` for
 * the current year, busting the 7-day cache short-circuit via `forceBuild`.
 *
 * Guards:
 *   1. Must be authenticated.
 *   2. Year must be the current UTC year — past years are immutable.
 *   3. The year_in_reviews row must NOT be locked (locked = admin-finalised).
 *   4. Rate-limited to 1 refresh per user per day (scope: "recap_refresh").
 *
 * The rate-limit check comes AFTER the locked check so a user who is already
 * blocked by a lock doesn't burn their daily allowance unnecessarily.
 *
 * Revalidation: calls `revalidatePath("/u/[username]/year/[year]", "page")`
 * with the dynamic-segment form so Next.js invalidates all matching pages.
 * The user's browser then does a hard reload (triggered client-side in
 * RefreshButton) to fetch the newly built payload.
 */

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import { enforceRateLimit, RateLimitedError } from "@/lib/security/rate-limit";
import { db, schema } from "@/lib/db";
import { cacheOrBuildYearly } from "./cache-or-build";

export async function refreshYearly(input: {
  year: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const currentYear = new Date().getUTCFullYear();
  if (input.year !== currentYear) {
    return { ok: false, error: "Only the current year can be refreshed" };
  }

  // Check locked_at — if locked, refuse before touching the rate-limit counter.
  const [existing] = await db
    .select({ lockedAt: schema.yearInReviews.lockedAt })
    .from(schema.yearInReviews)
    .where(
      and(
        eq(schema.yearInReviews.userId, user.id),
        eq(schema.yearInReviews.year, input.year),
      ),
    )
    .limit(1);

  if (existing?.lockedAt) {
    return {
      ok: false,
      error: "This year has been finalized and cannot be refreshed",
    };
  }

  // Rate-limit: 1 refresh per user per day.
  try {
    await enforceRateLimit({
      scope: "recap_refresh",
      identifier: user.id,
      limit: 1,
      windowSeconds: 86400,
    });
  } catch (e) {
    if (e instanceof RateLimitedError) {
      return {
        ok: false,
        error: "You've already refreshed today. Try again tomorrow.",
      };
    }
    throw e;
  }

  // Force rebuild — skip the 7-day cache short-circuit.
  await cacheOrBuildYearly({
    userId: user.id,
    year: input.year,
    forceBuild: true,
  });

  // Revalidate so the next request reads the freshly built payload.
  // The dynamic-segment form invalidates all /u/.../year/... pages for
  // this user — a slight over-invalidation that's acceptable for a
  // user-initiated action.
  revalidatePath("/u/[username]/year/[year]", "page");

  return { ok: true };
}
