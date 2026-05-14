/**
 * AI fallback for games where IGDB-derived mechanics are empty.
 *
 * Broader candidate set than the original Task 8 spec: covers ALL games
 * with igdb_resolved_at stamped + mechanics empty, regardless of whether
 * IGDB found a match. This catches both:
 *   (a) games IGDB had no record for (igdb_id NULL — small indies, etc.)
 *   (b) games IGDB matched but whose keywords didn't intersect our 151-entry
 *       hand-curated allow-list (small games with few keywords; our vocab
 *       is restrictive)
 *
 * Approach: OpenAI generateObject + Zod enum schemas built from the same
 * IGDB_* sets the IGDB normalizer uses. Uses gpt-4o-mini with strict
 * structured outputs (json_schema) — grammar-constrained decoder makes
 * invalid enum values mechanically impossible.
 *
 * Cost: gpt-4o-mini = $0.15 input / $0.60 output per 1M tokens. At ~1700
 * input + 50 output per game × 3027 games ≈ $0.78 total for the full
 * backfill. (Groq's openai/gpt-oss-120b would have been free but its 8K
 * TPM ceiling produced a ~12.5hr ETA, so we trade $0.78 for ~10min.)
 *
 * Idempotent: candidate query excludes already-mechanic'd rows.
 * Resume-safe.
 *
 * Run:
 *   pnpm tsx --conditions react-server --env-file=.env scripts/backfill-mechanics-ai.ts
 *
 * Flags via env:
 *   BACKFILL_LIMIT        — max games to process this run (default: all)
 *   BACKFILL_DRY_RUN=1    — don't write, just log what would happen
 *   OPENAI_API_KEY        — required (already in .env)
 *   OPENAI_CONCURRENCY    — parallel requests per wave (default: 10 for paid
 *                           tier; set to 3 or lower on free tier / RPM=3)
 */
import { and, eq, isNotNull, or, isNull, sql } from "drizzle-orm";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";

import { db } from "../lib/db";
import { games } from "../lib/db/schema";
import {
  IGDB_GAME_MODES,
  IGDB_PLAYER_PERSPECTIVES,
  IGDB_MECHANICS,
} from "../lib/igdb/vocabulary";

const MODEL = "gpt-4o-mini";

// OpenAI tier-1 (paid) limits: 500 RPM / 200K TPM — CONCURRENCY=10 is fine.
// Free tier (no billing): RPM=3 — CONCURRENCY must stay ≤ 3.
// The SDK retries on 429 so occasional bursts are handled, but setting
// CONCURRENCY above your RPM limit will cause most waves to exhaust retries.
// Add a payment method at https://platform.openai.com/account/billing to
// unlock 500 RPM and reduce the full-backfill ETA from ~17h to ~10min.
const CONCURRENCY = Number.parseInt(process.env.OPENAI_CONCURRENCY ?? "10", 10);
const PROGRESS_INTERVAL = 50;
const MAX_PER_FACET = 20;

// Zod 4 z.enum() accepts readonly string[] directly (no tuple cast needed).
// The sets are guaranteed non-empty: 6 modes + 7 perspectives + 151 mechanics.
const GAME_MODES_ARR = [...IGDB_GAME_MODES] as const;
const PERSPECTIVES_ARR = [...IGDB_PLAYER_PERSPECTIVES] as const;
const MECHANICS_ARR = [...IGDB_MECHANICS] as const;

// Strict schema: grammar-constrained decoder prevents values outside the enum.
const FacetSchema = z.object({
  game_modes: z.array(z.enum(GAME_MODES_ARR)),
  player_perspectives: z.array(z.enum(PERSPECTIVES_ARR)),
  mechanics: z.array(z.enum(MECHANICS_ARR)),
});

// Defense-in-depth: allow-list sets for post-filter in case strict mode
// ever slips (e.g. model version change or provider fallback).
const GAME_MODES_SET = new Set(GAME_MODES_ARR as unknown as string[]);
const PERSPECTIVES_SET = new Set(PERSPECTIVES_ARR as unknown as string[]);
const MECHANICS_SET = new Set(MECHANICS_ARR as unknown as string[]);

type Candidate = {
  id: number;
  title: string;
  genres: string[] | null;
  description: string | null;
};

const SYSTEM_PROMPT = [
  "You classify video games by gameplay mechanics, modes, and perspectives.",
  "Pick from the schema's enum values only.",
  "Prefer empty arrays over speculation — accuracy matters more than completeness.",
  "Mechanics describe what the player DOES (e.g. 'crafting', 'permadeath', 'turn-based').",
  "Game modes describe player count semantics (e.g. 'Single player', 'Multiplayer').",
  "Player perspectives describe the camera (e.g. 'First person', 'Third person').",
].join("\n");

async function classifyGame(
  model: ReturnType<ReturnType<typeof createOpenAI>>,
  g: Candidate,
) {
  const prompt = [
    `Title: ${g.title}`,
    `Genres: ${(g.genres ?? []).join(", ") || "(unknown)"}`,
    `Description: ${(g.description ?? "(no description available)").slice(0, 1500)}`,
  ].join("\n");

  const { object } = await generateObject({
    model,
    schema: FacetSchema,
    schemaName: "game_facets",
    schemaDescription:
      "Gameplay metadata. Each array contains ONLY tags that genuinely apply to this game; prefer empty arrays over speculation.",
    system: SYSTEM_PROMPT,
    prompt,
  });

  // Defense-in-depth post-filter (strict mode should already guarantee this,
  // but belt-and-suspenders in case of provider changes).
  return {
    gameModes: object.game_modes
      .filter((v) => GAME_MODES_SET.has(v))
      .slice(0, MAX_PER_FACET),
    playerPerspectives: object.player_perspectives
      .filter((v) => PERSPECTIVES_SET.has(v))
      .slice(0, MAX_PER_FACET),
    mechanics: object.mechanics
      .filter((v) => MECHANICS_SET.has(v))
      .slice(0, MAX_PER_FACET),
  };
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY env var is required");

  const limit = process.env.BACKFILL_LIMIT
    ? Number.parseInt(process.env.BACKFILL_LIMIT, 10)
    : Number.POSITIVE_INFINITY;
  const dryRun = process.env.BACKFILL_DRY_RUN === "1";

  console.log("AI mechanics fallback backfill (OpenAI gpt-4o-mini strict-mode)");
  console.log(`  limit:      ${Number.isFinite(limit) ? limit : "no limit"}`);
  console.log(`  dry-run:    ${dryRun ? "yes" : "no"}`);
  console.log(`  model:      ${MODEL} (OpenAI)`);
  console.log(`  mode:       json_schema (strict)`);
  console.log(`  concurrency: ${CONCURRENCY} (set OPENAI_CONCURRENCY to override; free-tier RPM=3 requires ≤3)`);

  const startedAt = Date.now();

  // BROADENED candidate filter (vs original spec): mechanics-empty games
  // regardless of igdb_id state. Catches both IGDB-missed AND
  // vocabulary-filter-empty cases.
  const candidates = (await db
    .select({
      id: games.id,
      title: games.title,
      genres: games.genres,
      description: games.description,
    })
    .from(games)
    .where(
      and(
        isNotNull(games.igdbResolvedAt),
        or(
          isNull(games.mechanics),
          sql`array_length(${games.mechanics}, 1) IS NULL`,
          sql`array_length(${games.mechanics}, 1) = 0`,
        ),
      ),
    )
    .orderBy(sql`${games.id} DESC`)) as Candidate[];

  const work = Number.isFinite(limit) ? candidates.slice(0, limit) : candidates;
  console.log(`  candidates: ${work.length}\n`);

  const openai = createOpenAI({ apiKey });
  const model = openai(MODEL);

  let processed = 0;
  let succeeded = 0;
  let emptyOutput = 0;
  let aiFailed = 0;
  let nextLog = PROGRESS_INTERVAL;

  for (let i = 0; i < work.length; i += CONCURRENCY) {
    const wave = work.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      wave.map(async (g) => {
        try {
          const out = await classifyGame(model, g);
          return { id: g.id, title: g.title, status: "ok" as const, out };
        } catch (err) {
          return {
            id: g.id,
            title: g.title,
            status: "ai-failed" as const,
            error: (err as Error).message,
          };
        }
      }),
    );

    for (const r of results) {
      processed++;
      if (r.status === "ai-failed") {
        aiFailed++;
        if (dryRun || aiFailed <= 3) {
          console.error(`  ai-failed [${r.id}] ${r.title}: ${r.error}`);
        }
        continue;
      }
      const { gameModes, playerPerspectives, mechanics } = r.out;
      if (gameModes.length === 0 && playerPerspectives.length === 0 && mechanics.length === 0) {
        emptyOutput++;
        if (dryRun) console.log(`  empty   [${r.id}] ${r.title}`);
        continue;
      }
      if (dryRun) {
        console.log(
          `  would-update [${r.id}] ${r.title} → modes=${gameModes.length} perspectives=${playerPerspectives.length} mechanics=${mechanics.length}`,
        );
        console.log(`    game_modes:     ${gameModes.join(", ") || "(none)"}`);
        console.log(`    perspectives:   ${playerPerspectives.join(", ") || "(none)"}`);
        console.log(`    mechanics:      ${mechanics.join(", ")}`);
        succeeded++;
        continue;
      }
      try {
        await db
          .update(games)
          .set({
            gameModes,
            playerPerspectives,
            mechanics,
          })
          .where(eq(games.id, r.id));
        console.log(
          `  updated  [${r.id}] ${r.title} → modes=${gameModes.length} perspectives=${playerPerspectives.length} mechanics=${mechanics.length}`,
        );
        succeeded++;
      } catch (err) {
        console.error(`  UPDATE failed for game ${r.id}: ${(err as Error).message}`);
        aiFailed++;
      }
    }

    if (processed >= nextLog) {
      const elapsed = (Date.now() - startedAt) / 1000;
      const rate = processed / elapsed;
      const remaining = work.length - processed;
      const eta = remaining / rate;
      console.log(
        `  [${processed}/${work.length}] succeeded=${succeeded} empty=${emptyOutput} ai-failed=${aiFailed} | ${rate.toFixed(1)}/s | ETA ${eta.toFixed(0)}s`,
      );
      nextLog += PROGRESS_INTERVAL;
    }
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsedSec}s`);
  console.log(`  processed:  ${processed}`);
  console.log(`  succeeded:  ${succeeded}`);
  console.log(`  empty:      ${emptyOutput}`);
  console.log(`  ai-failed:  ${aiFailed}`);

  process.exit(0);
}

void main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
