import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.9";
import { requireServiceRole } from "../_shared/auth.ts";
import { aggregate, type AggregateRow } from "../_shared/taste-engine.ts";
import { callRouter } from "../_shared/ai-router.ts";
import { buildNarrativePrompt, NARRATIVE_PROMPT_VERSION } from "../_shared/prompts.ts";

type Tier = "empty" | "sparse" | "sharpening" | "full";

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
      return new Response(JSON.stringify({ tier: "empty", skipped: "no logs" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
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
      return new Response(
        JSON.stringify({ tier, narrative: null, skipped: "sparse-tier-no-ai" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
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

    // 4. Call AI router.
    const { system, user } = buildNarrativePrompt({
      vectors: { genre: agg.genre, theme: agg.theme, mechanic: agg.mechanic },
      lengthPreference: agg.length_preference,
      recentLikedGames: recentLiked,
      recentDislikedGames: recentDisliked,
      tier,
      totalLogs: rows.length,
    });

    const result = await callRouter({
      feature: "fingerprint",
      system,
      user,
      maxTokens: 200,
    });

    const modelVersion = `${result.provider}-${result.model}/narrative-${NARRATIVE_PROMPT_VERSION}`;

    // 5. Atomic write: vectors + narrative + snapshot + model version.
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
        ${result.text},
        ${sql.json({ genre: agg.genre, theme: agg.theme, mechanic: agg.mechanic })},
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
      narrative: result.text,
      modelVersion,
      reason: reason ?? "manual",
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
});
