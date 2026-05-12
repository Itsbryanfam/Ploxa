import { NextResponse } from "next/server";
import { RelyingParty } from "openid";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCachedUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const realm = env.NEXT_PUBLIC_APP_URL;
  const returnUrl = `${realm}/api/auth/steam/callback`;
  const relyingParty = new RelyingParty(
    returnUrl,
    realm,
    true,   // stateless mode — no session storage
    false,  // strict mode off (Steam's OpenID realm is `https://steamcommunity.com/openid`)
    [],
  );

  return await new Promise<NextResponse>((resolve) => {
    relyingParty.authenticate(
      "https://steamcommunity.com/openid",
      false,
      (err, authUrl) => {
        if (err || !authUrl) {
          console.error("Steam OpenID start failed:", err);
          resolve(NextResponse.redirect(`${realm}/settings?error=steam_openid_start`));
          return;
        }
        resolve(NextResponse.redirect(authUrl));
      },
    );
  });
}
