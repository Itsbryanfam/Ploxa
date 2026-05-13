import "server-only";
import { desc, eq, or } from "drizzle-orm";

import { db, schema } from "@/lib/db";

const { reports } = schema;

/**
 * Fetch the admin moderation queue (pending + auto_flagged reports), ordered
 * newest first.
 *
 * Kept out of `server-actions.ts` deliberately: this is a server-side data
 * loader called from the `/admin/reports` server component, not a client-
 * invoked action. Mixing it into a `"use server"` file would expose it as a
 * public Server Action endpoint, which is unnecessary surface area. Use
 * `"server-only"` instead to enforce server-only consumption.
 */
export async function getReportQueue(opts: { limit?: number; offset?: number } = {}) {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  return await db
    .select()
    .from(reports)
    .where(or(eq(reports.status, "pending"), eq(reports.status, "auto_flagged")))
    .orderBy(desc(reports.createdAt))
    .limit(limit)
    .offset(offset);
}
