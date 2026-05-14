"use server";

import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth-cache";

export type SignOutOthersResult = { ok: true } | { ok: false; error: string };

/**
 * Signs out the current user on all OTHER active sessions (scope: 'others').
 * The local browser session remains intact — the caller stays signed in.
 *
 * Used by /settings/account → "Sign out other sessions" — useful after
 * losing a device, signing in on a friend's computer, etc.
 *
 * Auth gate is defense-in-depth: the (app) layout already redirects
 * unauthenticated users, but mirroring updatePassword's pattern keeps
 * the two account-mutating actions structurally consistent.
 */
export async function signOutOtherSessions(): Promise<SignOutOthersResult> {
  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
