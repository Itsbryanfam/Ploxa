"use server";

import "server-only";

import { randomUUID } from "node:crypto";

import { db } from "@/lib/db";
import { recommendations } from "@/lib/db/schema";
import { cacheKey } from "@/lib/recs/cache";
import { candidatePool, type CandidateGame } from "@/lib/recs/candidate-pool";
import { filterSchema, type FilterParams, type TimeBudget } from "@/lib/recs/moods";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { getFingerprint } from "@/lib/taste/server-actions";

/**
 * Recommendation card returned by getRecs.
 *
 * T9 narrows `algorithm` to `"similarity"` because the metadata-only path
 * is the only writer right now. T12 widens this to also include the
 * DB enum values `"ai"` and `"hybrid"` once the AI rerank path lands.
 * Note: the DB rec_algorithm enum is `["similarity","ai","hybrid"]` —
 * NOT `"ai_rerank"`. Earlier plan drafts referenced `"ai_rerank"`; that
 * string would fail the enum check at insert time.
 */
export type RecCard = {
  id: string;
  gameId: number;
  slug: string;
  title: string;
  releasedYear: number | null;
  posterUrl: string | null;
  coverUrl: string | null;
  score: number;
  reason: string;
  algorithm: "similarity";
};

export type RecResult =
  | {
      ok: true;
      tier: "sparse" | "sharpening" | "full";
      recs: RecCard[];
      algorithm: "similarity";
      banner?: string;
    }
  | { ok: false; reason: "unauthorized" | "empty-tier" | "no-candidates" };

/** Map a TimeBudget to a [minHours, maxHours] window for filtering candidates. */
function timeWindow(time: TimeBudget): [number, number] {
  switch (time) {
    case "15min":
      return [0, 3];
    case "1hr":
      return [0, 12];
    case "3hr+":
      return [2, 60];
    case "multi-session":
      return [10, Infinity];
  }
}

/**
 * Metadata-only recommendation generator (T9).
 *
 * Pulls a candidate pool from the user's taste fingerprint, filters by
 * the requested time budget (against `playtime_avg_hours`) and platform
 * overlap, and returns the top 5 by similarity score with templated
 * reasoning that references both the time window and the user's top
 * matched genre(s).
 *
 * T11 will add an AI-rerank Edge Function; T12 will widen this action to
 * route sharpening/full tiers through that rerank and surface a cache
 * hit when the same (user, cacheKey) tuple is asked again. For T9 every
 * call writes 5 fresh `recommendations` rows tagged with the cacheKey so
 * T12 can detect existing rows without a schema change.
 *
 * Filter notes:
 * - Games with null `playtime_avg_hours` are kept (best-effort: we don't
 *   want to drop unrated titles from the pool just because the catalog
 *   lacks playtime data). Same for null `platforms`.
 * - candidatePool already excludes games the user has already logged.
 */
export async function getRecs(rawFilters: FilterParams): Promise<RecResult> {
  const me = await getCachedUser();
  if (!me) return { ok: false, reason: "unauthorized" };

  // Re-validate at the boundary — the action receives raw deserialized
  // values from the wire and the TS signature alone is not a barrier.
  const filters = filterSchema.parse(rawFilters);
  const fp = await getFingerprint(me.id);

  if (fp.tier === "empty") return { ok: false, reason: "empty-tier" };

  const all = await candidatePool(me.id, { limit: 50 });

  const [minH, maxH] = timeWindow(filters.time);
  const platSet = new Set<string>(filters.platforms);
  const filtered: CandidateGame[] = all.filter((g) => {
    if (g.playtimeAvgHours != null) {
      if (g.playtimeAvgHours < minH || g.playtimeAvgHours > maxH) return false;
    }
    if (g.platforms && g.platforms.length > 0) {
      const platMatches = g.platforms.some((p) => platSet.has(p));
      if (!platMatches) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    return { ok: false, reason: "no-candidates" };
  }

  const top = filtered.slice(0, 5);

  const key = cacheKey({
    userId: me.id,
    moods: filters.moods,
    time: filters.time,
    platforms: filters.platforms,
  });

  // Top-5 user genre keys, ordered by vector weight. Used to compute the
  // genre-overlap clause of the templated reasoning sentence.
  const topUserGenres = Object.entries(fp.vectors.genre)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([k]) => k);

  const timeNote = ((): string => {
    switch (filters.time) {
      case "15min":
        return "Quick to pick up and put down.";
      case "1hr":
        return "Fits a one-hour session comfortably.";
      case "3hr+":
        return "Made for a longer evening.";
      case "multi-session":
        return "Built for the long haul.";
    }
  })();

  const sparsePrefix = fp.tier === "sparse" ? "Based on partial signal: " : "";

  const recs: RecCard[] = top.map((g) => {
    const overlap = (g.genres ?? []).filter((x) => topUserGenres.includes(x));
    const genreNote =
      overlap.length > 0
        ? `Heavy on ${overlap[0]}${overlap[1] ? ` and ${overlap[1]}` : ""}, ${
            overlap.length > 1 ? "two of your top genres" : "one of your top genres"
          }.`
        : "Strong match against your taste profile.";
    const reason = `${sparsePrefix}${timeNote} ${genreNote}`;
    return {
      id: randomUUID(),
      gameId: g.id,
      slug: g.slug,
      title: g.title,
      releasedYear: g.released ? g.released.getFullYear() : null,
      posterUrl: g.posterUrl,
      coverUrl: g.coverUrl,
      // similarityScore is an unbounded sum of vector weights; clamp to
      // [0,1] for the numeric(5,4) column. Heuristic divisor of 5 hits the
      // top of the range for a typical 5-genre overlap on a power user.
      score: Math.min(1, g.similarityScore / 5),
      reason,
      algorithm: "similarity" as const,
    };
  });

  // Persist with the cache key so T12's rerank can detect existing cache.
  // T9 writes unconditionally; T12 will add a cache-hit short-circuit
  // before this insert. Multiple calls with the same filters will
  // currently accumulate rows — that's intentional for the demo and
  // cleaned up in T12.
  await db.insert(recommendations).values(
    recs.map((r) => ({
      userId: me.id,
      gameId: r.gameId,
      score: r.score.toFixed(4),
      reason: r.reason,
      algorithm: "similarity" as const,
      cacheKey: key,
    })),
  );

  return {
    ok: true,
    tier: fp.tier,
    recs,
    algorithm: "similarity",
    banner:
      fp.tier === "sparse"
        ? "Your taste is still sharpening — these picks use genre matching only."
        : undefined,
  };
}
