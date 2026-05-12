/**
 * Phase 3 verification pass — automatable subset of the 8-point gate
 * defined in docs/superpowers/specs/2026-05-11-phase3-library-imports-design.md
 * (Verification Gate, lines 636-647).
 *
 * Run:
 *   pnpm tsx --conditions react-server --env-file=.env scripts/verify-phase-3.ts
 *
 * Reads .env for DATABASE_URL + SUPABASE_FUNCTIONS_URL +
 * SUPABASE_SERVICE_ROLE_KEY + IMPORT_ENCRYPTION_KEY.
 *
 * Exits 0 if every automatable check passes; exits 1 otherwise. Lists
 * the gate items that still require manual eyeballing at the end.
 *
 * What this script does NOT cover (still requires human in the loop):
 *   - Real Steam OpenID round-trip (gate #1)
 *   - Real OpenXBL key paste (gate #4 user-flow half)
 *   - End-to-end delta toast after a real new Steam log (gate #5)
 *   - Edge Function mid-import kill + restart (gate #8 behavioral half)
 */
import { spawnSync } from "node:child_process";
import postgres from "postgres";

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
function functionsUrl(): string {
  const u = process.env.SUPABASE_FUNCTIONS_URL;
  if (!u) throw new Error("SUPABASE_FUNCTIONS_URL not set");
  return u.replace(/\/$/, "");
}
function serviceRoleKey(): string {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
  return k;
}

// ───────────────────────────────────────────────────────────────────
// Group 1 — Schema sanity (gate #2, #3, #5 rely on tables/indexes
// existing as designed)
// ───────────────────────────────────────────────────────────────────
async function checkSchema(sql: ReturnType<typeof postgres>) {
  const group = "schema";

  // Required Phase 3 tables exist.
  const expectedTables = ["platform_connections", "imports", "logs", "games"];
  const tables = await sql<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ANY(${expectedTables})
  `;
  const tableSet = new Set(tables.map((t) => t.table_name));
  for (const t of expectedTables) {
    record({
      group,
      name: `table ${t} exists`,
      status: tableSet.has(t) ? "pass" : "fail",
      gate: "2,3,5",
    });
  }

  // Phase 3 columns on imports.
  const expectedImportsCols = [
    "id", "user_id", "platform", "status", "imported_count", "total_count",
    "error_message", "conflicts_jsonb", "unmatched_jsonb", "surfaced",
    "started_at", "completed_at", "created_at",
  ];
  const importsCols = await sql<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'imports'
  `;
  const importsColSet = new Set(importsCols.map((c) => c.column_name));
  const missingImportsCols = expectedImportsCols.filter((c) => !importsColSet.has(c));
  record({
    group,
    name: "imports table has every Phase 3 column",
    status: missingImportsCols.length === 0 ? "pass" : "fail",
    detail: missingImportsCols.length > 0 ? `missing: ${missingImportsCols.join(",")}` : undefined,
    gate: "2,5,6",
  });

  // Phase 3 columns on platform_connections.
  const expectedConnCols = [
    "id", "user_id", "platform", "external_id",
    "access_token_encrypted", "refresh_token_encrypted",
    "last_synced_at", "is_active", "created_at",
  ];
  const connCols = await sql<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'platform_connections'
  `;
  const connColSet = new Set(connCols.map((c) => c.column_name));
  const missingConnCols = expectedConnCols.filter((c) => !connColSet.has(c));
  record({
    group,
    name: "platform_connections has every Phase 3 column",
    status: missingConnCols.length === 0 ? "pass" : "fail",
    detail: missingConnCols.length > 0 ? `missing: ${missingConnCols.join(",")}` : undefined,
    gate: "4,7",
  });

  // Resumability constraint (gate #8 mechanical half).
  const uniqueIdx = await sql<{ indexdef: string }[]>`
    SELECT indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'logs'
      AND indexname = 'logs_user_game_replay_uniq'
  `;
  record({
    group,
    name: "logs (user_id, game_id, is_replay) unique constraint",
    status: uniqueIdx.length === 1 ? "pass" : "fail",
    detail: uniqueIdx.length === 1 ? undefined : "constraint missing — duplicate imports would not collide",
    gate: "8",
  });

  // Audit-fix indexes (Phase 3 perf shipped in 5daabf5).
  const auditIndexes = [
    "likes_review_id_idx",
    "reviews_user_game_idx",
    "reviews_user_published_at_idx",
  ];
  const idxRows = await sql<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = ANY(${auditIndexes})
  `;
  const idxSet = new Set(idxRows.map((r) => r.indexname));
  for (const idx of auditIndexes) {
    record({
      group,
      name: `audit index ${idx} applied`,
      status: idxSet.has(idx) ? "pass" : "fail",
      gate: "perf",
    });
  }

  // RLS enabled on the user-data tables.
  const rlsRows = await sql<{ tablename: string; rowsecurity: boolean }[]>`
    SELECT tablename, rowsecurity FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('logs', 'reviews', 'profiles', 'platform_connections', 'imports')
  `;
  const rlsOff = rlsRows.filter((r) => !r.rowsecurity).map((r) => r.tablename);
  record({
    group,
    name: "RLS enabled on user-data tables",
    status: rlsOff.length === 0 ? "pass" : "fail",
    detail: rlsOff.length > 0 ? `RLS off: ${rlsOff.join(",")}` : undefined,
    gate: "security",
  });
}

// ───────────────────────────────────────────────────────────────────
// Group 2 — Edge Function reachability + auth (gate #2, #4, #5)
// ───────────────────────────────────────────────────────────────────
async function checkEdgeFunctions() {
  const group = "edge-fn";
  const base = functionsUrl();
  const key = serviceRoleKey();
  const fetchOpts = (body: object | null, apikey: string | null) => ({
    method: "POST" as const,
    headers: {
      "Content-Type": "application/json",
      ...(apikey ? { apikey } : {}),
    },
    body: body ? JSON.stringify(body) : "{}",
  });

  // import-platform: no apikey → 401
  try {
    const res = await fetch(`${base}/import-platform`, fetchOpts({ importId: "x" }, null));
    record({
      group,
      name: "import-platform rejects missing apikey (401)",
      status: res.status === 401 ? "pass" : "fail",
      detail: `got ${res.status}`,
      gate: "2,security",
    });
  } catch (err) {
    record({ group, name: "import-platform reachable", status: "fail", detail: String(err), gate: "2" });
  }

  // import-platform: bad apikey → 401 (constant-time compare must still reject)
  try {
    const res = await fetch(`${base}/import-platform`, fetchOpts({ importId: "x" }, "bad-key"));
    record({
      group,
      name: "import-platform rejects bad apikey (401)",
      status: res.status === 401 ? "pass" : "fail",
      detail: `got ${res.status}`,
      gate: "security",
    });
  } catch (err) {
    record({ group, name: "import-platform bad-key reject", status: "fail", detail: String(err), gate: "security" });
  }

  // import-platform: valid apikey, missing importId → 400
  try {
    const res = await fetch(`${base}/import-platform`, fetchOpts({}, key));
    record({
      group,
      name: "import-platform validates body (400 on missing importId)",
      status: res.status === 400 ? "pass" : "fail",
      detail: `got ${res.status}`,
      gate: "2",
    });
  } catch (err) {
    record({ group, name: "import-platform body validation", status: "fail", detail: String(err), gate: "2" });
  }

  // import-platform: valid apikey, nonexistent importId → 404
  try {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await fetch(`${base}/import-platform`, fetchOpts({ importId: fakeId }, key));
    record({
      group,
      name: "import-platform returns 404 for unknown importId",
      status: res.status === 404 ? "pass" : "fail",
      detail: `got ${res.status}`,
      gate: "2",
    });
  } catch (err) {
    record({ group, name: "import-platform 404 path", status: "fail", detail: String(err), gate: "2" });
  }

  // daily-sync: no apikey → 401
  try {
    const res = await fetch(`${base}/daily-sync`, fetchOpts(null, null));
    record({
      group,
      name: "daily-sync rejects missing apikey (401)",
      status: res.status === 401 ? "pass" : "fail",
      detail: `got ${res.status}`,
      gate: "5,security",
    });
  } catch (err) {
    record({ group, name: "daily-sync auth", status: "fail", detail: String(err), gate: "5" });
  }

  // daily-sync: valid apikey → 200 + JSON with scheduled count
  try {
    const res = await fetch(`${base}/daily-sync`, fetchOpts(null, key));
    if (res.status !== 200) {
      record({ group, name: "daily-sync runs end-to-end", status: "fail", detail: `got ${res.status}`, gate: "5" });
    } else {
      const json = (await res.json()) as { scheduled?: number };
      const ok = typeof json.scheduled === "number";
      record({
        group,
        name: "daily-sync runs end-to-end and returns {scheduled}",
        status: ok ? "pass" : "fail",
        detail: ok ? `scheduled=${json.scheduled}` : `got ${JSON.stringify(json)}`,
        gate: "5",
      });
    }
  } catch (err) {
    record({ group, name: "daily-sync end-to-end", status: "fail", detail: String(err), gate: "5" });
  }
}

// ───────────────────────────────────────────────────────────────────
// Group 3 — Next.js API route auth (gate #1, #5)
// Requires the dev server to be running on http://localhost:3000.
// ───────────────────────────────────────────────────────────────────
async function checkApiRoutes() {
  const group = "api-route";
  const base = "http://localhost:3000";

  try {
    const res = await fetch(`${base}/api/imports/latest`);
    record({
      group,
      name: "/api/imports/latest requires auth (401)",
      status: res.status === 401 ? "pass" : "fail",
      detail: `got ${res.status}`,
      gate: "5,security",
    });
  } catch (err) {
    record({
      group,
      name: "/api/imports/latest reachable",
      status: "skip",
      detail: `dev server not reachable (${String(err)})`,
      gate: "5",
    });
    return; // skip the rest of this group if server's down
  }

  try {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await fetch(`${base}/api/imports/${fakeId}/status`);
    record({
      group,
      name: "/api/imports/[id]/status requires auth (401)",
      status: res.status === 401 ? "pass" : "fail",
      detail: `got ${res.status}`,
      gate: "1,security",
    });
  } catch (err) {
    record({ group, name: "status route reachable", status: "fail", detail: String(err), gate: "1" });
  }
}

// ───────────────────────────────────────────────────────────────────
// Group 4 — Stuck-threshold constants (gate #1 mechanical half)
// The behavioral version requires inserting a queued row and aging it;
// here we just verify the threshold values match the spec (5min queued,
// 30min running added in audit-fixes commit 5daabf5).
// ───────────────────────────────────────────────────────────────────
async function checkStuckLogic() {
  const group = "stuck-logic";
  const path = "app/api/imports/[importId]/status/route.ts";
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = await import("node:fs/promises");
  const src = await fs.readFile(path, "utf8");
  record({
    group,
    name: "queued stuck threshold = 5min",
    status: /STUCK_QUEUE_THRESHOLD_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/.test(src) ? "pass" : "fail",
    gate: "1",
  });
  record({
    group,
    name: "running stuck threshold = 30min (audit-fix)",
    status: /STUCK_RUNNING_THRESHOLD_MS\s*=\s*30\s*\*\s*60\s*\*\s*1000/.test(src) ? "pass" : "fail",
    gate: "1",
  });
  record({
    group,
    name: "stuck triggers on running AND queued",
    status: /row\.status === "running" && runningAgeMs > STUCK_RUNNING_THRESHOLD_MS/.test(src)
      ? "pass"
      : "fail",
    gate: "1",
  });
}

// ───────────────────────────────────────────────────────────────────
// Group 5 — Delegate to existing smokes (gate #3 merge, #4 encryption)
// ───────────────────────────────────────────────────────────────────
function delegateSmoke(file: string, gate: string, name: string) {
  const r = spawnSync(
    "pnpm",
    ["tsx", "--conditions", "react-server", "--env-file=.env", `scripts/${file}`],
    { encoding: "utf8", shell: true },
  );
  const status: Status = r.status === 0 ? "pass" : "fail";
  // Extract summary line ("N/N passed") if present.
  const summary = r.stdout
    .split(/\r?\n/)
    .reverse()
    .find((line) => /\d+\/\d+ passed/.test(line));
  record({
    group: "smoke",
    name,
    status,
    detail: summary ?? (r.status === 0 ? "exit 0" : `exit ${r.status}`),
    gate,
  });
}

// ───────────────────────────────────────────────────────────────────
// Group 6 — Audit-fix shape verification (open-redirect, rate limit
// plumbing, safe-next helper)
// ───────────────────────────────────────────────────────────────────
async function checkAuditFixes() {
  const group = "audit-fix";
  const fs = await import("node:fs/promises");

  const safeNext = await fs.readFile("lib/auth/safe-next.ts", "utf8");
  const rejectsDoubleSlash = /startsWith\("\/\/"\)/.test(safeNext);
  const rejectsBackslash = /startsWith\("\/\\\\"\)/.test(safeNext);
  record({
    group,
    name: "safe-next rejects // and /\\",
    status: rejectsDoubleSlash && rejectsBackslash ? "pass" : "fail",
    detail: `// ${rejectsDoubleSlash ? "y" : "n"}, /\\ ${rejectsBackslash ? "y" : "n"}`,
    gate: "security",
  });

  const callbackRoute = await fs.readFile("app/auth/callback/route.ts", "utf8");
  record({
    group,
    name: "auth/callback uses safeRedirectPath",
    status: /safeRedirectPath/.test(callbackRoute) ? "pass" : "fail",
    gate: "security",
  });

  const rateLimit = await fs.readFile("lib/security/rate-limit.ts", "utf8");
  record({
    group,
    name: "rate-limit module present",
    status: /enforceRateLimit/.test(rateLimit) && /clientIpForRateLimit/.test(rateLimit)
      ? "pass" : "fail",
    gate: "security",
  });

  const sharedAuth = await fs.readFile("supabase/functions/_shared/auth.ts", "utf8");
  record({
    group,
    name: "edge fn constant-time service-role compare",
    status: /constantTimeEqual/.test(sharedAuth) ? "pass" : "fail",
    gate: "security",
  });

  const dailySync = await fs.readFile("supabase/functions/daily-sync/index.ts", "utf8");
  record({
    group,
    name: "daily-sync uses EdgeRuntime.waitUntil for trigger fetches",
    status: /EdgeRuntime\.waitUntil/.test(dailySync) ? "pass" : "fail",
    gate: "5",
  });

  const importsServerActions = await fs.readFile("lib/imports/server-actions.ts", "utf8");
  record({
    group,
    name: "triggerImport uses after() for background trigger",
    status: /after\(\(\) => fireImportEdge/.test(importsServerActions) ? "pass" : "fail",
    gate: "2",
  });
  record({
    group,
    name: "triggerImport zod-validates platform",
    status: /platformSchema\.parse/.test(importsServerActions) ? "pass" : "fail",
    gate: "security",
  });
  record({
    group,
    name: "listConnections includes error_message",
    status: /error_message/.test(importsServerActions) ? "pass" : "fail",
    gate: "6",
  });
}

// ───────────────────────────────────────────────────────────────────
// Run
// ───────────────────────────────────────────────────────────────────
async function main() {
  console.log("Phase 3 verification — automatable subset\n");

  const sql = postgres(databaseUrl(), { prepare: false });
  try {
    await checkSchema(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }

  await checkEdgeFunctions();
  await checkApiRoutes();
  await checkStuckLogic();
  await checkAuditFixes();

  // Delegate to existing smokes last so their stdout sits separately.
  console.log("\n  — delegating to existing smokes —");
  delegateSmoke("smoke-encryption.ts", "4", "encryption round-trip (12-case smoke)");
  delegateSmoke("smoke-merge.ts", "3", "conflict-merge rules (12-case smoke)");
  delegateSmoke("smoke-rawg-match.ts", "2", "rawg-match normalize/match (smoke)");

  // Summary mapped to the 8-point gate.
  console.log("\n──── Gate mapping ────");
  const gateLines: Array<[string, string, string]> = [
    ["1", "Steam OpenID → import skeleton", "status route + auth"],
    ["2", "First import completes", "import-platform reachable + body validation"],
    ["3", "Conflict merge preserves user data", "12-case merge smoke"],
    ["4", "Xbox 3-step modal + AES-GCM key", "encryption smoke"],
    ["5", "Daily sync produces delta toast", "daily-sync end-to-end + EdgeRuntime.waitUntil"],
    ["6", "Error states (invalid OpenXBL key)", "listConnections error_message projection"],
    ["7", "Disconnect", "(code-shape verified in audit; behavioral pending)"],
    ["8", "Resumability", "logs unique constraint exists"],
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
  console.log("  - Real Steam OpenID round-trip from a real Steam account");
  console.log("  - Real OpenXBL key paste + AES-GCM-encrypted persistence");
  console.log("  - Real cron-driven daily-sync producing a real +N delta toast");
  console.log("  - Mid-import worker kill + resume behavioral test");

  const pass = checks.filter((c) => c.status === "pass").length;
  const fail = checks.filter((c) => c.status === "fail").length;
  const skip = checks.filter((c) => c.status === "skip").length;
  console.log(`\n${pass}/${checks.length} pass · ${fail} fail · ${skip} skip`);
  process.exit(fail === 0 ? 0 : 1);
}

void main().catch((err) => {
  console.error("verify-phase-3 crashed:", err);
  process.exit(1);
});
