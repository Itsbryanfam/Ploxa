/**
 * /play-next v2 redesign verification pass — the gate for all 21 tasks.
 *
 * Run:
 *   pnpm tsx --conditions react-server --env-file=.env scripts/verify-play-next-v2.ts
 *
 * Exits 0 when every automatable check passes (skips don't count as
 * failures). Exits 1 on any failure. Exits 2 on an unexpected crash.
 *
 * Structure mirrors scripts/verify-phase-6.ts:
 *   - runGroup() wrapper catches errors and records FAIL automatically.
 *   - Direct postgres-js queries for DB introspection (no Drizzle runtime).
 *   - Test/build suites shell out via spawnSync (Windows: shell:true).
 *   - File-source checks via readFile + regex.
 *
 * Five gate groups:
 *   G1 — Pure/unit suites under tests/unit/recs/ (run individually so a
 *        failure names the suite, plus one whole-dir sweep).
 *   G2 — Integration suite tests/integration/recs/get-recs.test.ts.
 *   G3 — `pnpm build` (the CANONICAL Next-16 Server-Action gate — tsc +
 *        vitest + lint do NOT catch "use server" export validation; only
 *        `next build` does. This is the single most important gate here:
 *        the feature heavily adds/modifies "use server" + server-only files
 *        — lib/recs/server-actions.ts, lib/recs/feature-flag.ts, the
 *        page/_client — and a prior overhaul's prod deploy broke on exactly
 *        this despite green tsc/tests).
 *   G4 — Source-wiring regex assertions (prove v2 wiring where runtime can't
 *        run pre-operator-close-out).
 *   G5 — E2E (Playwright) — operator-gated: SKIP (not FAIL) when migration
 *        0018 isn't applied to dev Supabase, since v2 getRecs 500s on
 *        recommendations.slot until then; runs for real if the column exists.
 *
 * What this script does NOT cover (operator must verify manually):
 *   M1 — Visual review: 3x2 stratified grid vs. current /play-next screenshot
 *   M2 — Refinement UX: "less grindy" → grid changes meaningfully in <2s
 *   M3 — Wildcard sanity: 3 users / 3 histories → wildcard pick is genuinely
 *        surprising (out-of-distribution, not just a low-scored comfort pick)
 *   M4 — Provider-failover smoke: unset CEREBRAS_API_KEY → Groq picks up
 *
 *   Operator close-out prerequisites (also documented in T20's plan
 *   execution note) — these gate G5 + production rollout:
 *     (1) apply lib/db/migrations/0018_play_next_redesign.sql to dev + prod
 *         Supabase (Supabase MCP apply_migration, name `play_next_redesign`);
 *     (2) deploy the T11 `rerank-recs` rerank-only-mode Edge Function;
 *     (3) production rollout via RECS_V2_ENABLED / RECS_V2_USERS per the
 *         plan's "Phase A complete" rollout sequence.
 */

import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

import postgres from "postgres";

type Status = "pass" | "fail" | "skip";
interface Check {
  group: string;
  name: string;
  status: Status;
  detail?: string;
  /** Comma-separated gate-group numbers this check contributes to. */
  gate: string;
}

const checks: Check[] = [];
function record(c: Check) {
  checks.push(c);
  const tag =
    c.status === "pass" ? "  PASS" : c.status === "fail" ? "  FAIL" : "  SKIP";
  console.log(
    `${tag}  ${c.group} · ${c.name}${c.detail ? `  —  ${c.detail}` : ""}`,
  );
}

function databaseUrl(): string {
  const u = process.env.DATABASE_URL;
  if (!u) throw new Error("DATABASE_URL not set");
  return u;
}

/**
 * Run a pnpm subcommand and return pass/fail + a stderr/stdout tail for the
 * failure detail. Windows needs shell:true so pnpm resolves off PATH.
 */
function runPnpm(
  args: string[],
  timeout: number,
): { ok: boolean; detail?: string } {
  const r = spawnSync("pnpm", args, {
    encoding: "utf8",
    shell: true,
    timeout,
  });
  if (r.status === 0) return { ok: true };
  // Build the most useful failure tail we can: prefer stderr, fall back to
  // stdout (vitest prints failures to stdout), then the spawn error.
  const stderr = (r.stderr ?? "").trim();
  const stdout = (r.stdout ?? "").trim();
  const tailSrc = stderr.length > 0 ? stderr : stdout;
  const tail = tailSrc
    ? tailSrc.split("\n").slice(-12).join(" | ")
    : r.error
      ? `spawn error: ${r.error.message}`
      : r.signal
        ? `killed by signal ${r.signal} (timeout=${timeout}ms?)`
        : `exit code ${r.status ?? "null"}`;
  return { ok: false, detail: tail.slice(0, 1200) };
}

// ─────────────────────────────────────────────────────────────────────────────
// G1 — Pure / unit suites under tests/unit/recs/
//
// Run each file individually so a failure names the offending suite, then a
// single whole-dir sweep as a backstop (catches anything not in the list).
// PASS/FAIL strictly on the vitest process exit code.
// ─────────────────────────────────────────────────────────────────────────────
const UNIT_SUITES = [
  "tests/unit/recs/schema-v2.test.ts",
  "tests/unit/recs/mood-affinity.test.ts",
  "tests/unit/recs/time-fit.test.ts",
  "tests/unit/recs/social-score.test.ts",
  "tests/unit/recs/soft-negative.test.ts",
  "tests/unit/recs/scoring.test.ts",
  "tests/unit/recs/diversity-mmr.test.ts",
  "tests/unit/recs/wildcard.test.ts",
  "tests/unit/recs/buckets.test.ts",
  "tests/unit/recs/rerank-prompt.test.ts",
  "tests/unit/recs/feature-flag.test.ts",
  "tests/unit/recs/rec-card-v2.test.tsx",
  "tests/unit/recs/filter-chip-popover.test.tsx",
  "tests/unit/recs/refinement-input.test.tsx",
  "tests/unit/recs/atoms.test.tsx",
  "tests/unit/recs/candidate-pool-v2.test.ts",
  "tests/unit/recs/dismissal-actions.test.ts",
];

function group1() {
  const group = "G1.unit";
  let idx = 0;
  for (const suite of UNIT_SUITES) {
    idx += 1;
    const short = suite.replace("tests/unit/recs/", "");
    // 120s/suite: these are pure unit suites; generous headroom for a cold
    // vitest start on Windows without flaking the gate.
    const { ok, detail } = runPnpm(["vitest", "run", suite], 120000);
    record({
      group,
      name: `G1.${idx} — ${short}`,
      status: ok ? "pass" : "fail",
      detail: ok ? undefined : detail,
      gate: "1",
    });
  }
  // Whole-dir backstop sweep.
  const { ok, detail } = runPnpm(["vitest", "run", "tests/unit/recs/"], 240000);
  record({
    group,
    name: `G1.${idx + 1} — whole tests/unit/recs/ dir sweep`,
    status: ok ? "pass" : "fail",
    detail: ok ? undefined : detail,
    gate: "1",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// G2 — Integration suite (getRecs orchestration, T12)
// ─────────────────────────────────────────────────────────────────────────────
function group2() {
  const group = "G2.integration";
  const { ok, detail } = runPnpm(
    ["vitest", "run", "tests/integration/recs/get-recs.test.ts"],
    180000,
  );
  record({
    group,
    name: "G2.1 — tests/integration/recs/get-recs.test.ts",
    status: ok ? "pass" : "fail",
    detail: ok ? undefined : detail,
    gate: "2",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// G3 — `pnpm build` — CANONICAL Next-16 Server-Action gate.
//
// THE most important gate in this script. The plan omitted it; this project's
// hard-won convention is that tsc + vitest + lint do NOT catch Next.js 16
// "Only async functions are allowed to be exported in a 'use server' file"
// validation — only `next build` does. The settings-overhaul prod deploy
// 179cd3b broke on exactly this with 15 cascading errors despite green
// tsc/tests. This feature heavily adds/modifies "use server" + server-only
// files (lib/recs/server-actions.ts for T12/T13/T19, lib/recs/feature-flag.ts
// server-only, the page/_client), so this is non-negotiable. Generous 10-min
// timeout for a cold Next-16 build.
// ─────────────────────────────────────────────────────────────────────────────
function group3() {
  const group = "G3.build";
  const { ok, detail } = runPnpm(["build"], 600000);
  record({
    group,
    name: "G3.1 — pnpm build (Next-16 'use server' export validation)",
    status: ok ? "pass" : "fail",
    detail: ok
      ? undefined
      : `BUILD FAILED — this is a real finding, not a flake. tail: ${detail ?? "(no output)"}`,
    gate: "3",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// G4 — Source-wiring assertions (regex over source)
//
// These prove the v2 wiring even where runtime can't run pre-operator-close-out
// (mirrors verify-phase-6 G1.2 style: readFile(...).catch(()=>"")).
// ─────────────────────────────────────────────────────────────────────────────
async function group4() {
  const group = "G4.wiring";

  // G4.1 — migration 0018: enum + 4 columns + partial neg-lookup index.
  const migSrc = await readFile(
    "lib/db/migrations/0018_play_next_redesign.sql",
    "utf8",
  ).catch(() => "");
  const hasRecSlotType = /CREATE TYPE "rec_slot"/.test(migSrc);
  const addsSlot = /ALTER TABLE "recommendations" ADD COLUMN "slot"/.test(migSrc);
  const addsDismissedAt =
    /ALTER TABLE "recommendations" ADD COLUMN "dismissed_at"/.test(migSrc);
  const addsSnoozedUntil =
    /ALTER TABLE "recommendations" ADD COLUMN "snoozed_until"/.test(migSrc);
  const addsNeverAgain =
    /ALTER TABLE "recommendations" ADD COLUMN "never_again"/.test(migSrc);
  const hasNegIdx = /recommendations_neg_lookup_idx/.test(migSrc);
  const migOk =
    hasRecSlotType &&
    addsSlot &&
    addsDismissedAt &&
    addsSnoozedUntil &&
    addsNeverAgain &&
    hasNegIdx;
  record({
    group,
    name: "G4.1 — 0018 migration: rec_slot enum + 4 ADD COLUMNs + neg_lookup partial index",
    status: migOk ? "pass" : "fail",
    detail: migOk
      ? undefined
      : `recSlot=${hasRecSlotType} slot=${addsSlot} dismissed_at=${addsDismissedAt} snoozed_until=${addsSnoozedUntil} never_again=${addsNeverAgain} negIdx=${hasNegIdx}`,
    gate: "4",
  });

  // G4.2 — feature-flag.ts: server-only + resolution order + normalization.
  const ffSrc = await readFile("lib/recs/feature-flag.ts", "utf8").catch(
    () => "",
  );
  const ffServerOnly = /import\s+"server-only"/.test(ffSrc);
  const ffCanaryFirst = /canary\.includes\(userId\)\s*\)\s*return true/.test(
    ffSrc,
  );
  const ffTrue = /flag\s*===\s*"true"\s*\)\s*return true/.test(ffSrc);
  const ffFalse = /flag\s*===\s*"false"\s*\)\s*return false/.test(ffSrc);
  const ffNodeEnvDefault =
    /process\.env\.NODE_ENV\s*!==\s*"production"/.test(ffSrc);
  const ffNormalize = /\?\.trim\(\)\.toLowerCase\(\)/.test(ffSrc);
  const ffOk =
    ffServerOnly &&
    ffCanaryFirst &&
    ffTrue &&
    ffFalse &&
    ffNodeEnvDefault &&
    ffNormalize;
  record({
    group,
    name: 'G4.2 — feature-flag.ts: server-only + canary→"true"→"false"→NODE_ENV order + trim/lowercase',
    status: ffOk ? "pass" : "fail",
    detail: ffOk
      ? undefined
      : `serverOnly=${ffServerOnly} canary1st=${ffCanaryFirst} true=${ffTrue} false=${ffFalse} nodeEnvDefault=${ffNodeEnvDefault} normalize=${ffNormalize}`,
    gate: "4",
  });

  // G4.3 — server-actions.ts: legacy fn + flag short-circuit + import.
  const saSrc = await readFile("lib/recs/server-actions.ts", "utf8").catch(
    () => "",
  );
  const definesLegacy = /function getRecsLegacy\(/.test(saSrc);
  const flagShortCircuit =
    /if \(!isRecsV2Enabled\(me\.id\)\) return getRecsLegacy\(rawFilters\);/.test(
      saSrc,
    );
  const importsFlag = /import \{ isRecsV2Enabled \} from "@\/lib\/recs\/feature-flag"/.test(
    saSrc,
  );
  const saOk = definesLegacy && flagShortCircuit && importsFlag;
  record({
    group,
    name: "G4.3 — server-actions.ts: getRecsLegacy + isRecsV2Enabled short-circuit + import",
    status: saOk ? "pass" : "fail",
    detail: saOk
      ? undefined
      : `legacyFn=${definesLegacy} shortCircuit=${flagShortCircuit} import=${importsFlag}`,
    gate: "4",
  });

  // G4.4 — rec-card.tsx root has BOTH data-testid="rec-card" and data-slot.
  const cardSrc = await readFile("components/recs/rec-card.tsx", "utf8").catch(
    () => "",
  );
  const hasTestId = /data-testid="rec-card"/.test(cardSrc);
  const hasDataSlot = /data-slot=\{rec\.slot\}/.test(cardSrc);
  record({
    group,
    name: 'G4.4 — rec-card.tsx root has data-testid="rec-card" + data-slot={rec.slot}',
    status: hasTestId && hasDataSlot ? "pass" : "fail",
    detail:
      hasTestId && hasDataSlot
        ? undefined
        : `testid=${hasTestId} dataSlot=${hasDataSlot}`,
    gate: "4",
  });

  // G4.5 — env.ts: RECS_V2_ENABLED + RECS_V2_USERS in schema AND parse map
  // (≥2 occurrences of each — once in the z.object, once in the explicit
  // serverSchema.parse({...process.env...}) mapping).
  const envSrc = await readFile("lib/env.ts", "utf8").catch(() => "");
  const enabledCount = (envSrc.match(/RECS_V2_ENABLED/g) ?? []).length;
  const usersCount = (envSrc.match(/RECS_V2_USERS/g) ?? []).length;
  const envOk = enabledCount >= 2 && usersCount >= 2;
  record({
    group,
    name: "G4.5 — env.ts: RECS_V2_ENABLED + RECS_V2_USERS in both serverSchema z.object and parse() map",
    status: envOk ? "pass" : "fail",
    detail: envOk
      ? `RECS_V2_ENABLED×${enabledCount}, RECS_V2_USERS×${usersCount}`
      : `RECS_V2_ENABLED×${enabledCount} (need ≥2), RECS_V2_USERS×${usersCount} (need ≥2)`,
    gate: "4",
  });

  // G4.6 — T11 mirror invariant. The plan's dispatch text says "byte-
  // identical", but the project's ACTUAL documented + test-enforced rule
  // (plan line ~1745 + tests/unit/recs/rerank-prompt.test.ts "rerank prompt
  // mirror integrity") is byte-equality of the RERANK REGION only, not the
  // whole file — whole-file identity is impossible because lib/taste/
  // prompts.ts has `import "server-only"` + `@/` aliases while the Deno
  // _shared copy inlines its types. We mirror the real, enforced invariant:
  // extract the rerank region with the SAME anchors the unit test uses
  // (const REFINEMENT_MAX … return { system, user: userBlocks.join("\n") };)
  // and assert those are byte-identical, plus both files set
  // RERANK_PROMPT_VERSION = "v2".
  const libPrompts = await readFile("lib/taste/prompts.ts", "utf8").catch(
    () => "",
  );
  const denoPrompts = await readFile(
    "supabase/functions/_shared/prompts.ts",
    "utf8",
  ).catch(() => "");
  const versionRe = /RERANK_PROMPT_VERSION\s*=\s*"v2"/;
  const libVersionV2 = versionRe.test(libPrompts);
  const denoVersionV2 = versionRe.test(denoPrompts);

  function rerankRegion(src: string): string | null {
    const start = src.indexOf("const REFINEMENT_MAX");
    const endAnchor = 'return { system, user: userBlocks.join("\\n") };';
    const end = src.indexOf(endAnchor);
    if (start === -1 || end === -1) return null;
    return src.slice(start, end + endAnchor.length);
  }
  const libRegion = rerankRegion(libPrompts);
  const denoRegion = rerankRegion(denoPrompts);
  const anchorsFound = libRegion !== null && denoRegion !== null;
  const regionIdentical = anchorsFound && libRegion === denoRegion;
  const mirrorOk =
    libVersionV2 && denoVersionV2 && anchorsFound && regionIdentical;
  record({
    group,
    name: 'G4.6 — T11 mirror: RERANK_PROMPT_VERSION="v2" both files + rerank region byte-identical',
    status: mirrorOk ? "pass" : "fail",
    detail: mirrorOk
      ? "rerank region (const REFINEMENT_MAX … userBlocks.join) byte-identical across lib + Deno mirror"
      : `libV2=${libVersionV2} denoV2=${denoVersionV2} anchorsFound=${anchorsFound} regionIdentical=${regionIdentical}`,
    gate: "4",
  });

  // G4.7 — Plan completeness: tasks.json parses + all 21 tasks completed.
  const tasksRaw = await readFile(
    "docs/superpowers/plans/2026-05-15-play-next-redesign.md.tasks.json",
    "utf8",
  ).catch(() => "");
  let tasksOk = false;
  let tasksDetail = "tasks.json unreadable";
  try {
    const parsed = JSON.parse(tasksRaw) as {
      tasks?: Array<{ id: number; status: string }>;
    };
    const tasks = parsed.tasks ?? [];
    const notCompleted = tasks
      .filter((t) => t.status !== "completed")
      .map((t) => t.id);
    tasksOk = tasks.length === 21 && notCompleted.length === 0;
    tasksDetail = tasksOk
      ? `all ${tasks.length} tasks completed`
      : `count=${tasks.length} (expect 21); not-completed ids: [${notCompleted.join(",")}]`;
  } catch (e) {
    tasksDetail = `JSON.parse failed: ${
      e instanceof Error ? e.message : String(e)
    }`;
  }
  record({
    group,
    name: "G4.7 — plan tasks.json parses + all 21 tasks status=completed",
    status: tasksOk ? "pass" : "fail",
    detail: tasksDetail,
    gate: "4",
  });

  // G4.8 — getRecsLegacy (the recsv2-OFF / rollback kill-switch path) must be
  // schema-independent of migration 0018. Migration 0018 (rec_slot enum +
  // recommendations.slot/dismissed_at/…) is a deferred operator step that is
  // NOT applied in production. If the legacy path projects
  // `slot: recommendations.slot`, Drizzle emits SELECT … "recommendations"."slot"
  // against a table without that column → Postgres 42703 → 500 for every real
  // user when the flag is OFF, making "flip the flag off to recover" a false
  // safety net. Slice ONLY the getRecsLegacy body (start anchor → next
  // top-level function decl) so the legitimate v2-path `slot:
  // recommendations.slot` projections don't trip this. (saSrc read at G4.3.)
  const legacyStart = saSrc.indexOf("async function getRecsLegacy(");
  let legacyBody = "";
  if (legacyStart !== -1) {
    const afterStart = saSrc.slice(legacyStart + 1);
    const nextDecl = afterStart.search(/\n(?:export )?(?:async )?function /);
    legacyBody =
      nextDecl === -1 ? afterStart : afterStart.slice(0, nextDecl);
  }
  const legacyHasSlotProjection = /slot:\s*recommendations\.slot/.test(
    legacyBody,
  );
  const legacySchemaIndependent = legacyStart !== -1 && !legacyHasSlotProjection;
  record({
    group,
    name: "G4.8 — getRecsLegacy is schema-independent of migration 0018 (no recommendations.slot projection on the OFF/rollback path)",
    status: legacySchemaIndependent ? "pass" : "fail",
    detail: legacySchemaIndependent
      ? "getRecsLegacy body does not project recommendations.slot — recsv2-OFF rollback works pre-0018"
      : legacyStart === -1
        ? "getRecsLegacy not found in lib/recs/server-actions.ts"
        : "getRecsLegacy body still contains `slot: recommendations.slot` — couples the rollback path to unapplied migration 0018 (42703 → 500 for every user when flag OFF)",
    gate: "4",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// G5 — E2E (Playwright) — operator-gated → SKIP, not FAIL
//
// Introspect the DB FIRST: rec_slot type + recommendations.slot column. If
// ABSENT, migration 0018 hasn't been applied to dev Supabase → v2 getRecs
// 500s on recommendations.slot, so Playwright would just burn minutes
// failing. Record a single SKIP (operator close-out pending) and do NOT run
// it. If the column IS present, run Playwright for real and PASS/FAIL on
// exit. Correct in BOTH the pre- and post-operator-close-out worlds.
// ─────────────────────────────────────────────────────────────────────────────
async function group5(sql: ReturnType<typeof postgres>) {
  const group = "G5.e2e";

  const typeRows = await sql<{ typname: string }[]>`
    SELECT typname FROM pg_type WHERE typname = 'rec_slot'
  `;
  const colRows = await sql<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'recommendations'
      AND column_name = 'slot'
  `;
  const typeExists = typeRows.length === 1;
  const colExists = colRows.length === 1;

  if (!typeExists || !colExists) {
    record({
      group,
      name: "E2E play-next-v2 (Playwright)",
      status: "skip",
      detail:
        "operator close-out pending: migration 0018_play_next_redesign.sql not applied to dev Supabase + T11 rerank-recs Edge Function not deployed — v2 getRecs 500s on recommendations.slot until then; spec is tsc-clean + statically reviewed (T20)",
      gate: "5",
    });
    return;
  }

  // Migration is applied — run the real browser flow.
  const { ok, detail } = runPnpm(
    ["playwright", "test", "play-next-v2"],
    120000,
  );
  record({
    group,
    name: "E2E play-next-v2 (Playwright)",
    status: ok ? "pass" : "fail",
    detail: ok ? undefined : detail,
    gate: "5",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────────────────
async function runGroup(
  name: string,
  n: number,
  fn: (sql: ReturnType<typeof postgres>) => Promise<void>,
  sql: ReturnType<typeof postgres>,
): Promise<void>;
async function runGroup(
  name: string,
  n: number,
  fn: (() => Promise<void>) | (() => void),
): Promise<void>;
async function runGroup(
  name: string,
  n: number,
  fn:
    | ((sql: ReturnType<typeof postgres>) => Promise<void>)
    | (() => Promise<void>)
    | (() => void),
  sql?: ReturnType<typeof postgres>,
): Promise<void> {
  try {
    if (sql) {
      await (fn as (sql: ReturnType<typeof postgres>) => Promise<void>)(sql);
    } else {
      await (fn as () => Promise<void> | void)();
    }
  } catch (e) {
    record({
      group: `G${n}.crash`,
      name: `Group ${n} (${name}) threw — remaining checks unrun`,
      status: "fail",
      detail: e instanceof Error ? e.message : String(e),
      gate: String(n),
    });
  }
}

async function main() {
  console.log("/play-next v2 redesign verification — 5 automated gate groups\n");

  // DB handle opened only for G5's operator-close-out detection.
  const sql = postgres(databaseUrl(), { prepare: false });
  try {
    await runGroup("unit-suites", 1, group1);
    await runGroup("integration", 2, group2);
    await runGroup("build", 3, group3);
    await runGroup("source-wiring", 4, group4);
    await runGroup("e2e", 5, group5, sql);
  } finally {
    await sql.end({ timeout: 5 });
  }

  // Gate mapping — FAIL if any fail / skip if all skip / auto-pass otherwise.
  console.log("\n──── Gate mapping ────");
  const gateLines: Array<[string, string]> = [
    ["1", "Pure/unit suites under tests/unit/recs/ all green"],
    ["2", "Integration suite (getRecs orchestration, T12) green"],
    [
      "3",
      "pnpm build green — CANONICAL Next-16 'use server' export gate (plan omitted; required)",
    ],
    ["4", "Source-wiring: migration/flag/legacy/data-attrs/env/mirror/plan"],
    ["5", "E2E Playwright — operator-gated (SKIP until 0018 applied)"],
  ];
  for (const [n, criterion] of gateLines) {
    const related = checks.filter((c) => c.gate.split(",").includes(n));
    const failures = related.filter((c) => c.status === "fail");
    const skips = related.filter((c) => c.status === "skip");
    const tag =
      failures.length > 0
        ? "FAIL"
        : related.length === 0
          ? "MANUAL"
          : skips.length === related.length
            ? "skip"
            : "auto-pass";
    console.log(`  #${n}  ${criterion}`);
    console.log(
      `        result: ${tag}${failures.length ? ` (${failures.length} failure(s))` : ""}`,
    );
  }

  console.log("\n──── Manual gate items (operator must verify) ────");
  console.log(
    "  M1 — Visual review: 3x2 stratified grid vs. current /play-next screenshot",
  );
  console.log(
    "  M2 — Refinement UX: \"less grindy\" → grid changes meaningfully in <2s",
  );
  console.log(
    "  M3 — Wildcard sanity: 3 users / 3 histories → wildcard pick genuinely surprising",
  );
  console.log(
    "  M4 — Provider-failover smoke: unset CEREBRAS_API_KEY → Groq picks up",
  );
  console.log("");
  console.log(
    "  OPERATOR PREREQUISITES (also in T20's plan execution note — gate G5 + rollout):",
  );
  console.log(
    "    (1) apply lib/db/migrations/0018_play_next_redesign.sql to dev + prod",
  );
  console.log(
    "        Supabase (Supabase MCP apply_migration, name `play_next_redesign`)",
  );
  console.log(
    "    (2) deploy the T11 `rerank-recs` rerank-only-mode Edge Function",
  );
  console.log(
    "    (3) production rollout via RECS_V2_ENABLED / RECS_V2_USERS per the",
  );
  console.log("        plan's \"Phase A complete\" rollout sequence");

  const pass = checks.filter((c) => c.status === "pass").length;
  const fail = checks.filter((c) => c.status === "fail").length;
  const skip = checks.filter((c) => c.status === "skip").length;
  console.log(`\n${pass}/${checks.length} pass · ${fail} fail · ${skip} skip`);
  process.exit(fail === 0 ? 0 : 1);
}

void main().catch((err) => {
  console.error("verify-play-next-v2 crashed:", err);
  process.exit(2);
});
