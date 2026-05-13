import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import { z } from "zod";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import { db } from "@/lib/db";
import { platformConnections, imports } from "@/lib/db/schema";
import { encryptSecret } from "@/lib/imports/encryption";
import { xboxAdapter, XboxKeyInvalidError } from "@/lib/imports/adapters/xbox";
import { requireEnv } from "@/lib/env";
import { enforceRateLimit, RateLimitedError } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

const Body = z.object({ key: z.string().min(10).max(2000) });

export async function POST(req: NextRequest) {
  const user = await getCachedUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // Per-user rate limit on Xbox key validation — without it, a leaked
  // session cookie can pound OpenXBL with brute-force keys. 3 attempts
  // per 5 minutes covers legit retries (typo, expired key) and blocks
  // scraping behavior.
  try {
    await enforceRateLimit({
      scope: "connect:xbox",
      identifier: user.id,
      limit: 3,
      windowSeconds: 300,
    });
  } catch (err) {
    if (err instanceof RateLimitedError) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }
    throw err;
  }

  let connect;
  try {
    connect = await xboxAdapter.connect({ kind: "xbox", openxblKey: body.key });
  } catch (err) {
    if (err instanceof XboxKeyInvalidError) {
      return NextResponse.json({ error: "invalid_key" }, { status: 401 });
    }
    console.error("Xbox connect failed:", err);
    return NextResponse.json({ error: "xbl_error" }, { status: 502 });
  }

  const accessTokenEncrypted = encryptSecret(body.key);

  await db
    .insert(platformConnections)
    .values({
      userId: user.id,
      platform: "xbox",
      externalId: connect.externalId,
      accessTokenEncrypted,
      refreshTokenEncrypted: null,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: [platformConnections.userId, platformConnections.platform],
      set: { externalId: connect.externalId, accessTokenEncrypted, isActive: true },
    });

  const [importRow] = await db
    .insert(imports)
    .values({
      userId: user.id,
      platform: "xbox",
      status: "queued",
      surfaced: true,
    })
    .returning({ id: imports.id });

  // Trigger the Edge function after the response is sent. `after()` keeps
  // the request alive until the fetch completes — bare `fetch().catch()`
  // can be dropped when Next terminates the request handler before the
  // network call resolves, which silently lost ~1% of imports under load.
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

  return NextResponse.json({ importId: importRow.id, displayHandle: connect.displayHandle });
}
