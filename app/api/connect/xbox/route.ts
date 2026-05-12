import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import { db } from "@/lib/db";
import { platformConnections, imports } from "@/lib/db/schema";
import { encryptSecret } from "@/lib/imports/encryption";
import { xboxAdapter, XboxKeyInvalidError } from "@/lib/imports/adapters/xbox";
import { requireEnv } from "@/lib/env";

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

  // Fire-and-forget — do not await; failure is non-fatal
  fetch(`${requireEnv("SUPABASE_FUNCTIONS_URL")}/import-platform`, {
    method: "POST",
    headers: {
      apikey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ importId: importRow.id }),
  }).catch((err: unknown) => console.error("Edge Function trigger failed:", err));

  return NextResponse.json({ importId: importRow.id, displayHandle: connect.displayHandle });
}
