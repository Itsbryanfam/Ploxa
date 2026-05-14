"use server";

import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  logs,
  reviews,
  games,
  profiles,
  tasteFingerprints,
  recommendations,
} from "@/lib/db/schema";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import {
  enforceRateLimit,
  RateLimitedError,
} from "@/lib/security/rate-limit";
import {
  aggregateFingerprint,
  type AggregateInputRow,
} from "@/lib/taste/aggregate";
import { tierForUser, type TasteTier } from "@/lib/taste/tier";
import type { VectorBundle } from "@/lib/taste/vectors";

export type FingerprintSnapshot = {
  tier: TasteTier;
  vectors: VectorBundle;
  lengthPreference: Record<string, number>;
  /** Narrative text from DB; null when not yet generated (sparse/empty) or never refreshed (T4+). */
  narrative: string | null;
  narrativeGeneratedAt: Date | null;
  logCount: number;
};

/**
 * Read-only snapshot for rendering /u/{name}/taste.
 *
 * In Task 3 this is vector-only — no AI narrative yet (the column is null
 * for everyone). Task 4 wires the Edge Function that fills narrative.
 *
 * Aggregation is computed live on every call. Cheap enough for a 1000-log
 * power user (<50ms). When this becomes a hot path we'll move to a stored
 * row + cron-driven refresh; not yet.
 *
 * Visibility: this is a `"use server"` export — any authenticated network
 * caller can hit it directly with an arbitrary userId, bypassing the
 * page-level visibility gate at /u/[username]/taste. Defend in depth here:
 * the snapshot is returned ONLY when the viewer is the target user OR the
 * target profile is public AND not soft-deleted. Returns null otherwise so
 * direct-RPC probes look identical to "user not found".
 */
export async function getFingerprint(userId: string): Promise<FingerprintSnapshot | null> {
  // Visibility gate (mirrors the page-level check at /u/[username]/taste).
  // We always look up the profile so we can also reject queries against
  // soft-deleted users — a public-but-deleted profile shouldn't surface
  // taste data via direct RPC even though pages 404 on it.
  const viewer = await getCachedUser();
  const targetProfile = await db.query.profiles.findFirst({
    where: eq(profiles.userId, userId),
    columns: { userId: true, isPublic: true, deletedAt: true },
  });
  if (!targetProfile) return null;
  if (targetProfile.deletedAt !== null) return null;
  const isOwner = viewer?.id === targetProfile.userId;
  if (!isOwner && !targetProfile.isPublic) return null;

  // Single join query pulling everything aggregateFingerprint needs.
  const rows = await db
    .select({
      status: logs.status,
      rating: logs.rating,
      hasPublishedReview: sql<boolean>`EXISTS (SELECT 1 FROM ${reviews} WHERE ${reviews.logId} = ${logs.id} AND ${reviews.publishedAt} IS NOT NULL)`,
      genres: games.genres,
      themes: games.themes,
      mechanics: games.mechanics,
      gameModes: games.gameModes,
      playerPerspectives: games.playerPerspectives,
      playtimeAvgHours: games.playtimeAvgHours,
    })
    .from(logs)
    .innerJoin(games, eq(games.id, logs.gameId))
    .where(eq(logs.userId, userId));

  const inputRows: AggregateInputRow[] = rows.map((r) => ({
    status: r.status,
    rating: r.rating != null ? Number(r.rating) : null,
    hasPublishedReview: r.hasPublishedReview,
    genres: r.genres ?? [],
    themes: r.themes ?? [],
    mechanics: r.mechanics ?? [],
    gameModes: r.gameModes ?? [],
    playerPerspectives: r.playerPerspectives ?? [],
    playtimeAvgHours: r.playtimeAvgHours != null ? Number(r.playtimeAvgHours) : null,
  }));

  const agg = aggregateFingerprint({ rows: inputRows });

  // Pull the persisted narrative (if any) without forcing a write.
  const fpRows = await db
    .select({
      narrative: tasteFingerprints.narrativeSummary,
      narrativeGeneratedAt: tasteFingerprints.narrativeGeneratedAt,
    })
    .from(tasteFingerprints)
    .where(eq(tasteFingerprints.userId, userId))
    .limit(1);

  return {
    tier: tierForUser(inputRows.length),
    vectors: { genre: agg.genre, theme: agg.theme, mechanic: agg.mechanic, gameMode: agg.gameMode, playerPerspective: agg.playerPerspective },
    lengthPreference: agg.lengthPreference,
    narrative: fpRows[0]?.narrative ?? null,
    narrativeGeneratedAt: fpRows[0]?.narrativeGeneratedAt ?? null,
    logCount: inputRows.length,
  };
}

export type RefreshFingerprintResult =
  | { ok: true; snapshot: FingerprintSnapshot }
  | {
      ok: false;
      reason: "unauthorized" | "rate-limited" | "ai-failure";
      retryAfterSeconds?: number;
    };

/**
 * Manual refresh entry point for /u/{name}/taste (owner-only) — invoked by
 * the refresh-button client island in T6. Rate-limited to 3 refreshes per
 * 24h per user so the AI router quota isn't blown by impatient clicking.
 * The empty tier short-circuits without an Edge call; sparse tier still
 * hits the Edge Function but the function itself skips the AI narrative
 * call (vectors-only persist). See supabase/functions/refresh-fingerprint.
 *
 * Visibility: this is a `"use server"` export — any authenticated network
 * caller can hit it directly. Identity is ALWAYS derived from
 * `getCachedUser()`; the function takes NO arguments, so there is no
 * caller-supplied userId surface to spoof. The Edge Function call carries
 * `me.id` from the session, and the recommendation cache invalidation also
 * keys on `me.id`. A regression that re-introduced a userId parameter (or
 * trusted one off `args`) would let one user trigger refreshes against
 * another's fingerprint and burn their AI quota — pin this contract.
 */
export async function refreshFingerprint(): Promise<RefreshFingerprintResult> {
  const me = await getCachedUser();
  if (!me) return { ok: false, reason: "unauthorized" };

  // 3 manual refreshes per user per 24h. Generous enough for a curious
  // user re-checking after logging more games; tight enough that a stuck
  // client can't burn through router quota in a tight loop.
  try {
    await enforceRateLimit({
      scope: "taste:refresh",
      identifier: me.id,
      limit: 3,
      windowSeconds: 24 * 60 * 60,
    });
  } catch (err) {
    if (err instanceof RateLimitedError) {
      return {
        ok: false,
        reason: "rate-limited",
        retryAfterSeconds: err.retryAfterSeconds,
      };
    }
    throw err;
  }

  // Empty tier short-circuit: nothing to aggregate, no AI to call. Return
  // the (empty) snapshot directly so the page can re-render without
  // round-tripping to the Edge Function for a known no-op.
  //
  // `getFingerprint` is owner-or-public; here we always pass our own id,
  // so the only null path is "profile row missing entirely" (e.g. just-
  // signed-up user without ensureMyProfile having run yet). Treat that
  // as ai-failure rather than crashing — the UI shows a toast.
  const before = await getFingerprint(me.id);
  if (!before) return { ok: false, reason: "ai-failure" };
  if (before.tier === "empty") {
    return { ok: true, snapshot: before };
  }

  // Edge Function lives at SUPABASE_FUNCTIONS_URL; the project URL +
  // `/functions/v1` is the documented fallback when Supabase doesn't
  // expose a custom domain. Missing service-role key is treated as
  // ai-failure rather than a crash — the UI can render a toast and the
  // user can retry once env is fixed.
  const functionsUrl =
    process.env.SUPABASE_FUNCTIONS_URL ??
    (process.env.NEXT_PUBLIC_SUPABASE_URL
      ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1`
      : null);
  const apikey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!functionsUrl || !apikey) {
    console.error(
      "refreshFingerprint: missing SUPABASE_FUNCTIONS_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
    return { ok: false, reason: "ai-failure" };
  }

  let resp: Response;
  try {
    resp = await fetch(`${functionsUrl}/refresh-fingerprint`, {
      method: "POST",
      headers: { apikey, "Content-Type": "application/json" },
      body: JSON.stringify({ userId: me.id, reason: "manual" }),
    });
  } catch (err) {
    console.error("refreshFingerprint: Edge Function fetch failed:", err);
    return { ok: false, reason: "ai-failure" };
  }
  if (!resp.ok) {
    console.error(
      "refreshFingerprint: Edge Function non-OK:",
      resp.status,
      await resp.text().catch(() => "<unreadable body>"),
    );
    return { ok: false, reason: "ai-failure" };
  }

  // Vector change invalidates the recommendation cache. Dismissed rows
  // are preserved — they're the negative-context history that future
  // rerank calls feed back into the prompt (see Phase 4 spec).
  await db
    .delete(recommendations)
    .where(
      and(
        eq(recommendations.userId, me.id),
        eq(recommendations.dismissed, false),
      ),
    );

  // Same null-path reasoning as `before` above — own-id guarantees the
  // owner branch in getFingerprint, so the only null is missing profile.
  const after = await getFingerprint(me.id);
  if (!after) return { ok: false, reason: "ai-failure" };
  return { ok: true, snapshot: after };
}
