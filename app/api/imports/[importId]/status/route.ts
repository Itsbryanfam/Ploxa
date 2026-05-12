import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import { db } from "@/lib/db";
import { imports } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const STUCK_QUEUE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

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

  const stuck =
    row.status === "queued" &&
    Date.now() - new Date(row.createdAt).getTime() > STUCK_QUEUE_THRESHOLD_MS;

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
