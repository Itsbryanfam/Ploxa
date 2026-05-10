import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

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
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=callback_failed`);
}
