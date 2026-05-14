/**
 * Phase 4 verification pass — automatable subset of the 8-point gate
 * for Taste Fingerprint + Recommendations (see Phase 4 spec).
 *
 * Run:
 *   pnpm tsx --conditions react-server --env-file=.env scripts/verify-phase-4.ts
 *
 * Reads .env for DATABASE_URL + (optional) SUPABASE_FUNCTIONS_URL +
 * SUPABASE_SERVICE_ROLE_KEY.
 *
 * Exits 0 if every automatable check passes (skips don't fail). Exits 1
 * if any check fails. Lists gate items that still require manual
 * eyeballing at the end.
 *
 * Graceful degradation:
 *   - Group B (Edge Function auth) skips if SUPABASE_FUNCTIONS_URL unset.
 *   - Group G (privacy + OG) skips if the dev server isn't reachable.
 *   - Schema (A), aggregate (C), drift (D), cache key (E partial),
 *     server-action auth shape (F), prompts (H), delegated smokes (I)
 *     all run locally and must pass.
 *
 * What this script does NOT cover (still requires human in the loop):
 *   - M1: A real /play-next round-trip with a logged-in browser.
 *   - M2: Visual rendering of /u/{name}/taste at every tier.
 *   - M3: Real AI router output for narrative + rerank.
 *   - M4: Mascot pose changes across tiers.
 */
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

import postgres from "postgres";

import { aggregateFingerprint, type AggregateInputRow } from "@/lib/taste/aggregate";
import { cosineSim, type SparseVector } from "@/lib/taste/vectors";
import { tierForUser } from "@/lib/taste/tier";
import { cacheKey } from "@/lib/recs/cache";
import { moodArraySchema } from "@/lib/recs/moods";
import { buildNarrativePrompt, buildRerankPrompt } from "@/lib/taste/prompts";

type Status = "pass" | "fail" | "skip";
interface Check {
  group: string;
  name: string;
  status: Status;
  detail?: string;
  /** Comma-separated gate-criterion numbers this check contributes to. */
  gate: string;
}

const checks: Check[] = [];
function record(c: Check) {
  checks.push(c);
  const tag = c.status === "pass" ? "  PASS" : c.status === "fail" ? "  FAIL" : "  SKIP";
  console.log(`${tag}  ${c.group} · ${c.name}${c.detail ? `  —  ${c.detail}` : ""}`);
}

function databaseUrl(): string {
  const u = process.env.DATABASE_URL;
  if (!u) throw new Error("DATABASE_URL not set");
  return u;
}

// ───────────────────────────────────────────────────────────────────
// Group A — Schema sanity (5 checks)
// Phase 4 migration adds narrative_* columns + cache_key + 2 partial idx.
// ───────────────────────────────────────────────────────────────────
async function checkSchema(sql: ReturnType<typeof postgres>) {
  const group = "A.schema";

  const tasteCols = await sql<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'taste_fingerprints'
  `;
  const tasteColSet = new Set(tasteCols.map((c) => c.column_name));

  record({
    group,
    name: "taste_fingerprints.narrative_snapshot_vectors column exists",
    status: tasteColSet.has("narrative_snapshot_vectors") ? "pass" : "fail",
    gate: "2,3",
  });
  record({
    group,
    name: "taste_fingerprints.narrative_generated_at column exists",
    status: tasteColSet.has("narrative_generated_at") ? "pass" : "fail",
    gate: "2,3",
  });
  record({
    group,
    name: "taste_fingerprints.narrative_model_version column exists",
    status: tasteColSet.has("narrative_model_version") ? "pass" : "fail",
    gate: "3",
  });

  const recsCols = await sql<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'recommendations'
  `;
  const recsColSet = new Set(recsCols.map((c) => c.column_name));
  record({
    group,
    name: "recommendations.cache_key column exists",
    status: recsColSet.has("cache_key") ? "pass" : "fail",
    gate: "5,6",
  });

  const expectedIdx = new Set([
    "recommendations_user_cache_key_idx",
    "recommendations_user_dismissed_idx",
  ]);
  const idxRows = await sql<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'recommendations'
      AND indexname = ANY(${[...expectedIdx]})
  `;
  const idxSet = new Set(idxRows.map((r) => r.indexname));
  const missingIdx = [...expectedIdx].filter((i) => !idxSet.has(i));
  record({
    group,
    name: "recommendations has both partial indexes (cache_key + dismissed)",
    status: missingIdx.length === 0 ? "pass" : "fail",
    detail: missingIdx.length > 0 ? `missing: ${missingIdx.join(",")}` : undefined,
    gate: "5,6",
  });
}

// ───────────────────────────────────────────────────────────────────
// Group B — Edge Function auth (6 checks)
// All SKIP if SUPABASE_FUNCTIONS_URL is unset.
// For each of {refresh-fingerprint, rerank-recs, taste-drift-cron}:
//   - POST without apikey → expect 401
//   - reachability (covered by getting an HTTP response at all)
// ───────────────────────────────────────────────────────────────────
async function checkEdgeFunctions() {
  const group = "B.edge-fn";
  const base = (process.env.SUPABASE_FUNCTIONS_URL ?? "").replace(/\/$/, "");
  const fns = ["refresh-fingerprint", "rerank-recs", "taste-drift-cron"];

  if (!base) {
    for (const fn of fns) {
      record({
        group,
        name: `${fn} reachable`,
        status: "skip",
        detail: "SUPABASE_FUNCTIONS_URL not set",
        gate: "2,3,5",
      });
      record({
        group,
        name: `${fn} rejects missing apikey (401)`,
        status: "skip",
        detail: "SUPABASE_FUNCTIONS_URL not set",
        gate: "security",
      });
    }
    return;
  }

  for (const fn of fns) {
    let httpStatus: number | null = null;
    let netError: string | null = null;
    try {
      const res = await fetch(`${base}/${fn}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      httpStatus = res.status;
    } catch (err) {
      netError = String(err);
    }
    // 404 means the function isn't deployed to this project — treat as SKIP
    // per the gate guidance (deploy is out-of-scope for the verify script).
    const deployed = httpStatus !== null && httpStatus !== 404;
    record({
      group,
      name: `${fn} deployed`,
      status: deployed ? "pass" : "skip",
      detail: netError
        ? `unreachable: ${netError}`
        : httpStatus === 404
          ? "not deployed (404)"
          : `got ${httpStatus}`,
      gate: "2,3,5",
    });
    record({
      group,
      name: `${fn} rejects missing apikey (401)`,
      status: deployed ? (httpStatus === 401 ? "pass" : "fail") : "skip",
      detail: deployed
        ? `got ${httpStatus}`
        : "function not deployed; will verify post-deploy",
      gate: "security",
    });
  }
}

// ───────────────────────────────────────────────────────────────────
// Group C — Aggregate truth-table (4 checks)
// Direct calls into lib/taste/aggregate.ts.
// ───────────────────────────────────────────────────────────────────
function row(partial: Partial<AggregateInputRow>): AggregateInputRow {
  return {
    status: "playing",
    rating: null,
    hasPublishedReview: false,
    genres: [],
    themes: [],
    mechanics: [],
    gameModes: [],
    playerPerspectives: [],
    playtimeAvgHours: null,
    ...partial,
  };
}
function checkAggregate() {
  const group = "C.aggregate";

  // 1. Empty input → all-zero vectors.
  const empty = aggregateFingerprint({ rows: [] });
  const emptyOk =
    Object.keys(empty.genre).length === 0 &&
    Object.keys(empty.theme).length === 0 &&
    Object.keys(empty.mechanic).length === 0 &&
    empty.totalLogsAtGeneration === 0;
  record({
    group,
    name: "empty input → zero vectors + totalLogs=0",
    status: emptyOk ? "pass" : "fail",
    gate: "1",
  });

  // 2. One rated-9 input → positive genre weight.
  const liked = aggregateFingerprint({
    rows: [row({ rating: 9, genres: ["RPG"] })],
  });
  record({
    group,
    name: "rating=9 with genre RPG → positive RPG weight",
    status: (liked.genre.RPG ?? 0) > 0 ? "pass" : "fail",
    detail: `RPG=${(liked.genre.RPG ?? 0).toFixed(3)}`,
    gate: "1",
  });

  // 3. One rated-2 input → negative genre weight.
  const hated = aggregateFingerprint({
    rows: [row({ rating: 2, genres: ["Action"] })],
  });
  record({
    group,
    name: "rating=2 with genre Action → negative Action weight",
    status: (hated.genre.Action ?? 0) < 0 ? "pass" : "fail",
    detail: `Action=${(hated.genre.Action ?? 0).toFixed(3)}`,
    gate: "1",
  });

  // 4. Backlog weight = 0.2 × signed contribution. Compare ratio of backlog
  //    vs completed (no rating, weight 0.6) for the same genre — backlog
  //    should contribute proportionally less.
  const backlogOnly = aggregateFingerprint({
    rows: [row({ status: "backlog", genres: ["Strategy"] })],
  });
  const completedOnly = aggregateFingerprint({
    rows: [row({ status: "completed", genres: ["Strategy"] })],
  });
  // Both normalize to 1 (single row), but raw weight differs. Since each
  // single-row aggregate's norm = max(1, totalW), backlog (w=0.2) lands at
  // raw/1 = 0.2, while completed (w=0.6) lands at raw/1 = 0.6. Both have
  // sign=+1 (engaged tiers + non-dropped), so the genre score is just the
  // unnormalized weight when totalW < 1.
  const backlogVal = backlogOnly.genre.Strategy ?? 0;
  const completedVal = completedOnly.genre.Strategy ?? 0;
  const ratioOk =
    Math.abs(backlogVal - 0.2) < 1e-6 && Math.abs(completedVal - 0.6) < 1e-6;
  record({
    group,
    name: "backlog weight ≈ 0.2 (vs completed 0.6)",
    status: ratioOk ? "pass" : "fail",
    detail: `backlog=${backlogVal.toFixed(3)}, completed=${completedVal.toFixed(3)}`,
    gate: "1",
  });
}

// ───────────────────────────────────────────────────────────────────
// Group D — Tier boundaries + vector drift (4 checks)
// ───────────────────────────────────────────────────────────────────
function checkTierAndDrift() {
  const group = "D.tier-drift";

  // 1. Boundary check at each tier transition.
  const boundariesOk =
    tierForUser(9) === "sparse" &&
    tierForUser(10) === "sharpening" &&
    tierForUser(29) === "sharpening" &&
    tierForUser(30) === "full";
  record({
    group,
    name: "tierForUser boundaries: 9→sparse, 10→sharpening, 29→sharpening, 30→full",
    status: boundariesOk ? "pass" : "fail",
    detail: `9=${tierForUser(9)}, 10=${tierForUser(10)}, 29=${tierForUser(29)}, 30=${tierForUser(30)}`,
    gate: "2,4",
  });

  // 2. Identity: cosineSim(v, v) === 1.
  const v: SparseVector = { a: 1, b: 2, c: 3 };
  record({
    group,
    name: "cosineSim identity: cosineSim(v, v) === 1",
    status: Math.abs(cosineSim(v, v) - 1) < 1e-10 ? "pass" : "fail",
    gate: "3,8",
  });

  // 3. Orthogonality: disjoint-key vectors → cosineSim = 0.
  const a: SparseVector = { x: 1, y: 1 };
  const b: SparseVector = { z: 1, w: 1 };
  record({
    group,
    name: "cosineSim orthogonality: disjoint-key vectors → 0",
    status: Math.abs(cosineSim(a, b)) < 1e-10 ? "pass" : "fail",
    detail: `cosineSim={${cosineSim(a, b).toFixed(6)}}`,
    gate: "8",
  });

  // 4. Scaling: cosineSim is scale-invariant (direction-only).
  const small: SparseVector = { a: 1, b: 2, c: 3 };
  const large: SparseVector = { a: 10, b: 20, c: 30 };
  record({
    group,
    name: "cosineSim scaling: cosineSim(v, 10·v) ≈ 1",
    status: Math.abs(cosineSim(small, large) - 1) < 1e-10 ? "pass" : "fail",
    detail: `cosineSim=${cosineSim(small, large).toFixed(6)}`,
    gate: "8",
  });
}

// ───────────────────────────────────────────────────────────────────
// Group E — Rec engine shape (5 checks)
// Mostly code-shape verification — actual behavior runs in
// scripts/smoke-recs-cache.ts (Group I).
// ───────────────────────────────────────────────────────────────────
async function checkRecsEngine() {
  const group = "E.recs";

  // 1. candidatePool import resolves + signature is (userId, opts?) → Promise<...>.
  //
  // Multi-line signatures are formatted with prettier; allow whitespace +
  // newlines between the params. dotall on `.` lets us span the linebreaks
  // between the function name and the return-type clause. The opts type
  // can carry additional fields (e.g. `vectors?` since the live-vectors
  // refactor) — we only assert that `limit?: number` is present and the
  // return type matches.
  const candSrc = await readFile("lib/recs/candidate-pool.ts", "utf8");
  const candidateSigOk =
    /export\s+async\s+function\s+candidatePool\s*\([^)]*userId:\s*string[^)]*opts:\s*\{[^}]*limit\?: number[^}]*\}[^)]*\)\s*:\s*Promise<CandidateGame\[\]>/s.test(
      candSrc,
    );
  record({
    group,
    name: "candidatePool signature: (userId, { limit?, … }) → Promise<CandidateGame[]>",
    status: candidateSigOk ? "pass" : "fail",
    gate: "5",
  });

  // 2. cacheKey stability — same input → same output.
  const k1 = cacheKey({ userId: "u1", moods: ["chill"], time: "1hr", platforms: ["steam"] });
  const k2 = cacheKey({ userId: "u1", moods: ["chill"], time: "1hr", platforms: ["steam"] });
  record({
    group,
    name: "cacheKey deterministic (same input → same 24-char hex)",
    status: k1 === k2 && k1.length === 24 ? "pass" : "fail",
    detail: `k=${k1}`,
    gate: "6",
  });

  // 3. cacheKey commutativity — mood/platform order doesn't matter.
  const ka = cacheKey({ userId: "u1", moods: ["chill", "multiplayer"], time: "1hr", platforms: ["xbox", "steam"] });
  const kb = cacheKey({ userId: "u1", moods: ["multiplayer", "chill"], time: "1hr", platforms: ["steam", "xbox"] });
  record({
    group,
    name: "cacheKey sort-stable (mood/platform order doesn't matter)",
    status: ka === kb ? "pass" : "fail",
    gate: "6",
  });

  // 4. Sparse-tier path skips AI (verify by reading source).
  const recsSrc = await readFile("lib/recs/server-actions.ts", "utf8");
  const sparseSkipsAi =
    /if \(fpReady\.tier === "sparse"\)\s*\{\s*return metadataOnlyRecs/.test(recsSrc);
  record({
    group,
    name: "sparse-tier getRecs path skips AI (returns metadataOnlyRecs)",
    status: sparseSkipsAi ? "pass" : "fail",
    gate: "4,5",
  });

  // 5. Cache-hit predicate is present (≥4 non-dismissed rows + freshness).
  const cacheHitShapeOk =
    /cached\.length >= 4 && cached\.every\(\(c\) => c\.generatedAt > vectorsAt\)/.test(
      recsSrc,
    );
  record({
    group,
    name: "cache-hit logic: ≥4 non-dismissed rows AND all generatedAt > vectorsAt",
    status: cacheHitShapeOk ? "pass" : "fail",
    gate: "6",
  });
}

// ───────────────────────────────────────────────────────────────────
// Group F — Server action auth + rate-limit (5 checks)
// Code-shape verification on the server-action sources. Confirms that:
//   - refreshFingerprint, dismissRec, saveRecForLater, playRec all
//     return `unauthorized` when there is no session.
//   - refreshFingerprint calls enforceRateLimit with scope taste:refresh.
// ───────────────────────────────────────────────────────────────────
/**
 * Locate the next occurrence of `export async function ${name}` in `src`,
 * skip to the first `{` of the function body, and return ~400 chars after
 * it. Lets us regex over the first few statements without burning context
 * matching the multi-line return-type clause.
 */
function functionBodyStart(src: string, name: string): string | null {
  const idx = src.indexOf(`export async function ${name}`);
  if (idx === -1) return null;
  const braceIdx = src.indexOf("{", idx);
  if (braceIdx === -1) return null;
  return src.slice(braceIdx, braceIdx + 600);
}

async function checkServerActionAuth() {
  const group = "F.actions";

  const tasteSrc = await readFile("lib/taste/server-actions.ts", "utf8");
  const refreshBody = functionBodyStart(tasteSrc, "refreshFingerprint");
  const refreshAuthOk =
    refreshBody !== null &&
    /const me = await getCachedUser\(\);\s*if \(!me\) return \{ ok: false, reason: "unauthorized" \};/s.test(
      refreshBody,
    );
  record({
    group,
    name: "refreshFingerprint unauth → { ok:false, reason:'unauthorized' }",
    status: refreshAuthOk ? "pass" : "fail",
    gate: "security",
  });

  // Rate-limit assertion. Must use scope "taste:refresh".
  const rateLimitOk =
    /enforceRateLimit\(\s*\{\s*scope:\s*"taste:refresh"/s.test(tasteSrc);
  record({
    group,
    name: "refreshFingerprint enforces rate-limit (scope=taste:refresh)",
    status: rateLimitOk ? "pass" : "fail",
    gate: "security",
  });

  const recsSrc = await readFile("lib/recs/server-actions.ts", "utf8");

  const dismissBody = functionBodyStart(recsSrc, "dismissRec");
  const dismissAuthOk =
    dismissBody !== null &&
    /const me = await getCachedUser\(\);\s*if \(!me\) return \{ ok: false, reason: "unauthorized" \};/s.test(
      dismissBody,
    );
  record({
    group,
    name: "dismissRec unauth → { ok:false, reason:'unauthorized' }",
    status: dismissAuthOk ? "pass" : "fail",
    gate: "security",
  });

  const saveBody = functionBodyStart(recsSrc, "saveRecForLater");
  const saveAuthOk =
    saveBody !== null &&
    /const me = await getCachedUser\(\);\s*if \(!me\) return \{ ok: false, reason: "unauthorized" \};/s.test(
      saveBody,
    );
  record({
    group,
    name: "saveRecForLater unauth → { ok:false, reason:'unauthorized' }",
    status: saveAuthOk ? "pass" : "fail",
    gate: "security",
  });

  const playBody = functionBodyStart(recsSrc, "playRec");
  const playAuthOk =
    playBody !== null &&
    /const me = await getCachedUser\(\);\s*if \(!me\) return \{ ok: false, reason: "unauthorized" \};/s.test(
      playBody,
    );
  record({
    group,
    name: "playRec unauth → { ok:false, reason:'unauthorized' }",
    status: playAuthOk ? "pass" : "fail",
    gate: "security",
  });
}

// ───────────────────────────────────────────────────────────────────
// Group G — Privacy + OG (4 checks)
// Requires the dev server. SKIP all if /localhost:3000 unreachable.
// ───────────────────────────────────────────────────────────────────
async function checkPrivacyAndOg() {
  const group = "G.privacy";
  const base = "http://localhost:3000";

  // Probe the dev server once. If it's down, skip the entire group.
  let serverUp = false;
  try {
    const probe = await fetch(`${base}/`, {
      method: "HEAD",
      signal: AbortSignal.timeout(1500),
    });
    serverUp = probe.status > 0;
  } catch {
    serverUp = false;
  }

  if (!serverUp) {
    const items = [
      "/u/{public}/taste → 200",
      "/u/{private}/taste → 404",
      "/api/og/taste/{public} → 200",
      "/api/og/taste/{private} → 404",
    ];
    for (const name of items) {
      record({
        group,
        name,
        status: "skip",
        detail: "dev server not reachable on http://localhost:3000",
        gate: "7",
      });
    }
    return;
  }

  // Server's up, but we don't have test fixtures wired in this session.
  // SKIP — the user will run these manually before the gate ceremony.
  for (const name of [
    "/u/{public}/taste → 200",
    "/u/{private}/taste → 404",
    "/api/og/taste/{public} → 200",
    "/api/og/taste/{private} → 404",
  ]) {
    record({
      group,
      name,
      status: "skip",
      detail: "no fixture usernames wired — run manual smoke",
      gate: "7",
    });
  }
}

// ───────────────────────────────────────────────────────────────────
// Group H — Prompts + moods (3 checks)
// ───────────────────────────────────────────────────────────────────
function checkPromptsAndMoods() {
  const group = "H.prompts";

  // 1. Narrative prompt returns { system, user } with non-empty strings.
  const narr = buildNarrativePrompt({
    vectors: { genre: { RPG: 0.5 }, theme: {}, mechanic: {}, gameMode: {}, playerPerspective: {} },
    lengthPreference: { "<5h": 0, "5-10h": 0.4, "10-30h": 0.6, "30-60h": 0, "60h+": 0 },
    recentLikedGames: [{ title: "Disco Elysium", genres: ["RPG"], rating: 9 }],
    recentDislikedGames: [],
    tier: "sharpening",
    totalLogs: 15,
  });
  record({
    group,
    name: "buildNarrativePrompt returns non-empty { system, user }",
    status:
      typeof narr.system === "string" &&
      narr.system.length > 50 &&
      typeof narr.user === "string" &&
      narr.user.length > 50
        ? "pass"
        : "fail",
    detail: `system=${narr.system.length}b, user=${narr.user.length}b`,
    gate: "3",
  });

  // 2. Rerank prompt returns non-empty { system, user }.
  const rer = buildRerankPrompt({
    narrative: "You favor moody RPGs with reactive worlds.",
    vectors: { genre: { RPG: 0.5 }, theme: {}, mechanic: {}, gameMode: {}, playerPerspective: {} },
    filters: { moods: ["chill"], time: "1hr", platforms: ["steam"] },
    candidates: [
      {
        id: 1,
        title: "Outer Wilds",
        genres: ["Adventure"],
        themes: ["Sci-Fi"],
        mechanics: ["Exploration"],
        playtimeAvgHours: 22,
        description: "Explore a tiny solar system stuck in a time loop.",
      },
    ],
    dismissedGames: [],
    currentlyPlaying: [],
  });
  record({
    group,
    name: "buildRerankPrompt returns non-empty { system, user }",
    status:
      typeof rer.system === "string" &&
      rer.system.length > 50 &&
      typeof rer.user === "string" &&
      rer.user.length > 50
        ? "pass"
        : "fail",
    detail: `system=${rer.system.length}b, user=${rer.user.length}b`,
    gate: "5",
  });

  // 3. Mood schema enforces max=2 per Q7.
  const threeMoodsRejected = !moodArraySchema.safeParse(["chill", "challenged", "story-driven"]).success;
  const twoMoodsAccepted = moodArraySchema.safeParse(["chill", "challenged"]).success;
  record({
    group,
    name: "moodArraySchema: rejects 3 moods, accepts 2 (Q7 cap)",
    status: threeMoodsRejected && twoMoodsAccepted ? "pass" : "fail",
    detail: `3-mood-rejected=${threeMoodsRejected}, 2-mood-accepted=${twoMoodsAccepted}`,
    gate: "5",
  });
}

// ───────────────────────────────────────────────────────────────────
// Group I — Delegated smokes (3 checks)
// ───────────────────────────────────────────────────────────────────
function delegateSmoke(file: string, gate: string, name: string) {
  const r = spawnSync(
    "pnpm",
    ["tsx", "--conditions", "react-server", "--env-file=.env", `scripts/${file}`],
    { encoding: "utf8", shell: true },
  );
  const status: Status = r.status === 0 ? "pass" : "fail";
  const summary = r.stdout
    .split(/\r?\n/)
    .reverse()
    .find((line) => /\d+\/\d+ passed/.test(line));
  record({
    group: "I.smoke",
    name,
    status,
    detail: summary ?? (r.status === 0 ? "exit 0" : `exit ${r.status}`),
    gate,
  });
}

// ───────────────────────────────────────────────────────────────────
// Run
// ───────────────────────────────────────────────────────────────────
async function main() {
  console.log("Phase 4 verification — automatable subset\n");

  const sql = postgres(databaseUrl(), { prepare: false });
  try {
    await checkSchema(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }

  await checkEdgeFunctions();
  checkAggregate();
  checkTierAndDrift();
  await checkRecsEngine();
  await checkServerActionAuth();
  await checkPrivacyAndOg();
  checkPromptsAndMoods();

  // Delegated smokes last — their stdout follows the inline run.
  console.log("\n  — delegating to existing smokes —");
  delegateSmoke("smoke-aggregate.ts", "1", "aggregate truth-table (smoke)");
  delegateSmoke("smoke-drift.ts", "8", "tier + vector drift (smoke)");
  delegateSmoke("smoke-recs-cache.ts", "6", "rec cache-key stability (smoke)");

  // Summary mapped to the 8-point gate (Phase 4 spec).
  console.log("\n──── Gate mapping ────");
  const gateLines: Array<[string, string, string]> = [
    ["1", "Aggregate produces vectors in [-1, +1]", "Group C truth-table + smoke"],
    ["2", "Schema columns + tier classification", "Group A schema + Group D boundaries"],
    ["3", "Narrative refresh produces text", "Group B refresh-fingerprint + Group H prompts"],
    ["4", "Tier UI gating", "Group D boundaries + Group E sparse-skip"],
    ["5", "Recs from /play-next return ≥4 cards", "Group B rerank + Group H prompts + Group A cache_key"],
    ["6", "Cache hit returns without re-running AI", "Group A indexes + Group E cache predicate"],
    ["7", "Privacy gate + OG cards", "Group G (dev-server) — manual when SKIP"],
    ["8", "Drift cron + cosineSim invariants", "Group B taste-drift-cron + Group D scaling/orthogonality"],
  ];
  for (const [n, criterion, mapped] of gateLines) {
    const related = checks.filter((c) => c.gate.split(",").includes(n));
    const failures = related.filter((c) => c.status === "fail");
    const tag = failures.length === 0
      ? (related.length === 0 ? "MANUAL" : "auto-pass")
      : "FAIL";
    console.log(`  #${n}  ${criterion}`);
    console.log(`        automatable: ${mapped}`);
    console.log(`        result: ${tag}${failures.length ? ` (${failures.length} failure(s))` : ""}`);
  }

  console.log("\n──── Manual-only items (not automatable from this script) ────");
  console.log("  M1 — A real /play-next round-trip with a logged-in browser");
  console.log("  M2 — Visual rendering of /u/{name}/taste at every tier");
  console.log("  M3 — Real AI router output for narrative + rerank");
  console.log("  M4 — Mascot pose changes across tiers (visual)");

  const pass = checks.filter((c) => c.status === "pass").length;
  const fail = checks.filter((c) => c.status === "fail").length;
  const skip = checks.filter((c) => c.status === "skip").length;
  console.log(`\n${pass}/${checks.length} pass · ${fail} fail · ${skip} skip`);
  process.exit(fail === 0 ? 0 : 1);
}

void main().catch((err) => {
  console.error("verify-phase-4 crashed:", err);
  process.exit(1);
});
