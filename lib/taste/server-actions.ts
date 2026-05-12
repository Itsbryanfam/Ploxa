"use server";

import "server-only";

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { logs, reviews, games, tasteFingerprints } from "@/lib/db/schema";
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
 */
export async function getFingerprint(userId: string): Promise<FingerprintSnapshot> {
  // Single join query pulling everything aggregateFingerprint needs.
  const rows = await db
    .select({
      status: logs.status,
      rating: logs.rating,
      hasPublishedReview: sql<boolean>`EXISTS (SELECT 1 FROM ${reviews} WHERE ${reviews.logId} = ${logs.id} AND ${reviews.publishedAt} IS NOT NULL)`,
      genres: games.genres,
      themes: games.themes,
      mechanics: games.mechanics,
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
    vectors: { genre: agg.genre, theme: agg.theme, mechanic: agg.mechanic },
    lengthPreference: agg.lengthPreference,
    narrative: fpRows[0]?.narrative ?? null,
    narrativeGeneratedAt: fpRows[0]?.narrativeGeneratedAt ?? null,
    logCount: inputRows.length,
  };
}
