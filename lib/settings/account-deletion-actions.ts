"use server";

import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { getProfileByUserId } from "@/lib/profile/server-actions";
import { userHasPassword } from "@/lib/auth/user-has-password";
import {
  verifyCurrentPassword,
  verifyReauthOtp,
  ReauthFailedError,
} from "@/lib/auth/reauth-actions";
import {
  enforceRateLimit,
  RateLimitedError,
} from "@/lib/security/rate-limit";

export type SoftDeleteResult = { ok: true } | { ok: false; error: string };
export type CancelDeletionResult = { ok: true } | { ok: false; error: string };

/**
 * Single source of truth for the soft-delete grace window. Used by:
 *   - softDeleteAccount (no direct use, but documented in the JSDoc)
 *   - app/auth/callback/route.ts (within-grace → /cancel-deletion)
 *   - app/(app)/cancel-deletion/page.tsx (compute restoreBy = deletedAt + grace)
 *   - app/account-deleted/page.tsx (estimate restoreBy from now())
 *   - supabase/functions/account-purge/index.ts (uses INTERVAL '30 days' literal —
 *     keep that in lock-step if this constant ever changes)
 */
export const DELETION_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Soft-deletes the current user's account. Sets profiles.deleted_at = NOW(),
 * then signs them out globally (every session, every device). The user has
 * 30 days (DELETION_GRACE_MS) to sign back in and call cancelDeletion before
 * the account-purge cron hard-deletes the auth.users row + cascades.
 *
 * Confirmation: typed username must match (case-insensitive), and the user
 * must complete the reauth challenge (password OR OTP per userHasPassword).
 *
 * Outer rate limit caps repeat-delete attempts: a hostile session that
 * already has the password can't loop delete-then-redelete-after-cancel
 * faster than 3 deletions/hour. The inner reauth gate is also rate-limited
 * by lib/auth/reauth-actions; this outer cap protects against the
 * known-credentials redelete race.
 */
export async function softDeleteAccount(form: FormData): Promise<SoftDeleteResult> {
  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const profile = await getProfileByUserId(user.id);
  if (!profile) return { ok: false, error: "Profile not found." };

  const typed = String(form.get("confirm_username") ?? "").trim();
  if (typed.toLowerCase() !== profile.username.toLowerCase()) {
    return { ok: false, error: "Typed username doesn't match — try again." };
  }

  // Cap the action to 3 successful-username attempts per hour per user.
  // Username-mismatches (above) don't count — only attempts that pass
  // the cheap pre-check reach the rate limit. Translates RateLimitedError
  // into the same discriminated union shape the rest of the function uses.
  try {
    await enforceRateLimit({
      scope: "account:delete",
      identifier: user.id,
      limit: 3,
      windowSeconds: 60 * 60,
    });
  } catch (e) {
    if (e instanceof RateLimitedError) {
      return {
        ok: false,
        error: `Too many delete attempts — try again in ${e.retryAfterSeconds}s.`,
      };
    }
    throw e;
  }

  const hasPwd = await userHasPassword(user.id);
  try {
    if (hasPwd) {
      await verifyCurrentPassword(String(form.get("current_password") ?? ""));
    } else {
      await verifyReauthOtp(String(form.get("otp_code") ?? ""));
    }
  } catch (e) {
    if (e instanceof ReauthFailedError) {
      return { ok: false, error: e.message };
    }
    throw e;
  }

  await db
    .update(schema.profiles)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.profiles.userId, user.id));

  // Global sign-out — kills every session everywhere. After this returns,
  // the next request will be unauthenticated; the client should navigate
  // immediately to /account-deleted.
  //
  // If the sign-out fails, the deletion is already committed in the DB —
  // the user's session is still alive and they'd land on /account-deleted
  // with a live cookie. Surface a specific error so the client can ask
  // them to sign out manually rather than landing them in inconsistent
  // state. The deletion still applies; they can re-cancel.
  const supabase = await createSupabaseServerClient();
  const { error: signOutError } = await supabase.auth.signOut({ scope: "global" });
  if (signOutError) {
    return {
      ok: false,
      error:
        "Account scheduled for deletion, but sign-out failed. Please sign out manually.",
    };
  }

  return { ok: true };
}

/**
 * Clears profiles.deleted_at, restoring the account. Available via the
 * /cancel-deletion page (which is the only page a soft-deleted user can
 * reach during the grace window — the (app) layout guard redirects all
 * other paths there).
 */
export async function cancelDeletion(): Promise<CancelDeletionResult> {
  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Not signed in." };
  await db
    .update(schema.profiles)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(eq(schema.profiles.userId, user.id));
  return { ok: true };
}

/**
 * Returns the deleted_at timestamp if the user is soft-deleted, null
 * otherwise. Used by the auth callback (to redirect to /cancel-deletion)
 * and the (app) layout guard (to gate every other path).
 *
 * Per-request memoized via React cache() — both call sites fire on the
 * same /cancel-deletion render; cache() collapses them to one DB read.
 *
 * NOTE: this intentionally does NOT filter isNull(deletedAt) — we need to
 * see the deletedAt value even when it is set. Contrast with getProfileByUserId
 * which always filters deleted rows out.
 */
export const isAccountSoftDeleted = cache(
  async (userId: string): Promise<Date | null> => {
    const profile = await db.query.profiles.findFirst({
      where: eq(schema.profiles.userId, userId),
      columns: { deletedAt: true },
    });
    return profile?.deletedAt ?? null;
  },
);
