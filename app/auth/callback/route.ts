import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureMyProfile } from "@/lib/profile/server-actions";
import { UsernameCollisionError } from "@/lib/profile/errors";
import { safeRedirectPath } from "@/lib/auth/safe-next";
import {
  isAccountSoftDeleted,
  DELETION_GRACE_MS,
} from "@/lib/settings/account-deletion-actions";

/**
 * OAuth + magic link callback handler.
 *
 * Supabase appends ?code=... after the user clicks the email link.
 * We exchange it for a session, then redirect to the originally-requested
 * page (passed in ?next=) or home.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  // Sanitize `next` to prevent open-redirect via protocol-relative
  // (`//evil.com`) or backslash-protocol (`/\evil.com`) URLs.
  const next = safeRedirectPath(searchParams.get("next"));

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Pull the username the user chose at signup from Supabase user metadata.
      // It was stored via signUp options.data.username so it survives the
      // email-confirmation round-trip. Non-signup flows (magic link, OAuth) won't
      // have it, and ensureMyProfile falls back to email-prefix derivation.
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const metadataUsername =
        typeof user?.user_metadata?.username === "string"
          ? user.user_metadata.username
          : undefined;
      try {
        await ensureMyProfile(metadataUsername ? { username: metadataUsername } : undefined);
      } catch (err) {
        // The username the user picked at signup was grabbed by someone
        // else between signup and email confirmation. Fall back to
        // email-prefix derivation so they at least get a profile and a
        // working session — far better than a 500. They can rename in
        // /settings (Task 12) once they're in.
        if (err instanceof UsernameCollisionError) {
          await ensureMyProfile();
        } else {
          throw err;
        }
      }
      // Soft-delete grace-window check: if the user soft-deleted their account
      // (profiles.deleted_at IS NOT NULL) and is within the 30-day window,
      // send them to the cancel-deletion page instead of wherever they were going.
      // This suppresses any ?next= override — a soft-deleted user should not
      // silently slip back into the app without acknowledging the pending deletion.
      if (user) {
        const deletedAt = await isAccountSoftDeleted(user.id);
        if (deletedAt) {
          const ageMs = Date.now() - deletedAt.getTime();
          if (ageMs < DELETION_GRACE_MS) {
            // Within grace window — surface the cancel UI.
            return NextResponse.redirect(new URL("/cancel-deletion", request.url));
          }
          // Past grace window: purge cron should have removed the auth.users row
          // before this point, but handle the race gracefully.
          return NextResponse.redirect(new URL("/account-deleted", request.url));
        }
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=callback_failed`);
}
