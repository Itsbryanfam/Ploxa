import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe-token";
import { db, schema } from "@/lib/db";

/**
 * One-click unsubscribe handler. GET-only (the link is rendered as <a>
 * inside emails; users can't POST without a form). The route verifies
 * the JWT, flips cadence to 'off', and redirects to a confirmation page.
 *
 * Token has no expiry by design (see lib/email/unsubscribe-token.ts) so
 * even years-old links continue to work. The audience-scoped signing
 * key means a leaked token can ONLY unsubscribe — it can't authorize
 * anything else.
 *
 * Pre-fetch tradeoff: email-client safety scanners (Outlook ATP,
 * Gmail SafeBrowsing) may GET the link before the user clicks. The state
 * change (cadence='off') is idempotent and reversible — the user can
 * re-enable in /settings/notifications — so a pre-fetch unsub is at
 * most a nuisance. Documented mitigation: not implemented yet, but
 * future versions could add an intermediate confirmation page that
 * requires a POST click.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/unsubscribe/invalid", url.origin));
  }

  const userId = await verifyUnsubscribeToken(token);
  if (!userId) {
    return NextResponse.redirect(new URL("/unsubscribe/invalid", url.origin));
  }

  await db
    .update(schema.profiles)
    .set({ emailDigestCadence: "off" })
    .where(eq(schema.profiles.userId, userId));

  return NextResponse.redirect(new URL("/unsubscribe/confirmed", url.origin));
}
