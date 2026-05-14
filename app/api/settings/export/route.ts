import "server-only";
import { NextResponse } from "next/server";
import JSZip from "jszip";
import { eq } from "drizzle-orm";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { db, schema } from "@/lib/db";
import { exportUserData } from "@/lib/settings/data-export";
import { enforceRateLimit, RateLimitedError } from "@/lib/security/rate-limit";

export async function GET() {
  const user = await getCachedUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Cap to 3 exports per user per hour. Each call does a full DB dump +
  // JSON serialize + zip — much heavier than a typical request. The user
  // is only allowed to download their own data, so the limit prevents
  // accidental self-DoS (e.g., a buggy script polling the endpoint).
  try {
    await enforceRateLimit({
      scope: "settings:export",
      identifier: user.id,
      limit: 3,
      windowSeconds: 60 * 60,
    });
  } catch (err) {
    if (err instanceof RateLimitedError) {
      return new NextResponse(
        `Too many export requests. Try again in ${err.retryAfterSeconds}s.`,
        {
          status: 429,
          headers: { "Retry-After": String(err.retryAfterSeconds) },
        },
      );
    }
    throw err;
  }

  // Inline username lookup — avoids importing a "use server" action into a
  // route handler, which can be flaky depending on Next internals.
  const profile = await db.query.profiles.findFirst({
    where: eq(schema.profiles.userId, user.id),
    columns: { username: true },
  });
  const username = profile?.username ?? "unknown";

  const data = await exportUserData(user.id);

  // Compact JSON (no indent) — halves the peak heap pressure for power
  // users with thousands of logs/reviews. The file is machine-readable;
  // users who want pretty-printed JSON can run it through a formatter.
  const zip = new JSZip();
  zip.file("data.json", JSON.stringify(data));
  const zipBytes = await zip.generateAsync({ type: "uint8array" });
  const blob = Buffer.from(zipBytes);

  const today = new Date().toISOString().slice(0, 10);
  const filename = `ploxa-${username}-${today}.zip`;

  return new NextResponse(blob, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
