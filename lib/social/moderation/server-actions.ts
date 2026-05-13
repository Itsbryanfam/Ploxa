"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { redis } from "@/lib/cache/redis";
import { isAdmin } from "./admin";

const { reports, comments } = schema;

const createSchema = z.object({
  targetType: z.enum(["comment", "review", "list", "profile"]),
  targetId: z.string().uuid(),
  reason: z.enum(["spam", "harassment", "spoiler", "off_topic", "other"]),
  details: z.string().max(500).optional(),
});

const REPORT_RATE_LIMIT = 10;
const REPORT_RATE_WINDOW_SECONDS = 60 * 60; // 1 hour

/**
 * Submit a user-initiated report. Auth required, 10/hour per user.
 *
 * Rate limit uses the INCR-then-conditional-DECR reservation pattern
 * (matches lib/ai/rate-limit.ts) so concurrent bursts can't overshoot the
 * cap. The bucket key includes the current hour epoch so old buckets age
 * out naturally; `expire` is set to 2× the window so a hard process
 * crash mid-bucket doesn't leave a perpetual key.
 */
export async function createReport(input: unknown): Promise<{ ok: boolean; reason?: string }> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid-input" };

  const user = await getCachedUser();
  if (!user) return { ok: false, reason: "not-authenticated" };

  const windowBucket = Math.floor(Date.now() / 1000 / REPORT_RATE_WINDOW_SECONDS);
  const key = `report:${user.id}:${windowBucket}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, REPORT_RATE_WINDOW_SECONDS * 2);
  }
  if (count > REPORT_RATE_LIMIT) {
    await redis.decr(key);
    return { ok: false, reason: "rate-limited" };
  }

  await db.insert(reports).values({
    reporterId: user.id,
    targetType: parsed.data.targetType,
    targetId: parsed.data.targetId,
    reason: parsed.data.reason,
    details: parsed.data.details ?? null,
    status: "pending",
  });

  return { ok: true };
}

const resolveSchema = z.object({
  reportId: z.string().uuid(),
  action: z.enum(["hide", "keep"]),
  resolverNote: z.string().max(500).optional(),
});

/**
 * Admin-only: resolve a pending/auto_flagged report.
 *
 * For `action='hide'` on `targetType='comment'`, sets `comments.is_hidden=true`
 * at the DB level. Reviews/lists/profiles don't have an `is_hidden` column
 * in the current schema — for Phase 5 those resolutions are metadata-only
 * (status + resolved_at + resolved_by recorded; the moderator must take
 * out-of-band action). Future phases can add `is_hidden` to reviews/lists
 * to extend automated hide.
 */
export async function resolveReport(input: unknown): Promise<{ ok: boolean; reason?: string }> {
  const parsed = resolveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid-input" };

  const user = await getCachedUser();
  if (!isAdmin(user?.id)) return { ok: false, reason: "not-authorized" };

  const report = await db.query.reports.findFirst({
    where: eq(reports.id, parsed.data.reportId),
  });
  if (!report) return { ok: false, reason: "not-found" };

  if (parsed.data.action === "hide" && report.targetType === "comment") {
    await db
      .update(comments)
      .set({ isHidden: true })
      .where(eq(comments.id, report.targetId));
  }

  await db
    .update(reports)
    .set({
      status: parsed.data.action === "hide" ? "resolved_action_taken" : "resolved_no_action",
      resolvedAt: new Date(),
      resolvedBy: user!.id,
      resolverNote: parsed.data.resolverNote ?? null,
    })
    .where(eq(reports.id, parsed.data.reportId));

  revalidatePath("/admin/reports");
  return { ok: true };
}
