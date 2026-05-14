"use server";

import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { userHasPassword } from "./user-has-password";
import {
  verifyCurrentPassword,
  verifyReauthOtp,
  ReauthFailedError,
} from "./reauth-actions";

/**
 * Client-validated minimum. Must match (or be stricter than) the
 * Supabase project's Auth → Password Settings → Minimum length. Default
 * Supabase minimum is 6; this project enforces 8 as an app-level floor.
 * If the dashboard setting is ever raised above 8, raise this in lockstep
 * so the user gets a friendly inline error rather than a raw SDK message.
 */
const MIN_PASSWORD = 8;

export type UpdatePasswordResult = { ok: true } | { ok: false; error: string };

/**
 * Set or change the user's password. Branches the reauth gate on
 * userHasPassword: existing-password users provide their current pwd;
 * magic-link-only users complete an OTP challenge.
 *
 * Validation happens before reauth (no point asking for the gate if the
 * new password is obviously invalid). Each return path yields a typed
 * discriminated union the form can switch on.
 */
export async function updatePassword(
  form: FormData,
): Promise<UpdatePasswordResult> {
  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const newPassword = String(form.get("new_password") ?? "");
  const confirm = String(form.get("new_password_confirm") ?? "");
  if (newPassword.length < MIN_PASSWORD) {
    return {
      ok: false,
      error: `Password must be at least ${MIN_PASSWORD} characters.`,
    };
  }
  if (newPassword !== confirm) {
    return { ok: false, error: "Passwords don't match." };
  }

  // Reauth gate. Branches on whether the user currently has a password.
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

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
