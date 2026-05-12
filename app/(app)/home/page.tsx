import { cookies } from "next/headers";
import { count, and, eq } from "drizzle-orm";

import { CockpitDashboard } from "../_cockpit/cockpit-dashboard";
import { ImportsNudge } from "@/components/imports/imports-nudge";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { db } from "@/lib/db";
import { logs, platformConnections } from "@/lib/db/schema";

export const metadata = { title: "Home — Letterboxd for Games" };

export default async function HomeRoute() {
  const user = await getCachedUser();

  let showNudge = false;
  if (user) {
    const dismissed =
      (await cookies()).get("imports-nudge-dismissed")?.value === "1";

    if (!dismissed) {
      const [{ value: logCount }] = await db
        .select({ value: count() })
        .from(logs)
        .where(eq(logs.userId, user.id));

      if (logCount >= 5 && logCount <= 30) {
        const [{ value: connCount }] = await db
          .select({ value: count() })
          .from(platformConnections)
          .where(
            and(
              eq(platformConnections.userId, user.id),
              eq(platformConnections.isActive, true),
            ),
          );
        showNudge = connCount === 0;
      }
    }
  }

  return (
    <>
      {showNudge && (
        <div className="mx-auto max-w-6xl px-6 pt-4">
          <ImportsNudge />
        </div>
      )}
      <CockpitDashboard />
    </>
  );
}
