import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.9";
import { requireServiceRole } from "../_shared/auth.ts";
import { buildRerankPrompt, RERANK_PROMPT_VERSION } from "../_shared/prompts.ts";
import { callRouter } from "../_shared/ai-router.ts";

type Filters = { moods: string[]; time: string; platforms: string[] };

type CandidateRow = {
  id: number;
  title: string;
  genres: string[] | null;
  themes: string[] | null;
  mechanics: string[] | null;
  playtime_avg_hours: number | null;
  description: string | null;
};

/**
 * Defensive JSON parse — strips a stray code fence if the model produced
 * one despite the system-prompt instruction "no code fences". Returns
 * null for any parse failure so the caller can branch into the 502
 * "ai-bad-output" path rather than crash on a thrown exception.
 */
function safeParseJson(text: string): unknown {
  const cleaned = text
    .replace(/^```(?:json)?\n?/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  // Auth: service-role key via `apikey` header. See _shared/auth.ts.
  // Same internal-service pattern as refresh-fingerprint (T4) — callers
  // (the Next-side getRecs server action) MUST derive userId from their
  // own auth check before invoking this function. Do NOT expose to public.
  const unauthorized = requireServiceRole(req);
  if (unauthorized) return unauthorized;

  let body: {
    userId?: string;
    filters?: Filters;
    candidateIds?: number[];
    cacheKey?: string;
    mode?: string;
    userRefinements?: string[];
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return new Response("invalid JSON body", { status: 400 });
  }
  const { userId, filters, candidateIds, cacheKey } = body;
  if (!userId || !filters || !candidateIds || !cacheKey) {
    return new Response(
      "missing userId / filters / candidateIds / cacheKey",
      { status: 400 },
    );
  }
  if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
    return new Response("candidateIds must be a non-empty array", { status: 400 });
  }
  // Structural check on filters so a malformed inner shape returns a clean
  // 400 instead of crashing into the outer catch and surfacing as a 500.
  // Caller is service-role-gated (T12), but this still helps catch caller
  // bugs early with a precise status code.
  if (
    !Array.isArray(filters.moods) ||
    typeof filters.time !== "string" ||
    !Array.isArray(filters.platforms)
  ) {
    return new Response("invalid filters shape", { status: 400 });
  }

  // mode is accepted for caller-contract completeness (Task 12 uses it to
  // decide full-vs-rerank-only on the Next side). This Edge function is
  // given candidateIds and never retrieves a pool, so it has no re-retrieve
  // step to skip — it always reranks the supplied set. Validate + default.
  const mode = body.mode === "rerank-only" ? "rerank-only" : "full";
  const userRefinements = Array.isArray(body.userRefinements)
    ? body.userRefinements
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .slice(0, 5)
    : [];

  const databaseUrl = Deno.env.get("DATABASE_URL")!;
  const sql = postgres(databaseUrl, { prepare: false });

  try {
    // 1-3. Pull fingerprint, candidate metadata, negative + exclusion
    //      context in parallel. Each query depends only on already-resolved
    //      request inputs (userId, candidateIds) — no inter-query
    //      dependencies — so we cut the prompt-prep latency by ~4x.
    //
    //      `fp` may be undefined for users who haven't run
    //      refresh-fingerprint yet — we still proceed with null narrative +
    //      empty vectors; the prompt handles that.
    //
    //      `dismissed` and `playing` are bounded by LIMIT to keep the
    //      prompt size predictable across very-active users.
    const [fpRows, candidates, dismissed, playing, library] = await Promise.all([
      sql<
        Array<{
          narrative: string | null;
          genre: Record<string, number>;
          theme: Record<string, number>;
          mechanic: Record<string, number>;
        }>
      >`
        SELECT
          narrative_summary AS narrative,
          genre_vector AS genre,
          theme_vector AS theme,
          mechanic_vector AS mechanic
        FROM taste_fingerprints
        WHERE user_id = ${userId}
        LIMIT 1
      `,
      sql<CandidateRow[]>`
        SELECT
          id, title, genres, themes, mechanics,
          playtime_avg_hours::float AS playtime_avg_hours,
          description
        FROM games
        WHERE id = ANY(${candidateIds}::int[])
      `,
      sql<Array<{ title: string; genres: string[] | null }>>`
        SELECT g.title, g.genres
        FROM recommendations r
        JOIN games g ON g.id = r.game_id
        WHERE r.user_id = ${userId} AND r.dismissed = true
        ORDER BY r.generated_at DESC
        LIMIT 20
      `,
      sql<Array<{ title: string }>>`
        SELECT g.title
        FROM logs l
        JOIN games g ON g.id = l.game_id
        WHERE l.user_id = ${userId} AND l.status = 'playing'
        ORDER BY l.updated_at DESC
        LIMIT 5
      `,
      sql<Array<{ title: string }>>`
        SELECT g.title
        FROM logs l JOIN games g ON g.id = l.game_id
        WHERE l.user_id = ${userId}
        GROUP BY g.title
        ORDER BY MAX(l.updated_at) DESC
        LIMIT 30
      `,
    ]);
    const fp = fpRows[0];

    if (candidates.length === 0) {
      return Response.json(
        { ok: false, reason: "no-candidate-rows" },
        { status: 400 },
      );
    }

    // 4. Render the prompt + call the AI router.
    const { system, user } = buildRerankPrompt({
      narrative: fp?.narrative ?? null,
      vectors: {
        genre: fp?.genre ?? {},
        theme: fp?.theme ?? {},
        mechanic: fp?.mechanic ?? {},
      },
      filters,
      candidates: candidates.map((c) => ({
        id: c.id,
        title: c.title,
        genres: c.genres ?? [],
        themes: c.themes ?? [],
        mechanics: c.mechanics ?? [],
        playtimeAvgHours: c.playtime_avg_hours,
        description: c.description,
      })),
      dismissedGames: dismissed.map((d) => ({
        title: d.title,
        genres: d.genres ?? [],
      })),
      currentlyPlaying: playing,
      libraryTitles: library.map((r) => r.title),
      userRefinements,
    });

    let aiResult: Awaited<ReturnType<typeof callRouter>>;
    try {
      aiResult = await callRouter({
        feature: "recommendation",
        system,
        user,
        // ~120 tokens per pick (JSON overhead + one-sentence reason);
        // 720 covers the 6-card grid.
        maxTokens: 720,
        // Telemetry parity with the Next-side router.
        telemetry: { sql, userId },
      });
    } catch (err) {
      console.error(
        "rerank-recs: AI router failed",
        err instanceof Error ? err.message : String(err),
      );
      return Response.json({ ok: false, reason: "ai-router-failed" }, { status: 502 });
    }

    // 5. Parse + validate. The candidateIdSet guard rejects hallucinated
    //    gameIds (model invents an ID not in the candidate pool) and
    //    duplicates (model picks the same game twice). Score is clamped
    //    to [0,1] because the DB column is numeric(5,4) and we trust no
    //    AI output. Reason is truncated to 280 chars to bound the column.
    const parsed = safeParseJson(aiResult.text) as
      | { recs?: Array<{ gameId?: unknown; score?: unknown; reason?: unknown }> }
      | null;

    if (!parsed || !Array.isArray(parsed.recs) || parsed.recs.length === 0) {
      console.error(
        "rerank-recs: AI returned unparseable response",
        aiResult.text.slice(0, 300),
      );
      return Response.json({ ok: false, reason: "ai-bad-output" }, { status: 502 });
    }

    const candidateIdSet = new Set(candidateIds);
    const seen = new Set<number>();
    const cleaned: Array<{ gameId: number; score: number; reason: string }> = [];
    for (const r of parsed.recs) {
      const gameId = Number(r.gameId);
      if (!Number.isInteger(gameId) || !candidateIdSet.has(gameId)) continue;
      if (seen.has(gameId)) continue;
      seen.add(gameId);
      const rawScore = Number(r.score);
      const score = Number.isFinite(rawScore)
        ? Math.max(0, Math.min(1, rawScore))
        : 0;
      const reason = String(r.reason ?? "").slice(0, 280);
      cleaned.push({ gameId, score, reason });
      if (cleaned.length === 6) break;
    }

    if (cleaned.length === 0) {
      return Response.json({ ok: false, reason: "no-valid-recs" }, { status: 502 });
    }

    // 6. Atomic delete-then-insert under cache_key. Wraps both in a single
    //    transaction so a partial failure can't leave a half-populated
    //    cache key (which would later look like a cache hit with <5 recs).
    //    Algorithm value is 'ai' to match the DB rec_algorithm enum
    //    [similarity, ai, hybrid] — earlier plan drafts wrote 'ai_rerank',
    //    which would fail the enum check.
    //
    //    Bulk INSERT via postgres-js's tx(rows, ...keys) helper — replaces a
    //    per-row INSERT loop with a single statement (one network round-trip
    //    for up to 5 rows). `generated_at` and `dismissed` rely on their
    //    DB defaults (NOW() and false) so we omit them from the column list.
    const rowsToInsert = cleaned.map((r) => ({
      user_id: userId,
      game_id: r.gameId,
      score: r.score.toFixed(4),
      reason: r.reason,
      algorithm: "ai",
      cache_key: cacheKey,
    }));
    await sql.begin(async (tx) => {
      await tx`
        DELETE FROM recommendations
        WHERE user_id = ${userId}
          AND cache_key = ${cacheKey}
          AND dismissed = false
      `;
      await tx`
        INSERT INTO recommendations ${
          tx(rowsToInsert, "user_id", "game_id", "score", "reason", "algorithm", "cache_key")
        }
      `;
    });

    const modelVersion = `${aiResult.provider}-${aiResult.model}/rerank-${RERANK_PROMPT_VERSION}`;

    return Response.json({
      ok: true,
      recs: cleaned,
      modelVersion,
      mode,
    });
  } catch (err) {
    console.error(
      "rerank-recs: unexpected error",
      err instanceof Error ? err.message : String(err),
    );
    return Response.json({ ok: false, reason: "unexpected-error" }, { status: 500 });
  } finally {
    await sql.end({ timeout: 5 });
  }
});
