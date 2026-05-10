import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureMyProfile } from "@/lib/profile/server-actions";

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
  // Only honor relative paths — prevents open-redirect via crafted `?next=`.
  const rawNext = searchParams.get("next") ?? "/home";
  const next = rawNext.startsWith("/") ? rawNext : "/home";

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
      await ensureMyProfile(metadataUsername ? { username: metadataUsername } : undefined);
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=callback_failed`);
}
