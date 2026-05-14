# Audit Fixes Implementation Plan — 2026-05-14

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land all Tier 1 critical and Tier 2 important findings from the 2026-05-14 codebase audit on the `audit-fixes-2026-05-14` branch.

**Architecture:** Each task is a coherent unit of work (1–3 files typically) producing a testable, committable outcome. Tasks ordered by priority (security → functional bugs → perf P0 → sweeps). All work on one branch; merge to main when complete.

**Tech Stack:** Next.js 16 (App Router + Turbopack), Supabase (Auth + Edge Functions + pg_cron), Drizzle ORM, postgres-js, Tailwind, Vitest, Playwright, Radix.

**Spec:** [`docs/superpowers/specs/2026-05-14-audit-design.md`](../specs/2026-05-14-audit-design.md)

---

## Tier 1 — Critical (Tasks 1–11)

### Task 1: Lock down server-action RPC surface

**Goal:** Three `"use server"` actions accept caller-supplied `userId` and trust it; close the holes by deriving identity from session or enforcing visibility.

**Files:**
- Modify: `lib/logs/server-actions.ts:127` (`ensureLog`)
- Modify: `lib/taste/server-actions.ts:47` (`getFingerprint`)
- Modify: `lib/profile/server-actions.ts:61` (`getProfileByUsername`, `getProfileByUserId`)
- Modify: `lib/social/feed/server-actions.ts:31` (`getFeed` — drop `viewerId` param)
- Test: `tests/unit/server-action-rpc-hardening.test.ts` (NEW)

**Acceptance Criteria:**
- [ ] `ensureLog` no longer accepts `userId` arg; derives via `getCachedUser()`; returns early `{ ok: false, error: "not-signed-in" }` if no session
- [ ] All callers of `ensureLog` updated (likely in `lib/recs/*` and `app/api/auth/*` callbacks)
- [ ] `getFingerprint(userId)` either drops the param OR re-validates: `viewer.id === userId` OR (`profile.isPublic && !profile.deletedAt`); throws/returns null otherwise
- [ ] `getProfileByUsername`/`getProfileByUserId` strip `bio` and `displayName` when caller is non-owner AND `isPublic === false`
- [ ] `getFeed` drops `viewerId` param; derives from session
- [ ] New unit tests verify each action correctly rejects unauthorized callers
- [ ] `pnpm tsc --noEmit` clean
- [ ] `pnpm vitest run` green

**Verify:** `pnpm vitest run tests/unit/server-action-rpc-hardening.test.ts && pnpm tsc --noEmit`

**Steps:**

- [ ] **Step 1:** Audit each action's call sites; record which need to pass identity vs derive it
- [ ] **Step 2:** Write failing tests that call each action with a wrong userId and assert the response shape
- [ ] **Step 3:** Drop/replace the `userId` param signature; update call sites
- [ ] **Step 4:** Run tests; confirm green
- [ ] **Step 5:** `git commit -m "fix(security): lock down server-action RPC surface — derive userId from session"`

```json:metadata
{"files": ["lib/logs/server-actions.ts", "lib/taste/server-actions.ts", "lib/profile/server-actions.ts", "lib/social/feed/server-actions.ts", "tests/unit/server-action-rpc-hardening.test.ts"], "verifyCommand": "pnpm vitest run tests/unit/server-action-rpc-hardening.test.ts && pnpm tsc --noEmit", "acceptanceCriteria": ["ensureLog drops userId arg, derives from session", "getFingerprint enforces ownership/visibility check", "getProfileByUsername/getProfileByUserId redact bio for non-owner private profiles", "getFeed drops viewerId arg, derives from session", "New unit tests prove each action rejects unauthorized callers"]}
```

### Task 2: PII leak sweep — data export + avatar alt-text

**Goal:** Strip commenter UUIDs from data export; stop leaking emails as avatar alt-text.

**Files:**
- Modify: `lib/settings/data-export.ts:81–96` (replace `user_id` with `username`)
- Modify: `components/ui/avatar.tsx:50, 80, 104` (drop email fallback in alt + aria-label)
- Test: `tests/unit/data-export-pii.test.ts` (NEW or extend existing)

**Acceptance Criteria:**
- [ ] `comments_received[].author` includes `username` and `display_name`, NOT `user_id`
- [ ] Existing data-export test updated to assert no UUIDs other than the export-owner's
- [ ] Avatar alt fallback is `username ?? "User"` (never `user.email`)
- [ ] `aria-label` matches `alt`
- [ ] Existing avatar component tests still pass

**Verify:** `pnpm vitest run tests/unit/data-export-pii.test.ts tests/unit/avatar*.test.ts`

**Steps:**

- [ ] **Step 1:** Update data-export return shape; add explicit Zod parse on returned rows to fail-loud if a UUID slips back in
- [ ] **Step 2:** Update avatar component fallbacks
- [ ] **Step 3:** Add/update tests
- [ ] **Step 4:** Commit: `fix(security): redact other-user UUIDs from data export + stop leaking emails as avatar alt`

```json:metadata
{"files": ["lib/settings/data-export.ts", "components/ui/avatar.tsx", "tests/unit/data-export-pii.test.ts"], "verifyCommand": "pnpm vitest run tests/unit/data-export-pii.test.ts tests/unit/avatar*.test.ts", "acceptanceCriteria": ["data-export comments_received excludes other users' UUIDs", "avatar alt+aria fallback uses username, never email"]}
```

### Task 3: Soft-delete + block-filter coverage sweep

**Goal:** Comment-thread query missing `withBlockedFilter`; 4+ read paths missing `deleted_at IS NULL`.

**Files:**
- Modify: `app/(app)/u/[username]/reviews/[slug]/page.tsx:117–143` (wrap in `withBlockedFilter`)
- Modify: `app/api/internal/digest/run/route.ts:52–67` (add `p.deleted_at IS NULL`)
- Modify: `lib/social/discovery/trending-reviews.ts:52–68` (add `p.deleted_at IS NULL`)
- Modify: `lib/social/comments/mentions.ts:31–40` (filter mentioned soft-deleted users)
- Modify: `lib/social/discovery/popular-games.ts:38–47` (join profiles; filter soft-deleted)
- Test: `tests/unit/social-soft-delete-coverage.test.ts` (NEW)

**Acceptance Criteria:**
- [ ] Comment-thread query uses `withBlockedFilter(viewer?.id ?? null, base, schema.comments.userId)`
- [ ] Digest cron WHERE clause adds `AND p.deleted_at IS NULL`
- [ ] Trending-reviews query adds `AND p.deleted_at IS NULL`
- [ ] Mention resolver filters out soft-deleted users
- [ ] Popular-games joins profiles + filters soft-deleted authors
- [ ] Tests cover each path

**Verify:** `pnpm vitest run tests/unit/social-soft-delete-coverage.test.ts`

```json:metadata
{"files": ["app/(app)/u/[username]/reviews/[slug]/page.tsx", "app/api/internal/digest/run/route.ts", "lib/social/discovery/trending-reviews.ts", "lib/social/comments/mentions.ts", "lib/social/discovery/popular-games.ts", "tests/unit/social-soft-delete-coverage.test.ts"], "verifyCommand": "pnpm vitest run tests/unit/social-soft-delete-coverage.test.ts", "acceptanceCriteria": ["comment thread filtered through withBlockedFilter", "digest cron skips soft-deleted users", "trending-reviews skips soft-deleted authors", "mention resolver skips soft-deleted users", "popular-games skips soft-deleted authors"]}
```

### Task 4: Defensive small wins

**Goal:** Spurious-report bug + safeParse + constant-time compare + server-only guard.

**Files:**
- Modify: `lib/social/comments/server-actions.ts:154–185` (only insert report when UPDATE returns rows)
- Modify: `lib/recs/server-actions.ts:770` (`safeParse` not `parse`)
- Modify: `app/api/internal/digest/run/route.ts:38` (`crypto.timingSafeEqual`)
- Modify: `lib/db/index.ts:1` (add `import "server-only"`)
- Test: `tests/unit/comments-edit-no-spurious-report.test.ts` (NEW)

**Acceptance Criteria:**
- [ ] `editComment` UPDATE uses `.returning({ id })`; report INSERT runs only when `result.length > 0`
- [ ] Test: non-author edit attempt with spammy content does NOT create a report row
- [ ] `refillRecs` returns `{ ok: false, reason: "invalid-filters" }` envelope on malformed input
- [ ] Cron secret comparison uses `crypto.timingSafeEqual` after length-equality check
- [ ] `lib/db/index.ts` first line is `import "server-only";`

**Verify:** `pnpm vitest run tests/unit/comments-edit-no-spurious-report.test.ts`

```json:metadata
{"files": ["lib/social/comments/server-actions.ts", "lib/recs/server-actions.ts", "app/api/internal/digest/run/route.ts", "lib/db/index.ts", "tests/unit/comments-edit-no-spurious-report.test.ts"], "verifyCommand": "pnpm vitest run tests/unit/comments-edit-no-spurious-report.test.ts && pnpm tsc --noEmit", "acceptanceCriteria": ["editComment skips report insert on no-update", "refillRecs returns error envelope not 500", "CRON_SECRET uses timingSafeEqual", "lib/db has server-only guard"]}
```

### Task 5: Notification routing + keyboard semantics

**Goal:** All notification rows route to actual content; `<li onClick>` becomes `<button>` for keyboard A11y.

**Files:**
- Modify: `lib/social/notifications/server-actions.ts` (extend `getInbox` to return `targetHref`)
- Modify: `components/notifications/notification-row.tsx:24–52` (use `targetHref`; render as `<button>` or add keyboard handlers)
- Modify: `lib/social/discovery/popular-games.ts:73`, `app/(app)/u/[username]/lists/page.tsx:16` (remove stale T26 comments)
- Test: `tests/unit/notification-target-resolver.test.ts` (NEW)

**Acceptance Criteria:**
- [ ] `getInbox` payload includes `targetHref: string` per notification, resolved server-side via target type joins
- [ ] `review_liked`/`review_commented`/`review_replied` → `/u/{author}/reviews/{slug}` (with optional `#comment-{id}` for comments)
- [ ] `list_liked`/`list_commented`/`list_published` → `/u/{author}/lists/{listSlug}`
- [ ] `mention` → resolves by `targetType`
- [ ] `wishlist_friend_logged` → `/g/{gameSlug}`
- [ ] Notification row is keyboard-activatable (Enter/Space) with `role="button"`
- [ ] Stale T26 comments removed from 3 files
- [ ] Tests cover each notification type → href

**Verify:** `pnpm vitest run tests/unit/notification-target-resolver.test.ts`

```json:metadata
{"files": ["lib/social/notifications/server-actions.ts", "components/notifications/notification-row.tsx", "lib/social/discovery/popular-games.ts", "app/(app)/u/[username]/lists/page.tsx", "tests/unit/notification-target-resolver.test.ts"], "verifyCommand": "pnpm vitest run tests/unit/notification-target-resolver.test.ts && pnpm tsc --noEmit", "acceptanceCriteria": ["getInbox returns targetHref per row", "all notification types resolve to correct content URL", "notification row keyboard-accessible", "stale T26 comments removed"]}
```

### Task 6: Avatar column sweep — `avatarUrl` → `profilePictureUrl`

**Goal:** 7+ Phase 5 sites SELECT the dormant `avatarUrl` column; replace with the real `profilePictureUrl`.

**Files:**
- Modify: `app/(app)/home/feed/page.tsx:72`
- Modify: `app/(app)/u/[username]/reviews/[slug]/page.tsx:128`
- Modify: `lib/social/blocks/server-actions.ts:79`
- Modify: `lib/social/follows/server-actions.ts:101, 132`
- Modify: `lib/social/notifications/server-actions.ts:65`
- Modify: `lib/social/discovery/similar-users.ts:95, 126`
- Modify: `lib/db/schema.ts:107–109` (update dormant comment to confirm the migration)
- Test: existing or new — verify avatar renders for a profile with `profilePictureUrl` set

**Acceptance Criteria:**
- [ ] All `avatarUrl` SELECTs in Phase 5 surface area replaced with `profilePictureUrl`
- [ ] Type-check clean
- [ ] Schema comment on `avatarUrl` updated to "Dropped from active reads on 2026-05-14; kept for additive-only migration safety"
- [ ] Manual smoke: avatar with PFP set renders correctly in feed/notification/comment

**Verify:** `pnpm tsc --noEmit && pnpm vitest run`

```json:metadata
{"files": ["app/(app)/home/feed/page.tsx", "app/(app)/u/[username]/reviews/[slug]/page.tsx", "lib/social/blocks/server-actions.ts", "lib/social/follows/server-actions.ts", "lib/social/notifications/server-actions.ts", "lib/social/discovery/similar-users.ts", "lib/db/schema.ts"], "verifyCommand": "pnpm tsc --noEmit && pnpm vitest run", "acceptanceCriteria": ["all 7+ Phase 5 sites use profilePictureUrl", "schema.ts dormant comment updated", "type-check clean"]}
```

### Task 7: CSS tokens sweep — vars + WCAG AA + Phase 4 colors

**Goal:** Three undefined vars used in 16 files; `--text-faint` fails WCAG; Phase 4 hardcodes Tailwind palette.

**Files:**
- Modify: `app/globals.css` (add `--text-muted`, `--border-hover`, `--accent-fg`; bump `--text-faint` to pass WCAG AA at 4.5:1)
- Modify: `components/taste/*.tsx` (8 files), `components/recs/*.tsx` (3 files), `app/(app)/play-next/_client.tsx`, `components/taste/milestone-toast.tsx` (replace `zinc-*`/`emerald-*`/`bg-sky-600` with CSS tokens)
- Test: visual smoke — verify settings/connections/privacy/feed-empty/block-dialog/imports-nudge all render with proper colors

**Acceptance Criteria:**
- [ ] `--text-muted: var(--text-dim)`, `--border-hover: var(--border)`, `--accent-fg: #ffffff` defined in `:root`
- [ ] `--text-faint` bumped to ≥ 4.5:1 contrast against `--bg-card` (#16161f) — proposed: `#7d7d92` (5.2:1)
- [ ] Phase 4 components use `bg-card`/`border`/`text`/`text-dim`/`accent` tokens; no raw `zinc-*` or `emerald-*` remain in `components/taste/`, `components/recs/`, `play-next/_client.tsx`
- [ ] `bg-sky-600` Tweet button → `bg-[var(--accent)]` (or appropriate brand color)
- [ ] MilestoneToast uses `accent-soft` not `emerald-950/80`

**Verify:** `pnpm grep -r "zinc-\|emerald-\|bg-sky-" components/taste components/recs app/\(app\)/play-next | wc -l` returns 0 (or grep equivalent)

```json:metadata
{"files": ["app/globals.css", "components/taste/", "components/recs/", "app/(app)/play-next/_client.tsx"], "verifyCommand": "grep -r \"zinc-\\|emerald-\\|bg-sky-\" components/taste components/recs 'app/(app)/play-next' || echo 'no raw palette colors remain'", "acceptanceCriteria": ["3 missing CSS vars added to globals.css", "--text-faint bumped to pass WCAG AA", "Phase 4 surface uses CSS tokens, no raw zinc/emerald/sky"]}
```

### Task 8: Discovery follow-state — pipe `viewerFollows`

**Goal:** `SimilarUsersRow` always shows "Follow" even for already-followed users.

**Files:**
- Modify: `lib/social/discovery/similar-users.ts` (return `viewerFollows: boolean` per candidate)
- Modify: `components/discovery/similar-users-row.tsx:62` (use `viewerFollows` not hardcoded false)
- Test: existing similar-users test extended to verify `viewerFollows` semantics

**Acceptance Criteria:**
- [ ] `getSimilarUsers` payload includes `viewerFollows: boolean` per row
- [ ] `<FollowButton initialIsFollowing={u.viewerFollows} />` reflects real state
- [ ] Test: viewer follows User A, queries similar-users including A, asserts `viewerFollows: true`

**Verify:** `pnpm vitest run tests/unit/similar-users*.test.ts`

```json:metadata
{"files": ["lib/social/discovery/similar-users.ts", "components/discovery/similar-users-row.tsx"], "verifyCommand": "pnpm vitest run tests/unit/similar-users*.test.ts", "acceptanceCriteria": ["getSimilarUsers returns viewerFollows per row", "FollowButton reflects real follow state"]}
```

### Task 9: Error + loading boundaries

**Goal:** Add brand-consistent root error/not-found pages + `loading.tsx` for 11 high-traffic Phase 5 routes.

**Files:**
- Create: `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx`
- Create: `app/(app)/home/feed/loading.tsx`, `app/(app)/notifications/loading.tsx`, `app/(app)/discover/loading.tsx` (or per-tab), `app/(app)/u/[username]/loading.tsx`, `app/(app)/u/[username]/taste/loading.tsx`, `app/(app)/u/[username]/lists/loading.tsx`, `app/(app)/u/[username]/lists/[listSlug]/loading.tsx`, `app/(app)/play-next/loading.tsx`, `app/(app)/settings/loading.tsx`
- Reference: `app/(app)/library/loading.tsx` for skeleton patterns

**Acceptance Criteria:**
- [ ] Root `error.tsx` renders mascot + "Try again" button + link home; uses CSS tokens
- [ ] Root `global-error.tsx` (used when root layout itself fails) — minimal HTML, no provider deps
- [ ] Root `not-found.tsx` matches brand voice; links to home + (if signed in) feed
- [ ] Each `loading.tsx` renders a skeleton matching the page's primary content shape
- [ ] No `loading.tsx` is empty/identical — each is page-shape-specific

**Verify:** Manual — navigate to a 404 URL and force a thrown error; both render correctly

```json:metadata
{"files": ["app/error.tsx", "app/global-error.tsx", "app/not-found.tsx", "app/(app)/home/feed/loading.tsx", "app/(app)/notifications/loading.tsx", "app/(app)/discover/loading.tsx", "app/(app)/u/[username]/loading.tsx", "app/(app)/u/[username]/taste/loading.tsx", "app/(app)/u/[username]/lists/loading.tsx", "app/(app)/u/[username]/lists/[listSlug]/loading.tsx", "app/(app)/play-next/loading.tsx", "app/(app)/settings/loading.tsx"], "verifyCommand": "pnpm tsc --noEmit && pnpm build", "acceptanceCriteria": ["root error.tsx + global-error.tsx + not-found.tsx exist with brand voice", "11 phase 5 routes get page-shape-specific loading.tsx"]}
```

### Task 10: Reports queue UX — actual content links + filter chip

**Goal:** Mods see UUIDs not content; can't moderate effectively.

**Files:**
- Modify: `lib/moderation/server-actions.ts` (or wherever `getReportQueue` lives) — join target tables; return `targetUrl` per row
- Modify: `components/moderation/reports-queue.tsx:36–38` (render `targetUrl` as link; add auto-flagged filter chip; optimistic resolution)
- Test: existing or new — verify each `target_type` resolves to a sensible URL

**Acceptance Criteria:**
- [ ] `getReportQueue` rows include `targetUrl: string | null` (null if target deleted)
- [ ] Queue UI renders "View content →" link instead of bare UUID
- [ ] Auto-flagged vs user-reported separated by filter chip
- [ ] Resolved row optimistically removed from UI before `router.refresh()` lands

**Verify:** Manual on `/admin/reports`

```json:metadata
{"files": ["lib/moderation/server-actions.ts", "components/moderation/reports-queue.tsx"], "verifyCommand": "pnpm tsc --noEmit && pnpm vitest run", "acceptanceCriteria": ["getReportQueue returns targetUrl", "queue UI links to actual content", "auto-flagged filter chip", "optimistic resolution"]}
```

### Task 11: Recs perf — candidatePool DB-side prefilter + indexes

**Goal:** `candidatePool` does full table scan; push genre/theme overlap into Postgres.

**Files:**
- Modify: `lib/recs/candidate-pool.ts:102–116` (add WHERE clause filtering by user's top genres/themes via `genres && ARRAY[...]`; cap LIMIT to a sane multiple of the eventual candidate count)
- Create: migration `lib/db/migrations/0014_recs_perf_indexes.sql`
- Modify: `lib/db/schema.ts` (add index declaration to keep schema in sync)

**Acceptance Criteria:**
- [ ] `candidatePool` SELECT includes a `WHERE games.genres && ARRAY[$top_user_genres]::text[]` filter (or equivalent for themes)
- [ ] LIMIT cap (suggested 1000 — well above candidate target but bounded)
- [ ] New index: `CREATE INDEX games_rawg_rating_desc ON games (rawg_rating DESC NULLS LAST)` for popularity fallback
- [ ] Test verifies a zero-overlap user (no top genres) falls back to popularity (not empty)
- [ ] Migration applies cleanly to local + has been applied to live DB via Supabase MCP

**Verify:** `pnpm vitest run tests/unit/candidate-pool*.test.ts && pnpm tsx scripts/verify-recs-perf.ts` (script TBD or fold into existing perf check)

```json:metadata
{"files": ["lib/recs/candidate-pool.ts", "lib/db/migrations/0014_recs_perf_indexes.sql", "lib/db/schema.ts"], "verifyCommand": "pnpm vitest run tests/unit/candidate-pool*.test.ts && pnpm tsc --noEmit", "acceptanceCriteria": ["candidatePool pushes overlap filter into Postgres", "popularity index added", "zero-overlap user still gets candidates"]}
```

---

## Tier 2 — Important sweep tasks (12–25)

### Task 12: Feed perf — batch isBlockedBetween + bounds + pagination

**Goal:** N+1 block lookup in feed; missing LIMIT/pagination across multiple paths.

**Files:**
- Modify: `lib/social/_shared/visibility.ts` (add `getBlockedPairs(viewerId, candidateIds)` batch helper)
- Modify: `lib/social/feed/queries.ts:147–149` (use batch helper)
- Modify: `lib/social/discovery/trending-reviews.ts:134–137` (use batch helper)
- Modify: `app/(app)/u/[username]/reviews/[slug]/page.tsx:117–143` (add LIMIT 100 to comments query)
- Modify: `lib/social/follows/server-actions.ts:91–141` (`getFollowers`/`getFollowing` accept `limit`/`offset`; default 100)
- Modify: `app/(app)/u/[username]/followers/page.tsx`, `following/page.tsx` (use pagination + "Load more")
- Test: `tests/unit/visibility-batch.test.ts` (NEW)

**Acceptance Criteria:**
- [ ] `getBlockedPairs(viewerId, ids)` returns a Set of blocked actor IDs in one query
- [ ] Feed + trending use the batched helper (no per-row awaits)
- [ ] Comments query has `LIMIT 100`
- [ ] Followers/following pages paginate (default 100 per page)
- [ ] Tests cover the batch helper

**Verify:** `pnpm vitest run tests/unit/visibility-batch.test.ts`

```json:metadata
{"files": ["lib/social/_shared/visibility.ts", "lib/social/feed/queries.ts", "lib/social/discovery/trending-reviews.ts", "app/(app)/u/[username]/reviews/[slug]/page.tsx", "lib/social/follows/server-actions.ts", "app/(app)/u/[username]/followers/page.tsx", "app/(app)/u/[username]/following/page.tsx", "tests/unit/visibility-batch.test.ts"], "verifyCommand": "pnpm vitest run tests/unit/visibility-batch.test.ts && pnpm tsc --noEmit", "acceptanceCriteria": ["batched getBlockedPairs replaces N+1 isBlockedBetween loop", "comments query has LIMIT 100", "followers/following paginated"]}
```

### Task 13: Profile-summary perf — bound stats + library

**Goal:** Profile library query loads everything to render 12.

**Files:**
- Modify: `lib/social/_shared/profile-summary.ts:102–112` (split into bounded stats aggregate + LIMIT 12 library fetch)
- Test: `tests/unit/profile-summary-bounds.test.ts` (NEW or extend)

**Acceptance Criteria:**
- [ ] Stats computed via `SELECT count(*) FILTER (WHERE status = ...)` aggregate query
- [ ] `libraryTruncated` limited to 12 via separate LIMIT 12 query
- [ ] Type-check clean; existing profile rendering unchanged
- [ ] Test verifies 1000-log user only fetches 12 game rows (mock-checked)

**Verify:** `pnpm vitest run tests/unit/profile-summary*.test.ts`

```json:metadata
{"files": ["lib/social/_shared/profile-summary.ts", "tests/unit/profile-summary-bounds.test.ts"], "verifyCommand": "pnpm vitest run tests/unit/profile-summary*.test.ts && pnpm tsc --noEmit", "acceptanceCriteria": ["stats use COUNT FILTER aggregates", "library fetch capped at 12 rows"]}
```

### Task 14: Sequential-await sweep + cache wraps + bulk ops

**Goal:** 6 sites with sequential awaits → Promise.all; reorderListItems bulk UPDATE; rerank-recs bulk INSERT; reviews/[slug] cache() wrap.

**Files:**
- Modify: `app/(app)/layout.tsx:29–46` (`Promise.all` for `deletedAt` + `headerUser`)
- Modify: `supabase/functions/refresh-fingerprint/index.ts:103–121` (`Promise.all` for liked/disliked)
- Modify: `supabase/functions/rerank-recs/index.ts:85–138` (`Promise.all` for fp/candidates/dismissed/playing); `:229–244` (single bulk INSERT)
- Modify: `lib/logs/server-actions.ts:204–228` (parallel logs + reviews map fetch)
- Modify: `lib/social/comments/triggers.ts:57–65` (`Promise.all` for emit loop)
- Modify: `lib/social/comments/server-actions.ts:20–33` (single JOIN for `revalidateAuthorReviewListing`)
- Modify: `lib/social/lists/server-actions.ts:307–319` (`reorderListItems` → `UPDATE … FROM (VALUES …)`)
- Modify: `app/(app)/u/[username]/reviews/[slug]/page.tsx` (extract `getReviewPageData()` helper, wrap in `cache()`)
- Test: existing tests still pass

**Acceptance Criteria:**
- [ ] All 6 sequential-await sites use `Promise.all`
- [ ] `reorderListItems` issues 1 UPDATE for any number of items
- [ ] `rerank-recs` INSERT is a single `INSERT ... VALUES (...), (...)` bulk
- [ ] `getReviewPageData()` wrapped in `cache()`; both `generateMetadata` and page body call it
- [ ] Edge functions deployed: `npx supabase functions deploy refresh-fingerprint rerank-recs --project-ref lkrnhddvbqhpzxivpaja`
- [ ] All existing tests still green

**Verify:** `pnpm vitest run && pnpm tsc --noEmit`

```json:metadata
{"files": ["app/(app)/layout.tsx", "supabase/functions/refresh-fingerprint/index.ts", "supabase/functions/rerank-recs/index.ts", "lib/logs/server-actions.ts", "lib/social/comments/triggers.ts", "lib/social/comments/server-actions.ts", "lib/social/lists/server-actions.ts", "app/(app)/u/[username]/reviews/[slug]/page.tsx"], "verifyCommand": "pnpm vitest run && pnpm tsc --noEmit", "acceptanceCriteria": ["all 6 sequential-await sites parallelized", "reorderListItems single UPDATE FROM VALUES", "rerank-recs single bulk INSERT", "review page data cache()-wrapped"]}
```

### Task 15: Client-island reductions

**Goal:** Two ~40-line nav components forced to client just for `usePathname`; one wasteful Supabase client instantiation.

**Files:**
- Modify: `components/layout/nav-tabs.tsx` (server component reading `(await headers()).get('x-pathname')`)
- Modify: `components/settings/sidebar-nav.tsx` (same pattern)
- Modify: `lib/profile/server-actions.ts:27–32` (build `posterUrlFor` URL via `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatars/...` directly; drop the createSupabaseServerClient call)
- Modify: `components/social/connector-pills.tsx` (extract Discord-copy as small client island; pills server-side)
- Test: existing nav/connector tests still pass

**Acceptance Criteria:**
- [ ] `nav-tabs.tsx` and `sidebar-nav.tsx` no longer have `"use client"` directive
- [ ] Both read pathname via header (which middleware sets via `x-pathname`)
- [ ] `posterUrlFor` is pure URL string concat; no Supabase client instantiation
- [ ] `ConnectorPills` ships <2KB of client JS (Discord copy button is the only island)

**Verify:** `pnpm tsc --noEmit && pnpm build`

```json:metadata
{"files": ["components/layout/nav-tabs.tsx", "components/settings/sidebar-nav.tsx", "lib/profile/server-actions.ts", "components/social/connector-pills.tsx"], "verifyCommand": "pnpm tsc --noEmit && pnpm build", "acceptanceCriteria": ["NavTabs + SettingsSidebarNav are server components", "posterUrlFor avoids Supabase client instantiation", "ConnectorPills minimizes client surface"]}
```

### Task 16: Add missing DB indexes

**Goal:** Reports composite index for dedupe lookup; (any other indexes from audit not covered in T11).

**Files:**
- Create: migration `lib/db/migrations/0015_audit_indexes.sql`
- Modify: `lib/db/schema.ts` (declare the index)

**Acceptance Criteria:**
- [ ] `CREATE INDEX reports_target_type_id_status_idx ON reports (target_type, target_id, status)`
- [ ] Schema.ts updated to declare the index
- [ ] Migration applies cleanly to local + applied to live DB

**Verify:** `pnpm tsc --noEmit && psql -f .../0015_audit_indexes.sql --dry-run` (or equivalent)

```json:metadata
{"files": ["lib/db/migrations/0015_audit_indexes.sql", "lib/db/schema.ts"], "verifyCommand": "pnpm tsc --noEmit", "acceptanceCriteria": ["reports composite index created", "schema.ts in sync"]}
```

### Task 17: Drizzle snapshot drift fix + CI gate

**Goal:** Snapshots 0007–0011, 0013 missing from `meta/_journal.json`; recurring across 3 phase boundaries.

**Files:**
- Modify: `lib/db/migrations/meta/_journal.json` (add missing entries)
- Create: `lib/db/migrations/meta/0007_*.json` … `0013_*.json` (snapshot files matching live schema)
- Create: `scripts/check-drizzle-sync.ts` (run `drizzle-kit generate --check` and exit non-zero if drift detected)
- Modify: `package.json` (add `db:check` script)
- Document in `lib/db/README.md` (or create) — when to run, expected output

**Acceptance Criteria:**
- [ ] All 6 missing snapshots regenerated from live schema (use `drizzle-kit introspect` against the live DB OR carefully reconstruct from migration SQL)
- [ ] `_journal.json` complete from 0000 through 0015 (after Task 16)
- [ ] `pnpm db:check` runs `drizzle-kit generate --check` (or equivalent) and reports zero drift
- [ ] README documents the convention

**Verify:** `pnpm db:check`

```json:metadata
{"files": ["lib/db/migrations/meta/_journal.json", "lib/db/migrations/meta/0007_*.json", "lib/db/migrations/meta/0008_*.json", "lib/db/migrations/meta/0009_*.json", "lib/db/migrations/meta/0010_*.json", "lib/db/migrations/meta/0011_*.json", "lib/db/migrations/meta/0013_*.json", "scripts/check-drizzle-sync.ts", "package.json", "lib/db/README.md"], "verifyCommand": "pnpm db:check", "acceptanceCriteria": ["all missing snapshots regenerated", "journal complete", "db:check script exists and passes"]}
```

### Task 18: Env var hygiene

**Goal:** 4 env vars used in code but not in `.env.example` or `lib/env.ts`.

**Files:**
- Modify: `.env.example` (add `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET`, `OPENAI_API_KEY`, `SGDB_API_KEY` with provider-link comments)
- Modify: `lib/env.ts` (add to `serverSchema`)
- Modify: `lib/igdb/client.ts:25`, `lib/igdb/twitch-oauth.ts:42–43` (use `requireEnv` instead of raw `process.env.X`)

**Acceptance Criteria:**
- [ ] All 4 vars in `.env.example` with clear "where to get" comments matching the existing style
- [ ] All 4 vars in `lib/env.ts serverSchema`
- [ ] `lib/igdb/*` uses `requireEnv`; throws clear error if missing
- [ ] `pnpm tsc --noEmit` clean

**Verify:** `pnpm tsc --noEmit && grep -E "IGDB_CLIENT_(ID|SECRET)|OPENAI_API_KEY|SGDB_API_KEY" .env.example | wc -l` returns 4

```json:metadata
{"files": [".env.example", "lib/env.ts", "lib/igdb/client.ts", "lib/igdb/twitch-oauth.ts"], "verifyCommand": "pnpm tsc --noEmit", "acceptanceCriteria": ["IGDB/OPENAI/SGDB env vars added to .env.example", "all 4 added to env.ts serverSchema", "lib/igdb uses requireEnv"]}
```

### Task 19: Dead code sweep

**Goal:** Remove dead `lib/imports/` modules + unused exports + stale comments.

**Files:**
- Delete: `lib/imports/rawg-match.ts`, `scripts/smoke-rawg-match.ts`
- Delete: `lib/imports/merge.ts`, `scripts/smoke-merge.ts`, `tests/unit/imports-merge.test.ts`
- Modify: `lib/imports/adapters/steam.ts`, `lib/imports/adapters/xbox.ts` (drop unused `fetchLibrary`; rename `LibraryImporter` interface to `LibraryConnector`)
- Modify: `lib/mascot/copy.ts:84–119, 166–177`, `lib/mascot/scenarios.ts` (remove unreachable scenarios)
- Modify: `components/mascot/mascot-store.ts:10, 33–39` (drop `reset` from interface and impl)
- Modify: `lib/recs/moods.ts:17, 22, 30` (drop `export` from sub-schemas)
- Modify: `lib/social/notifications/digest.ts:70` (drop `export` if no consumer)
- Modify: `lib/social/lists/triggers.ts` (delete file; inline the no-op comment at the call site)

**Acceptance Criteria:**
- [ ] All deleted files no longer imported anywhere
- [ ] `pnpm tsc --noEmit` clean
- [ ] `pnpm vitest run` green (deleted tests intentional)
- [ ] No `LibraryImporter` references remain (all renamed to `LibraryConnector`)

**Verify:** `pnpm tsc --noEmit && pnpm vitest run`

```json:metadata
{"files": ["lib/imports/rawg-match.ts", "lib/imports/merge.ts", "lib/imports/adapters/steam.ts", "lib/imports/adapters/xbox.ts", "lib/mascot/copy.ts", "lib/mascot/scenarios.ts", "components/mascot/mascot-store.ts", "lib/recs/moods.ts", "lib/social/notifications/digest.ts", "lib/social/lists/triggers.ts"], "verifyCommand": "pnpm tsc --noEmit && pnpm vitest run", "acceptanceCriteria": ["3 dead lib/imports modules deleted", "unused exports removed", "no broken imports remain"]}
```

### Task 20: Recs file hygiene — extract `hydrateRecs` helper

**Goal:** `lib/recs/server-actions.ts` has two near-identical 200-line "select recs, join games, build RecCard" blocks.

**Files:**
- Modify: `lib/recs/server-actions.ts` (extract private `hydrateRecs(rows)` helper; both call sites become 5 lines)
- Test: existing recs tests cover both paths

**Acceptance Criteria:**
- [ ] Single `hydrateRecs(rows)` private helper consumed by both call sites
- [ ] File LOC reduced (~200 lines saved)
- [ ] `pnpm tsc --noEmit` clean
- [ ] Existing recs tests still pass (no behavioral change)
- [ ] `scripts/verify-phase-4.ts` still passes

**Verify:** `pnpm vitest run && pnpm tsx scripts/verify-phase-4.ts`

```json:metadata
{"files": ["lib/recs/server-actions.ts"], "verifyCommand": "pnpm vitest run && pnpm tsx scripts/verify-phase-4.ts", "acceptanceCriteria": ["hydrateRecs helper extracted", "duplicate scaffolding removed", "verify-phase-4 still green"]}
```

### Task 21: Form accessibility sweep

**Goal:** 7+ forms missing labels/fieldsets — quick-log, edit-log, comment composer, report modal, sort dropdown, profile Discord, notification prefs.

**Files:**
- Modify: `components/palette/quick-log-form.tsx:108–160` (use `<fieldset>`+`<legend>` for status group; proper `<label>` for note)
- Modify: `components/game/edit-log-modal.tsx:199–205` (refactor `Field` helper to use `<label>` + `htmlFor`)
- Modify: `components/comments/comment-composer.tsx:42–50` (add `aria-label="Comment"`; render `<p role="alert">` on error)
- Modify: `components/moderation/report-modal.tsx:91–115` (add `<legend className="sr-only">`; `aria-label` for details textarea)
- Modify: `components/library/sort-dropdown.tsx:28–38` (add `aria-label="Sort library by"`)
- Modify: `app/(app)/settings/profile/_profile-form.tsx:306–321` (Discord input: `<label htmlFor="discord">`)
- Modify: `app/(app)/settings/notifications/prefs-form.tsx:114–131` (`<fieldset>`+`<legend>` for "Email me when..." group)

**Acceptance Criteria:**
- [ ] Every form input has either a `<label htmlFor>` or `aria-label`
- [ ] Radio/checkbox groups wrapped in `<fieldset><legend>`
- [ ] Error states announced via `role="alert"` where applicable
- [ ] No raw `<p>{label}</p>` followed by `<input>` patterns remain in the listed files
- [ ] Visual rendering unchanged (legends can be `sr-only`)

**Verify:** Manual A11y tab-through; `pnpm tsc --noEmit && pnpm build`

```json:metadata
{"files": ["components/palette/quick-log-form.tsx", "components/game/edit-log-modal.tsx", "components/comments/comment-composer.tsx", "components/moderation/report-modal.tsx", "components/library/sort-dropdown.tsx", "app/(app)/settings/profile/_profile-form.tsx", "app/(app)/settings/notifications/prefs-form.tsx"], "verifyCommand": "pnpm tsc --noEmit && pnpm build", "acceptanceCriteria": ["all 7 forms have proper labels/fieldsets", "groups have legends", "error states use role=alert"]}
```

### Task 22: Destructive-flow polish + dialog A11y

**Goal:** Native `confirm()` for delete flows; ShareModal/PosterStatusMenu missing focus trap + Esc; hover-only buttons on touch.

**Files:**
- Modify: `components/library/edit-log-modal.tsx:71` (replace `confirm()` with Radix Dialog matching `BlockAction` pattern)
- Modify: `components/comments/comment-card.tsx:40` (replace `confirm()` with Radix Dialog)
- Modify: `components/reviews/delete-review-link.tsx:38–47` (Radix Dialog with consequence enumerated)
- Modify: `components/reviews/section-card.tsx:73` (always-visible action buttons; remove `opacity-0 group-hover:opacity-100`)
- Modify: `components/auth/username-input.tsx:120–138` (add text prefix to color-only signals)
- Modify: `components/taste/share-modal.tsx:83–136` (use Radix Dialog instead of custom div)
- Modify: `components/library/poster-status-menu.tsx` (use Radix DropdownMenu — Esc + outside-click + restore focus)

**Acceptance Criteria:**
- [ ] No `window.confirm()` calls remain in the 3 destructive flows
- [ ] Section card edit/regenerate buttons visible on touch
- [ ] Username availability prefixed with "Available: " / "Unavailable: "
- [ ] ShareModal + PosterStatusMenu use Radix primitives (focus trap + Esc + restore)

**Verify:** `pnpm tsc --noEmit && pnpm build`

```json:metadata
{"files": ["components/library/edit-log-modal.tsx", "components/comments/comment-card.tsx", "components/reviews/delete-review-link.tsx", "components/reviews/section-card.tsx", "components/auth/username-input.tsx", "components/taste/share-modal.tsx", "components/library/poster-status-menu.tsx"], "verifyCommand": "pnpm tsc --noEmit && pnpm build", "acceptanceCriteria": ["native confirm() replaced with Radix Dialog in 3 places", "review section actions always visible", "username availability has text prefix", "ShareModal + PosterStatusMenu use Radix"]}
```

### Task 23: Metadata + OG cards for shareable surfaces

**Goal:** Profile/list/taste/game pages have no `generateMetadata` — share-link unfurls show generic preview.

**Files:**
- Modify: `app/(app)/u/[username]/page.tsx` (add `generateMetadata`)
- Modify: `app/(app)/u/[username]/lists/[listSlug]/page.tsx` (add `generateMetadata`)
- Modify: `app/(app)/u/[username]/taste/page.tsx` (add `generateMetadata`)
- Modify: `app/(app)/games/[slug]/page.tsx` (add `generateMetadata`)
- Create: `app/og/profile/[username]/route.tsx` (OG image route)
- Create: `app/og/list/[id]/route.tsx`
- Create: `app/og/game/[slug]/route.tsx`

**Acceptance Criteria:**
- [ ] Each page returns `{ title, description, openGraph: { images: [...] } }` from `generateMetadata`
- [ ] OG image routes follow the `/og/review/[id]/route.tsx` pattern
- [ ] Title format: `<Subject> · Letterboxd for Games`
- [ ] Description includes meaningful summary (game title + year, list title + count, profile + stat hint, taste tier + top genre)

**Verify:** `pnpm build && curl -I http://localhost:3000/og/profile/itsbryanfam` returns 200

```json:metadata
{"files": ["app/(app)/u/[username]/page.tsx", "app/(app)/u/[username]/lists/[listSlug]/page.tsx", "app/(app)/u/[username]/taste/page.tsx", "app/(app)/games/[slug]/page.tsx", "app/og/profile/[username]/route.tsx", "app/og/list/[id]/route.tsx", "app/og/game/[slug]/route.tsx"], "verifyCommand": "pnpm build", "acceptanceCriteria": ["generateMetadata on profile/list/taste/game pages", "OG routes for each", "title + description + openGraph image present"]}
```

### Task 24: Lists social affordances — like + comment + share

**Goal:** Lists appear in feed, have `notifications.list_liked` events, but list-detail has no like/comment/share buttons.

**Files:**
- Modify: `lib/db/schema.ts` (verify `likes.listId` column exists; add if not — likely needs migration if dormant)
- Create: migration if needed
- Modify: `lib/social/lists/server-actions.ts` (add `toggleListLike`, `getListComments`)
- Modify: `components/lists/list-detail.tsx` (add LikeButton, share button matching review pattern, CommentThread)
- Test: `tests/unit/list-likes.test.ts` (NEW)

**Acceptance Criteria:**
- [ ] `likes.listId` column populated correctly when liking a list
- [ ] List-detail page shows like count + like button
- [ ] List-detail page renders CommentThread (reuses existing component)
- [ ] Share button copies URL + opens tweet intent matching review pattern
- [ ] `notifications.list_liked` actually fires on first like
- [ ] Unit tests cover toggle behavior

**Verify:** `pnpm vitest run tests/unit/list-likes.test.ts`

```json:metadata
{"files": ["lib/db/schema.ts", "lib/social/lists/server-actions.ts", "components/lists/list-detail.tsx", "tests/unit/list-likes.test.ts"], "verifyCommand": "pnpm vitest run tests/unit/list-likes.test.ts && pnpm tsc --noEmit", "acceptanceCriteria": ["likes.listId wired", "list-detail shows like + comment + share", "list_liked notification fires"]}
```

### Task 25: Internal-link + marketing/SEO polish

**Goal:** `<a href>` → `<Link>` audit; marketing footer cleanup; add /robots.ts + /sitemap.ts + /manifest.ts.

**Files:**
- Modify: `components/feed/feed-empty-state.tsx:32–37`, `feed-list.tsx:34–39`, `feed-item-log.tsx`, `feed-item-review.tsx`, `feed-item-list.tsx` (replace `<a href>` with `<Link>`)
- Modify: `app/(app)/settings/connections/page.tsx:73–78` (sync history `<a>` → `<Link>`)
- Modify: `components/imports/import-summary.tsx:179` (drop or implement the dead "Phase 4" anchor)
- Modify: `app/page.tsx:85` (replace "Phase 0 · Foundation · v0.1.0" footer copy)
- Create: `app/robots.ts`, `app/sitemap.ts`, `app/manifest.ts`

**Acceptance Criteria:**
- [ ] No `<a href="/">` for internal routes in feed components
- [ ] Connections sync history uses `<Link>`
- [ ] Marketing footer reads as user-facing (e.g., "Made for game-tracking nerds · v1")
- [ ] `app/robots.ts` allows crawl, points to sitemap
- [ ] `app/sitemap.ts` enumerates public profiles, lists, game slugs
- [ ] `app/manifest.ts` returns name, short_name, theme_color from `--accent`, icons

**Verify:** `pnpm build && curl http://localhost:3000/robots.txt && curl http://localhost:3000/sitemap.xml`

```json:metadata
{"files": ["components/feed/feed-empty-state.tsx", "components/feed/feed-list.tsx", "components/feed/feed-item-log.tsx", "components/feed/feed-item-review.tsx", "components/feed/feed-item-list.tsx", "app/(app)/settings/connections/page.tsx", "components/imports/import-summary.tsx", "app/page.tsx", "app/robots.ts", "app/sitemap.ts", "app/manifest.ts"], "verifyCommand": "pnpm build", "acceptanceCriteria": ["internal <a href> → <Link>", "marketing footer cleaned up", "robots/sitemap/manifest exist"]}
```

---

## Final close-out

After all 25 tasks land:

- [ ] Run full test suite: `pnpm vitest run` (must be green)
- [ ] Run full type-check: `pnpm tsc --noEmit` (must be clean)
- [ ] Run `pnpm build` (must succeed — catches Next.js 16 server-action validation regressions)
- [ ] Run all phase verifies: `pnpm tsx scripts/verify-phase-3.ts && pnpm tsx scripts/verify-phase-4.ts && pnpm tsx scripts/verify-phase-5.ts`
- [ ] Manual smoke: hit `/play-next`, `/home/feed`, `/u/{me}`, `/u/{me}/taste`, `/notifications`, `/discover/people`, `/settings/*`
- [ ] Apply migrations to live DB via Supabase MCP (`mcp__supabase__apply_migration`)
- [ ] Deploy Edge functions: `npx supabase functions deploy refresh-fingerprint rerank-recs --project-ref lkrnhddvbqhpzxivpaja`
- [ ] Merge `audit-fixes-2026-05-14` to `main`; push
- [ ] Tag: `git tag audit-fixes-2026-05-14`
- [ ] Write memory file: `audit_fixes_2026_05_14.md` summarizing what landed
- [ ] Verify production: hit `letterboxd-for-games.vercel.app` after deploy lands

---

## Self-review notes

- **Spec coverage:** Every Tier 1 finding (S1–S3, F1–F5, P1–P4) maps to at least one task. Tier 2 P1 findings folded into sweep tasks (T12–T25).
- **No placeholders:** Each task has concrete file paths and acceptance criteria. Steps describe HOW, not just WHAT.
- **Type consistency:** `targetHref`, `viewerFollows`, `getBlockedPairs`, `hydrateRecs` named consistently across tasks.
- **Out-of-scope items explicitly listed in spec:** Edge function vendoring deduplication (D2), all Tier 3 polish.
