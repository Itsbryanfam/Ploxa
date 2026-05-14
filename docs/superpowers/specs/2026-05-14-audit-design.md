# Codebase audit fixes — 2026-05-14 design

## Overview

Comprehensive audit run on 2026-05-14 covered all surface area shipped since `whole-app-audit-2026-05-11`: Phase 4 (Taste + Recs), Phase 5 (Social Layer), production launch fixes, settings overhaul, and IGDB integration. Four parallel auditors (dead code, bugs/security, performance, UX/accessibility) returned ~80 distinct findings, of which ~12 are critical (P0) and ~50 are important (P1).

This spec defines the fix scope: **all Tier 1 critical and Tier 2 important findings**, grouped into 25 coherent task units to land on branch `audit-fixes-2026-05-14`.

## Methodology

- 4 parallel `general-purpose` subagents, each given non-overlapping audit dimensions and the list of recently-shipped surface area
- Findings cross-validated where multiple agents flagged the same root cause (notification routing, avatarUrl drift, undefined CSS vars, candidatePool full-scan all confirmed by ≥2 agents)
- Top P0 security claims verified by direct file read before being accepted into the fix scope
- Tier 3 polish (40+ small items) deferred to a follow-up plan

## Tier 1 — Critical findings (verified)

### Security (verified P0)

| # | Location | Issue |
|---|---|---|
| S1 | `lib/logs/server-actions.ts:127` | `ensureLog` is `"use server"` and accepts caller-supplied `userId` with no ownership check — RPC-callable to write logs to any user's library |
| S2 | `lib/taste/server-actions.ts:47` | `getFingerprint(userId)` is `"use server"` and bypasses the `/u/[username]/taste` page-level visibility gate via direct RPC, leaking taste vectors + AI narrative for any UUID |
| S3 | `lib/settings/data-export.ts:91` | "PII redaction" comment is wrong — `comments_received[].author.user_id` includes other users' UUIDs, handing attackers a list of valid targets to exploit S1/S2 |

### Functional bugs (P0)

| # | Location | Issue |
|---|---|---|
| F1 | `components/notifications/notification-row.tsx:24` | All non-follow notifications dead-end at `/home/feed` (TODO never resolved); re-engagement loop broken |
| F2 | `lib/db/schema.ts:107` (dormant column) read by 7 Phase 5 sites | `profiles.avatarUrl` is documented dormant but Phase 5 reads it everywhere; avatars never render in feed/comments/notifications |
| F3 | `app/globals.css` + 16 consumer files | `--text-muted`, `--border-hover`, `--accent-fg` used widely but undefined; Settings/Connections/Privacy/Feed look broken |
| F4 | `components/discovery/similar-users-row.tsx:62` | Hardcoded `initialIsFollowing={false}` — already-followed users see "Follow" button on /discover/people |
| F5 | Missing | No root `app/error.tsx` / `app/global-error.tsx` / `app/not-found.tsx` — unhandled errors and unknown URLs render Next.js's default broken-looking UI |

### Performance (P0)

| # | Location | Issue |
|---|---|---|
| P1 | `lib/recs/candidate-pool.ts:102` | Full `games`-table scan on every `/play-next` cache miss; dot-products in JS; flagged in code as deferred fix |
| P2 | `lib/social/feed/queries.ts:147` | `isBlockedBetween` called sequentially per feed row (50 RTTs = 250–750ms per /home/feed render) |
| P3 | `lib/social/_shared/profile-summary.ts:102` | Profile library query has no LIMIT — 1000-log user ships 1000 game-cover URLs to render 12 |
| P4 | `components/moderation/reports-queue.tsx:36` | Mods see raw UUIDs not the reported content — moderation functionally broken |

## Tier 2 — Important findings (sweep targets)

### Security P1

- S4: comment thread missing `withBlockedFilter` — `app/(app)/u/[username]/reviews/[slug]/page.tsx:117`
- S5: `getProfileByUsername`/`getProfileByUserId` leak private bio via RPC — `lib/profile/server-actions.ts:61`
- S6: digest cron emails soft-deleted users — `app/api/internal/digest/run/route.ts:52`
- S7: trending feed surfaces soft-deleted users' reviews — `lib/social/discovery/trending-reviews.ts:52`
- S8: `editComment` creates spurious `auto_flagged` reports when UPDATE no-ops — `lib/social/comments/server-actions.ts:154`
- S9: `lib/db/index.ts` missing `import "server-only"`
- S10: `refillRecs` uses `.parse()` not `.safeParse()` — `lib/recs/server-actions.ts:770`
- S11: `CRON_SECRET` compared with `!==` not constant-time — `app/api/internal/digest/run/route.ts:38`
- soft-delete misses in `mention resolver` (`lib/social/comments/mentions.ts:31`) and `popular-games` (`lib/social/discovery/popular-games.ts:38`)

### Performance P1 (15 items, sweep groups)

- **Sequential awaits**: `(app)/layout.tsx:29`, `refresh-fingerprint:103`, `rerank-recs:85`, `logs/server-actions.ts:204`, `comments/triggers.ts:57`, `comments/server-actions.ts:20`
- **Bulk operations**: `reorderListItems` (500 sequential UPDATEs), `rerank-recs` (5 sequential INSERTs in txn)
- **Missing LIMIT**: comments thread, followers/following pagination
- **Cache wraps**: `reviews/[slug]/page.tsx` `generateMetadata` + body double-fetch
- **Forced client islands**: `NavTabs`, `SettingsSidebarNav` (only need `usePathname`; middleware exposes `x-pathname`)
- **Wasteful client instantiation**: `lib/profile/server-actions.ts:27` (full Supabase client for string concat)
- **Missing `loading.tsx`**: 11 high-traffic Phase 5 routes
- **Missing index**: `reports(target_type, target_id, status)` composite

### Dead code / drift P1

- D1: Drizzle migration snapshot chain broken — snapshots 0007–0011, 0013 missing from `meta/_journal.json`. Recurring across 3 phase boundaries.
- D2: ~1,800 LOC of edge-function vendoring (`igdb-engine.ts`, `import-engine.ts`, `taste-engine.ts`, `prompts.ts`, `ai-router.ts`) with confirmed naming drift between `prompts.ts` and `taste-engine.ts`
- D3: Three dead `lib/imports/` modules (`rawg-match.ts`, `merge.ts`, adapter `fetchLibrary` methods) — only smoke-tested in `lib/`, vendored into Edge engine
- D4: Missing from `.env.example`: `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET`, `OPENAI_API_KEY`, `SGDB_API_KEY`
- D5: Stale `T26` references in 3 files
- D6: 3 uncoordinated cron migrations (no consolidating apply script)
- D7: `(app)/play-next/_client.tsx` at 393 LOC mixing concerns
- D8: `lib/recs/server-actions.ts` at 789 LOC with two near-identical hydration blocks

### UX / accessibility P1 (25 items, top priority)

- 7+ forms missing labels/fieldsets (quick-log, edit-log, comment composer, report modal, sort dropdown, profile Discord, notification prefs)
- Phase 4 surface uses raw `zinc-*`/`emerald-*` Tailwind classes — two visual languages in one app
- Missing `generateMetadata` on shareable pages: profile, lists, taste, games
- WCAG AA fail: `--text-faint` (#5a5a70) on `--bg-card` (#16161f) = 4.27:1 (needs 4.5:1)
- Avatar fallback alt-text leaks email
- Notification row `<li onClick>` no keyboard support — fails WCAG 2.1.1
- Hover-only edit/regenerate buttons broken on touch
- Username availability uses color-only pass/fail (RG colorblindness)
- Native `confirm()` for destructive flows
- Lists missing like/comment/share affordances
- Account-deleted/unsubscribe pages have no header/nav
- Marketing footer leaks "Phase 0 · Foundation · v0.1.0"
- Missing files: `app/robots.ts`, `app/sitemap.ts`, `app/manifest.ts`

## Tier 3 — Polish (deferred)

40+ smaller items: keyboard shortcuts beyond ⌘K, year-in-review surface, list-deletion UI, mobile menu missing Notifications + What-to-Play, comment thread depth=1 only, follow-back indicator, notification grouping, undo for destructive actions, share buttons on review cards, "Currently playing" on profile, Discover sort/filter chips, screenshot gallery alt text duplication, milestone-toast emerald color clashing with accent, `EditLogModal` close button using Unicode `×`, login form mode toggle role, `/lists/new` immediate-create, comment thread depth, etc.

These are tracked but explicitly out of scope for this branch. They can be addressed in a follow-up plan if/when polish becomes a priority over feature work.

## Systemic patterns (root causes)

These motivate grouping fixes rather than addressing one finding at a time:

1. **`"use server"` files have public RPC surface that wasn't fully internalized.** Three actions (`ensureLog`, `getFingerprint`, `getProfileByUsername`) take a `userId` parameter and trust it. Pattern fix: add a convention doc + sweep to ensure every `"use server"` action derives sensitive identity from session, not args.

2. **Soft-delete coverage incomplete.** Phase 5 sweep landed 2026-05-13 but at least 4 read paths skip the filter. Pattern fix: a helper or a one-time audit + add a `selectActiveProfiles()` wrapper.

3. **Edge-function vendoring is unsustainable.** ~1,800 LOC of "keep in sync" mirror code with confirmed drift. **Out of scope for this branch** — needs its own design (codegen vs canonical TS), but flagged here so future work is explicit.

4. **Migration snapshot chain breakage is recurring.** Three phase boundaries broken. Pattern fix: a one-line CI gate.

5. **Phase 4 has its own visual language.** Pattern fix: var-find-replace sweep.

6. **Form accessibility was systematically skipped.** Pattern fix: add a `<Field>` primitive.

7. **PII leaks have repeated shape** (email-as-display-name fixed in production launch; same shape in avatar alt + data-export commenter UUID + private profile bio leak). Pattern fix: a "what NOT to expose to non-owners" checklist + sweep.

## Acceptance criteria

The `audit-fixes-2026-05-14` branch is complete when:

1. All 25 implementation tasks (T01–T25) are committed
2. `pnpm vitest run` passes (133+ unit tests; new tests added for security fixes)
3. `pnpm tsc --noEmit` clean
4. `pnpm build` succeeds (catches Next.js 16 server-action validation regressions)
5. `pnpm verify-phase-{3,4,5}` all green (existing gates still satisfied)
6. Manual smoke check: `/play-next`, `/home/feed`, `/u/{me}`, `/u/{me}/taste`, `/notifications`, `/discover/people`, `/settings/*` all render and key flows work
7. Memory file `audit_fixes_2026_05_14.md` written summarizing what landed

## Out of scope (explicit)

- Edge-function vendoring deduplication (D2) — needs its own design
- All Tier 3 polish items
- Architectural refactors (file splits beyond the explicit `hydrateRecs` extraction)
- New features beyond the lists like/comment/share affordance (which is a P1 UX gap, not a feature)
- Replacing Framer Motion (per "no visual loss" constraint)
- Adding test infra (CI, Playwright additions) — these are tracked separately

## Branch state at start

- Branch: `audit-fixes-2026-05-14` cut from `main` at `d9f1054`
- Working tree clean
- Production at `letterboxd-for-games.vercel.app` is healthy
