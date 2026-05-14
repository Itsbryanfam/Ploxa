/**
 * check-drizzle-sync — CI gate that detects Drizzle schema/migration drift.
 *
 * Run:
 *   pnpm db:check
 *
 * What it does:
 *   1. Runs `drizzle-kit check` to validate the journal/snapshot chain.
 *   2. Runs `drizzle-kit generate` and asserts it does NOT produce a new
 *      migration file. If schema.ts has drifted from the snapshot chain,
 *      generate writes a new 00NN_*.sql + snapshot + journal entry; this
 *      script reverts those side effects and exits non-zero.
 *
 * Why both? `drizzle-kit check` only validates the journal/snapshot chain
 * is internally consistent — it does NOT compare against schema.ts. The
 * drift this script is here to catch (which actually happened across the
 * 0007-0011 and 0013-0015 phase boundaries before being fixed in T17 of
 * audit-fixes-2026-05-14) is: schema.ts changed but no matching migration
 * exists. Only `generate` surfaces that.
 *
 * Exit codes:
 *   0 — schema, snapshot chain, and migrations are in sync.
 *   1 — drift detected, OR `drizzle-kit` exited non-zero, OR generate
 *       would emit a new migration file.
 *
 * Project convention reminder (see lib/db/README.md): migrations in this
 * project are HAND-AUTHORED, not generated. This script's job is to catch
 * the case where someone edited schema.ts without also writing the
 * matching SQL file + updating snapshots. When that happens, the fix is to
 * write the SQL by hand (CONCURRENTLY indexes on hot tables, see README)
 * and update the snapshot chain — never let `drizzle-kit generate` ship
 * its output verbatim.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

function fail(msg: string): never {
  console.error(`[db:check] FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg: string): void {
  console.log(`[db:check] OK: ${msg}`);
}

function info(msg: string): void {
  console.log(`[db:check] ${msg}`);
}

function run(cmd: string, args: string[], opts: { cwd?: string } = {}) {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd ?? repoRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: process.env,
  });
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

// ─── step 1: drizzle-kit check (chain validity) ────────────────────────────

info("Step 1: drizzle-kit check (journal/snapshot chain consistency)");
const checkResult = run("pnpm", ["drizzle-kit", "check"]);
if (checkResult.code !== 0) {
  console.error(checkResult.stdout);
  console.error(checkResult.stderr);
  fail(`drizzle-kit check exited ${checkResult.code}`);
}
const checkOut = checkResult.stdout + checkResult.stderr;
if (!checkOut.includes("Everything's fine")) {
  console.error(checkOut);
  fail("drizzle-kit check exited 0 but did not report 'Everything's fine' — review output above");
}
ok("journal/snapshot chain is internally consistent");

// ─── step 2: drizzle-kit generate (schema.ts ↔ migrations parity) ──────────
//
// `drizzle-kit generate` always writes its output to drizzleConfig.out, which
// is ./lib/db/migrations. If schema.ts has drifted, it'll write a new
// 00NN_*.sql file + a snapshot + a journal entry. We don't want side effects
// from a CI check, so:
//   1. Snapshot the current migrations dir contents (file list).
//   2. Run generate.
//   3. Diff the file list. If anything new appeared, it's drift; fail and
//      revert the new files.
//   4. Also parse stdout for the "No schema changes" line as a sanity check.

info("Step 2: drizzle-kit generate (schema.ts ↔ migrations parity)");

const migrationsDir = resolve(repoRoot, "lib/db/migrations");
const metaDir = join(migrationsDir, "meta");

function snapshotDir(): { sql: Set<string>; meta: Set<string>; journal: string } {
  const sql = new Set(
    readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"))
  );
  const meta = new Set(
    readdirSync(metaDir).filter((f) => f.endsWith("_snapshot.json"))
  );
  const journal = readFileSync(join(metaDir, "_journal.json"), "utf8");
  return { sql, meta, journal };
}

const before = snapshotDir();
const generateResult = run("pnpm", ["drizzle-kit", "generate"]);
const after = snapshotDir();

const newSql = [...after.sql].filter((f) => !before.sql.has(f));
const newMeta = [...after.meta].filter((f) => !before.meta.has(f));
const journalChanged = before.journal !== after.journal;

// Revert any side effects before failing — this script must be idempotent.
for (const f of newSql) {
  rmSync(join(migrationsDir, f), { force: true });
}
for (const f of newMeta) {
  rmSync(join(metaDir, f), { force: true });
}
if (journalChanged) {
  writeFileSync(join(metaDir, "_journal.json"), before.journal);
}

if (generateResult.code !== 0) {
  console.error(generateResult.stdout);
  console.error(generateResult.stderr);
  fail(`drizzle-kit generate exited ${generateResult.code}`);
}

const generateOut = generateResult.stdout + generateResult.stderr;

if (newSql.length > 0 || newMeta.length > 0 || journalChanged) {
  console.error(generateOut);
  console.error("");
  console.error("New files that would be written by drizzle-kit generate:");
  for (const f of newSql) console.error(`  + ${f}`);
  for (const f of newMeta) console.error(`  + meta/${f}`);
  if (journalChanged) console.error("  ~ meta/_journal.json (entry added)");
  console.error("");
  console.error("These have been reverted to keep the working tree clean.");
  console.error("");
  console.error("This means schema.ts changed but no matching migration exists.");
  console.error("FIX: write a hand-authored migration file (see lib/db/README.md).");
  console.error("     Use CREATE INDEX CONCURRENTLY for indexes on hot tables.");
  fail("drift detected: schema.ts and migrations are out of sync");
}

if (!generateOut.includes("No schema changes")) {
  console.error(generateOut);
  fail("drizzle-kit generate output did not match expected 'No schema changes' — review above");
}

ok("schema.ts and migrations are in sync");

console.log("");
ok("All Drizzle sync checks passed.");
process.exit(0);
