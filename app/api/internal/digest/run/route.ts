import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { Resend } from "resend";

import { db, schema } from "@/lib/db";
import { env, requireEnv } from "@/lib/env";
import { buildDigest } from "@/lib/social/notifications/digest";
import {
  renderDigestHtml,
  renderDigestPlainText,
} from "@/lib/email/digest-template";
import { signUnsubscribeToken } from "@/lib/email/unsubscribe-token";

/**
 * Internal digest cron endpoint. Invoked by pg_cron once per day; selects
 * eligible users (cadence='daily' OR cadence='weekly' on Sunday), builds
 * each user's digest payload, renders HTML + plain text, and ships via
 * Resend.
 *
 * Auth: pg_cron passes a shared secret in the X-Cron-Secret header.
 * Anything else gets 404 (don't leak the route's existence to scanners
 * or surface it as a 401 that signals "secret exists, you guessed wrong").
 *
 * Concurrency: BATCH_CONCURRENCY workers drain a shared queue. Each send
 * is independent — one failure logs and skips, doesn't poison the others.
 * last_digest_sent_at is updated per-send so a partial run still reflects
 * accurate cooldowns on retry.
 */
export const dynamic = "force-dynamic";

const SUBJECT = "Your recap from Letterboxd for Games";
const BATCH_CONCURRENCY = 5;

export async function POST(request: Request) {
  // Gate: header secret check. 404 (not 401) hides the route's existence.
  const cronSecret = requireEnv("CRON_SECRET");
  const supplied = request.headers.get("x-cron-secret");
  if (!supplied || supplied !== cronSecret) {
    return new NextResponse(null, { status: 404 });
  }

  const resendKey = requireEnv("RESEND_API_KEY");
  const now = new Date();
  const dow = now.getUTCDay(); // 0 = Sunday
  const fromAddress =
    env.RESEND_DIGEST_FROM_ADDRESS ?? "digest@letterboxd-for-games.vercel.app";
  const baseUrl = env.NEXT_PUBLIC_APP_URL;

  // Candidate set: cadence='daily' OR (cadence='weekly' AND today is Sunday),
  // AND last_digest_sent_at IS NULL OR older than 20 hours (gives a 4-hour
  // tolerance window around the daily cron without re-sending).
  const rawCandidates = await db.execute<{
    user_id: string;
    email: string;
    username: string;
  }>(sql`
    SELECT p.user_id, u.email, p.username
    FROM profiles p
    JOIN auth.users u ON u.id = p.user_id
    WHERE (
        p.email_digest_cadence = 'daily'
        OR (p.email_digest_cadence = 'weekly' AND ${dow} = 0)
      )
      AND (p.last_digest_sent_at IS NULL OR p.last_digest_sent_at < now() - interval '20 hours')
      AND u.email IS NOT NULL
  `);

  // postgres-js RowList is array-like; cast through unknown to iterate directly.
  const candidates = rawCandidates as unknown as Array<{
    user_id: string;
    email: string;
    username: string;
  }>;

  if (candidates.length === 0) {
    return NextResponse.json({ sent: 0, candidates: 0 });
  }

  const resend = new Resend(resendKey);
  let sent = 0;
  let failed = 0;

  const queue = [...candidates];

  async function worker() {
    while (queue.length > 0) {
      const candidate = queue.shift();
      if (!candidate) return;
      try {
        const payload = await buildDigest(candidate.user_id);
        if (!payload) continue;

        const token = await signUnsubscribeToken(candidate.user_id);
        const unsubscribeUrl = `${baseUrl}/unsubscribe?token=${encodeURIComponent(token)}`;
        const html = await renderDigestHtml({ payload, unsubscribeUrl, baseUrl });
        const text = renderDigestPlainText({ payload, unsubscribeUrl });

        // Resend's SDK returns { data, error } and does NOT throw on send failure.
        // We must check error explicitly; otherwise a failed delivery would still
        // mark the user as "sent" and we'd skip them on the next cron tick.
        const sendResult = await resend.emails.send({
          from: fromAddress,
          to: candidate.email,
          subject: SUBJECT,
          html,
          text,
        });
        if (sendResult.error) {
          console.error(`Digest send rejected by Resend for ${candidate.user_id}:`, sendResult.error);
          failed++;
          continue;
        }

        // Count the send before the DB update. If the DB update fails the email
        // has already left our hands — we'd rather log the cooldown-state drift
        // than understate the count. (The next cron run would resend, producing
        // a duplicate; flag this loudly so the operator can intervene.)
        sent++;

        try {
          await db
            .update(schema.profiles)
            .set({ lastDigestSentAt: now })
            .where(eq(schema.profiles.userId, candidate.user_id));
        } catch (dbErr) {
          console.error(
            `lastDigestSentAt update failed AFTER successful send for ${candidate.user_id}; next cron tick may resend:`,
            dbErr,
          );
        }
      } catch (e) {
        console.error(`Digest pipeline failed for ${candidate.user_id}:`, e);
        failed++;
      }
    }
  }

  await Promise.all(Array.from({ length: BATCH_CONCURRENCY }, () => worker()));

  return NextResponse.json({ sent, failed, candidates: candidates.length });
}
