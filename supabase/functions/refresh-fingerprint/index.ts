import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.9";
import { requireServiceRole } from "../_shared/auth.ts";
import { aggregate, type AggregateRow } from "../_shared/taste-engine.ts";
import { callRouter } from "../_shared/ai-router.ts";
import { buildNarrativePrompt, NARRATIVE_PROMPT_VERSION } from "../_shared/prompts.ts";

type Tier = "empty" | "sparse" | "sharpening" | "full";

// Mirrored from lib/taste/tier.ts:tierForUser. Edge runtime can't import
// from `lib/` (no @/ alias resolution), so we duplicate. Keep these in
// sync — boundary changes (currently 0 / 10 / 30) are calibrated.
function tierForUser(count: number): Tier {
  if (count <= 0) return "empty";
  if (count < 10) return "sparse";
  if (count < 30) return "sharpening";
  return "full";
}

Deno.serve(async (req) => {
  // Auth: service-role key via `apikey` header. See _shared/auth.ts.
  const unauthorized = requireServiceRole(req);
  if (unauthorized) return unauthorized;

  // Auth boundary note: this Edge function trusts body.userId because
  // requireServiceRole gates the entire handler. Anyone with the
  // SUPABASE_SERVICE_ROLE_KEY (which lives only on the Next-side server)
  // can trigger a refresh for any userId. Callers MUST derive userId from
  // their own auth check before invoking this function — see T5's
  // refreshFingerprint server action. Do NOT expose this Edge function
  // to public traffic. T11 (rerank-recs) and T18 (drift-cron) will reuse
  // this same internal-service pattern.
  let body: { userId?: string; reason?: string };
  try {
    body = (await req.json()) as { userId?: string; reason?: string };
  } catch {
    return new Response("invalid JSON body", { status: 400 });
  }
  const { userId, reason } = body;
  if (!userId) return new Response("missing userId", { status: 400 });

  const databaseUrl = Deno.env.get("DATABASE_URL")!;
  const sql = postgres(databaseUrl, { prepare: false });

  try {
    // 1. Pull all logs joined with games + review-existence indicator.
    //    Uses EXISTS (not LEFT JOIN) to avoid row multiplication when a
    //    log has 2+ published reviews. See lib/taste/server-actions.ts
    //    for the Next-side equivalent.
    const rows = await sql<AggregateRow[]>`
      SELECT
        l.status,
        l.rating::float AS rating,
        EXISTS (
          SELECT 1 FROM reviews r
          WHERE r.log_id = l.id AND r.published_at IS NOT NULL
        ) AS has_published_review,
        g.genres,
        g.themes,
        g.mechanics,
        g.playtime_avg_hours::float AS playtime_avg_hours
      FROM logs l
      JOIN games g ON g.id = l.game_id
      WHERE l.user_id = ${userId}
    `;

    if (rows.length === 0) {
      return Response.json({ tier: "empty", skipped: "no logs" });
    }

    const agg = aggregate(rows);
    const tier = tierForUser(rows.length);

    // 2. For sparse tier, persist vectors only — skip AI narrative.
    if (tier === "sparse") {
      await sql`
        INSERT INTO taste_fingerprints (
          user_id, genre_vector, theme_vector, mechanic_vector,
          length_preference, total_logs_at_generation, vectors_generated_at
        ) VALUES (
          ${userId},
          ${sql.json(agg.genre)},
          ${sql.json(agg.theme)},
          ${sql.json(agg.mechanic)},
          ${sql.json(agg.length_preference)},
          ${agg.total_logs_at_generation},
          NOW()
        )
        ON CONFLICT (user_id) DO UPDATE SET
          genre_vector = EXCLUDED.genre_vector,
          theme_vector = EXCLUDED.theme_vector,
          mechanic_vector = EXCLUDED.mechanic_vector,
          length_preference = EXCLUDED.length_preference,
          total_logs_at_generation = EXCLUDED.total_logs_at_generation,
          vectors_generated_at = NOW()
      `;
      return Response.json({ tier, narrative: null, skipped: "sparse-tier-no-ai" });
    }

    // 3. Build narrative-prompt inputs (sharpening/full tier).
    const recentLiked = await sql<
      Array<{ title: string; genres: string[]; rating: number }>
    >`
      SELECT g.title, g.genres, l.rating::float AS rating
      FROM logs l JOIN games g ON g.id = l.game_id
      WHERE l.user_id = ${userId} AND l.rating IS NOT NULL AND l.rating >= 7
      ORDER BY l.updated_at DESC
      LIMIT 5
    `;
    const recentDisliked = await sql<
      Array<{ title: string; genres: string[]; status: string; rating: number | null }>
    >`
      SELECT g.title, g.genres, l.status, l.rating::float AS rating
      FROM logs l JOIN games g ON g.id = l.game_id
      WHERE l.user_id = ${userId}
        AND ((l.rating IS NOT NULL AND l.rating <= 3) OR l.status = 'dropped')
      ORDER BY l.updated_at DESC
      LIMIT 3
    `;

    // 4. Call AI router. Wrapped in try/catch so a router throw
    //    (AIProvidersExhaustedError when no provider is configured, or
    //    when all providers are temporarily down) degrades to a
    //    vector-only persist instead of returning 500. The vector-only
    //    path below is identical to the AI-rejected-output handling, so
    //    the user still gets a usable taste_fingerprints row that
    //    candidatePool / rerank-recs can read.
    const { system, user } = buildNarrativePrompt({
      vectors: { genre: agg.genre, theme: agg.theme, mechanic: agg.mechanic },
      lengthPreference: agg.length_preference,
      recentLikedGames: recentLiked,
      recentDislikedGames: recentDisliked,
      tier,
      totalLogs: rows.length,
    });

    let result: Awaited<ReturnType<typeof callRouter>>;
    try {
      result = await callRouter({
        feature: "fingerprint",
        system,
        user,
        maxTokens: 200,
        // Telemetry parity with the Next-side router — writes to ai_calls
        // so this Edge function's cost shows up on the same dashboard.
        telemetry: { sql, userId },
      });
    } catch (err) {
      console.warn(
        `refresh-fingerprint: AI router failed, persisting vectors only: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // Same vector-only persist as the length-rejected branch below —
      // do NOT touch narrative_summary / narrative_snapshot_vectors /
      // narrative_generated_at columns. Existing narrative (if any) is
      // preserved; the daily drift cron remains the path that decides
      // when to re-narrate.
      await sql`
        INSERT INTO taste_fingerprints (
          user_id, genre_vector, theme_vector, mechanic_vector,
          length_preference, total_logs_at_generation, vectors_generated_at
        ) VALUES (
          ${userId},
          ${sql.json(agg.genre)},
          ${sql.json(agg.theme)},
          ${sql.json(agg.mechanic)},
          ${sql.json(agg.length_preference)},
          ${agg.total_logs_at_generation},
          NOW()
        )
        ON CONFLICT (user_id) DO UPDATE SET
          genre_vector = EXCLUDED.genre_vector,
          theme_vector = EXCLUDED.theme_vector,
          mechanic_vector = EXCLUDED.mechanic_vector,
          length_preference = EXCLUDED.length_preference,
          total_logs_at_generation = EXCLUDED.total_logs_at_generation,
          vectors_generated_at = NOW()
      `;
      return Response.json({
        tier,
        narrative: null,
        skipped: "ai-router-failed",
        reason: reason ?? "manual",
      });
    }

    // Length sanity check — guard against AI failure modes that produce
    // empty/truncated/run-on output. callRouter already rejects empty strings;
    // this catches the next class of issues. Bounds: max_tokens=200 typically
    // caps at ~800-1000 chars; we allow up to 1500 for tokenization variance.
    // Refusal patterns ("I cannot help with that", "As an AI…") are not
    // length-detectable — content-quality filtering is plan Step 7 (manual
    // prompt iteration) territory.
    const narrative = result.text.trim();
    if (narrative.length < 20 || narrative.length > 1500) {
      console.warn(
        `refresh-fingerprint: AI narrative rejected (length=${narrative.length}, provider=${result.provider})`,
      );
      // Persist vectors only — same path as the sparse-tier branch above.
      await sql`
        INSERT INTO taste_fingerprints (
          user_id, genre_vector, theme_vector, mechanic_vector,
          length_preference, total_logs_at_generation, vectors_generated_at
        ) VALUES (
          ${userId},
          ${sql.json(agg.genre)},
          ${sql.json(agg.theme)},
          ${sql.json(agg.mechanic)},
          ${sql.json(agg.length_preference)},
          ${agg.total_logs_at_generation},
          NOW()
        )
        ON CONFLICT (user_id) DO UPDATE SET
          genre_vector = EXCLUDED.genre_vector,
          theme_vector = EXCLUDED.theme_vector,
          mechanic_vector = EXCLUDED.mechanic_vector,
          length_preference = EXCLUDED.length_preference,
          total_logs_at_generation = EXCLUDED.total_logs_at_generation,
          vectors_generated_at = NOW()
      `;
      return Response.json({
        tier,
        narrative: null,
        skipped: "ai-output-rejected",
        reason: reason ?? "manual",
      });
    }

    const modelVersion = `${result.provider}-${result.model}/narrative-${NARRATIVE_PROMPT_VERSION}`;

    // 5. Atomic write: vectors + narrative + snapshot + model version.
    // Snapshot the SAME vectors we just wrote to genre/theme/mechanic_vector,
    // frozen at narrative-generation time. Subsequent vector-only refreshes
    // (sparse-tier path, drift-cron) update genre_vector etc but do NOT
    // touch narrative_snapshot_vectors — the daily drift cron compares
    // current vectors vs this snapshot to decide whether to re-narrate.
    // Do not "dedupe" by reading from the just-inserted columns; this
    // freeze IS the contract.
    const narrativeSnapshot = sql.json({ genre: agg.genre, theme: agg.theme, mechanic: agg.mechanic });
    await sql`
      INSERT INTO taste_fingerprints (
        user_id, genre_vector, theme_vector, mechanic_vector,
        length_preference, narrative_summary, narrative_snapshot_vectors,
        total_logs_at_generation, narrative_model_version,
        vectors_generated_at, narrative_generated_at
      ) VALUES (
        ${userId},
        ${sql.json(agg.genre)},
        ${sql.json(agg.theme)},
        ${sql.json(agg.mechanic)},
        ${sql.json(agg.length_preference)},
        ${narrative},
        ${narrativeSnapshot},
        ${agg.total_logs_at_generation},
        ${modelVersion},
        NOW(),
        NOW()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        genre_vector = EXCLUDED.genre_vector,
        theme_vector = EXCLUDED.theme_vector,
        mechanic_vector = EXCLUDED.mechanic_vector,
        length_preference = EXCLUDED.length_preference,
        narrative_summary = EXCLUDED.narrative_summary,
        narrative_snapshot_vectors = EXCLUDED.narrative_snapshot_vectors,
        total_logs_at_generation = EXCLUDED.total_logs_at_generation,
        narrative_model_version = EXCLUDED.narrative_model_version,
        vectors_generated_at = NOW(),
        narrative_generated_at = NOW()
    `;

    return Response.json({
      tier,
      narrative,
      modelVersion,
      reason: reason ?? "manual",
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
});
