import "server-only";
import { cache } from "react";
import { getAdminClient } from "./admin-client";

/**
 * True iff the auth.users row for `userId` has encrypted_password set.
 * Used by /settings/account to branch "Change password" (has password)
 * vs "Set password" (magic-link-only) UI, and by the reauth-actions to
 * decide whether to accept a password or only OTP code.
 *
 * Per-request memoized via React's cache() — same request multiple
 * consumers hit one admin SDK call.
 *
 * Fail-closed: any error from the admin SDK returns false. The downstream
 * UX falls back to OTP reauth, which is strictly safer than assuming the
 * user has a password they don't actually have.
 */
export const userHasPassword = cache(async (userId: string): Promise<boolean> => {
  const admin = getAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user) return false;
  // The Supabase types omit encrypted_password from the public surface,
  // but the admin endpoint returns it. Narrow with an explicit cast.
  const u = data.user as { encrypted_password?: string | null };
  return Boolean(u.encrypted_password);
});
