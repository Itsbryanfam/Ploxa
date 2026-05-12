import { NextResponse, type NextRequest } from "next/server";
import { RelyingParty, type VerifyResult } from "openid";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import { db } from "@/lib/db";
import { platformConnections, imports } from "@/lib/db/schema";
import { env, requireEnv } from "@/lib/env";
import { steamAdapter } from "@/lib/imports/adapters/steam";

export const dynamic = "force-dynamic";

const STEAMID_RE = /\/openid\/id\/(\d+)$/;

export async function GET(req: NextRequest) {
  const user = await getCachedUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const realm = env.NEXT_PUBLIC_APP_URL;
  const returnUrl = `${realm}/api/auth/steam/callback`;

  // Strict return_to match — the response's return_to must equal what we sent.
  const responseReturnTo = req.nextUrl.searchParams.get("openid.return_to");
  if (responseReturnTo !== returnUrl) {
    return NextResponse.redirect(`${realm}/settings?error=steam_return_to_mismatch`);
  }

  const relyingParty = new RelyingParty(returnUrl, realm, true, false, []);

  const verified = await new Promise<VerifyResult | null>((resolve) => {
    relyingParty.verifyAssertion(req.url, (err, result) => {
      if (err || !result.authenticated) {
        resolve(null);
        return;
      }
      resolve(result);
    });
  });

  if (!verified) {
    return NextResponse.redirect(`${realm}/settings?error=steam_openid_verify_failed`);
  }

  const claimedId = verified.claimedIdentifier;
  const match = claimedId?.match(STEAMID_RE);
  if (!match) {
    return NextResponse.redirect(`${realm}/settings?error=steam_id_extract_failed`);
  }
  const steamId = match[1];

  // Best-effort persona fetch (result unused — connect() upserts display handle elsewhere)
  await steamAdapter.connect({ kind: "steam", steamId }).catch(() => {
    // Swallow — persona name is optional; SteamID is all we need to proceed
  });

  // Upsert platform_connections
  await db
    .insert(platformConnections)
    .values({
      userId: user.id,
      platform: "steam",
      externalId: steamId,
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: [platformConnections.userId, platformConnections.platform],
      set: { externalId: steamId, isActive: true },
    });

  // Insert imports row
  const [importRow] = await db
    .insert(imports)
    .values({
      userId: user.id,
      platform: "steam",
      status: "queued",
      surfaced: true,
    })
    .returning({ id: imports.id });

  // Fire-and-forget — do not await; failure is non-fatal
  fetch(`${requireEnv("SUPABASE_FUNCTIONS_URL")}/import-platform`, {
    method: "POST",
    headers: {
      apikey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ importId: importRow.id }),
  }).catch((err: unknown) => console.error("Edge Function trigger failed:", err));

  return NextResponse.redirect(`${realm}/library/import/${importRow.id}`);
}
