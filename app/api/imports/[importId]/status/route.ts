import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import { db } from "@/lib/db";
import { imports } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

// `stuck` triggers when an import has spent too long in a non-terminal
// state. Two thresholds because the worker behaviors differ:
//   - queued: never picked up by the Edge Function trigger
//   - running: picked up but mid-import worker hung / Steam API stalled
// Both surface the same "import paused — retry?" UI; the second one
// catches zombie polls that previously ran indefinitely.
const STUCK_QUEUE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const STUCK_RUNNING_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ importId: string }> },
) {
  const user = await getCachedUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { importId } = await params;

  const [row] = await db
    .select()
    .from(imports)
    .where(and(eq(imports.id, importId), eq(imports.userId, user.id)))
    .limit(1);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Age is measured from createdAt for queued (never picked up) and from
  // startedAt for running (worker began but stalled). Falls back to
  // createdAt when startedAt is null (the queued→running transition
  // hadn't landed before the poll arrived).
  const queuedAgeMs = Date.now() - new Date(row.createdAt).getTime();
  const runningAgeMs = Date.now() - new Date(row.startedAt ?? row.createdAt).getTime();
  const stuck =
    (row.status === "queued" && queuedAgeMs > STUCK_QUEUE_THRESHOLD_MS) ||
    (row.status === "running" && runningAgeMs > STUCK_RUNNING_THRESHOLD_MS);

  return NextResponse.json({
    id: row.id,
    status: row.status,
    stuck,
    importedCount: row.importedCount,
    totalCount: row.totalCount,
    errorMessage: row.errorMessage,
    conflicts: row.conflictsJsonb,
    unmatched: row.unmatchedJsonb,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  });
}
