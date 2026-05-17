"use server";

import "server-only";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  games,
  logs,
  platformConnections,
  recommendations,
  tasteFingerprints,
} from "@/lib/db/schema";
import { ensureLog } from "@/lib/logs/server-actions";
import { assignBuckets, GRID_SIZE, type ScoredCandidate } from "@/lib/recs/buckets";
import { cacheKey, sha256Hex } from "@/lib/recs/cache";
import {
  backlogPool,
  candidatePool,
  type CandidateGame,
} from "@/lib/recs/candidate-pool";
import { applyMMR } from "@/lib/recs/diversity-mmr";
import { isRecsV2Enabled } from "@/lib/recs/feature-flag";
import { moodMatchScore } from "@/lib/recs/mood-affinity";
import { filterSchema, type FilterParams, type TimeBudget } from "@/lib/recs/moods";
import { gamePlatformsMatchUserFilter } from "@/lib/recs/platform-match";
import { composeScore } from "@/lib/recs/scoring";
import { computeSocialScore, fetchSocialSignals } from "@/lib/recs/social-score";
import { softNegativePenalty } from "@/lib/recs/soft-negative";
import { isTimeFeasible, timeFitScore } from "@/lib/recs/time-fit";
import { enforceRateLimit, RateLimitedError } from "@/lib/security/rate-limit";
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
  // Threaded so RecCard UI can render the platform picker (T15). DB returns
  // `text[] | null`; the UI casts down to `Platform[]` since values come from
  // the same `platform_kind` enum that powers the user-connections filter.
  platforms: string[] | null;
  algorithm: "similarity" | "ai" | "hybrid";
  // Play-next redesign (Task 12). `slot` is the stratified rail this card
  // belongs to (Comfort / Backlog / Friends / Wildcard). `fitChips` drive
  // the RecCard "why" affordances (T15); `confidence` is a coarse band
  // derived from the composite score for the card's strength indicator.
  slot: "comfort" | "backlog" | "friends" | "wildcard";
  fitChips: {
    timeFit: "perfect" | "close" | "loose";
    moodMatches: string[];
    inLibrary: boolean;
    friendsCount: number;
  };
  confidence: "strong" | "good" | "worth-a-try";
};

export type RecResult =
  | {
      ok: true;
      tier: "sparse" | "sharpening" | "full";
      recs: RecCard[];
      algorithm: "similarity" | "ai" | "hybrid";
      banner?: string;
    }
  | {
      ok: false;
      reason:
        | "unauthorized"
        | "empty-tier"
        | "no-candidates"
        | "invalid-filters"
        // Refinement path exceeded the per-user rate limit (F-005).
        | "rate-limited"
        // Client-set only: a thrown/timed-out getRecs|refillRecs. The action
        // itself never returns this (it returns the specific reasons above or
        // throws); the client maps a rejection to this so the UI shows a
        // recoverable error instead of an infinite pending mascot.
        | "error";
    };

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
 * Preserved pre-v2 getRecs, served when the `recsv2` flag is OFF (Task 19
 * wires the flag branch) — the spec's one-toggle kill-switch / rollback
 * path. Behaviorally identical to the pre-v2 body AND schema-independent of
 * migration 0018: it never references `recommendations.slot` (nor
 * `dismissed_at` / `snoozed_until` / `never_again`), so the `recsv2`-OFF
 * rollback works even before 0018 is applied (0018 is a deferred operator
 * step). `hydrateRecs` defaults the omitted slot to 'comfort' (uniform with
 * metadataOnlyRecs). Do NOT add v2 logic here — deleted in the post-rollout
 * cleanup once v2 is default.
 */
async function getRecsLegacy(rawFilters: FilterParams): Promise<RecResult> {
  const me = await getCachedUser();
  if (!me) return { ok: false, reason: "unauthorized" };

  // Re-validate at the boundary — the action receives raw deserialized
  // values from the wire and the TS signature alone is not a barrier.
  // safeParse so a malformed client payload returns a clean reason instead
  // of a 500 from the server-action error boundary.
  const filtersResult = filterSchema.safeParse(rawFilters);
  if (!filtersResult.success) {
    return { ok: false, reason: "invalid-filters" };
  }
  const filters = filtersResult.data;
  // getFingerprint is owner-or-public; me.id is always the owner branch,
  // so the only null path is "profile row missing" — treat as empty-tier.
  const fp = await getFingerprint(me.id);
  if (!fp) return { ok: false, reason: "empty-tier" };

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
    const recs = await hydrateRecs(cached.slice(0, GRID_SIZE));
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
  //    Pass live `fp.vectors` so the pool stays correct even when the
  //    persisted taste_fingerprints row hasn't been written yet (the
  //    refresh-fingerprint Edge Function only fires on milestone counts
  //    and depends on AI providers being healthy).
  const candidates = await candidatePool(me.id, {
    limit: 50,
    vectors: fpReady.vectors,
  });
  if (candidates.length === 0) {
    return { ok: false, reason: "no-candidates" };
  }

  const [minH, maxH] = timeWindow(filters.time);
  const filtered: CandidateGame[] = candidates.filter((g) => {
    if (g.playtimeAvgHours != null) {
      if (g.playtimeAvgHours < minH || g.playtimeAvgHours > maxH) return false;
    }
    // games.platforms holds RAWG names ("PC", "PlayStation 4", …); the picker
    // emits platform_kind enum values ("steam", "xbox", "psn"). The helper
    // bridges via lib/games/platform-mapping.ts and treats PC as Steam.
    if (!gamePlatformsMatchUserFilter(g.platforms, filters.platforms)) {
      return false;
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
          // LIVE taste signal (Task 5 — Codex remediation). Same rationale
          // as the v2 path: the legacy candidate pool already used
          // `fpReady.vectors`; pass the SAME live values so the Edge rerank
          // ordering + reasoning use live taste rather than the stale/missing
          // persisted taste_fingerprints row. The Edge keeps its SQL read as
          // a fallback (deploy-order safe).
          vectors: fpReady.vectors,
          narrative: fpReady.narrative ?? null,
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
    const recs = await hydrateRecs(fresh);
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
 * Coarse confidence band derived from the composite score. Drives the
 * RecCard strength chip (T15). Thresholds are a product call (design spec)
 * — the cache-hit / metadata paths derive it from the persisted/normalized
 * score; the fresh AI path overrides with the in-scope composite.
 */
function deriveConfidence(score: number): "strong" | "good" | "worth-a-try" {
  if (score >= 0.66) return "strong";
  if (score >= 0.4) return "good";
  return "worth-a-try";
}

/**
 * Default fit chips for paths without live scoring context (cache-hit
 * rehydrate, metadata-only). Type-correct + honest: no fabricated signal.
 */
function neutralFitChips(): RecCard["fitChips"] {
  return { timeFit: "close", moodMatches: [], inLibrary: false, friendsCount: 0 };
}

/**
 * Cosine similarity over the bag-of-tags vectors the v2 MMR stage builds.
 * No precomputed game embeddings exist, so getRecs derives a sparse 0/1
 * tag vector per candidate over the union of genre/theme/mechanic tags in
 * the filtered set and feeds pairwise cosine into applyMMR for diversity.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Primary recommendation entry point (v2 — play-next redesign Task 12).
 *
 * Preserves the original flow's steps 0-2 byte-for-behavior (auth →
 * safeParse → fingerprint/empty-tier → fpReady → cacheKey → cache+freshness
 * gate → sparse-tier metadataOnlyRecs) and replaces ONLY the sharpening/full
 * candidate→filter→Edge→hydrate stage with the v2 scoring → MMR-diversity →
 * bucket → slot pipeline.
 *
 * Additions over legacy (the ONLY behavioral deltas):
 *   - `options.refinements`: free-text user nudges ("less grindy"). When
 *     present, the cache is bypassed (re-rank fresh) and the Edge Function
 *     is invoked in `"rerank-only"` mode with `userRefinements`.
 *   - composite scoring (taste/mood/timeFit/social/library − soft-negative),
 *     MMR diversity over a bag-of-tags vector, stratified bucket assignment.
 *   - post-rerank slot UPDATE so the cache-hit path serves correct rails
 *     (user decision A: "getRecs post-rerank UPDATE").
 *   - every RecCard now carries `slot` / `fitChips` / `confidence`.
 *
 * Everything else (cache freshness gate, empty/sparse tiers,
 * metadataOnlyRecs incl. its banner, tier+algorithm on every RecResult,
 * the exact Edge URL/auth/untrusted-JSON guard) is preserved exactly.
 *
 * `getRecsLegacy` above is a verbatim copy of the pre-v2 body, wired by
 * Task 19 behind the `recsv2` flag.
 */
export async function getRecs(
  rawFilters: FilterParams,
  options?: { refinements?: string[] },
): Promise<RecResult> {
  const me = await getCachedUser();
  if (!me) return { ok: false, reason: "unauthorized" };

  if (!isRecsV2Enabled(me.id)) return getRecsLegacy(rawFilters);

  // Hoist one wall-clock per request (T5) — fed to softNegativePenalty and
  // the snooze gate so a single call can't straddle a tick boundary.
  const now = new Date();
  // Sanitize free-text refinements at the boundary (wire-deserialized).
  // Count-capped at 5; each string length-capped at 120 so a hostile caller
  // can't inflate the host-paid Edge prompt (F-005).
  const refinements = (options?.refinements ?? [])
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .slice(0, 5)
    .map((s) => s.trim().slice(0, 120));

  // F-005: a non-empty refinement set bypasses the cache and forces a
  // host-paid Edge rerank on every call. Gate it per-user (the no-refinement
  // path is cached and unaffected). 20 / 10min is far above any human tweak
  // cadence but caps scripted abuse.
  if (refinements.length > 0) {
    try {
      await enforceRateLimit({
        scope: "recs:refine",
        identifier: me.id,
        limit: 20,
        windowSeconds: 600,
      });
    } catch (e) {
      if (e instanceof RateLimitedError) {
        return { ok: false, reason: "rate-limited" };
      }
      throw e;
    }
  }

  // Re-validate at the boundary — the action receives raw deserialized
  // values from the wire and the TS signature alone is not a barrier.
  // safeParse so a malformed client payload returns a clean reason instead
  // of a 500 from the server-action error boundary.
  const filtersResult = filterSchema.safeParse(rawFilters);
  if (!filtersResult.success) {
    return { ok: false, reason: "invalid-filters" };
  }
  const filters = filtersResult.data;
  // getFingerprint is owner-or-public; me.id is always the owner branch,
  // so the only null path is "profile row missing" — treat as empty-tier.
  const fp = await getFingerprint(me.id);
  if (!fp) return { ok: false, reason: "empty-tier" };

  if (fp.tier === "empty") return { ok: false, reason: "empty-tier" };

  // Pin the narrowed tier so the helper signature can require non-empty
  // without TS losing the narrowing across the helper boundary.
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

  // Refinement *session* cache key. A refinement run ("less grindy") is
  // session-only by spec ("Refined results session-only, not persisted")
  // and MUST NOT overwrite the user's unrefined cached set for this filter
  // tuple: the rerank Edge function unconditionally DELETEs+INSERTs rows
  // under the cacheKey it's handed (regardless of `mode` — `mode` only
  // selects the prompt), so reusing the bare base `key` on a refinement
  // run poisons the base cache until vectors re-aggregate. Derive a
  // distinct, DETERMINISTIC key from the base key + a hash of the sorted
  // refinements so (i) the base cache is isolated, (ii) the same
  // refinements reuse the same session slot, and (iii) per-row actions
  // still work because the rec rows still exist (just under this key —
  // dismiss/save/play resolve a rec by primary id, not by cache_key).
  // No refinements ⇒ `writeKey === key`, so the no-refinement path is
  // byte-unchanged (Edge payload + slot UPDATE + re-read all use bare
  // `key`). Same `sha256Hex` primitive as `cacheKey` — one hash scheme.
  const writeKey =
    refinements.length > 0
      ? `${key}:r:${sha256Hex(JSON.stringify([...refinements].sort())).slice(0, 8)}`
      : key;

  // 1. Cache check — non-dismissed rows for this key, ordered by score desc.
  //    Refinements bypass the cache entirely: a user nudging the results
  //    explicitly asked for a fresh re-rank, so a stale cache hit would be
  //    wrong. The freshness gate logic is otherwise identical to legacy.
  if (refinements.length === 0) {
    const cached = await db
      .select({
        id: recommendations.id,
        gameId: recommendations.gameId,
        score: recommendations.score,
        reason: recommendations.reason,
        algorithm: recommendations.algorithm,
        slot: recommendations.slot,
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
      const recs = await hydrateRecs(cached.slice(0, GRID_SIZE));
      if (recs.length >= 4) {
        return { ok: true, tier: fpReady.tier, recs, algorithm: "hybrid" };
      }
      // If we lost too many rows to a games-table join miss (e.g. a game
      // was deleted between the rec insert and now), fall through.
    }
  }

  // 2. Sparse tier — skip AI, use metadataOnlyRecs (T9 templated path +
  //    T10 popularity fallback for thin vectors). Refinements don't apply
  //    to the sparse path (no AI rerank there) — acceptable per dispatch.
  if (fpReady.tier === "sparse") {
    return metadataOnlyRecs(me.id, fpReady, filters, key);
  }

  // 3. Sharpening / full — v2 pipeline. Pull a candidate pool (T10: 100
  //    default, no explicit limit), hard-filter on time/platform/never-
  //    again/active-snooze, composite-score every survivor, MMR-diversify,
  //    stratify into the 4 rails, then send the pre-scored shortlist to
  //    the rerank Edge Function. Pass live `fp.vectors` so the pool stays
  //    correct even when the persisted taste_fingerprints row is stale.
  // Two-lane sourcing (play-next Backlog-bucket revival 2026-05-16):
  //   - DISCOVERY lane (`candidatePool`): catalog rows the user has NOT
  //     logged at all. `inLibrary:false`.
  //   - BACKLOG lane (`backlogPool`): the user's OWNED-BUT-UNPLAYED logs
  //     (backlog/wishlist/on_hold). `inLibrary:true`.
  // The lanes are disjoint by construction (candidatePool excludes EVERY
  // logged game; the backlog lane only emits logged ones), so the
  // `inLibrary` partition is exact: `inLibrary` is true iff the candidate
  // came from the backlog lane, and ONLY the Backlog slot consumes
  // `inLibrary` (`buckets.ts`) — no leak into Comfort/Wildcard. Pre-fix this
  // used a single unconditional "all logged ids" query: `inLibrary` was
  // ALWAYS false (the pool is exactly the non-logged set), so the Backlog
  // rail + `libraryBonus` were both structurally dead.
  const [discovery, backlog] = await Promise.all([
    candidatePool(me.id, { vectors: fpReady.vectors }),
    backlogPool(me.id, { vectors: fpReady.vectors }),
  ]);
  const backlogIds = new Set(backlog.map((c) => c.id));
  // Merge, backlog entry winning for any shared id (defensive — the lanes
  // are provably disjoint, but a future change to either query must not
  // silently turn an owned game into an `inLibrary:false` discovery card).
  const mergedById = new Map<number, CandidateGame>();
  for (const c of discovery) mergedById.set(c.id, c);
  for (const c of backlog) mergedById.set(c.id, c);
  const candidates = [...mergedById.values()];
  if (candidates.length === 0) {
    return { ok: false, reason: "no-candidates" };
  }

  // Dismissal / snooze / never-again state for the candidate set (T1
  // partial index covers this lookup). Covers BOTH lanes — a never-again /
  // active-snooze on a backlog game still hard-excludes it from the rail.
  const candIds = candidates.map((c) => c.id);
  const negRows = await db
    .select({
      gameId: recommendations.gameId,
      dismissedAt: recommendations.dismissedAt,
      snoozedUntil: recommendations.snoozedUntil,
      neverAgain: recommendations.neverAgain,
    })
    .from(recommendations)
    .where(
      and(
        eq(recommendations.userId, me.id),
        inArray(recommendations.gameId, candIds),
      ),
    );
  // Collapse to one state per gameId (most-recent non-null wins; any
  // never-again / active snooze sticks across rows).
  const negMap = new Map<
    number,
    { dismissedAt: Date | null; snoozedUntil: Date | null; neverAgain: boolean }
  >();
  for (const r of negRows) {
    const prev = negMap.get(r.gameId);
    negMap.set(r.gameId, {
      dismissedAt: r.dismissedAt ?? prev?.dismissedAt ?? null,
      snoozedUntil: r.snoozedUntil ?? prev?.snoozedUntil ?? null,
      neverAgain: r.neverAgain || prev?.neverAgain || false,
    });
  }

  const filtered: CandidateGame[] = candidates.filter((g) => {
    if (!isTimeFeasible(g.playtimeAvgHours, filters.time)) return false;
    // games.platforms holds RAWG names ("PC", "PlayStation 4", …); the picker
    // emits platform_kind enum values ("steam", "xbox", "psn"). The helper
    // bridges via lib/games/platform-mapping.ts and treats PC as Steam.
    if (!gamePlatformsMatchUserFilter(g.platforms, filters.platforms)) {
      return false;
    }
    const ds = negMap.get(g.id);
    if (ds?.neverAgain) return false;
    if (ds?.snoozedUntil && ds.snoozedUntil.getTime() > now.getTime()) {
      return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    return { ok: false, reason: "no-candidates" };
  }

  // `libraryIds` is now the backlog-lane id set (computed above from
  // `backlogPool`), NOT a fresh unconditional "all logged ids" query. The
  // old query returned every logged game, but `candidates` is the merged
  // (discovery ∪ backlog) set — discovery rows are never logged, so
  // `libraryIds.has(c.id)` was ALWAYS false and `libraryBonus` was dead.
  // Sourcing it from the backlog lane makes `inLibrary` true exactly for
  // owned-but-unplayed candidates, which is what the Backlog slot +
  // `libraryBonus` weight were designed to consume. Bulk social signals +
  // lowercased explored-genre stats follow (T8/T9: games.genres is
  // mixed-case; assignBuckets/pickWildcard require lowercased Set/Map
  // members).
  const libraryIds = backlogIds;
  const socialMap = await fetchSocialSignals(
    me.id,
    filtered.map((c) => c.id),
  );
  const exploredGenres = new Set<string>();
  const genreFrequency = new Map<string, number>();
  const loggedGenreRows = await db
    .select({ genres: games.genres })
    .from(logs)
    .innerJoin(games, eq(games.id, logs.gameId))
    .where(eq(logs.userId, me.id));
  for (const row of loggedGenreRows) {
    for (const raw of row.genres ?? []) {
      const g = raw.toLowerCase();
      exploredGenres.add(g);
      genreFrequency.set(g, (genreFrequency.get(g) ?? 0) + 1);
    }
  }

  const byId = new Map(filtered.map((c) => [c.id, c]));
  const scored: ScoredCandidate[] = filtered.map((c) => {
    // Same normalization as metadataOnlyRecs: similarityScore is an
    // unbounded sum of vector weights; clamp to [0,1] via /5.
    const taste = Math.min(1, Math.max(0, c.similarityScore / 5));
    const moodScores = filters.moods.map((m) =>
      moodMatchScore(m, { genres: c.genres, mechanics: c.mechanics }),
    );
    const mood =
      moodScores.length > 0
        ? moodScores.reduce((a, b) => a + b, 0) / moodScores.length
        : 0.5;
    const timeFit = timeFitScore(c.playtimeAvgHours, filters.time);
    const sig = socialMap.get(c.id);
    const social = sig ? computeSocialScore(sig) : 0; // T4: already [0,1)
    const inLibrary = libraryIds.has(c.id);
    const penalty = softNegativePenalty(
      negMap.get(c.id) ?? {
        dismissedAt: null,
        snoozedUntil: null,
        neverAgain: false,
      },
      now,
    );
    // recencyQuality: blended released-year + rawg_rating, [0,1]. Without
    // this an original and its sequel (near-identical taste vectors) tie and
    // the older/lower id wins arbitrarily — "Risk of Rain" over the higher-
    // rated "Risk of Rain 2" (2026-05-15). Missing signal → neutral 0.5
    // (NOT 0, which would punish catalog rows lacking the field).
    const relYear = c.released ? c.released.getFullYear() : null;
    const recency =
      relYear != null
        ? Math.max(
            0,
            Math.min(1, (relYear - 1995) / (now.getFullYear() - 1995)),
          )
        : 0.5;
    const quality =
      c.rawgRating != null
        ? Math.max(0, Math.min(1, c.rawgRating / 5))
        : 0.5;
    const recencyQuality = 0.5 * recency + 0.5 * quality;
    const composite = composeScore({
      taste,
      mood,
      timeFit,
      social,
      libraryBonus: inLibrary ? 1 : 0,
      recencyQuality,
      softNegPenalty: penalty,
    });
    return {
      gameId: c.id,
      composite,
      inLibrary,
      socialScore: social,
      genres: (c.genres ?? []).map((x) => x.toLowerCase()),
    };
  });

  // MMR diversity. No precomputed embeddings exist — derive a bag-of-tags
  // 0/1 vector over the union of genre/theme/mechanic tags in the filtered
  // set and feed pairwise cosine in.
  const tagIndex = new Map<string, number>();
  for (const c of filtered) {
    for (const t of [
      ...(c.genres ?? []),
      ...(c.themes ?? []),
      ...(c.mechanics ?? []),
    ]) {
      const k = t.toLowerCase();
      if (!tagIndex.has(k)) tagIndex.set(k, tagIndex.size);
    }
  }
  const embFor = (c: CandidateGame): number[] => {
    const v = new Array<number>(tagIndex.size).fill(0);
    for (const t of [
      ...(c.genres ?? []),
      ...(c.themes ?? []),
      ...(c.mechanics ?? []),
    ]) {
      const i = tagIndex.get(t.toLowerCase());
      if (i != null) v[i] = 1;
    }
    return v;
  };
  const mmrInput = scored.map((s) => ({
    id: s.gameId,
    score: s.composite,
    embedding: embFor(byId.get(s.gameId)!),
  }));
  const diversified = applyMMR(mmrInput, {
    lambda: 0.7,
    topN: 15,
    similarity: cosineSimilarity,
  });
  const scoredById = new Map(scored.map((s) => [s.gameId, s]));
  const diversifiedScored = diversified
    .map((m) => scoredById.get(m.id))
    .filter((s): s is ScoredCandidate => s !== undefined);

  const bucketed = assignBuckets(diversifiedScored, {
    exploredGenres,
    genreFrequency,
    seed: Math.floor(now.getTime() / 60000),
  });
  if (bucketed.length === 0) {
    return { ok: false, reason: "no-candidates" };
  }
  const slotByGameId = new Map(bucketed.map((b) => [b.gameId, b.slot]));

  // Edge rerank candidate set.
  //
  // `bucketed` is the 6-CARD GRID (3 comfort + backlog + friends + wildcard,
  // capped at GRID_SIZE=6). Using it as the Edge CANDIDATE POOL starves the
  // reranker: "pick 5 from ~6" is nearly fixed, so userRefinements (which
  // only enter the Edge PROMPT, never pool/score/MMR/bucket) can't move the
  // picks — multiple active refinements returned the same games (incident
  // 2026-05-15). When refinements are active, hand the Edge a much wider
  // MMR-diversified pool so it has real room to honor them; the picks it
  // returns still get slotted via `slotByGameId` (unknown ids default to
  // 'comfort'). The no-refinement path is unchanged — it keeps the
  // stratified 6 so the rail layout is exact.
  const edgeCandidateIds =
    refinements.length > 0
      ? applyMMR(mmrInput, {
          lambda: 0.7,
          topN: 40,
          similarity: cosineSimilarity,
        }).map((m) => m.id)
      : bucketed.map((b) => b.gameId);

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
          // Pre-scored shortlist — the Edge re-ranks within this set. With
          // refinements active this is a WIDER MMR pool (not the 6-card
          // grid) so the refinement text can actually change the picks; see
          // `edgeCandidateIds` above.
          candidateIds: edgeCandidateIds,
          // `writeKey` === bare `key` on the no-refinement path (byte-
          // unchanged); a distinct session key when refinements are active
          // so the Edge's DELETE+INSERT can't clobber the base cache.
          cacheKey: writeKey,
          mode: refinements.length > 0 ? "rerank-only" : "full",
          userRefinements: refinements,
          // LIVE taste signal (Task 5 — Codex remediation). The
          // deterministic pool/score/MMR/bucket stages above already used
          // `fpReady.vectors`; feed the SAME live values to the Edge so its
          // AI rerank ORDERING + user-facing "why we picked this" reasoning
          // match the live taste — not the persisted `taste_fingerprints`
          // row the Edge would otherwise independently re-SELECT (that row
          // only updates on log milestones / the drift cron and is
          // documented as often-stale/missing). `narrative` is normalized to
          // null defensively — the real FingerprintSnapshot.narrative is
          // already string|null; this guards a non-conforming caller / test
          // mock that yields undefined — so the Edge gets an explicit "no live
          // narrative → use
          // your SQL fallback" signal rather than an absent key. The Edge
          // retains its SQL read as a fallback, so this is forward/backward-
          // compatible across deploy ordering.
          vectors: fpReady.vectors,
          narrative: fpReady.narrative ?? null,
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
    // Persist the real bucket assignment over the rows the Edge wrote (they
    // default to slot='comfort') so the cache-hit path serves correct rails
    // (user decision A: getRecs post-rerank UPDATE). One UPDATE per slot
    // value (≤4 slots) keyed by gameId list — bounded, no N+1.
    //
    // Which gameIds get which slot differs by path:
    //
    //   NO-REFINEMENT (byte-unchanged): the Edge received EXACTLY the
    //   stratified 6 (`bucketed`), so the slot universe is the base-6
    //   `slotByGameId`. We persist those slots and re-read the DB rows
    //   (UPDATE → re-read order preserved); hydrate uses the DB slot. The
    //   partition-contract integration test pins this exact behavior.
    //
    //   REFINEMENT (Task 6 fix): the Edge received a WIDE MMR pool (≈40
    //   ids), so its final picks can include games OUTSIDE the base 6.
    //   Those are absent from `slotByGameId`, so before this fix they kept
    //   the schema DEFAULT 'comfort' — collapsing refined grids toward
    //   all-Comfort and destroying the Backlog/Friends/Wildcard rails. We
    //   instead read the Edge's final picks first, then run the SAME
    //   canonical `assignBuckets` (Tasks 3/4) over JUST those picks —
    //   threading each pick's already-computed ScoredCandidate via
    //   `scoredById` (no recompute) — and persist THOSE slots. The slot
    //   re-read for hydration is the same SELECT either way (poison
    //   contract (c): it queries under `writeKey`, never the base key).
    let fresh: {
      id: string;
      gameId: number;
      score: string;
      reason: string | null;
      algorithm: "similarity" | "ai" | "hybrid";
      slot: "comfort" | "backlog" | "friends" | "wildcard";
    }[];

    // Shared reader: both branches SELECT the same six columns from the rows
    // the Edge wrote under `writeKey` (dismissed===false, desc score). Declared
    // once here so the two branches can't drift apart.
    const readSessionRows = () =>
      db
        .select({
          id: recommendations.id,
          gameId: recommendations.gameId,
          score: recommendations.score,
          reason: recommendations.reason,
          algorithm: recommendations.algorithm,
          slot: recommendations.slot,
        })
        .from(recommendations)
        .where(
          and(
            eq(recommendations.userId, me.id),
            eq(recommendations.cacheKey, writeKey),
            eq(recommendations.dismissed, false),
          ),
        )
        .orderBy(desc(recommendations.score));

    if (refinements.length === 0) {
      // ── NO-REFINEMENT PATH — BYTE-UNCHANGED ──────────────────────────
      const bySlot = new Map<string, number[]>();
      for (const [gid, slot] of slotByGameId) {
        const arr = bySlot.get(slot) ?? [];
        arr.push(gid);
        bySlot.set(slot, arr);
      }
      await Promise.all(
        [...bySlot.entries()].map(([slot, gids]) =>
          db
            .update(recommendations)
            .set({
              slot: slot as "comfort" | "backlog" | "friends" | "wildcard",
            })
            .where(
              and(
                eq(recommendations.userId, me.id),
                // Match the key the Edge actually wrote under: bare `key`
                // on the no-refinement path.
                eq(recommendations.cacheKey, writeKey),
                eq(recommendations.dismissed, false),
                inArray(recommendations.gameId, gids),
              ),
            ),
        ),
      );

      // Re-read the rows the Edge Function just wrote atomically under
      // `writeKey` (=== bare `key` with no refinements).
      fresh = await readSessionRows();
    } else {
      // ── REFINEMENT PATH — slot over the FINAL rerank picks ───────────
      // Read the Edge's final picks FIRST (under the session `writeKey` —
      // never the base key; satisfies poison contract (c)). This is the
      // SAME slot re-read SELECT the no-refinement path runs, just ordered
      // before the UPDATE because the wide-pool picks are only knowable
      // from what the Edge persisted.
      const picked = await readSessionRows();

      // Re-run the canonical assigner (Tasks 3/4) over JUST the final
      // picks, carrying each pick's already-computed composite / inLibrary
      // / socialScore / genres from `scoredById` (every Edge candidate id
      // came from the scored pool, so it is present; defensively skip any
      // that somehow are not rather than fabricating a score). Same
      // `exploredGenres` / `genreFrequency` / minute-bucketed `seed` as the
      // base `assignBuckets` call so slotting stays deterministic.
      const finalScored: ScoredCandidate[] = [];
      for (const p of picked) {
        const sc = scoredById.get(p.gameId);
        if (sc) finalScored.push(sc);
      }
      const finalBucketed = assignBuckets(finalScored, {
        exploredGenres,
        genreFrequency,
        seed: Math.floor(now.getTime() / 60000),
      });
      const slotByFinalPick = new Map(
        finalBucketed.map((b) => [b.gameId, b.slot]),
      );

      const bySlot = new Map<string, number[]>();
      for (const [gid, slot] of slotByFinalPick) {
        const arr = bySlot.get(slot) ?? [];
        arr.push(gid);
        bySlot.set(slot, arr);
      }
      await Promise.all(
        [...bySlot.entries()].map(([slot, gids]) =>
          db
            .update(recommendations)
            .set({
              slot: slot as "comfort" | "backlog" | "friends" | "wildcard",
            })
            .where(
              and(
                eq(recommendations.userId, me.id),
                // The session key on a refinement run, so we update the
                // session rows, not the user's unrefined base-cache rows.
                eq(recommendations.cacheKey, writeKey),
                eq(recommendations.dismissed, false),
                inArray(recommendations.gameId, gids),
              ),
            ),
        ),
      );

      // Hydrate from the rows we already read, overriding each row's slot
      // with the freshly-computed assignment (the DB value we read was the
      // pre-UPDATE default; the UPDATE above persisted the correct slot for
      // the cache-hit path, but we don't pay for a second SELECT here —
      // unknown picks (not bucketed) fall back to the row's own pre-UPDATE
      // value (the schema default)).
      fresh = picked.map((p) => ({
        ...p,
        slot: slotByFinalPick.get(p.gameId) ?? p.slot,
      }));
    }

    const recs = await hydrateRecs(fresh);
    // Symmetry with the cache-hit branch: if a catalog race deleted every
    // game between the Edge Function's INSERT and this re-read, return a
    // structured failure rather than an empty grid with no error context.
    if (recs.length === 0) {
      return { ok: false, reason: "no-candidates" };
    }
    // Enrich the FRESH path with precise fit chips from in-scope scoring
    // data (hydrateRecs gave neutral chips; we still hold socialMap /
    // scoredById / byId / filters here).
    const enriched = recs.map((r): RecCard => {
      const sc = scoredById.get(r.gameId);
      const cand = byId.get(r.gameId);
      const sig = socialMap.get(r.gameId);
      const tf = cand ? timeFitScore(cand.playtimeAvgHours, filters.time) : 0.5;
      const moodMatches = cand
        ? filters.moods.filter(
            (m) =>
              moodMatchScore(m, {
                genres: cand.genres,
                mechanics: cand.mechanics,
              }) >= 0.5,
          )
        : [];
      return {
        ...r,
        fitChips: {
          timeFit: (tf >= 0.8
            ? "perfect"
            : tf >= 0.4
              ? "close"
              : "loose") as "perfect" | "close" | "loose",
          moodMatches,
          inLibrary: sc?.inLibrary ?? false,
          friendsCount: sig ? sig.friendsPlayed + sig.friendsLiked : 0,
        },
        confidence: deriveConfidence(sc?.composite ?? r.score),
      };
    });
    return { ok: true, tier: fpReady.tier, recs: enriched, algorithm: "ai" };
  }

  // 4. AI failure → metadata fallback with banner. Set the banner after the
  //    helper returns so we don't duplicate the helper's "sparse banner"
  //    logic; AI failure on sharpening/full overrides any inner banner.
  //    Pass `writeKey`, not bare `key`: metadataOnlyRecs persists
  //    "similarity" rows under the key it's handed, so on a refinement run
  //    whose Edge rerank failed, using bare `key` here would poison the
  //    user's unrefined base cache exactly like the Edge path would —
  //    the same isolation must cover the fallback write. `writeKey === key`
  //    with no refinements, so the no-refinement fallback is byte-unchanged.
  const fallback = await metadataOnlyRecs(me.id, fpReady, filters, writeKey);
  if (fallback.ok) {
    fallback.banner = "AI ranking unavailable — basic matching shown.";
  }
  return fallback;
}

/**
 * Shared rec-row → RecCard hydration. Both the cache-hit branch and the
 * post-rerank rehydration branch in `getRecs` produce the same shape: a list
 * of recommendations rows joined to the games table. Encapsulating the join
 * + map keeps the two call sites short and prevents drift between them.
 *
 * Caller is responsible for the SELECT (so the freshness gate on
 * `generatedAt` can run before we pay for the games join). Caller also
 * applies any slicing (cache-hit slices to top 5; rerank rehydration takes
 * everything the Edge Function wrote). Rows whose game can't be joined
 * (e.g. a catalog row was deleted between insert and read) are dropped.
 */
type RecHydrationRow = {
  id: string;
  gameId: number;
  score: string;
  reason: string | null;
  algorithm: "similarity" | "ai" | "hybrid";
  slot?: "comfort" | "backlog" | "friends" | "wildcard";
};
async function hydrateRecs(rows: RecHydrationRow[]): Promise<RecCard[]> {
  if (rows.length === 0) return [];
  const gameIds = [...new Set(rows.map((r) => r.gameId))];
  const gameRows = await db
    .select({
      id: games.id,
      slug: games.slug,
      title: games.title,
      released: games.released,
      posterUrl: games.posterUrl,
      coverUrl: games.coverUrl,
      platforms: games.platforms,
    })
    .from(games)
    .where(inArray(games.id, gameIds));
  const gameById = new Map(gameRows.map((g) => [g.id, g]));
  return rows
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
        platforms: g.platforms,
        // Drizzle infers `c.algorithm` as the pgEnum union — assigns
        // directly to `RecCard.algorithm` which mirrors the same enum.
        algorithm: c.algorithm,
        // Cache-hit / post-rerank rehydrate lacks live signal context, so
        // chips are neutral and confidence is score-derived; the slot is
        // the REAL persisted bucket (written by the v2 post-rerank UPDATE).
        // On the legacy (recsv2-OFF) path the row never projects `slot`
        // (that path is schema-independent of migration 0018), so it's
        // `undefined` and we default it to 'comfort' here — uniform with
        // metadataOnlyRecs's hardcoded 'comfort'.
        slot: c.slot ?? "comfort",
        fitChips: neutralFitChips(),
        confidence: deriveConfidence(Number(c.score)),
      };
    })
    .filter((r): r is RecCard => r !== null);
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
  // Pass live `fp.vectors` (same rationale as the sharpening/full branch
  // in getRecs above): decouple the recs pipeline from the persisted
  // taste_fingerprints row so a missing/stale row doesn't return an
  // empty pool when the user actually has plenty of signal.
  let candidates = await candidatePool(userId, {
    limit: 50,
    vectors: fp.vectors,
  });
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
          rawgRating: g.rawgRating != null ? Number(g.rawgRating) : null,
          // rawgRating is numeric → string from Drizzle. Older catalog rows
          // can be null; default to 0 so they sort last but don't crash.
          similarityScore: g.rawgRating != null ? Number(g.rawgRating) : 0,
        }),
      );
  }

  const filtered: CandidateGame[] = candidates.filter((g) => {
    if (!isTimeFeasible(g.playtimeAvgHours, filters.time)) return false;
    // games.platforms holds RAWG names ("PC", "PlayStation 4", …); the picker
    // emits platform_kind enum values ("steam", "xbox", "psn"). The helper
    // bridges via lib/games/platform-mapping.ts and treats PC as Steam.
    if (!gamePlatformsMatchUserFilter(g.platforms, filters.platforms)) {
      return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    return { ok: false, reason: "no-candidates" };
  }

  const top = filtered.slice(0, GRID_SIZE);

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
      platforms: g.platforms,
      algorithm: "similarity" as const,
      // The metadata path has no bucket stage — every pick is "comfort".
      // No live mood/social/time context here either, so chips are
      // neutral; confidence is derived from the normalized score.
      slot: "comfort" as const,
      fitChips: neutralFitChips(),
      confidence: deriveConfidence(Math.min(1, g.similarityScore / 5)),
    };
  });

  // Persist with the cache key so future calls can detect existing cache.
  // T12 cache-hit short-circuit happens BEFORE this helper is called from
  // getRecs, so this write is reached only on miss → no dup risk per call.
  // The AI-failure fallback path here also writes "similarity" rows that
  // a subsequent same-filter call will surface as a `"hybrid"` cache hit;
  // by design — see getRecs flow comment.
  //
  // The cache-write is a pure optimization (next same-filter call cache-
  // hits instead of recomputing). A failure here — transient DB error, a
  // concurrent-cache-miss unique-constraint race, an FK race under load —
  // must NEVER deny the user the recommendations we already computed.
  // 2026-05-15 incident: an unguarded throw here propagated out of getRecs;
  // the client's loadRecs transition had no catch, so /play-next hung on
  // the pending mascot forever. Swallow + log; next call just recomputes.
  try {
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
  } catch (err) {
    console.error(
      "metadataOnlyRecs: cache-write failed; returning recs uncached:",
      err,
    );
  }

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

// ─────────────────────────────────────────────────────────────
// T14: Feedback server actions
// ─────────────────────────────────────────────────────────────

/**
 * Owner-only dismissal. Sets `dismissed=true` so the row drops out of the
 * cache-hit window for future getRecs calls and feeds the rerank prompt's
 * negative-context SELECT. Also stamps `dismissedAt` so T5's
 * `softNegativePenalty` (read via getRecs' negMap from
 * `recommendations.dismissedAt`) applies its time-decayed soft-negative
 * penalty to the game. Deliberately does NOT delete the row.
 *
 * No cache invalidation: the four remaining non-dismissed rows for the
 * current cache key continue to serve. The /play-next page revalidates so a
 * follow-up navigation re-renders without the dismissed card.
 */
export async function dismissRec(
  recId: string,
): Promise<{ ok: true } | { ok: false; reason: "unauthorized" | "not-found" }> {
  const me = await getCachedUser();
  if (!me) return { ok: false, reason: "unauthorized" };

  const [row] = await db
    .select({ id: recommendations.id, userId: recommendations.userId })
    .from(recommendations)
    .where(eq(recommendations.id, recId))
    .limit(1);
  if (!row) return { ok: false, reason: "not-found" };
  if (row.userId !== me.id) return { ok: false, reason: "unauthorized" };

  await db
    .update(recommendations)
    .set({ dismissed: true, dismissedAt: new Date() })
    .where(eq(recommendations.id, recId));

  revalidatePath("/play-next");
  return { ok: true };
}

/**
 * Owner-only 30-day snooze. Sets `snoozedUntil` so T5's softNegativePenalty
 * (read via getRecs' negMap) hard-excludes the game until it lapses, then
 * lets it decay back in.
 *
 * Also sets `dismissed=true`. A snooze IS a dismissal — the card leaves the
 * grid and the user said "not now". The temporal nature lives entirely in
 * `snoozedUntil` (getRecs' negMap re-admits the game once it lapses,
 * regardless of `dismissed`, because the negMap SELECT is not filtered on
 * `dismissed`). Without `dismissed=true` the row is `dismissed=false`, so
 * `refillRecs` ("Show me more like these →", which DELETEs WHERE
 * dismissed=false) wipes the snooze and the just-rejected game returns on
 * the very next refill; the rerank negative-context (WHERE dismissed=true)
 * also never sees it. This was the 2026-05-15 "same suggestions" bug.
 */
export async function snoozeRec(
  recId: string,
): Promise<{ ok: true } | { ok: false; reason: "unauthorized" | "not-found" }> {
  const me = await getCachedUser();
  if (!me) return { ok: false, reason: "unauthorized" };

  const [row] = await db
    .select({ id: recommendations.id, userId: recommendations.userId })
    .from(recommendations)
    .where(eq(recommendations.id, recId))
    .limit(1);
  if (!row) return { ok: false, reason: "not-found" };
  if (row.userId !== me.id) return { ok: false, reason: "unauthorized" };

  await db
    .update(recommendations)
    .set({
      snoozedUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      dismissed: true,
    })
    .where(eq(recommendations.id, recId));

  revalidatePath("/play-next");
  return { ok: true };
}

/**
 * Owner-only permanent exclusion. Sets `neverAgain` (hard-excluded forever by
 * T5's softNegativePenalty) plus `dismissedAt` (soft-negative timestamp) and
 * `dismissed=true` so the row survives `refillRecs`' WHERE dismissed=false
 * DELETE and feeds the rerank negative-context (WHERE dismissed=true) — same
 * 2026-05-15 fix as snoozeRec. Intentionally does NOT delete the row (kept
 * for the rerank negative-context SELECT).
 */
export async function neverAgainRec(
  recId: string,
): Promise<{ ok: true } | { ok: false; reason: "unauthorized" | "not-found" }> {
  const me = await getCachedUser();
  if (!me) return { ok: false, reason: "unauthorized" };

  const [row] = await db
    .select({ id: recommendations.id, userId: recommendations.userId })
    .from(recommendations)
    .where(eq(recommendations.id, recId))
    .limit(1);
  if (!row) return { ok: false, reason: "not-found" };
  if (row.userId !== me.id) return { ok: false, reason: "unauthorized" };

  await db
    .update(recommendations)
    .set({ neverAgain: true, dismissedAt: new Date(), dismissed: true })
    .where(eq(recommendations.id, recId));

  revalidatePath("/play-next");
  return { ok: true };
}

/**
 * "Save for later" — adds the game to the user's library via `ensureLog`
 * (which fires `triggerOnLogWrite` → vector recompute + maybe milestone
 * narrative refresh) and dismisses the rec so it doesn't reappear.
 *
 * Destination follows library semantics: a recommended game is one the user
 * doesn't have (candidatePool excludes every logged game), so the default is
 * `wishlist` ("want it, don't own it"). Only when an existing non-wishlist
 * log already proves possession do we use `backlog` ("own it, not played").
 * `ensureLog` is onConflictDoNothing for non-playing statuses, so an
 * already-owned game keeps its real status; the message reflects intent.
 */
export async function saveRecForLater(
  recId: string,
): Promise<
  | { ok: true; message: string }
  | { ok: false; reason: "unauthorized" | "not-found" }
> {
  const me = await getCachedUser();
  if (!me) return { ok: false, reason: "unauthorized" };

  const [row] = await db
    .select({
      id: recommendations.id,
      userId: recommendations.userId,
      gameId: recommendations.gameId,
    })
    .from(recommendations)
    .where(eq(recommendations.id, recId))
    .limit(1);
  if (!row) return { ok: false, reason: "not-found" };
  if (row.userId !== me.id) return { ok: false, reason: "unauthorized" };

  // Ownership check. A recommended game normally has zero logs (candidatePool
  // excludes every logged game), so this is almost always "no row" → wishlist.
  // The branch is the safety net for a game already in the library in an
  // owning status (a wishlist row does NOT count as owning it).
  const [existingLog] = await db
    .select({ status: logs.status })
    .from(logs)
    .where(and(eq(logs.userId, me.id), eq(logs.gameId, row.gameId)))
    .limit(1);
  const alreadyOwned =
    existingLog != null && existingLog.status !== "wishlist";
  const targetStatus: "backlog" | "wishlist" = alreadyOwned
    ? "backlog"
    : "wishlist";

  // Dismiss BEFORE ensureLog. ensureLog fires triggerOnLogWrite which
  // DELETE FROM recommendations WHERE user_id=$1 AND dismissed=false —
  // if we marked dismissed after the log write, the rec row would be
  // wiped before the UPDATE could flip it to dismissed=true, and the
  // gameId would never enter the rerank prompt's negative-context
  // SELECT (which filters on dismissed=true). The save-for-later
  // action is conceptually a "dismiss with a side effect" — model it
  // that way at the SQL level too.
  await db
    .update(recommendations)
    .set({ dismissed: true })
    .where(eq(recommendations.id, recId));

  // ensureLog derives userId from session — it would no-op if `me` were
  // gone here, but we already gated above so this is informational.
  await ensureLog({ gameId: row.gameId, status: targetStatus });

  revalidatePath("/play-next");
  revalidatePath("/library");
  return {
    ok: true,
    message: alreadyOwned
      ? "Added to your backlog."
      : "Added to your wishlist.",
  };
}

/**
 * "Play this" — smart-routes based on whether a platform hint was supplied,
 * whether the user has that platform connection, and whether the game
 * actually exists on that platform.
 *
 *   - No platform hint            → redirect=true (caller pushes /games/{slug})
 *   - Platform not connected      → ok=false, "platform-not-connected"
 *   - Game lacks the platform     → redirect=true (caller falls back to slug)
 *   - All green                   → ensureLog(playing, [platform]) + dismiss
 *                                   + toast message
 *
 * Mirrors the three-button RecCard UI from T15: the platform picker is only
 * shown when the user has 2+ matching connections; the single-platform case
 * passes through here without a UI prompt.
 */
export async function playRec(
  recId: string,
  platform?: "steam" | "xbox" | "psn",
): Promise<
  | { ok: true; redirect: false; message: string }
  | { ok: true; redirect: true; slug: string }
  | {
      ok: false;
      reason: "unauthorized" | "not-found" | "platform-not-connected";
    }
> {
  const me = await getCachedUser();
  if (!me) return { ok: false, reason: "unauthorized" };

  const [row] = await db
    .select({
      id: recommendations.id,
      userId: recommendations.userId,
      gameId: recommendations.gameId,
    })
    .from(recommendations)
    .where(eq(recommendations.id, recId))
    .limit(1);
  if (!row) return { ok: false, reason: "not-found" };
  if (row.userId !== me.id) return { ok: false, reason: "unauthorized" };

  const [game] = await db
    .select({ slug: games.slug, platforms: games.platforms })
    .from(games)
    .where(eq(games.id, row.gameId))
    .limit(1);
  if (!game) return { ok: false, reason: "not-found" };

  if (!platform) {
    return { ok: true, redirect: true, slug: game.slug };
  }

  // Confirm the user actually has an active connection for this platform.
  const [conn] = await db
    .select({ id: platformConnections.id })
    .from(platformConnections)
    .where(
      and(
        eq(platformConnections.userId, me.id),
        eq(platformConnections.platform, platform),
        eq(platformConnections.isActive, true),
      ),
    )
    .limit(1);
  if (!conn) return { ok: false, reason: "platform-not-connected" };

  // Confirm the game has this platform — catalog drift means a game that
  // looked Steam-only at filter time may have lost the tag, etc. Fall back
  // to slug navigation rather than asserting a platform we can't verify.
  if (!(game.platforms ?? []).includes(platform)) {
    return { ok: true, redirect: true, slug: game.slug };
  }

  // Dismiss BEFORE ensureLog — same reasoning as saveRecForLater above.
  // triggerOnLogWrite (fired inside ensureLog) DELETEs non-dismissed rec
  // rows; the dismissed=true UPDATE must land first so the row survives
  // and contributes to future rerank prompts' negative context.
  await db
    .update(recommendations)
    .set({ dismissed: true })
    .where(eq(recommendations.id, recId));

  // ensureLog derives userId from session (see header comment in lib/logs).
  await ensureLog({
    gameId: row.gameId,
    status: "playing",
    platforms: [platform],
  });

  revalidatePath("/play-next");
  revalidatePath("/library");
  return { ok: true, redirect: false, message: `Marked as playing on ${platform}.` };
}

/**
 * "Show me more like these" — wipes the non-dismissed rows for the current
 * `(userId, cacheKey)` so the next `getRecs` re-runs the rerank with the
 * cumulative dismissed history feeding the negative-context section of the
 * prompt. Historically-dismissed rows are preserved for that purpose.
 */
export async function refillRecs(rawFilters: FilterParams): Promise<RecResult> {
  const me = await getCachedUser();
  if (!me) return { ok: false, reason: "unauthorized" };

  // safeParse mirrors getRecs — a malformed RPC payload returns a clean
  // discriminated `{ ok: false, reason: "invalid-filters" }` instead of
  // throwing a Zod error that surfaces as a 500 from the server-action
  // boundary.
  const filtersResult = filterSchema.safeParse(rawFilters);
  if (!filtersResult.success) {
    return { ok: false, reason: "invalid-filters" };
  }
  const filters = filtersResult.data;
  const key = cacheKey({
    userId: me.id,
    moods: filters.moods,
    time: filters.time,
    platforms: filters.platforms,
  });

  await db
    .delete(recommendations)
    .where(
      and(
        eq(recommendations.userId, me.id),
        eq(recommendations.cacheKey, key),
        eq(recommendations.dismissed, false),
      ),
    );

  return getRecs(filters);
}
