"use server";

import "server-only";

import { randomUUID } from "node:crypto";

import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { games, logs, recommendations } from "@/lib/db/schema";
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

  // T10 sparse-tier fallback: a freshly-onboarded user with 3 logs may have
  // a tier of "sparse" but vectors so thin that the dot-product candidate
  // pool returns 0 — every game scores `s <= 0` and gets dropped. Detect
  // that here by summing absolute vector mass and route through a popularity
  // fallback (top-rated catalog, exclude logged) instead. The fallback also
  // catches the rare case where the user is sparse-tier but happens to have
  // logs that produce a non-thin vector — in that case we still want the
  // honest "starter picks while your taste sharpens" framing.
  const vectorMass =
    Object.values(fp.vectors.genre).reduce((a, b) => a + Math.abs(b), 0) +
    Object.values(fp.vectors.theme).reduce((a, b) => a + Math.abs(b), 0) +
    Object.values(fp.vectors.mechanic).reduce((a, b) => a + Math.abs(b), 0);
  let candidates = await candidatePool(me.id, { limit: 50 });
  const useFallback =
    fp.tier === "sparse" && (vectorMass < 2.0 || candidates.length === 0);

  if (useFallback) {
    // Pull logged-game IDs and top-200 by RAWG rating in parallel. We pull
    // 200 (not 50) so the time/platform filter below has headroom before
    // slicing to 50 candidates.
    const [loggedRows, popular] = await Promise.all([
      db.select({ gameId: logs.gameId }).from(logs).where(eq(logs.userId, me.id)),
      db
        .select({
          id: games.id,
          slug: games.slug,
          title: games.title,
          released: games.released,
          coverUrl: games.coverUrl,
          posterUrl: games.posterUrl,
          genres: games.genres,
          themes: games.themes,
          mechanics: games.mechanics,
          platforms: games.platforms,
          playtimeAvgHours: games.playtimeAvgHours,
          rawgRating: games.rawgRating,
        })
        .from(games)
        .orderBy(desc(games.rawgRating))
        .limit(200),
    ]);
    const loggedIds = new Set(loggedRows.map((r) => r.gameId));
    candidates = popular
      .filter((g) => !loggedIds.has(g.id))
      .slice(0, 50)
      .map(
        (g): CandidateGame => ({
          id: g.id,
          slug: g.slug,
          title: g.title,
          released: g.released,
          coverUrl: g.coverUrl,
          posterUrl: g.posterUrl,
          genres: g.genres,
          themes: g.themes,
          mechanics: g.mechanics,
          platforms: g.platforms,
          playtimeAvgHours:
            g.playtimeAvgHours != null ? Number(g.playtimeAvgHours) : null,
          // rawgRating is numeric → string from Drizzle. Older catalog rows
          // can be null; default to 0 so they sort last but don't crash.
          similarityScore: g.rawgRating != null ? Number(g.rawgRating) : 0,
        }),
      );
  }

  const [minH, maxH] = timeWindow(filters.time);
  const platSet = new Set<string>(filters.platforms);
  const filtered: CandidateGame[] = candidates.filter((g) => {
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

  // Drop the "Based on partial signal" prefix when the popularity fallback
  // is in play — the genre/taste framing would be a lie since we're sorting
  // by RAWG rating, not the user's vectors.
  const sparsePrefix =
    fp.tier === "sparse" && !useFallback ? "Based on partial signal: " : "";

  const recs: RecCard[] = top.map((g) => {
    const overlap = (g.genres ?? []).filter((x) => topUserGenres.includes(x));
    const genreNote = useFallback
      ? "Highly rated and broadly liked — solid starter pick while your taste sharpens."
      : overlap.length > 0
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
    banner: useFallback
      ? "Your taste is still sharpening — these are popular starter picks while we learn."
      : fp.tier === "sparse"
        ? "Your taste is still sharpening — these picks use genre matching only."
        : undefined,
  };
}
