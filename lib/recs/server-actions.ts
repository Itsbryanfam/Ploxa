"use server";

import "server-only";

import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { games, logs, recommendations, tasteFingerprints } from "@/lib/db/schema";
import { cacheKey } from "@/lib/recs/cache";
import { candidatePool, type CandidateGame } from "@/lib/recs/candidate-pool";
import { filterSchema, type FilterParams, type TimeBudget } from "@/lib/recs/moods";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { getFingerprint } from "@/lib/taste/server-actions";

/**
 * Recommendation card returned by getRecs.
 *
 * `algorithm` mirrors the DB `rec_algorithm` enum exactly:
 *   - `"similarity"` — metadata-only path (T9 / T10 popularity fallback /
 *     T12 AI-failure fallback).
 *   - `"ai"` — fresh AI rerank result (T11/T12 sharpening/full path).
 *   - `"hybrid"` — cache-hit result; rows were previously written as `"ai"`
 *     (or `"similarity"` if a prior rerank failed), and we're serving them
 *     again without recomputing. The algorithm widens at the RecResult
 *     envelope level to communicate "cached output, not a fresh AI call".
 *
 * Earlier plan drafts referenced `"ai_rerank"` — that string is NOT in the
 * enum and would fail the insert check. Keep this union in lock-step with
 * `recAlgorithmEnum` in `lib/db/schema.ts`.
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
  algorithm: "similarity" | "ai" | "hybrid";
};

export type RecResult =
  | {
      ok: true;
      tier: "sparse" | "sharpening" | "full";
      recs: RecCard[];
      algorithm: "similarity" | "ai" | "hybrid";
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
 * Primary recommendation entry point.
 *
 * Flow:
 *   1. Cache check — if ≥4 non-dismissed rows exist for (user, cacheKey)
 *      AND every row was generated AFTER the user's `vectorsGeneratedAt`,
 *      we serve the persisted rows as a `"hybrid"` result without any
 *      AI call. The ≥4 threshold (rather than ===5) tolerates the rerank
 *      Edge Function dropping 1 of 5 picks for a hallucinated gameId.
 *   2. Sparse tier — skip AI entirely; use metadataOnlyRecs (the T9 path,
 *      including the T10 RAWG-popularity fallback for thin vectors).
 *   3. Sharpening / full — pull candidate pool, apply hard time + platform
 *      filters BEFORE sending to AI (no point asking the model to consider
 *      candidates that violate hard constraints), then invoke the
 *      rerank-recs Edge Function. On success, re-read the rows the function
 *      persisted under cacheKey and return them as `"ai"`.
 *   4. AI failure — fall back to metadataOnlyRecs with an explanatory
 *      banner. Note: this writes `"similarity"` rows under cacheKey, so a
 *      subsequent same-filter call will cache-hit on those similarity
 *      rows (returned as `"hybrid"`). Acceptable for the demo; a future
 *      task can scope cache hits to AI-derived algorithms if needed.
 */
export async function getRecs(rawFilters: FilterParams): Promise<RecResult> {
  const me = await getCachedUser();
  if (!me) return { ok: false, reason: "unauthorized" };

  // Re-validate at the boundary — the action receives raw deserialized
  // values from the wire and the TS signature alone is not a barrier.
  const filters = filterSchema.parse(rawFilters);
  const fp = await getFingerprint(me.id);

  if (fp.tier === "empty") return { ok: false, reason: "empty-tier" };

  // Pin the narrowed tier so the helper signature can require non-empty
  // without TS losing the narrowing across the helper boundary.
  // (TS narrows the `fp.tier` *property* via the discriminant check above,
  // but doesn't propagate that narrowing to the `fp` object as a whole —
  // re-bind here so every downstream usage gets the non-empty type.)
  const fpReady = fp as typeof fp & {
    tier: "sparse" | "sharpening" | "full";
  };

  // Compute the cache key once and thread it through every branch — keeps
  // the cache check, rerank invocation, and metadataOnlyRecs insert in sync.
  const key = cacheKey({
    userId: me.id,
    moods: filters.moods,
    time: filters.time,
    platforms: filters.platforms,
  });

  // 1. Cache check — non-dismissed rows for this key, ordered by score desc.
  const cached = await db
    .select({
      id: recommendations.id,
      gameId: recommendations.gameId,
      score: recommendations.score,
      reason: recommendations.reason,
      algorithm: recommendations.algorithm,
      generatedAt: recommendations.generatedAt,
    })
    .from(recommendations)
    .where(
      and(
        eq(recommendations.userId, me.id),
        eq(recommendations.cacheKey, key),
        eq(recommendations.dismissed, false),
      ),
    )
    .orderBy(desc(recommendations.score));

  // Freshness gate: compare against the user's last vector update. If the
  // milestone trigger (T7) re-aggregated vectors after the cache was
  // written, the cache is stale even if it has 5 rows. `vectorsGeneratedAt`
  // is `notNull` per schema, but we defensively default to epoch so a
  // missing row (e.g. a brand-new sparse-tier user who never persisted a
  // fingerprint row) doesn't crash the comparison.
  const [vrow] = await db
    .select({ vectorsGeneratedAt: tasteFingerprints.vectorsGeneratedAt })
    .from(tasteFingerprints)
    .where(eq(tasteFingerprints.userId, me.id))
    .limit(1);
  const vectorsAt = vrow?.vectorsGeneratedAt ?? new Date(0);

  const cacheStillFresh =
    cached.length >= 4 && cached.every((c) => c.generatedAt > vectorsAt);

  if (cacheStillFresh) {
    const gameIds = [...new Set(cached.map((c) => c.gameId))];
    const gameRows = await db
      .select({
        id: games.id,
        slug: games.slug,
        title: games.title,
        released: games.released,
        posterUrl: games.posterUrl,
        coverUrl: games.coverUrl,
      })
      .from(games)
      .where(inArray(games.id, gameIds));
    const gameById = new Map(gameRows.map((g) => [g.id, g]));
    const recs: RecCard[] = cached
      .slice(0, 5)
      .map((c): RecCard | null => {
        const g = gameById.get(c.gameId);
        if (!g) return null;
        return {
          id: c.id,
          gameId: c.gameId,
          slug: g.slug,
          title: g.title,
          releasedYear: g.released ? g.released.getFullYear() : null,
          posterUrl: g.posterUrl,
          coverUrl: g.coverUrl,
          score: Number(c.score),
          reason: c.reason ?? "",
          // Drizzle infers `c.algorithm` as the pgEnum union — assigns
          // directly to `RecCard.algorithm` which mirrors the same enum.
          algorithm: c.algorithm,
        };
      })
      .filter((r): r is RecCard => r !== null);
    if (recs.length >= 4) {
      return { ok: true, tier: fpReady.tier, recs, algorithm: "hybrid" };
    }
    // If we lost too many rows to a games-table join miss (e.g. a game was
    // deleted between the rec insert and now), fall through to regenerate.
  }

  // 2. Sparse tier — skip AI, use metadataOnlyRecs (T9 templated path +
  //    T10 popularity fallback for thin vectors).
  if (fpReady.tier === "sparse") {
    return metadataOnlyRecs(me.id, fpReady, filters, key);
  }

  // 3. Sharpening / full — invoke rerank-recs Edge Function. First we need
  //    a candidate pool with hard filters applied so the AI only chooses
  //    from games that satisfy the user's time + platform constraints.
  const candidates = await candidatePool(me.id, { limit: 50 });
  if (candidates.length === 0) {
    return { ok: false, reason: "no-candidates" };
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

  // Resolve the Edge Function URL. Prefer the explicit `SUPABASE_FUNCTIONS_URL`
  // env var (custom domains); fall back to `${NEXT_PUBLIC_SUPABASE_URL}/functions/v1`.
  // Missing env → treat as AI failure rather than crash.
  const functionsUrl =
    process.env.SUPABASE_FUNCTIONS_URL ??
    (process.env.NEXT_PUBLIC_SUPABASE_URL
      ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1`
      : null);
  const apikey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let rerankOk = false;
  if (functionsUrl && apikey) {
    try {
      const resp = await fetch(`${functionsUrl}/rerank-recs`, {
        method: "POST",
        headers: { apikey, "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: me.id,
          filters,
          candidateIds: filtered.map((c) => c.id),
          cacheKey: key,
        }),
      });
      if (resp.ok) {
        // Untrusted JSON body — guard the "ok" property check against a
        // non-object payload (e.g. `null`, or a string). Edge Function
        // controls this response shape so the practical risk is near-zero,
        // but the type assertion alone is not a runtime barrier.
        const j: unknown = await resp.json();
        if (
          typeof j === "object" &&
          j !== null &&
          "ok" in j &&
          (j as { ok: unknown }).ok === true
        ) {
          rerankOk = true;
        }
      }
    } catch (err) {
      console.error("rerank-recs invoke failed:", err);
    }
  }

  if (rerankOk) {
    // Re-read the rows the Edge Function just wrote atomically under cacheKey.
    // Same shape as the cache-hit branch — join games, map to RecCard[].
    const fresh = await db
      .select({
        id: recommendations.id,
        gameId: recommendations.gameId,
        score: recommendations.score,
        reason: recommendations.reason,
        algorithm: recommendations.algorithm,
      })
      .from(recommendations)
      .where(
        and(
          eq(recommendations.userId, me.id),
          eq(recommendations.cacheKey, key),
          eq(recommendations.dismissed, false),
        ),
      )
      .orderBy(desc(recommendations.score));
    const freshIds = [...new Set(fresh.map((c) => c.gameId))];
    const gameRows = await db
      .select({
        id: games.id,
        slug: games.slug,
        title: games.title,
        released: games.released,
        posterUrl: games.posterUrl,
        coverUrl: games.coverUrl,
      })
      .from(games)
      .where(inArray(games.id, freshIds));
    const gameById = new Map(gameRows.map((g) => [g.id, g]));
    const recs: RecCard[] = fresh
      .map((c): RecCard | null => {
        const g = gameById.get(c.gameId);
        if (!g) return null;
        return {
          id: c.id,
          gameId: c.gameId,
          slug: g.slug,
          title: g.title,
          releasedYear: g.released ? g.released.getFullYear() : null,
          posterUrl: g.posterUrl,
          coverUrl: g.coverUrl,
          score: Number(c.score),
          reason: c.reason ?? "",
          algorithm: c.algorithm,
        };
      })
      .filter((r): r is RecCard => r !== null);
    // Symmetry with the cache-hit branch: if a catalog race deleted every
    // game between the Edge Function's INSERT and this re-read, return a
    // structured failure rather than an empty grid with no error context.
    if (recs.length === 0) {
      return { ok: false, reason: "no-candidates" };
    }
    return { ok: true, tier: fpReady.tier, recs, algorithm: "ai" };
  }

  // 4. AI failure → metadata fallback with banner. Set the banner after the
  //    helper returns so we don't duplicate the helper's "sparse banner"
  //    logic; AI failure on sharpening/full overrides any inner banner.
  const fallback = await metadataOnlyRecs(me.id, fpReady, filters, key);
  if (fallback.ok) {
    fallback.banner = "AI ranking unavailable — basic matching shown.";
  }
  return fallback;
}

/**
 * Metadata-only recommendation generator — T9 templated path + T10 sparse
 * popularity fallback. Used by:
 *   - sparse tier (always)
 *   - sharpening / full tier when the rerank Edge Function fails
 *
 * Pulls a candidate pool from the user's taste fingerprint, optionally
 * routes to a RAWG-popularity fallback if vector mass is too thin to
 * produce meaningful similarity, filters by the requested time budget and
 * platform overlap, and returns the top 5 with templated reasoning.
 *
 * Filter notes:
 * - Games with null `playtime_avg_hours` are kept (best-effort: we don't
 *   want to drop unrated titles from the pool just because the catalog
 *   lacks playtime data). Same for null `platforms`.
 * - candidatePool already excludes games the user has already logged.
 *
 * Persistence: writes 5 `"similarity"` rows tagged with `key` so the next
 * call with the same filter combo can cache-hit (it'll return as
 * `"hybrid"` at the response level, since "we have rows for this key" is
 * what makes it a cache hit — the per-row algorithm stays `"similarity"`).
 */
async function metadataOnlyRecs(
  userId: string,
  fp: Awaited<ReturnType<typeof getFingerprint>> & {
    tier: "sparse" | "sharpening" | "full";
  },
  filters: FilterParams,
  key: string,
): Promise<RecResult> {
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
  let candidates = await candidatePool(userId, { limit: 50 });
  const useFallback =
    fp.tier === "sparse" && (vectorMass < 2.0 || candidates.length === 0);

  if (useFallback) {
    // Pull logged-game IDs and top-200 by RAWG rating in parallel. We pull
    // 200 (not 50) so the time/platform filter below has headroom before
    // slicing to 50 candidates.
    const [loggedRows, popular] = await Promise.all([
      db.select({ gameId: logs.gameId }).from(logs).where(eq(logs.userId, userId)),
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

  // Persist with the cache key so future calls can detect existing cache.
  // T12 cache-hit short-circuit happens BEFORE this helper is called from
  // getRecs, so this write is reached only on miss → no dup risk per call.
  // The AI-failure fallback path here also writes "similarity" rows that
  // a subsequent same-filter call will surface as a `"hybrid"` cache hit;
  // by design — see getRecs flow comment.
  await db.insert(recommendations).values(
    recs.map((r) => ({
      userId,
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
