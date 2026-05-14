"use server";

import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { enforceRateLimit, RateLimitedError } from "@/lib/security/rate-limit";
// ReauthFailedError lives in a separate module — Next.js 16's `"use server"`
// directive only allows async-function exports. The class is imported here
// for use in the catch / rethrow flow, and consumers import it directly
// from `@/lib/auth/reauth-errors`.
import { ReauthFailedError } from "./reauth-errors";

async function currentEmail(): Promise<string> {
  // Unreachable in practice — (app)/layout.tsx redirects unauthenticated
  // users to /login before any settings server action runs. Kept as a
  // defense-in-depth so the action can never accidentally key reauth on
  // an empty email.
  const user = await getCachedUser();
  if (!user?.email) throw new ReauthFailedError("Not signed in");
  return user.email;
}

async function rateLimit(
  scope: string,
  identifier: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  try {
    await enforceRateLimit({ scope, identifier, limit, windowSeconds });
  } catch (err) {
    if (err instanceof RateLimitedError) {
      throw new ReauthFailedError(
        `Too many attempts — try again in ${err.retryAfterSeconds}s`,
      );
    }
    throw err;
  }
}

export async function verifyCurrentPassword(password: string): Promise<void> {
  const email = await currentEmail();
  await rateLimit("reauth:pwd", email, 10, 5 * 60);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new ReauthFailedError("Wrong password");
  // We only needed to verify; the session is fine to keep (Supabase returns
  // a fresh one — that's harmless, the user is already signed in).
}

export async function sendReauthOtp(): Promise<void> {
  const email = await currentEmail();
  await rateLimit("reauth:otp-send", email, 3, 60 * 60);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });
  if (error) throw new ReauthFailedError("Could not send code");
}

export async function verifyReauthOtp(code: string): Promise<void> {
  const email = await currentEmail();
  await rateLimit("reauth:otp-verify", email, 10, 5 * 60);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
  if (error) throw new ReauthFailedError("Wrong or expired code");
}
