# Audit Fixes 2026-05-15 Implementation Plan

> **For agentic workers:** Implement task-by-task in order. Steps use checkbox (`- [ ]`) syntax. Each task is TDD: bug-encoding-test check → RED test → fix → GREEN → commit. `pnpm build` is the canonical gate (only thing that catches Next 16 `"use server"` violations). Push to a feature branch ONLY — never `git push origin main` directly.

**Goal:** Close the 4 verified findings from the Codex audit triage (F-001, F-004, F-005, F-006, F-007) plus the F-003 / live-advisor hardening batch, fixing the two underlying root causes rather than scattering patches.

**Architecture:** Two root causes. (A) *Visibility predicate not mirrored on secondary content paths* — the recap aggregator, feed UNION, and comment/like actions don't apply the `owner OR (public profile AND public/non-private content)` gate that profile/library pages enforce. (B) *Host-paid AI entry points trust a per-user cap only one caller applies* — add `enforceRateLimit` to every uncapped `generate()` / Edge-rerank entry. Plus a tracked RLS-hygiene policy migration so live DB security state is captured in version control.

**Tech Stack:** Next.js 16.2.6 App Router, Drizzle + postgres-js, Supabase (Postgres/Auth/Edge/Storage), Upstash Redis, Vitest, pnpm.

**Branch:** `fix/audit-2026-05-15` (feature branch; push via `git push origin HEAD:fix/audit-2026-05-15`, then PR — the classifier blocks direct `main` pushes).

---

## Deliberate decisions (made per "fix them all, don't stop" — flagged so they can be redirected)

1. **F-001 — recap excludes private logs for EVERYONE, including the owner.** `buildRecap` is the single source for the page *and* the OG image *and* the persisted cache row; bifurcating by viewer would require cache-key churn. A year/month recap is a *shareable artifact*, so it never includes `is_private` logs even in the owner's own view. (Owner still sees private logs everywhere else — library, profile, stats.)
2. **F-001 — OG routes 404 private profiles.** Reject the existing "sharing is consent" rationale (the URL is enumerable: username is public, year/month guessable). Match `/og/profile/[username]` which already 404s private profiles. A private user wanting to share a recap is an accepted edge-case casualty of correctness.
3. **F-001 — invalidate already-cached recap rows.** Rows in `year_in_reviews` / `monthly_recaps` were built *with* private logs; a one-time `DELETE` forces clean rebuilds. `locked_at` is lost on those rows (re-set by the lock cron / T19); acceptable for a security fix.
4. **F-006 — read-side fix, no follow-severing.** Feed UNION branches require `profiles.is_public = true`. We do NOT prune follow edges on going-private (YAGNI; reversible if the user re-publicizes; consistent with the rest of the app's "private = invisible to non-owners").
5. **F-004 / F-005 — additive per-user rate limit, keep host-paid model.** Do NOT introduce BYOK. Keep `DAILY_REVIEW_CAP` on `startInterview`; add a generous-but-bounding `enforceRateLimit` on the uncapped entry points.
6. **Task 7 — pg_net NOT auto-moved.** Moving an extension schema is risky shared infra (pg_cron / webhooks depend on it). Documented as a recommendation for explicit user decision, not an automated change. Leaked-password protection is a dashboard-only Auth setting → operator checklist item.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `lib/recaps/aggregate.ts` | Add `is_private = false` to every logs query | 1 |
| `app/og/year/[username]/[year]/route.tsx` + `/scene/[i]/route.tsx` | 404 private profiles | 1 |
| `app/og/month/[username]/[yyyymm]/route.tsx` + `/scene/[i]/route.tsx` | 404 private profiles | 1 |
| `lib/reviews/server-actions.ts` | Per-user RL on submitAnswer/generateDraft/regenerateSection | 2 |
| `lib/recs/server-actions.ts` | Per-user RL + length cap on refinement path | 3 |
| `lib/recs/types.ts` (+ UI consumer) | New `"rate-limited"` RecResult reason | 3 |
| `lib/social/_shared/review-visibility.ts` (new) | Shared `loadVisibleReview` helper | 4 |
| `lib/social/comments/server-actions.ts` | Gate `createComment` via helper | 4 |
| `lib/social/reactions/server-actions.ts` | Gate `likeReview` via helper | 4 |
| `lib/social/feed/queries.ts` | Add `is_public = true` to 3 UNION branches | 5 |
| `lib/db/policies/0003_rls_hygiene.sql` (new) | Tracked RLS-enable + REVOKE + avatars policy | 6, 7 |
| `lib/db/schema.ts` | Fix the stale `app_secrets` RLS comment | 6 |

---

### Task 1: F-001 — Recap aggregator excludes private logs + OG routes 404 private profiles

**Goal:** Private logs never appear in any recap aggregate (page, OG, cache); OG routes return 404 for private profiles; stale cached rows are invalidated.

**Files:**
- Modify: `lib/recaps/aggregate.ts` (every `FROM logs` query)
- Modify: `app/og/year/[username]/[year]/route.tsx`, `app/og/year/[username]/[year]/scene/[i]/route.tsx`
- Modify: `app/og/month/[username]/[yyyymm]/route.tsx`, `app/og/month/[username]/[yyyymm]/scene/[i]/route.tsx`
- Test: `tests/unit/recaps/aggregate.test.ts`, new `tests/unit/recaps/og-privacy.test.ts`
- Data: live `year_in_reviews` + `monthly_recaps` invalidation via Supabase MCP `execute_sql`

**Acceptance Criteria:**
- [ ] Every `logs` query in `aggregate.ts` (count gate, totals, top games, top genres, top mechanic, longest, most_replayed outer + replay_count subquery, top_theme, mood_themes) has an `is_private = false` predicate with the correct table alias.
- [ ] `reviews`-sourced queries are unchanged (out of scope; the favorite-review query is already `is_public`+`published`-gated).
- [ ] All 4 OG routes fetch `p.is_public` and return `404` when `is_public = false`.
- [ ] Existing cached recap rows deleted so they rebuild private-free.
- [ ] `pnpm test tests/unit/recaps/ --run` green; `pnpm build` succeeds.

**Verify:** `pnpm test tests/unit/recaps/ --run` → all pass; `pnpm build` → success.

**Steps:**

- [ ] **Step 1: Bug-encoding-test check.** Read `tests/unit/recaps/aggregate.test.ts`, `tests/unit/recaps/cache-or-build.test.ts`, `tests/unit/recaps/cache-or-build-monthly.test.ts`. If any assertion asserts that a private (`is_private = true`) in-window log IS counted in totals/topGames/etc., that assertion encodes the bug — correct it to the intended contract (private excluded) before touching source. Note the existing `db.execute` mock harness in `aggregate.test.ts` — reuse it verbatim for the RED test.

- [ ] **Step 2: Write the failing test.** In `tests/unit/recaps/aggregate.test.ts`, add a test using the file's existing harness that drives `buildRecap` and asserts the SQL passed to the mocked `db.execute` for the count gate and the totals/top-games queries contains `is_private = false`. (Mirror however the existing tests inspect the `sql` template — match the file's established pattern; do not invent a new harness.)

- [ ] **Step 3: Run test to verify it fails.** Run: `pnpm test tests/unit/recaps/aggregate.test.ts --run`. Expected: FAIL (new assertion — `is_private` clause absent).

- [ ] **Step 4: Add the predicate to every logs query in `lib/recaps/aggregate.ts`.** Insert the clause immediately after the existing `user_id = ${userId}` line in each query, using the correct alias:
  - Count gate (~L60): `WHERE user_id = ${userId}` → add line `      AND is_private = false`
  - Totals (~L121): `WHERE user_id = ${userId}` → add `      AND is_private = false` (the inner `reviews` subquery is unchanged)
  - Top games (~L142): `WHERE l.user_id = ${userId}` → add `        AND l.is_private = false`
  - Top genres (~L153): `WHERE l.user_id = ${userId}` → add `        AND l.is_private = false`
  - Top mechanic (~L165): `WHERE l.user_id = ${userId}` → add `        AND l.is_private = false`
  - Longest (~L190): `WHERE l.user_id = ${userId}` → add `        AND l.is_private = false`
  - `applySubstitutions` most_replayed: outer query (~L408) `WHERE l.user_id = ${userId}` → add `          AND l.is_private = false`; AND the `replay_count` correlated subquery (~L401) `WHERE l2.user_id = ${userId}` → add `              AND l2.is_private = false`
  - top_theme (~L451): `WHERE l.user_id = ${userId}` → add `          AND l.is_private = false`
  - mood_themes (~L491): `WHERE l.user_id = ${userId}` → add `          AND l.is_private = false`
  Use SQL `--`-style intent only if needed (never `//` inside `sql\`\``). Update the file's header doc (L8-41) with a line: "All `logs` aggregates exclude `is_private = true` rows — the recap is a shareable artifact and never includes private logs, even in the owner's own view."

- [ ] **Step 5: Run test to verify it passes.** Run: `pnpm test tests/unit/recaps/aggregate.test.ts --run`. Expected: PASS.

- [ ] **Step 6: Gate the OG routes.** In `app/og/year/[username]/[year]/route.tsx`: change the profile SELECT to `SELECT p.user_id, p.is_public` and the row type to `{ user_id: string; is_public: boolean }`. After `if (!profile) return new Response("Not found", { status: 404 });` add:
```tsx
  // Private profiles 404 here too — the URL is enumerable (username public,
  // year guessable), so "sharing is consent" doesn't hold. Matches
  // /og/profile/[username].
  if (!profile.is_public) return new Response("Not found", { status: 404 });
```
  Replace the misleading "Privacy note: ... intentionally does NOT 404 private profiles" module comment with the new behavior. Read `app/og/year/[username]/[year]/scene/[i]/route.tsx`, `app/og/month/[username]/[yyyymm]/route.tsx`, `app/og/month/[username]/[yyyymm]/scene/[i]/route.tsx` and apply the identical SELECT + 404 gate + comment fix to each (the profile-load block is structurally identical across all four).

- [ ] **Step 7: OG privacy RED→GREEN test.** Create `tests/unit/recaps/og-privacy.test.ts` modelled on the `@/lib/db` mock pattern in `tests/unit/server-action-rpc-hardening.test.ts` (chainable/thenable db mock; here mock `db.execute` to resolve `[{ user_id: "u1", is_public: false }]`). Assert each route's `GET` returns a `Response` with `status === 404` for a private profile, and does NOT call `cacheOrBuildYearly`/`cacheOrBuildMonthly` (mock those modules and assert not-called). Run `pnpm test tests/unit/recaps/og-privacy.test.ts --run` → PASS.

- [ ] **Step 8: Invalidate cached recap rows (prod DB, done with care).** Via Supabase MCP `execute_sql`: first `SELECT count(*) FROM year_in_reviews; SELECT count(*) FROM monthly_recaps;` (record counts), then `DELETE FROM year_in_reviews; DELETE FROM monthly_recaps;`. These rebuild on next view via `cacheOrBuild*`. Re-run the counts to confirm 0. (If counts are large/unexpected, stop and report instead of deleting.)

- [ ] **Step 9: Verify + commit.** Run `pnpm test tests/unit/recaps/ --run` then `pnpm build`. Both green →
```bash
git add lib/recaps/aggregate.ts "app/og/year" "app/og/month" tests/unit/recaps/
git commit -m "fix(recaps): exclude private logs from all recap aggregates; 404 private profiles on OG routes (F-001)"
```

---

### Task 2: F-004 — Per-user rate limit on uncapped review AI entry points

**Goal:** `submitAnswer`, `generateDraft`, `regenerateSection` enforce a per-user limit before calling `generate()`, so the cap can't be bypassed after `startInterview`.

**Files:**
- Modify: `lib/reviews/server-actions.ts`
- Test: new `tests/unit/reviews-ai-ratelimit.test.ts`

**Acceptance Criteria:**
- [ ] All three actions call `enforceRateLimit({ scope: "ai:review:gen", identifier: user.id, limit: 40, windowSeconds: 600 })` before any `generate()` call, only on the path that actually reaches `generate()`.
- [ ] `RateLimitedError` is translated to the action's existing `{ ok: false, error }` shape (or the stream-error shape) — never thrown raw.
- [ ] A legit 4-turn interview + draft (~5 calls) is unaffected; the 41st call in 10 min is rejected.
- [ ] `pnpm build` succeeds.

**Verify:** `pnpm test tests/unit/reviews-ai-ratelimit.test.ts --run` → pass; `pnpm build` → success.

**Steps:**

- [ ] **Step 1: Bug-encoding-test check.** Grep `tests/` for existing coverage of `submitAnswer|generateDraft|regenerateSection`. If a test asserts these succeed under rapid repeat with no limit, that encodes the bug — update it to the new contract first.

- [ ] **Step 2: Write the failing test.** Create `tests/unit/reviews-ai-ratelimit.test.ts`. Reuse the mock scaffolding shape from `tests/unit/server-action-rpc-hardening.test.ts` (db chainable mock, `getCachedUser` mock, `vi.mock("@/lib/security/rate-limit", ...)` — note that file already shows the canonical rate-limit mock at L184-188). Mock `@/lib/ai/router` `generate` as `vi.fn()`. Test: when `enforceRateLimit` is mocked to throw `new RateLimitedError("ai:review:gen", 30)`, calling `regenerateSection({ reviewId: <uuid>, sectionIndex: 0 })` (with a session user + a found review) returns `{ ok: false, ... }` and `generate` is NOT called. Repeat for `generateDraft` and `submitAnswer` (turn 1).

- [ ] **Step 3: Run test to verify it fails.** Run: `pnpm test tests/unit/reviews-ai-ratelimit.test.ts --run`. Expected: FAIL (no rate-limit call yet → `generate` IS called).

- [ ] **Step 4: Implement.** In `lib/reviews/server-actions.ts` add to the imports:
```ts
import { enforceRateLimit, RateLimitedError } from "@/lib/security/rate-limit";
```
Add near the Zod schemas:
```ts
// Per-user throttle on every host-paid generate() entry point. startInterview
// already burns one DAILY_REVIEW_CAP slot; without this, submitAnswer/
// generateDraft/regenerateSection could loop generate() unbounded after one
// slot (F-004). 40 / 10min is ~8× a full interview — never trips for humans,
// caps loop abuse.
const REVIEW_AI_RL = { scope: "ai:review:gen", limit: 40, windowSeconds: 600 } as const;

async function guardReviewAiRate(userId: string): Promise<{ ok: false; error: string } | null> {
  try {
    await enforceRateLimit({ ...REVIEW_AI_RL, identifier: userId });
    return null;
  } catch (e) {
    if (e instanceof RateLimitedError) {
      return { ok: false, error: "Slow down a sec — try again in a moment." };
    }
    throw e;
  }
}
```
- `submitAnswer`: after the `if (parsed.data.turn === 4) return { ok: true, ready: true };` block (so non-generating calls don't consume budget), before `const nextTurn = ...`: `const rl = await guardReviewAiRate(user.id); if (rl) return rl;`
- `generateDraft`: after the session/answers validation and the existing-review cardinality block, before `const game = await db.query.games.findFirst(...)` that precedes the insert: `const rl = await guardReviewAiRate(user.id); if (rl) return rl;`
- `regenerateSection`: after `if (!review) return { ok: false, error: "Review not found" };`, before the `game` lookup: `const rl = await guardReviewAiRate(user.id); if (rl) return rl;`

- [ ] **Step 5: Run test to verify it passes.** Run: `pnpm test tests/unit/reviews-ai-ratelimit.test.ts --run`. Expected: PASS.

- [ ] **Step 6: Verify + commit.** `pnpm build` green →
```bash
git add lib/reviews/server-actions.ts tests/unit/reviews-ai-ratelimit.test.ts
git commit -m "fix(reviews): per-user rate limit on submitAnswer/generateDraft/regenerateSection (F-004)"
```

---

### Task 3: F-005 — Rate-limit + length-cap the recs refinement path

**Goal:** The cache-bypassing refinement path of `getRecs` is per-user rate-limited and each refinement string is length-bounded before it reaches the host-paid Edge rerank.

**Files:**
- Modify: `lib/recs/server-actions.ts`
- Modify: `lib/recs/types.ts` (or wherever `RecResult` is defined) + the UI consumer that switches on `reason`
- Test: `tests/integration/recs/get-recs.test.ts`

**Acceptance Criteria:**
- [ ] Each refinement string is truncated to ≤120 chars at the sanitize boundary (currently only count-capped at 5).
- [ ] When `refinements.length > 0`, `enforceRateLimit({ scope: "recs:refine", identifier: me.id, limit: 20, windowSeconds: 600 })` runs before `candidatePool`/Edge fetch; on `RateLimitedError` returns `{ ok: false, reason: "rate-limited" }`.
- [ ] `RecResult` reason union includes `"rate-limited"`; the UI consumer renders a friendly message for it.
- [ ] `pnpm build` succeeds.

**Verify:** `pnpm test tests/integration/recs/get-recs.test.ts --run` → pass; `pnpm build` → success.

**Steps:**

- [ ] **Step 1: Bug-encoding-test check.** Read `tests/integration/recs/get-recs.test.ts`. If a test asserts unlimited refinement calls all hit the Edge, correct it to the new contract first.

- [ ] **Step 2: Locate the type + consumer.** Grep `RecResult` and `reason: "no-candidates"` to find the type def (likely `lib/recs/types.ts`) and grep `reason ===` / a `switch` over recs reasons in `components/` / `app/(app)/play-next` for the UI consumer.

- [ ] **Step 3: Write the failing tests.** In `tests/integration/recs/get-recs.test.ts` (reuse its harness): (a) a refinement string of 500 chars is truncated to 120 before the Edge `fetch` body is built (assert on the captured fetch body / mock); (b) with `enforceRateLimit` mocked to throw `RateLimitedError`, `getRecs(filters, { refinements: ["x"] })` returns `{ ok: false, reason: "rate-limited" }` and the Edge `fetch` is NOT called.

- [ ] **Step 4: Run tests to verify they fail.** Run: `pnpm test tests/integration/recs/get-recs.test.ts --run`. Expected: FAIL.

- [ ] **Step 5: Implement.** In `lib/recs/server-actions.ts`:
  - Add import: `import { enforceRateLimit, RateLimitedError } from "@/lib/security/rate-limit";`
  - In the sanitize block (currently `.filter((s): s is string => typeof s === "string" && s.trim().length > 0).slice(0, 5)`), append `.map((s) => s.trim().slice(0, 120))`.
  - Immediately after `refinements` is computed and `if (!isRecsV2Enabled...)` / fingerprint guards, add — only when refinements present:
```ts
  if (refinements.length > 0) {
    try {
      await enforceRateLimit({
        scope: "recs:refine",
        identifier: me.id,
        limit: 20,
        windowSeconds: 600,
      });
    } catch (e) {
      if (e instanceof RateLimitedError) return { ok: false, reason: "rate-limited" };
      throw e;
    }
  }
```
  Place it before the cache-check block (it only matters on the refinement path, which already bypasses cache).
  - Add `"rate-limited"` to the `RecResult` failure `reason` union in its type file.
  - In the UI consumer, add a case for `"rate-limited"` → friendly copy (e.g. mascot line "Too many tweaks too fast — give it a minute.").

- [ ] **Step 6: Run tests to verify they pass.** Run: `pnpm test tests/integration/recs/get-recs.test.ts --run`. Expected: PASS.

- [ ] **Step 7: Verify + commit.** `pnpm build` green →
```bash
git add lib/recs/ "app" components tests/integration/recs/get-recs.test.ts
git commit -m "fix(recs): rate-limit + length-cap the refinement path (F-005)"
```

---

### Task 4: F-007 — Comment/like require a visible review

**Goal:** `createComment` and `likeReview` only act on reviews the caller may see (owner, or published+public review by a public author), via one shared helper mirroring `likeList`'s gate.

**Files:**
- Create: `lib/social/_shared/review-visibility.ts`
- Modify: `lib/social/comments/server-actions.ts` (`createComment`)
- Modify: `lib/social/reactions/server-actions.ts` (`likeReview`)
- Test: `tests/unit/server-action-rpc-hardening.test.ts` (add cases) or new `tests/unit/review-visibility-actions.test.ts`

**Acceptance Criteria:**
- [ ] `loadVisibleReview(reviewId, viewerId)` returns `{ id, userId }` iff viewer is owner OR (`review.isPublic && review.publishedAt != null && authorProfile.isPublic`); else `null`.
- [ ] `createComment` returns `{ ok: false, reason: "review-not-found" }` (indistinguishable) for a non-visible review; no comment insert, no `onComment`.
- [ ] `likeReview` returns `{ ok: false }` for a non-visible review; no like insert, no `emit`. Owner liking their own unpublished draft still silently succeeds (existing self-like `{ ok: true }`).
- [ ] Block-checks remain in the callers (unchanged).
- [ ] `pnpm build` succeeds.

**Verify:** `pnpm test tests/unit/ --run` (social subset) → pass; `pnpm build` → success.

**Steps:**

- [ ] **Step 1: Bug-encoding-test check.** Read `tests/unit/server-action-rpc-hardening.test.ts`, `tests/unit/comments-edit-no-spurious-report.test.ts`, `tests/unit/list-likes.test.ts`. Fix any assertion that asserts comment/like succeeds on an unpublished/private review.

- [ ] **Step 2: Write the failing tests.** Add (mirroring the `server-action-rpc-hardening.test.ts` db+`getCachedUser` mock harness): createComment on a review with `isPublic:false`/`publishedAt:null`/private author → `{ ok:false, reason:"review-not-found" }`, `insertMock` not called, `onComment` mock not called; likeReview same → `{ ok:false }`, no insert/emit; owner path (viewer === review.userId) → still proceeds.

- [ ] **Step 3: Run to verify fail.** Run: `pnpm test tests/unit/server-action-rpc-hardening.test.ts --run` (or the new file). Expected: FAIL (no visibility gate yet).

- [ ] **Step 4: Create the shared helper.** `lib/social/_shared/review-visibility.ts`:
```ts
import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

const { reviews, profiles } = schema;

/**
 * Returns the review iff the viewer may act on it: owner sees their own
 * (any state); everyone else only a published+public review by a public,
 * non-deleted author. Mirrors likeList's gate + the indistinguishable
 * not-found contract. The `db` connection is service-role (bypasses RLS),
 * so this app-level check is the enforcement point — not RLS.
 */
export async function loadVisibleReview(
  reviewId: string,
  viewerId: string,
): Promise<{ id: string; userId: string } | null> {
  const review = await db.query.reviews.findFirst({
    where: eq(reviews.id, reviewId),
    columns: { id: true, userId: true, isPublic: true, publishedAt: true },
  });
  if (!review) return null;
  if (review.userId === viewerId) return { id: review.id, userId: review.userId };
  if (!review.isPublic || review.publishedAt == null) return null;
  const author = await db.query.profiles.findFirst({
    where: and(eq(profiles.userId, review.userId)),
    columns: { isPublic: true, deletedAt: true },
  });
  if (!author || author.deletedAt != null || !author.isPublic) return null;
  return { id: review.id, userId: review.userId };
}
```

- [ ] **Step 5: Wire `createComment`.** In `lib/social/comments/server-actions.ts`, replace the `const review = await db.query.reviews.findFirst({ where: eq(reviews.id, reviewId), columns: { id: true, userId: true } }); if (!review) return { ok: false, reason: "review-not-found" };` block with:
```ts
import { loadVisibleReview } from "@/lib/social/_shared/review-visibility";
// ...
const review = await loadVisibleReview(reviewId, user.id);
if (!review) return { ok: false, reason: "review-not-found" };
```
(Keep the subsequent `isBlockedBetween`, parent-context, spam-check, insert, `onComment` logic unchanged.)

- [ ] **Step 6: Wire `likeReview`.** In `lib/social/reactions/server-actions.ts`, replace `const review = await db.query.reviews.findFirst({ where: eq(reviews.id, reviewId), columns: { userId: true } }); if (!review) return { ok: false };` with:
```ts
import { loadVisibleReview } from "@/lib/social/_shared/review-visibility";
// ...
const review = await loadVisibleReview(reviewId, user.id);
if (!review) return { ok: false };
```
(The existing `if (review.userId === user.id) return { ok: true };` self-like line still works — owner path returns the review. Block-check, insert, emit unchanged.)

- [ ] **Step 7: Run to verify pass.** Run the test from Step 2. Expected: PASS.

- [ ] **Step 8: Verify + commit.** `pnpm build` green →
```bash
git add lib/social/_shared/review-visibility.ts lib/social/comments/server-actions.ts lib/social/reactions/server-actions.ts tests/unit/
git commit -m "fix(social): require visible review for comment/like (F-007)"
```

---

### Task 5: F-006 — Feed respects profile privacy

**Goal:** Feed never surfaces a followee's activity once that profile is private (consistent with profile/library/recap).

**Files:**
- Modify: `lib/social/feed/queries.ts`
- Test: new `tests/unit/feed-privacy.test.ts`

**Acceptance Criteria:**
- [ ] All three UNION branches' `EXISTS (... FROM profiles ...)` subqueries additionally require `is_public = true`.
- [ ] `pnpm build` succeeds.

**Verify:** `pnpm test tests/unit/feed-privacy.test.ts --run` → pass; `pnpm build` → success.

**Steps:**

- [ ] **Step 1: Bug-encoding-test check.** Grep `tests/` for `buildFeedQuery`. If a test asserts a private followee's events appear, correct it first.

- [ ] **Step 2: Write the failing test.** Create `tests/unit/feed-privacy.test.ts` mirroring the `db.execute`-SQL-inspection harness used by `tests/unit/recaps/aggregate.test.ts`. Call `buildFeedQuery({ viewerId, followeeIds: ["f1"], cursor: null })` with `db.execute` mocked; assert the generated SQL string contains `is_public = true` for each of the three branches (e.g. asserts `(sql.match(/is_public = true/g) || []).length >= 3`).

- [ ] **Step 3: Run to verify fail.** Run: `pnpm test tests/unit/feed-privacy.test.ts --run`. Expected: FAIL.

- [ ] **Step 4: Implement.** In `lib/social/feed/queries.ts`, in each of the three `EXISTS` subqueries change:
  - logs branch (~L88): `SELECT 1 FROM profiles WHERE user_id = logs.user_id AND deleted_at IS NULL` → append ` AND is_public = true`
  - reviews branch (~L108): `... WHERE user_id = reviews.user_id AND deleted_at IS NULL` → append ` AND is_public = true`
  - lists branch (~L128): `... WHERE user_id = lists.user_id AND deleted_at IS NULL` → append ` AND is_public = true`
  Update the function doc comment to note feed honors `profiles.is_public` (private = invisible to non-owner followers; going-private is not retroactively follow-severed, enforced read-side).

- [ ] **Step 5: Run to verify pass.** Run: `pnpm test tests/unit/feed-privacy.test.ts --run`. Expected: PASS.

- [ ] **Step 6: Verify + commit.** `pnpm build` green →
```bash
git add lib/social/feed/queries.ts tests/unit/feed-privacy.test.ts
git commit -m "fix(feed): require public profile in all feed branches (F-006)"
```

---

### Task 6: F-003 — Tracked RLS-hygiene migration + fix stale comment

**Goal:** The live (already-safe) RLS-enabled-no-policy state of `app_secrets`/`featured_lists`/`monthly_recaps` is captured in version control so a fresh restore stays safe; the misleading schema comment is corrected.

**Files:**
- Create: `lib/db/policies/0003_rls_hygiene.sql`
- Modify: `lib/db/schema.ts` (the `app_secrets` comment, ~L244-249)
- Apply: via Supabase MCP `apply_migration` (idempotent; live already has RLS enabled — this is restore-parity + REVOKE hardening)

**Acceptance Criteria:**
- [ ] `0003_rls_hygiene.sql` idempotently enables RLS on the 3 tables and REVOKEs `app_secrets` from `anon, authenticated`. SQL comments use `--` only.
- [ ] `schema.ts` comment accurately states "RLS enabled, no policy (deny-all); enforced via lib/db/policies/0003; service-role bypasses".
- [ ] Post-apply `get_advisors(security)` shows no new ERROR/WARN regressions; the 3 tables remain deny-all.

**Verify:** Supabase MCP `get_advisors` security run before/after — no regression.

**Steps:**

- [ ] **Step 1: Write the migration.** Create `lib/db/policies/0003_rls_hygiene.sql`:
```sql
-- 0003_rls_hygiene — capture the live RLS-enabled-no-policy state in VCS so a
-- fresh restore from migrations stays safe (F-003). RLS-enabled + zero
-- policies = deny-all for anon/authenticated; the service-role connection
-- (DATABASE_URL) bypasses RLS, which is how the app/Edge code still reads
-- these tables. ENABLE ROW LEVEL SECURITY is idempotent.
ALTER TABLE "app_secrets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "featured_lists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "monthly_recaps" ENABLE ROW LEVEL SECURITY;

-- Defense-in-depth: app_secrets caches OAuth bearer tokens. Even with RLS
-- deny-all, revoke table grants from the API roles so a future accidental
-- permissive policy can't expose it.
REVOKE ALL ON TABLE "app_secrets" FROM anon, authenticated;
```

- [ ] **Step 2: Fix the schema comment.** In `lib/db/schema.ts` replace the `app_secrets` block comment (currently "Service-role-only; never exposed via PostgREST. RLS not enabled because…") with:
```ts
// App-level secret cache (Twitch OAuth tokens, etc.).
// RLS ENABLED with NO policy ⇒ deny-all for anon/authenticated (see
// lib/db/policies/0003_rls_hygiene.sql). The service-role connection
// (DATABASE_URL) bypasses RLS — that is the only access path.
```

- [ ] **Step 3: Apply (with care) + verify.** Run Supabase MCP `get_advisors` security and record current lints. Apply `0003_rls_hygiene.sql` via Supabase MCP `apply_migration` (name `0003_rls_hygiene`). Re-run `get_advisors` security. Confirm: no new ERROR/WARN; `app_secrets`/`featured_lists`/`monthly_recaps` still report only the benign `rls_enabled_no_policy` INFO (or drop off). If anything regresses, stop and report.

- [ ] **Step 4: Commit.**
```bash
git add lib/db/policies/0003_rls_hygiene.sql lib/db/schema.ts
git commit -m "fix(db): track RLS-enable for app_secrets/featured_lists/monthly_recaps; correct stale comment (F-003)"
```

---

### Task 7: Advisor hardening — avatars bucket listing; document leaked-password + pg_net

**Goal:** Stop public listing of the `avatars` bucket; capture the remaining advisor WARNs as explicit operator/decision items.

**Files:**
- Modify: `lib/db/policies/0003_rls_hygiene.sql` (append avatars policy fix)
- Modify: this plan / a checklist note for operator items (no code for leaked-password / pg_net)

**Acceptance Criteria:**
- [ ] `avatars` bucket no longer allows broad LIST via `storage.objects` while object-by-URL GET still works.
- [ ] Leaked-password protection captured as an operator checklist item (dashboard-only).
- [ ] pg_net documented as a deliberate no-touch with rationale.

**Verify:** Avatar images still render in the running app; `get_advisors(security)` no longer flags `public_bucket_allows_listing` for `avatars`.

**Steps:**

- [ ] **Step 1: Inspect the current policy.** Supabase MCP `execute_sql`: `SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='avatars_public_read';` Record the definition.

- [ ] **Step 2: Drop the broad LIST-enabling policy.** Public-bucket object URLs are served by the storage CDN and do not require a `SELECT` policy on `storage.objects`; the broad policy only enables enumeration. Append to `lib/db/policies/0003_rls_hygiene.sql`:
```sql
-- avatars is a PUBLIC bucket: object-by-URL GET is served without a
-- storage.objects SELECT policy. The broad SELECT policy only enabled
-- listing/enumeration of every avatar key — drop it. (advisor 0025)
DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
```
Apply via Supabase MCP `apply_migration` (append to / re-apply `0003_rls_hygiene`).

- [ ] **Step 3: Verify avatars still load (done with care).** With `pnpm dev` running (or against the deployed preview), load a page that renders a user avatar and confirm the image still resolves (avatar fetch is a direct public-object URL, unaffected by removing the listing policy). Re-run `get_advisors(security)` → `public_bucket_allows_listing` for `avatars` is gone. **If avatars 404**, the assumption is wrong — restore a key-scoped policy instead:
```sql
CREATE POLICY "avatars_public_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'avatars');
```
(this still permits per-object SELECT; if listing must be blocked too, gate by a path predicate). Re-verify.

- [ ] **Step 4: Document operator/decision items** (append to this file under "Operator close-out"):
  - **Leaked-password protection (WARN):** Supabase Dashboard → Authentication → Sign In / Providers → enable "Leaked password protection (HaveIBeenPwned)". Dashboard-only; cannot be set via SQL/MCP.
  - **pg_net in public schema (WARN):** deliberately NOT changed — pg_cron jobs / webhooks depend on `pg_net`; relocating an extension schema is risky shared infra. Recommend revisiting only with a tested migration window.

- [ ] **Step 5: Commit.**
```bash
git add lib/db/policies/0003_rls_hygiene.sql docs/superpowers/plans/2026-05-15-audit-fixes.md
git commit -m "fix(storage): drop broad avatars listing policy; document operator items (advisor)"
```

---

## Final: whole-branch review, gates, push, PR

- [ ] **Whole-branch review.** Dispatch the `code-reviewer` agent over the full branch diff vs `main` (per-task isolated reviews miss cross-task coupling — the visibility-family and AI-cap-family changes must be reviewed together). Address any Critical/High before proceeding.
- [ ] **Full canonical gates:** `pnpm typecheck && pnpm lint && pnpm test --run && pnpm build`. All green. (`pnpm build` is the only gate that catches Next 16 `"use server"` violations — it is mandatory, not optional.)
- [ ] **Push to feature branch (never main directly):** `git push origin HEAD:fix/audit-2026-05-15`
- [ ] **Open PR** to `main` summarizing the 4 findings + the hardening batch, the two deliberate behavior changes (OG 404s private profiles; recaps exclude owner's own private logs), and the operator close-out items (recap-cache DELETE already done in Task 1; leaked-password dashboard toggle; pg_net decision).

## Operator close-out (carry-forward)
- Recap cache invalidation: performed in Task 1 Step 8 (re-runs unnecessary unless restoring an old DB).
- Leaked-password protection: enable in Supabase Dashboard (Task 7 Step 4).
- pg_net: no action — documented decision.

## Self-Review

- **Spec coverage:** F-001 → Task 1; F-004 → Task 2; F-005 → Task 3; F-007 → Task 4; F-006 → Task 5; F-003 → Task 6; live-advisor bonus (avatars/leaked-password/pg_net) → Task 7. F-002 — no task (verified false positive in triage). All real findings covered.
- **Placeholders:** source edits give exact files + exact predicates/clauses + line anchors; test steps reference the concrete existing harness file to mirror (the established mock pattern is the spec — fabricating a different harness would be the real failure).
- **Type consistency:** `loadVisibleReview(reviewId, viewerId) → { id, userId } | null` used identically in Tasks 4's two call-sites; `REVIEW_AI_RL` / `guardReviewAiRate` names consistent within Task 2; `"rate-limited"` reason added to the type and handled in UI in Task 3.
