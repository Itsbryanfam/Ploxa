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
  //
  // "Active" semantics:
  //   - queued / running: always active (a sync is genuinely in flight)
  //   - failed: active ONLY when no later completed import exists for the
  //     same platform. Once the user has successfully re-synced after a
  //     failure, the failure is functionally resolved and the toast must
  //     drop it — otherwise a stale failed row sits in the corner forever.
  //     Bug surfaced when a Steam WORKER_RESOURCE_LIMIT failure from a
  //     day prior was still flagging "steam sync paused" days after the
  //     user had successfully re-synced Steam multiple times.
  const [activeRows, recentSuccessRows, delta] = await Promise.all([
    db
      .select()
      .from(imports)
      .where(
        and(
          eq(imports.userId, user.id),
          sql`(
            ${imports.status} IN ('queued','running')
            OR (
              ${imports.status} = 'failed'
              AND NOT EXISTS (
                SELECT 1 FROM imports later
                WHERE later.user_id = ${imports.userId}
                  AND later.platform = ${imports.platform}
                  AND later.status = 'completed'
                  AND later.created_at > ${imports.createdAt}
              )
            )
          )`,
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
