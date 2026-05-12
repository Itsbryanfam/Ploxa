import { NextResponse } from "next/server";
import { and, desc, eq, gt, sql } from "drizzle-orm";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import { db } from "@/lib/db";
import { imports } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCachedUser();
  if (!user) return NextResponse.json({ active: null, recentSuccess: null, delta: [] }, { status: 401 });

  // Active import (queued, running, or failed)
  const [active] = await db
    .select()
    .from(imports)
    .where(
      and(
        eq(imports.userId, user.id),
        sql`${imports.status} IN ('queued','running','failed')`,
      ),
    )
    .orderBy(desc(imports.createdAt))
    .limit(1);

  // Recent successful import (last 60s, already surfaced) for the "success" pill
  const [recentSuccess] = await db
    .select()
    .from(imports)
    .where(
      and(
        eq(imports.userId, user.id),
        eq(imports.status, "completed"),
        sql`${imports.completedAt} > now() - interval '60 seconds'`,
        eq(imports.surfaced, true),
      ),
    )
    .orderBy(desc(imports.completedAt))
    .limit(1);

  // Unsurfaced deltas (cron-driven background imports)
  const delta = await db
    .select()
    .from(imports)
    .where(
      and(
        eq(imports.userId, user.id),
        eq(imports.surfaced, false),
        eq(imports.status, "completed"),
        gt(imports.importedCount, 0),
      ),
    );

  return NextResponse.json({
    active: active ?? null,
    recentSuccess: recentSuccess ?? null,
    delta,
  });
}
