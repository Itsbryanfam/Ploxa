"use server";

import "server-only";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { userHasPassword } from "./user-has-password";
import {
  verifyCurrentPassword,
  verifyReauthOtp,
  ReauthFailedError,
} from "./reauth-actions";
import { getAdminClient } from "./admin-client";

const emailSchema = z.string().email();

export type UpdateEmailResult = { ok: true } | { ok: false; error: string };

/**
 * Initiates the change-email flow. Validates input, gates on reauth
 * (password OR OTP per userHasPassword), and calls auth.updateUser({email}).
 * Supabase's both-confirm flow then emails a confirmation link to BOTH
 * the old and new addresses; the change applies once both are clicked.
 */
export async function updateEmailAddress(
  form: FormData,
): Promise<UpdateEmailResult> {
  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const newEmail = String(form.get("new_email") ?? "");
  const parsed = emailSchema.safeParse(newEmail);
  if (!parsed.success) {
    return { ok: false, error: "Enter a valid email address." };
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

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ email: parsed.data });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Returns the live-actual auth.users.email for the current user via the
 * admin SDK. Used by the change-email form's pending-change poll: when
 * this differs from the cached user.email, one of the confirmation links
 * has been clicked and the change is starting to take effect.
 *
 * Returns null if no user (or admin SDK errors — fail-closed; the poll
 * just keeps trying).
 */
export async function getLiveCurrentEmail(): Promise<string | null> {
  const user = await getCachedUser();
  if (!user) return null;
  const admin = getAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(user.id);
  if (error || !data?.user) return null;
  return data.user.email ?? null;
}
