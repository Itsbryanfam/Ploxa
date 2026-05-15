import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Resend } from "resend";
import { z } from "zod";

import { db, schema } from "@/lib/db";
import { env, requireEnv } from "@/lib/env";
import { cacheOrBuildYearly, cacheOrBuildMonthly } from "@/lib/recaps/cache-or-build";
import {
  renderRecapHtml,
  renderRecapPlainText,
  recapSubject,
} from "@/lib/email/recap-template";
import { signUnsubscribeToken } from "@/lib/email/unsubscribe-token";

/**
 * Internal recap-email cron endpoint — Phase 6 T18.
 *
 * Invoked by pg_cron on three schedules:
 *   - Dec 1  → mode=annual_preview   (current year preview)
 *   - Jan 5  → mode=annual_locked    (previous year finalised)
 *   - 1st of month → mode=monthly    (previous month mini-recap)
 *
 * Auth: same X-Cron-Secret / timingSafeEqual / 404 pattern as the
 * digest worker. Reuses CRON_SECRET env var (same Vault secret).
 *
 * Concurrency: BATCH_CONCURRENCY=5 workers drain a shared queue.
 * Per-row try/catch — one failure logs + skips, doesn't poison the batch.
 *
 * Resend SDK shape: returns {data, error}; does NOT throw on send failure.
 * We check sendResult.error explicitly before marking a send as "sent".
 *
 * last_recap_sent_at is updated AFTER counting the send (same as
 * last_digest_sent_at) so a DB-update failure doesn't understate the count.
 *
 * Sparse tier: payload.tier === "too_sparse" → skipped counter, no email, no
 * last_recap_sent_at update. The sparse decision is intentionally not cached
 * in the recap tables so the user gets a real email once they log more games.
 */
export const dynamic = "force-dynamic";

const BATCH_CONCURRENCY = 5;

// ─────────────────────────────────────────────────────────────
// Body schema
// ─────────────────────────────────────────────────────────────

const BodySchema = z.object({
  mode: z.enum(["annual_preview", "annual_locked", "monthly"]),
});

type RecapMode = z.infer<typeof BodySchema>["mode"];

// ─────────────────────────────────────────────────────────────
// Year / month derivation
// ─────────────────────────────────────────────────────────────

interface RecapWindow {
  year: number;
  monthIndex: number | null; // 1-based; null for yearly modes
}

function deriveWindow(mode: RecapMode, now: Date): RecapWindow {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1; // 1-based

  if (mode === "annual_preview") {
    // Dec 1 cron → preview of the current year (e.g. 2026 preview in Dec 2026)
    return { year, monthIndex: null };
  }
  if (mode === "annual_locked") {
    // Jan 5 cron → finalise previous year (e.g. 2026 locked in Jan 2027)
    return { year: year - 1, monthIndex: null };
  }
  // mode === "monthly": 1st of month → previous month's recap
  // Jan 1 → December of previous year; Feb 1 → January of current year
  if (month === 1) {
    return { year: year - 1, monthIndex: 12 };
  }
  return { year, monthIndex: month - 1 };
}

// ─────────────────────────────────────────────────────────────
// Cohort SQL
// ─────────────────────────────────────────────────────────────

interface Candidate {
  user_id: string;
  email: string;
  username: string;
  email_digest_cadence: string;
}

async function fetchCandidates(mode: RecapMode): Promise<Candidate[]> {
  if (mode === "annual_preview" || mode === "annual_locked") {
    // Yearly emails: daily + weekly + monthly cadence users.
    // db.execute<T> requires T extends Record<string,unknown> — use inline
    // object type and cast through unknown (same pattern as digest worker).
    const rows = (await db.execute<{
      user_id: string;
      email: string;
      username: string;
      email_digest_cadence: string;
    }>(sql`
      SELECT p.user_id, u.email, p.username, p.email_digest_cadence
      FROM profiles p
      JOIN auth.users u ON u.id = p.user_id
      WHERE p.email_digest_cadence IN ('daily', 'weekly', 'monthly')
        AND (p.last_recap_sent_at IS NULL OR p.last_recap_sent_at < now() - interval '20 hours')
        AND u.email IS NOT NULL
        AND p.deleted_at IS NULL
    `)) as unknown as Candidate[];
    return rows;
  }

  // mode === "monthly": only explicit monthly cadence users
  const rows = (await db.execute<{
    user_id: string;
    email: string;
    username: string;
    email_digest_cadence: string;
  }>(sql`
    SELECT p.user_id, u.email, p.username, p.email_digest_cadence
    FROM profiles p
    JOIN auth.users u ON u.id = p.user_id
    WHERE p.email_digest_cadence = 'monthly'
      AND (p.last_recap_sent_at IS NULL OR p.last_recap_sent_at < now() - interval '20 hours')
      AND u.email IS NOT NULL
      AND p.deleted_at IS NULL
  `)) as unknown as Candidate[];
  return rows;
}

// ─────────────────────────────────────────────────────────────
// Route handler
// ─────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  // Gate: header secret. 404 (not 401) hides route existence from scanners.
  // Length-equality short-circuit is required: timingSafeEqual throws on
  // byte-length mismatch. Same pattern as app/api/internal/digest/run/route.ts.
  const cronSecret = requireEnv("CRON_SECRET");
  const supplied = request.headers.get("x-cron-secret");
  const suppliedBuf = supplied ? Buffer.from(supplied) : null;
  const expectedBuf = Buffer.from(cronSecret);
  if (
    !suppliedBuf ||
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return new NextResponse(null, { status: 404 });
  }

  // Body parse
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { mode } = parsed.data;

  const now = new Date();
  const { year, monthIndex } = deriveWindow(mode, now);
  const fromAddress =
    env.RESEND_DIGEST_FROM_ADDRESS ?? "digest@ploxa.vercel.app";
  const baseUrl = env.NEXT_PUBLIC_APP_URL;
  const resendKey = requireEnv("RESEND_API_KEY");
  const resend = new Resend(resendKey);

  // Cohort SELECT
  let candidates: Candidate[];
  try {
    candidates = await fetchCandidates(mode);
  } catch (e) {
    console.error("recap-email: cohort SELECT failed:", e);
    return NextResponse.json({ error: "cohort query failed" }, { status: 500 });
  }

  if (candidates.length === 0) {
    return NextResponse.json({ mode, sent: 0, failed: 0, skipped: 0, candidates: 0 });
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  const queue = [...candidates];

  async function worker() {
    while (queue.length > 0) {
      const candidate = queue.shift();
      if (!candidate) return;
      try {
        // Pre-warm / build the recap row
        let payload;
        if (mode === "annual_preview" || mode === "annual_locked") {
          ({ payload } = await cacheOrBuildYearly({ userId: candidate.user_id, year }));
        } else {
          // monthIndex is always non-null for "monthly" mode (see deriveWindow)
          ({ payload } = await cacheOrBuildMonthly({
            userId: candidate.user_id,
            year,
            monthIndex: monthIndex!,
          }));
        }

        // Sparse tier → skip, no email, no timestamp update
        if (payload.tier === "too_sparse") {
          skipped++;
          continue;
        }

        // Build recap URL for the CTA button
        let recapUrl: string;
        if (mode === "annual_preview" || mode === "annual_locked") {
          recapUrl = `${baseUrl}/u/${candidate.username}/year/${year}`;
        } else {
          const mm = String(monthIndex!).padStart(2, "0");
          recapUrl = `${baseUrl}/u/${candidate.username}/month/${year}${mm}`;
        }

        const token = await signUnsubscribeToken(candidate.user_id);
        const unsubscribeUrl = `${baseUrl}/unsubscribe?token=${encodeURIComponent(token)}`;

        const emailMode: "yearly" | "monthly" =
          mode === "monthly" ? "monthly" : "yearly";

        const subject =
          mode === "monthly"
            ? recapSubject({ mode: "monthly", year, monthIndex: monthIndex! })
            : recapSubject({ mode: "yearly", year });

        const html = await renderRecapHtml({
          payload,
          mode: emailMode,
          recapUrl,
          unsubscribeUrl,
        });
        const text = renderRecapPlainText({
          payload,
          mode: emailMode,
          recapUrl,
          unsubscribeUrl,
        });

        // Resend returns {data, error} — does NOT throw on send failure.
        const sendResult = await resend.emails.send({
          from: fromAddress,
          to: candidate.email,
          subject,
          html,
          text,
        });
        if (sendResult.error) {
          console.error(
            `recap-email: Resend rejected send for ${candidate.user_id} (mode=${mode}):`,
            sendResult.error,
          );
          failed++;
          continue;
        }

        // Count BEFORE the DB update (same as digest worker rationale).
        sent++;

        // Update last_recap_sent_at — best-effort, log on failure
        try {
          await db
            .update(schema.profiles)
            .set({ lastRecapSentAt: now })
            .where(eq(schema.profiles.userId, candidate.user_id));
        } catch (dbErr) {
          console.error(
            `recap-email: lastRecapSentAt update failed AFTER successful send for ${candidate.user_id}; next cron may resend:`,
            dbErr,
          );
        }

        // annual_locked: also set year_in_reviews.locked_at if not already set.
        // Belt-and-suspenders — T19 lock cron bulk-updates this too.
        if (mode === "annual_locked") {
          try {
            await db
              .update(schema.yearInReviews)
              .set({ lockedAt: now })
              .where(
                and(
                  eq(schema.yearInReviews.userId, candidate.user_id),
                  eq(schema.yearInReviews.year, year),
                  isNull(schema.yearInReviews.lockedAt),
                ),
              );
          } catch (lockErr) {
            console.error(
              `recap-email: locked_at update failed for ${candidate.user_id} year=${year} (non-fatal):`,
              lockErr,
            );
          }
        }
      } catch (e) {
        console.error(`recap-email: pipeline failed for ${candidate.user_id} (mode=${mode}):`, e);
        failed++;
      }
    }
  }

  await Promise.all(Array.from({ length: BATCH_CONCURRENCY }, () => worker()));

  return NextResponse.json({ mode, sent, failed, skipped, candidates: candidates.length });
}
