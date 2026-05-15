import "server-only";
import { z } from "zod";
import { generate } from "@/lib/ai/router";
import { AIProvidersExhaustedError } from "@/lib/ai/errors";
import { db, schema } from "@/lib/db";
import type { RecapPayload, SceneDefinition, SceneId } from "./types";
import {
  buildOpeningPrompt,
  buildGotyPrompt,
  buildGenreDominancePrompt,
  buildMechanicLovePrompt,
  buildSurprisePrompt,
  buildTasteEvolutionPrompt,
  buildClosingPrompt,
  type PromptOutput,
} from "./prompts";
import { SCENE_CATALOG } from "./scenes";

/**
 * captions.ts — AI overlay for the recap pageant.
 *
 * For each `aiCaption: true` scene in payload.scenes, build a system+user
 * prompt and ask the multi-provider router for a caption. The router itself
 * streams text; we collect the full string, JSON.parse it, and zod-validate
 * the shape `{caption: string}`. On any failure mode we fall through to
 * `scene.fallbackTemplate(payload)` so the recap is never broken end-to-end.
 *
 * Why not `generateObject`?  The plan was written against an imagined
 * generateObject({schema, system, prompt}) entry point that the router
 * doesn't actually expose. The real router is `generate({prompt, systemPrompt,
 * feature, userId})` returning `{textStream, providerUsed}` — same shape used
 * by Phase 2 (interview/review). We do the JSON-parse + zod step here.
 *
 * Telemetry overlap with the router: the router writes its own `ai_calls`
 * rows via lib/ai/telemetry.recordCall — `success=true` after a stream
 * completes and `success=false` per-provider failure during fallthrough.
 * From the router's perspective a malformed response IS a success (the
 * stream completed). So when we end up using the fallbackTemplate due to a
 * JSON-parse or zod-validation failure, we write our OWN `success=false`
 * row here so the cost dashboard reflects that the call didn't actually
 * help. Likewise on AIProvidersExhaustedError we write a row tagged
 * `provider=router` to distinguish "no providers available" from any
 * per-provider failure rows the router already logged.
 *
 * Retry semantics:
 *   - JSON-parse / zod failure → retry ONCE with a stricter system suffix
 *     telling the model to output ONLY valid JSON. If retry also fails,
 *     fall back.
 *   - Provider exhaustion → fallback immediately. Retrying when zero
 *     providers are configured won't change anything.
 */

const CaptionSchema = z.object({ caption: z.string().min(8).max(140) });

const STRICTER_SUFFIX =
  "\n\nIMPORTANT: Output ONLY valid JSON matching the schema {\"caption\": string}. " +
  "Do not include backticks, prose, markdown, or any other text outside the JSON object.";

/**
 * Dispatcher: scene id → prompt builder. Returns null when the payload
 * lacks the data the prompt needs (e.g. mechanic_love without topMechanic).
 * Callers should fall back to the scene's template in that case.
 */
function buildPrompt(sceneId: SceneId, payload: RecapPayload): PromptOutput | null {
  const year = new Date(payload.windowStart).getUTCFullYear();
  switch (sceneId) {
    case "opening":
      return buildOpeningPrompt({
        totalGames: payload.totals.totalGames,
        year,
        reviewCount: payload.totals.reviewCount,
        topGenre: payload.topGenre?.name ?? null,
      });
    case "goty":
      return payload.goty
        ? buildGotyPrompt({
            title: payload.goty.title,
            rating: payload.goty.rating,
            status: String(payload.goty.status),
          })
        : null;
    case "genre_dominance":
      return payload.topGenre
        ? buildGenreDominancePrompt({
            topGenre: payload.topGenre.name,
            topGenrePct: payload.topGenre.pct,
            secondGenre: payload.topGenre.secondName,
            secondGenrePct: payload.topGenre.secondPct,
          })
        : null;
    case "mechanic_love":
      return payload.topMechanic
        ? buildMechanicLovePrompt({ topMechanic: payload.topMechanic.name })
        : null;
    case "surprise":
      return payload.surprise
        ? buildSurprisePrompt({
            game: payload.surprise.game.title,
            surpriseGenre: payload.surprise.surpriseGenre,
            rating: payload.surprise.game.rating,
            baselineAvg: payload.surprise.baselineAvg,
          })
        : null;
    case "taste_evolution":
      return payload.tasteEvolution
        ? buildTasteEvolutionPrompt({
            q1Vibe: payload.tasteEvolution.q1Vibe,
            q4Vibe: payload.tasteEvolution.q4Vibe,
          })
        : null;
    case "closing":
      return buildClosingPrompt({
        topGame: payload.goty?.title ?? "varied",
        topGenre: payload.topGenre?.name ?? "varied",
        surpriseGame: payload.surprise?.game.title ?? null,
        year,
        mode: payload.mode,
      });
    default:
      // No prompt builder for non-AI scenes or unsupported ids — caller
      // falls back to scene template.
      return null;
  }
}

/**
 * Consume a textStream to a complete string. The router yields chunks as
 * the provider streams; for captions we want the final concatenated text
 * before JSON.parse runs. No chunk-size cap because captions are short
 * (zod enforces ≤140 chars on the inner caption field).
 */
async function collectStream(stream: AsyncIterable<string>): Promise<string> {
  let out = "";
  for await (const chunk of stream) out += chunk;
  return out;
}

/**
 * Attempt to extract a `{caption: string}` object from a raw model response.
 * Tries a direct JSON.parse first; on failure scans for the first `{...}`
 * object substring (some models prefix with ```json or commentary even
 * when told not to). Returns null if neither succeeds OR the parsed value
 * doesn't pass the zod schema.
 */
function parseCaption(raw: string): { caption: string } | null {
  const direct = tryParse(raw);
  if (direct) return direct;
  // Fallback: find the first balanced JSON object substring.
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  return tryParse(match[0]);
}

function tryParse(s: string): { caption: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    return null;
  }
  const validated = CaptionSchema.safeParse(parsed);
  return validated.success ? validated.data : null;
}

/**
 * Write a best-effort row to ai_calls. We pass `provider="router"` for
 * conditions the router can't attribute to a specific provider (validation
 * failure after a successful stream, or AIProvidersExhaustedError where
 * every provider already got its own row). Errors here are swallowed — the
 * cost dashboard going stale should never break the recap flow.
 */
async function logCaptionsFailure(args: {
  userId: string;
  latencyMs: number;
  errorMessage: string;
}): Promise<void> {
  try {
    await db.insert(schema.aiCalls).values({
      userId: args.userId,
      feature: "year_in_review",
      provider: "router",
      model: "n/a",
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: args.latencyMs,
      success: false,
      errorMessage: args.errorMessage,
    });
  } catch (err) {
    // Best-effort. Don't let telemetry breakage break the recap render.
    console.error("captions: ai_calls write failed", err);
  }
}

/**
 * Single-scene AI captioning with a retry-then-fallback ladder.
 *
 * Steps:
 *   1. If the scene is non-AI, return the deterministic fallback (no router).
 *   2. If the prompt builder can't build a prompt (missing payload data),
 *      return the fallback (no router).
 *   3. Call generate(). On AIProvidersExhaustedError → log + fallback (no retry).
 *   4. Stream → string → parse + validate. On success return the caption.
 *      The router already wrote a `success=true` ai_calls row.
 *   5. Validation failed: retry once with the stricter suffix.
 *   6. If retry succeeds → return its caption.
 *   7. If retry also fails → log captions-side failure + fallback.
 */
export async function generateCaption(
  scene: SceneDefinition,
  payload: RecapPayload,
  userId: string,
): Promise<string> {
  if (!scene.aiCaption) return scene.fallbackTemplate(payload);

  const prompt = buildPrompt(scene.id, payload);
  if (!prompt) return scene.fallbackTemplate(payload);

  const started = Date.now();

  // First attempt.
  try {
    const result = await generate({
      prompt: prompt.user,
      systemPrompt: prompt.system,
      feature: "year_in_review",
      userId,
    });
    const raw = await collectStream(result.textStream);
    const parsed = parseCaption(raw);
    if (parsed) return parsed.caption;
    // First attempt completed but response was malformed → retry with
    // stricter shape instructions. Fall through to retry block.
  } catch (err) {
    if (err instanceof AIProvidersExhaustedError) {
      await logCaptionsFailure({
        userId,
        latencyMs: Date.now() - started,
        errorMessage: err.message,
      });
      return scene.fallbackTemplate(payload);
    }
    // Non-exhaustion router error (rate limit, unexpected throw). Still
    // try one retry — could be a transient hiccup.
  }

  // Retry with stricter system suffix.
  try {
    const retry = await generate({
      prompt: prompt.user,
      systemPrompt: prompt.system + STRICTER_SUFFIX,
      feature: "year_in_review",
      userId,
    });
    const raw = await collectStream(retry.textStream);
    const parsed = parseCaption(raw);
    if (parsed) return parsed.caption;
    // Retry also returned a malformed response. Log + fallback.
    await logCaptionsFailure({
      userId,
      latencyMs: Date.now() - started,
      errorMessage: `captions: zod/JSON validation failed after retry for scene=${scene.id}`,
    });
    return scene.fallbackTemplate(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logCaptionsFailure({
      userId,
      latencyMs: Date.now() - started,
      errorMessage: `captions: retry attempt errored for scene=${scene.id}: ${msg}`,
    });
    return scene.fallbackTemplate(payload);
  }
}

/**
 * Build a caption for every scene in payload.scenes in parallel.
 * Non-AI scenes go through `generateCaption` too, which short-circuits
 * to their template — that way the returned record always covers
 * payload.scenes 1:1.
 *
 * If a scene id in payload.scenes has no SCENE_CATALOG entry (drift bug),
 * it's silently skipped from the result rather than throwing. The caller
 * (T11 render path) treats missing captions as fallbacks via the scene
 * lookup anyway.
 */
export async function generateAllCaptions(
  payload: RecapPayload,
  userId: string,
): Promise<Record<SceneId, string>> {
  const scenes = payload.scenes
    .map((id) => SCENE_CATALOG.find((s) => s.id === id))
    .filter((s): s is SceneDefinition => s !== undefined);

  const entries = await Promise.all(
    scenes.map(async (s) => [s.id, await generateCaption(s, payload, userId)] as const),
  );
  return Object.fromEntries(entries) as Record<SceneId, string>;
}
