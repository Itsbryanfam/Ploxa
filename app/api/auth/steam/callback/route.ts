import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
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

  // Best-effort persona fetch. We persist displayHandle on platform_connections
  // for the profile-page connector pill ("Steam · papi"). A failed fetch must
  // not block the connection — Steam API hiccups happen and a SteamID alone is
  // enough for imports + a generic "Steam" pill.
  const connectResult = await steamAdapter
    .connect({ kind: "steam", steamId })
    .catch(() => null);
  const displayName = connectResult?.displayHandle ?? null;

  // Upsert platform_connections
  await db
    .insert(platformConnections)
    .values({
      userId: user.id,
      platform: "steam",
      externalId: steamId,
      displayName,
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: [platformConnections.userId, platformConnections.platform],
      // Only overwrite displayName when a fresh non-null value came back;
      // a transient Steam API failure shouldn't clobber the cached gamertag.
      set: displayName
        ? { externalId: steamId, displayName, isActive: true }
        : { externalId: steamId, isActive: true },
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

  // Trigger via after() so the fetch survives the redirect — bare
  // fire-and-forget had a race where Next could terminate the request
  // handler before the trigger fetch completed.
  after(() =>
    fetch(`${requireEnv("SUPABASE_FUNCTIONS_URL")}/import-platform`, {
      method: "POST",
      headers: {
        apikey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ importId: importRow.id }),
    }).catch((err: unknown) => console.error("Edge Function trigger failed:", err)),
  );

  return NextResponse.redirect(`${realm}/library/import/${importRow.id}`);
}
