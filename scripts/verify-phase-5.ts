/**
 * Phase 5 verification pass — automatable subset of the 10-point gate
 * for the Social Layer (see Phase 5 spec).
 *
 * Run:
 *   pnpm tsx --conditions react-server --env-file=.env scripts/verify-phase-5.ts
 *
 * Reads .env for DATABASE_URL.
 *
 * Exits 0 if every automatable check passes (skips don't fail). Exits 1
 * if any check fails. Prints M1-M5 manual checklist at the end.
 *
 * Structure mirrors scripts/verify-phase-4.ts:
 *   - Each check is a `Check` with group/name/status/detail/gate.
 *   - `record()` logs + accumulates.
 *   - Schema introspection uses postgres-js directly (no Drizzle).
 *   - File-shape checks use readFile + regex.
 *   - Gate mapping summarises 10 criteria with auto-pass/skip/FAIL.
 *
 * What this script does NOT cover (M1-M5 — operator must verify):
 *   - Real digest email + unsubscribe round-trip
 *   - Visual rendering on desktop + mobile breakpoints
 *   - @-mention autocomplete UX feel
 *   - Drag-to-reorder lists on touch + mouse
 *   - Notification bell badge polling (2-tab test)
 */
import { readFile } from "node:fs/promises";

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

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path, "utf8");
    return true;
  } catch {
    return false;
  }
}

// ───────────────────────────────────────────────────────────────────
// Group 1 — Bidirectional block
// G1.1: blocks table exists
// G1.2: blocks_no_self CHECK constraint exists
// G1.3: withBlockedFilter + isBlockedBetween exported from visibility.ts
// ───────────────────────────────────────────────────────────────────
async function group1(sql: ReturnType<typeof postgres>) {
  const group = "G1.block";

  const blocksRows = await sql<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'blocks'
  `;
  record({
    group,
    name: "G1.1 — blocks table exists",
    status: blocksRows.length === 1 ? "pass" : "fail",
    gate: "1",
  });

  const checkConRows = await sql<{ conname: string }[]>`
    SELECT conname FROM pg_constraint
    WHERE conname = 'blocks_no_self' AND contype = 'c'
  `;
  record({
    group,
    name: "G1.2 — blocks_no_self CHECK constraint exists",
    status: checkConRows.length === 1 ? "pass" : "fail",
    gate: "1",
  });

  const visSrc = await readFile("lib/social/_shared/visibility.ts", "utf8").catch(() => "");
  const withBlockedFilterExported = /export function withBlockedFilter\b/.test(visSrc);
  const isBlockedBetweenExported = /export async function isBlockedBetween\b/.test(visSrc);
  record({
    group,
    name: "G1.3 — visibility.ts exports withBlockedFilter + isBlockedBetween",
    status: withBlockedFilterExported && isBlockedBetweenExported ? "pass" : "fail",
    detail: `withBlockedFilter=${withBlockedFilterExported}, isBlockedBetween=${isBlockedBetweenExported}`,
    gate: "1",
  });
}

// ───────────────────────────────────────────────────────────────────
// Group 2 — Feed material events
// G2.1: logs.last_event_at + last_event_type columns exist
// G2.2: feed queries.ts file exists
// G2.3: feed SQL does NOT include `status = 'backlog'` in the log branch
// ───────────────────────────────────────────────────────────────────
async function group2(sql: ReturnType<typeof postgres>) {
  const group = "G2.feed";

  const cols = await sql<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'logs'
      AND column_name IN ('last_event_at', 'last_event_type')
  `;
  const colSet = new Set(cols.map((c) => c.column_name));
  const hasBoth = colSet.has("last_event_at") && colSet.has("last_event_type");
  record({
    group,
    name: "G2.1 — logs has last_event_at + last_event_type columns",
    status: hasBoth ? "pass" : "fail",
    detail: hasBoth ? undefined : `present=${[...colSet].join(",") || "(none)"}`,
    gate: "2",
  });

  const feedExists = await fileExists("lib/social/feed/queries.ts");
  record({
    group,
    name: "G2.2 — lib/social/feed/queries.ts exists",
    status: feedExists ? "pass" : "fail",
    gate: "2",
  });

  if (feedExists) {
    const feedSrc = await readFile("lib/social/feed/queries.ts", "utf8");
    // The feed log branch must be "material events only" — no backlog inclusion.
    // Look for any "WHERE … status = 'backlog'" pattern (allow whitespace
    // variation but reject any explicit inclusion of backlog).
    const includesBacklog = /status\s*=\s*'backlog'/.test(feedSrc);
    record({
      group,
      name: "G2.3 — feed log branch has no `status = 'backlog'` filter (material events only)",
      status: !includesBacklog ? "pass" : "fail",
      detail: includesBacklog ? "found backlog-status reference in feed queries" : undefined,
      gate: "2",
    });
  } else {
    record({
      group,
      name: "G2.3 — feed log branch material-event check",
      status: "skip",
      detail: "feed queries.ts not found",
      gate: "2",
    });
  }
}

// ───────────────────────────────────────────────────────────────────
// Group 3 — Comments thread 1-level deep + soft-delete preserves structure
// G3.1: comments.parent_id FK exists
// G3.2: comments.is_hidden column exists
// G3.3: comment-thread.tsx renders CommentCard for top-level + replies
// ───────────────────────────────────────────────────────────────────
async function group3(sql: ReturnType<typeof postgres>) {
  const group = "G3.comments";

  // Look up the comments.parent_id FK by walking pg_constraint for FKs
  // on the comments table that reference comments.id (self-FK).
  const fkRows = await sql<{ conname: string }[]>`
    SELECT conname FROM pg_constraint
    WHERE contype = 'f'
      AND conrelid = 'public.comments'::regclass
      AND confrelid = 'public.comments'::regclass
  `;
  record({
    group,
    name: "G3.1 — comments.parent_id self-FK exists",
    status: fkRows.length >= 1 ? "pass" : "fail",
    detail: fkRows.length === 0 ? "no self-FK found on comments" : `found ${fkRows.map((r) => r.conname).join(",")}`,
    gate: "3",
  });

  const hiddenCol = await sql<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'comments' AND column_name = 'is_hidden'
  `;
  record({
    group,
    name: "G3.2 — comments.is_hidden column exists",
    status: hiddenCol.length === 1 ? "pass" : "fail",
    gate: "3",
  });

  // comment-thread.tsx must render CommentCard both at top-level and inside
  // the replies map — that's how soft-delete preserves the tree (hidden rows
  // stay in the structure so their replies still render under them).
  const threadSrc = await readFile("components/comments/comment-thread.tsx", "utf8").catch(() => "");
  const importsCommentCard = /from\s+"\.\/comment-card"/.test(threadSrc) ||
    /import.*CommentCard/.test(threadSrc);
  // Two distinct CommentCard usages (top-level + reply). Count occurrences.
  const cardUsages = (threadSrc.match(/<CommentCard\b/g) ?? []).length;
  record({
    group,
    name: "G3.3 — comment-thread.tsx imports CommentCard + renders ≥2 instances (top-level + reply)",
    status: importsCommentCard && cardUsages >= 2 ? "pass" : "fail",
    detail: `import=${importsCommentCard}, <CommentCard>=${cardUsages}`,
    gate: "3",
  });
}

// ───────────────────────────────────────────────────────────────────
// Group 4 — Auto-flag rules + flagged hidden from non-author
// G4.1: rules.ts exports checkSpamRules
// G4.2: reports table exists + auto_flagged is a valid report_status value
// G4.3: createComment inserts into reports when checkSpamRules flags
// ───────────────────────────────────────────────────────────────────
async function group4(sql: ReturnType<typeof postgres>) {
  const group = "G4.autoflag";

  const rulesSrc = await readFile("lib/social/moderation/rules.ts", "utf8").catch(() => "");
  const exportsCheckSpamRules = /export function checkSpamRules\b/.test(rulesSrc);
  record({
    group,
    name: "G4.1 — rules.ts exports checkSpamRules",
    status: exportsCheckSpamRules ? "pass" : "fail",
    gate: "4",
  });

  const reportsRows = await sql<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'reports'
  `;
  const reportsExists = reportsRows.length === 1;
  const enumRows = await sql<{ enumlabel: string }[]>`
    SELECT enumlabel FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'report_status' AND enumlabel = 'auto_flagged'
  `;
  const hasAutoFlagged = enumRows.length === 1;
  record({
    group,
    name: "G4.2 — reports table + report_status enum has 'auto_flagged' value",
    status: reportsExists && hasAutoFlagged ? "pass" : "fail",
    detail: `reports=${reportsExists}, auto_flagged=${hasAutoFlagged}`,
    gate: "4",
  });

  const commentsActionsSrc = await readFile("lib/social/comments/server-actions.ts", "utf8").catch(() => "");
  // The createComment action must INSERT into reports when checkSpamRules flags.
  // Match a flag-conditional reports insert: either uses `flagCheck.isFlagged`
  // followed by `db.insert(schema.reports)` (or .insert(reports)) nearby.
  const flagInsertOk =
    /flagCheck\.isFlagged/.test(commentsActionsSrc) &&
    /\.insert\(\s*(schema\.reports|reports)\s*\)/.test(commentsActionsSrc);
  record({
    group,
    name: "G4.3 — createComment inserts into reports when flagged",
    status: flagInsertOk ? "pass" : "fail",
    detail: `flagCheck.isFlagged + reports insert pair present=${flagInsertOk}`,
    gate: "4",
  });
}

// ───────────────────────────────────────────────────────────────────
// Group 5 — 6 notification types + dedupe index + ON CONFLICT
// G5.1: notification_type enum has exactly 6 expected values
// G5.2: notifications_dedupe_uniq index exists
// G5.3: emit.ts contains an onConflict clause
// ───────────────────────────────────────────────────────────────────
async function group5(sql: ReturnType<typeof postgres>) {
  const group = "G5.notif";

  const expectedTypes = new Set([
    "new_follower",
    "review_liked",
    "list_liked",
    "review_commented",
    "comment_replied",
    "wishlist_logged_by_friend",
  ]);
  const enumRows = await sql<{ enumlabel: string }[]>`
    SELECT enumlabel FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'notification_type'
  `;
  const present = new Set(enumRows.map((r) => r.enumlabel));
  const missing = [...expectedTypes].filter((v) => !present.has(v));
  const extras = [...present].filter((v) => !expectedTypes.has(v));
  const enumExact = missing.length === 0 && extras.length === 0;
  record({
    group,
    name: "G5.1 — notification_type enum has exactly 6 expected values",
    status: enumExact ? "pass" : "fail",
    detail:
      missing.length > 0
        ? `missing: ${missing.join(",")}`
        : extras.length > 0
          ? `unexpected extras: ${extras.join(",")}`
          : `${present.size} value(s) present`,
    gate: "5",
  });

  const dedupeIdx = await sql<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'notifications_dedupe_uniq'
  `;
  record({
    group,
    name: "G5.2 — notifications_dedupe_uniq index exists",
    status: dedupeIdx.length === 1 ? "pass" : "fail",
    gate: "5",
  });

  const emitSrc = await readFile("lib/social/notifications/emit.ts", "utf8").catch(() => "");
  // Drizzle's onConflictDoUpdate is the conventional call; raw ON CONFLICT
  // is the SQL fallback. Accept either to keep the check robust.
  const onConflictPresent = /onConflictDoUpdate\s*\(|ON CONFLICT/i.test(emitSrc);
  record({
    group,
    name: "G5.3 — emit.ts contains onConflict clause (idempotent dedupe)",
    status: onConflictPresent ? "pass" : "fail",
    gate: "5",
  });
}

// ───────────────────────────────────────────────────────────────────
// Group 6 — Email digest payload + unsubscribe JWT
// G6.1: digest.ts exports buildDigest
// G6.2: digest-template.tsx file exists
// G6.3: unsubscribe-token.ts exports signUnsubscribeToken + verifyUnsubscribeToken
// ───────────────────────────────────────────────────────────────────
async function group6(_sql: ReturnType<typeof postgres>) {
  const group = "G6.digest";

  const digestSrc = await readFile("lib/social/notifications/digest.ts", "utf8").catch(() => "");
  const exportsBuildDigest = /export async function buildDigest\b/.test(digestSrc);
  record({
    group,
    name: "G6.1 — digest.ts exports buildDigest",
    status: exportsBuildDigest ? "pass" : "fail",
    gate: "6",
  });

  const templateExists = await fileExists("lib/email/digest-template.tsx");
  record({
    group,
    name: "G6.2 — lib/email/digest-template.tsx exists",
    status: templateExists ? "pass" : "fail",
    gate: "6",
  });

  const tokenSrc = await readFile("lib/email/unsubscribe-token.ts", "utf8").catch(() => "");
  const exportsSign = /export async function signUnsubscribeToken\b/.test(tokenSrc);
  const exportsVerify = /export async function verifyUnsubscribeToken\b/.test(tokenSrc);
  record({
    group,
    name: "G6.3 — unsubscribe-token.ts exports sign + verify",
    status: exportsSign && exportsVerify ? "pass" : "fail",
    detail: `sign=${exportsSign}, verify=${exportsVerify}`,
    gate: "6",
  });
}

// ───────────────────────────────────────────────────────────────────
// Group 7 — Discovery routes ordering
// G7.1: popular-games.ts exists + has ORDER BY clause
// G7.2: trending-reviews.ts exists + has ORDER BY clause
// G7.3: similar-users.ts exists + calls drift()
// ───────────────────────────────────────────────────────────────────
async function group7(_sql: ReturnType<typeof postgres>) {
  const group = "G7.discovery";

  const popularSrc = await readFile("lib/social/discovery/popular-games.ts", "utf8").catch(() => "");
  const popularOrdered = popularSrc.length > 0 && /ORDER BY/i.test(popularSrc);
  record({
    group,
    name: "G7.1 — popular-games.ts exists + has ORDER BY clause",
    status: popularOrdered ? "pass" : "fail",
    gate: "7",
  });

  const trendingSrc = await readFile("lib/social/discovery/trending-reviews.ts", "utf8").catch(() => "");
  const trendingOrdered = trendingSrc.length > 0 && /ORDER BY/i.test(trendingSrc);
  record({
    group,
    name: "G7.2 — trending-reviews.ts exists + has ORDER BY clause",
    status: trendingOrdered ? "pass" : "fail",
    gate: "7",
  });

  const similarSrc = await readFile("lib/social/discovery/similar-users.ts", "utf8").catch(() => "");
  // drift() comes from lib/taste/vectors and is called inline to score each
  // candidate. Either the import or a bare call indicates the path's wired.
  const similarDriftPresent =
    similarSrc.length > 0 &&
    (/from\s+"@\/lib\/taste\/vectors"/.test(similarSrc) || /\bdrift\s*\(/.test(similarSrc));
  record({
    group,
    name: "G7.3 — similar-users.ts exists + uses drift() for similarity",
    status: similarDriftPresent ? "pass" : "fail",
    gate: "7",
  });
}

// ───────────────────────────────────────────────────────────────────
// Group 8 — Lists CRUD + drag-reorder + publish + share URL
// G8.1: lists.slug + lists.published_at columns exist
// G8.2: list_likes table exists
// G8.3: reorderListItems wraps in db.transaction
// ───────────────────────────────────────────────────────────────────
async function group8(sql: ReturnType<typeof postgres>) {
  const group = "G8.lists";

  const listsCols = await sql<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'lists'
      AND column_name IN ('slug', 'published_at')
  `;
  const colSet = new Set(listsCols.map((c) => c.column_name));
  const bothCols = colSet.has("slug") && colSet.has("published_at");
  record({
    group,
    name: "G8.1 — lists has slug + published_at columns",
    status: bothCols ? "pass" : "fail",
    detail: bothCols ? undefined : `present=${[...colSet].join(",") || "(none)"}`,
    gate: "8",
  });

  const likesTable = await sql<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'list_likes'
  `;
  record({
    group,
    name: "G8.2 — list_likes table exists",
    status: likesTable.length === 1 ? "pass" : "fail",
    gate: "8",
  });

  const listsSrc = await readFile("lib/social/lists/server-actions.ts", "utf8").catch(() => "");
  // Find the reorderListItems function and verify it uses db.transaction.
  const reorderIdx = listsSrc.indexOf("export async function reorderListItems");
  let txOk = false;
  if (reorderIdx !== -1) {
    // Scan ~1500 chars after the function start for a transaction call.
    const slice = listsSrc.slice(reorderIdx, reorderIdx + 1500);
    txOk = /db\.transaction\s*\(/.test(slice);
  }
  record({
    group,
    name: "G8.3 — reorderListItems uses db.transaction",
    status: txOk ? "pass" : "fail",
    detail: reorderIdx === -1 ? "reorderListItems not found" : undefined,
    gate: "8",
  });
}

// ───────────────────────────────────────────────────────────────────
// Group 9 — Profile overview hub renders all 5 content sections
// G9.1: getProfileSummary return type has the 5 expected fields
// G9.2: app/(app)/u/[username]/page.tsx imports getProfileSummary
// ───────────────────────────────────────────────────────────────────
async function group9(_sql: ReturnType<typeof postgres>) {
  const group = "G9.profile";

  // The actual ProfileSummary shape (per lib/social/_shared/profile-summary.ts):
  //   profile, stats, tasteSnippet, topLists, recentReviews, libraryTruncated,
  //   isOwner, isFollowing, isBlocked, followerCount, followingCount.
  // The 5 content sections we care about for the gate: stats, tasteSnippet,
  // topLists, recentReviews, libraryTruncated.
  const summarySrc = await readFile("lib/social/_shared/profile-summary.ts", "utf8").catch(() => "");
  const exportsGetProfileSummary = /export async function getProfileSummary\b/.test(summarySrc);
  const requiredFields = ["stats", "tasteSnippet", "topLists", "recentReviews", "libraryTruncated"];
  const fieldPresent = requiredFields.map((f) => ({
    f,
    ok: new RegExp(`\\b${f}\\b\\s*:`).test(summarySrc),
  }));
  const missing = fieldPresent.filter((x) => !x.ok).map((x) => x.f);
  const allFieldsPresent = missing.length === 0;
  record({
    group,
    name: "G9.1 — getProfileSummary returns 5 content sections (stats/tasteSnippet/topLists/recentReviews/libraryTruncated)",
    status: exportsGetProfileSummary && allFieldsPresent ? "pass" : "fail",
    detail: !exportsGetProfileSummary
      ? "getProfileSummary not exported"
      : missing.length > 0
        ? `missing fields: ${missing.join(",")}`
        : undefined,
    gate: "9",
  });

  const pagePath = "app/(app)/u/[username]/page.tsx";
  const pageSrc = await readFile(pagePath, "utf8").catch(() => "");
  const importsSummary = /from\s+"@\/lib\/social\/_shared\/profile-summary"/.test(pageSrc) &&
    /\bgetProfileSummary\b/.test(pageSrc);
  record({
    group,
    name: "G9.2 — profile page imports + calls getProfileSummary",
    status: importsSummary ? "pass" : "fail",
    detail: pageSrc.length === 0 ? `${pagePath} not found` : undefined,
    gate: "9",
  });
}

// ───────────────────────────────────────────────────────────────────
// Group 10 — Admin queue env-gated; non-admin gets 404
// G10.1: isAdmin checks env.ADMIN_USER_IDS
// G10.2: /admin/reports page calls notFound() for non-admin
// G10.3: resolveReport requires isAdmin
// ───────────────────────────────────────────────────────────────────
async function group10(_sql: ReturnType<typeof postgres>) {
  const group = "G10.admin";

  const adminSrc = await readFile("lib/social/moderation/admin.ts", "utf8").catch(() => "");
  const isAdminChecksEnv =
    /export function isAdmin\b/.test(adminSrc) &&
    /env\.ADMIN_USER_IDS/.test(adminSrc);
  record({
    group,
    name: "G10.1 — isAdmin() checks env.ADMIN_USER_IDS",
    status: isAdminChecksEnv ? "pass" : "fail",
    gate: "10",
  });

  const adminPageSrc = await readFile("app/(app)/admin/reports/page.tsx", "utf8").catch(() => "");
  // Page must import notFound + call it conditional on !isAdmin(...).
  const pageGuards =
    /from\s+"next\/navigation"/.test(adminPageSrc) &&
    /\bnotFound\(\)/.test(adminPageSrc) &&
    /isAdmin\s*\(/.test(adminPageSrc);
  record({
    group,
    name: "G10.2 — /admin/reports page calls notFound() for non-admin",
    status: pageGuards ? "pass" : "fail",
    detail: adminPageSrc.length === 0 ? "admin reports page.tsx not found" : undefined,
    gate: "10",
  });

  const modActionsSrc = await readFile("lib/social/moderation/server-actions.ts", "utf8").catch(() => "");
  // resolveReport must call isAdmin and refuse non-admin callers. Look for
  // `isAdmin(` inside the resolveReport function body.
  const resolveIdx = modActionsSrc.indexOf("export async function resolveReport");
  let resolveOk = false;
  if (resolveIdx !== -1) {
    const slice = modActionsSrc.slice(resolveIdx, resolveIdx + 800);
    resolveOk = /isAdmin\s*\(/.test(slice);
  }
  record({
    group,
    name: "G10.3 — resolveReport requires isAdmin",
    status: resolveOk ? "pass" : "fail",
    detail: resolveIdx === -1 ? "resolveReport not found" : undefined,
    gate: "10",
  });
}

// ───────────────────────────────────────────────────────────────────
// Run
// ───────────────────────────────────────────────────────────────────
async function runGroup(
  name: string,
  n: number,
  fn: (sql: ReturnType<typeof postgres>) => Promise<void>,
  sql: ReturnType<typeof postgres>,
) {
  try {
    await fn(sql);
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
  console.log("Phase 5 verification — automatable subset\n");

  const sql = postgres(databaseUrl(), { prepare: false });
  try {
    await runGroup("bidirectional-block", 1, group1, sql);
    await runGroup("feed-material", 2, group2, sql);
    await runGroup("comments-thread", 3, group3, sql);
    await runGroup("auto-flag-rules", 4, group4, sql);
    await runGroup("notifications", 5, group5, sql);
    await runGroup("digest+unsubscribe", 6, group6, sql);
    await runGroup("discovery", 7, group7, sql);
    await runGroup("lists+reorder", 8, group8, sql);
    await runGroup("profile-summary", 9, group9, sql);
    await runGroup("admin-gate", 10, group10, sql);
  } finally {
    await sql.end({ timeout: 5 });
  }

  // Gate mapping (10 criteria) — mirrors verify-phase-4 summary shape.
  console.log("\n──── Gate mapping ────");
  const gateLines: Array<[string, string]> = [
    ["1", "Bidirectional block prevents both directions"],
    ["2", "Feed shows material events only"],
    ["3", "Comments thread 1-level deep with soft-delete preserved"],
    ["4", "Auto-flag rules + flagged hidden from non-author"],
    ["5", "All 6 notification types + dedupe"],
    ["6", "Email digest payload + unsubscribe JWT"],
    ["7", "Discovery routes ordering"],
    ["8", "Lists CRUD + drag-reorder + publish + share URL"],
    ["9", "Profile overview hub all 5 sections"],
    ["10", "Admin queue env-gated; non-admin 404"],
  ];
  for (const [n, criterion] of gateLines) {
    const related = checks.filter((c) => c.gate.split(",").includes(n));
    const failures = related.filter((c) => c.status === "fail");
    const skips = related.filter((c) => c.status === "skip");
    const tag =
      failures.length === 0
        ? related.length === 0
          ? "MANUAL"
          : skips.length === related.length
            ? "skip"
            : "auto-pass"
        : "FAIL";
    console.log(`  #${n}  ${criterion}`);
    console.log(
      `        result: ${tag}${failures.length ? ` (${failures.length} failure(s))` : ""}`,
    );
  }

  console.log("\n──── Manual gate items (operator must verify) ────");
  console.log("  M1 — Real digest email delivered + unsubscribe round-trip");
  console.log("  M2 — Visual rendering desktop + mobile breakpoints");
  console.log("  M3 — @-mention autocomplete UX (debounce, ordering, mobile)");
  console.log("  M4 — Drag-to-reorder list items on touch + mouse");
  console.log("  M5 — Notification bell badge polling (2-tab test)");

  const pass = checks.filter((c) => c.status === "pass").length;
  const fail = checks.filter((c) => c.status === "fail").length;
  const skip = checks.filter((c) => c.status === "skip").length;
  console.log(`\n${pass}/${checks.length} pass · ${fail} fail · ${skip} skip`);
  process.exit(fail === 0 ? 0 : 1);
}

void main().catch((err) => {
  console.error("verify-phase-5 crashed:", err);
  process.exit(1);
});
