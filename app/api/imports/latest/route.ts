import { NextResponse } from "next/server";
import { and, desc, eq, gt, sql } from "drizzle-orm";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import { db } from "@/lib/db";
import { imports } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCachedUser();
  if (!user) return NextResponse.json({ active: null, recentSuccess: null, delta: [] }, { status: 401 });

  // All three buckets are independent — fire them in parallel. The toast
  // polls this every 2s during an active import, so collapsing 3 RTT into
  // 1 saves real DB time across an import session.
  const [activeRows, recentSuccessRows, delta] = await Promise.all([
    db
      .select()
      .from(imports)
      .where(
        and(
          eq(imports.userId, user.id),
          sql`${imports.status} IN ('queued','running','failed')`,
        ),
      )
      .orderBy(desc(imports.createdAt))
      .limit(1),
    db
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
      .limit(1),
    db
      .select()
      .from(imports)
      .where(
        and(
          eq(imports.userId, user.id),
          eq(imports.surfaced, false),
          eq(imports.status, "completed"),
          gt(imports.importedCount, 0),
        ),
      ),
  ]);

  return NextResponse.json({
    active: activeRows[0] ?? null,
    recentSuccess: recentSuccessRows[0] ?? null,
    delta,
  });
}
