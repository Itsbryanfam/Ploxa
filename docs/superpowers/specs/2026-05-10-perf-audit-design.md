# Performance Audit Design — Post-Phase-1.5 Optimization Pass

**Date:** 2026-05-10
**Status:** Spec — awaiting user review before plan writing
**Predecessor:** [2026-05-10-phase1.5-baseline.md](../perf/2026-05-10-phase1.5-baseline.md) (Phase 1.5 baseline + applied fixes)

---

## Context

Phase 1.5 closed on 2026-05-10 with three perf fixes landed via static analysis (image unoptimized, TanStack initialData freshness, dashboard double-scan dedup). All empirical numbers in that baseline remain **TBD** — the fixes are correctness-verified but not measured.

This audit is the next pass. The user is away from their PC and cannot run DevTools / Chrome Network tab interactively. The constraint set is:

1. **No empirical measurement loop is possible.** Work is entirely static-analysis-driven.
2. **Zero UI/UX impact.** Animation feel, scroll behavior, visual fidelity, and interaction patterns must remain identical. No virtualization, no pagination, no streaming-induced load-order changes, no animation-engine swaps.
3. **Maximum perf within that envelope.** Apply every UI/UX-neutral optimization we can ground in source code.

Phase 1.5 proved out a working pattern in this codebase: atomic per-fix commits + a baseline doc that gets its "applied fixes" appendix filled in as work lands. This audit follows the same shape.

---

## Approach

**Approach B — Tiered batches, ranked by risk.** Optimizations grouped into five tiers, each shipped as its own commit (or small commit cluster), with Tier 5 documenting deliberately-rejected items so the spec is a defensible record of what was considered.

Two alternatives were considered and rejected:
- **Approach A (single big PR):** Faster but harder to attribute or revert.
- **Approach C (bundle-analyzer-first):** Folded into Tier 4 instead of being its own approach — we ship the analyzer alongside other config changes and use its output to inform follow-up work.

---

## Tier 1 — Server-side cleanup

Zero UI risk. Every change preserves bytes-identical user-facing behavior. Five atomic commits, all in `lib/` or `app/(app)/`.

### 1.1 — Remove redundant `findFirst` pre-INSERT in `createLog`

- **File:** [lib/logs/server-actions.ts:61-70](../../../lib/logs/server-actions.ts)
- **Problem:** `createLog` does a `SELECT … LIMIT 1` to detect duplicate logs, then `INSERT` wrapped in a `try/catch` for SQLSTATE `23505`. The SELECT is redundant — the existing unique index `logs_user_game_replay_uniq` enforces the invariant, and the catch path already maps `23505` to the same friendly error.
- **Fix:** Delete the `findFirst` call and the `if (existing)` short-circuit. Keep the unique-violation catch block — it handles both the previously-existing case and the race-condition case identically.
- **Behavior delta:** None. Same error message (`"Already logged. Edit the existing log instead."`), same error envelope, same DB invariant.
- **Impact:** One DB round-trip per `createLog` instead of two. ~50% latency reduction on log-creation writes.
- **Verification:** Add a log twice through the UI; second attempt should still display the "Already logged" toast. Unit-test parity preserved.
- **Risk:** None.
- **Effort:** ~5 lines deleted.

### 1.2 — React `cache()` wrapper for `supabase.auth.getUser()`

- **Files (14 call sites, verified via grep):**
  - [lib/logs/server-actions.ts](../../../lib/logs/server-actions.ts) — lines 46, 113, 183, 206, 228, 273, 322
  - [lib/profile/server-actions.ts](../../../lib/profile/server-actions.ts) — lines 85, 197
  - [lib/profile/avatar-actions.ts:31](../../../lib/profile/avatar-actions.ts)
  - [app/(app)/layout.tsx:29](../../../app/(app)/layout.tsx)
  - [app/page.tsx:15](../../../app/page.tsx)
  - [app/(app)/games/[slug]/page.tsx:25](../../../app/(app)/games/[slug]/page.tsx)
  - [app/(app)/@modal/(.)games/[slug]/page.tsx:28](../../../app/(app)/@modal/(.)games/[slug]/page.tsx)
  - [app/(app)/u/[username]/page.tsx:26](../../../app/(app)/u/[username]/page.tsx)
  - [app/(app)/settings/page.tsx:10](../../../app/(app)/settings/page.tsx)
- **Excluded:** [lib/supabase/middleware.ts:39](../../../lib/supabase/middleware.ts) — different lifecycle (edge middleware, runs before React tree). Leave as-is.
- **Problem:** A typical `/home` request walks middleware → app layout → Server Component → 2-3 server actions. Each server action and each layout/page Server Component independently calls `supabase.auth.getUser()`, which hits the Supabase auth endpoint to verify the JWT. On `/home`: 4+ independent verifications for one page render.
- **Fix:** Create `lib/supabase/auth-cache.ts`:
  ```ts
  import "server-only";
  import { cache } from "react";
  import { createSupabaseServerClient } from "./server";

  export const getCachedUser = cache(async () => {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  });
  ```
  Replace all 14 inline call sites with `const user = await getCachedUser();`. React's `cache()` provides per-request memoization — first call hits Supabase; subsequent calls within the same request return the cached promise.
- **Behavior delta:** None for the user. Server-side: 3+ fewer auth verifications per page load on protected routes.
- **Impact:** Removes ~20-80ms of cumulative round-trip latency per protected page render (highly dependent on Supabase pooler warmth).
- **Verification:** Add a one-time `console.log("auth verify")` inside `getCachedUser` in dev; cold-load `/home`; confirm one log line per request (not four). Remove the console.log before commit.
- **Risk:** Very low. `cache()` is per-request and cannot leak across users. The Supabase client itself is also per-request (created fresh in `createSupabaseServerClient`).
- **Effort:** Medium — one new helper file, 14 mechanical call-site swaps.

### 1.3 — Derive recent activity from already-fetched library on dashboard

- **File:** [app/(app)/_cockpit/cockpit-dashboard.tsx:38-41](../../../app/(app)/_cockpit/cockpit-dashboard.tsx)
- **Problem:** Dashboard fan-out does `Promise.all([getUserLibrary({}), getRecentActivity(10)])`. Both queries are `SELECT logs JOIN games WHERE userId = ? ORDER BY updatedAt DESC` — the second just adds `LIMIT 10`. The first 10 entries of `library` *are* the activity feed.
- **Fix:** Add a `computeRecentActivityFromLibrary(library: LibraryItem[]): ActivityEvent[]` helper inside the dashboard file (mirroring the existing `computeUserStatsFromLibrary` pattern from commit `3d81bac`). Map `library.slice(0, 10)` to `ActivityEvent` shape. Drop the `getRecentActivity(10)` call from the dashboard's `Promise.all`.
- **Preserve:** The `getRecentActivity` export stays in `lib/logs/server-actions.ts` for future callers (profile pages, notification feed) that don't have a pre-loaded library.
- **Behavior delta:** None. Same `ActivityEvent` shape, same sort order, same 10-item bound.
- **Impact:** Saves one full logs-JOIN-games query per `/home` load. Combined with Tier 1.2, dashboard goes from "3 auth + 2 DB queries" to "1 auth + 1 DB query".
- **Verification:** Server log (Next.js dev console) should show one fewer logs query per `/home` render. Activity timeline shows identical items in identical order.
- **Risk:** None — same pattern as already-merged Phase 1.5.15c.
- **Effort:** Tiny — ~15 lines of mapper code.

### 1.4 — Move `isPrivate` filter from JS into SQL on public profile page

- **File:** [app/(app)/u/[username]/page.tsx:30-63](../../../app/(app)/u/[username]/page.tsx)
- **Problem:** The public profile page fetches all logs for the profile owner, then filters out private logs in JS for non-owner viewers:
  ```ts
  const rows = await db.select(...).where(eq(logs.userId, profile.userId)).orderBy(...);
  const items = rows.filter((r) => isOwn || !r.log.isPrivate).map(...);
  ```
  Private rows traverse the database → Node.js boundary only to be discarded.
- **Fix:** Push the filter into the WHERE clause:
  ```ts
  .where(and(
    eq(schema.logs.userId, profile.userId),
    isOwn ? undefined : eq(schema.logs.isPrivate, false),
  ))
  ```
  Remove the JS `.filter()` step.
- **Behavior delta:** None for the user. Privacy semantics identical (private logs still hidden from non-owners; owners still see everything).
- **Impact:** Smaller payload over the wire when private logs exist. Eliminates a JS filter pass that scales with the user's log count.
- **Verification:** Visit a profile with mixed public/private logs as both owner and non-owner; verify owner sees all, non-owner sees only public.
- **Risk:** None.
- **Effort:** One line changed.

### 1.5 — Tighter column projection on `getProfileByUsername`

- **File:** [lib/profile/server-actions.ts:55-60](../../../lib/profile/server-actions.ts)
- **Problem:** `findFirst` without a `columns:` projection fetches all 11 profile columns. Verified via grep: the only production caller is [app/(app)/u/[username]/page.tsx:19](../../../app/(app)/u/[username]/page.tsx), which accesses only `profile.userId`, `profile.username`, `profile.displayName`, and `profile.bio`.
- **Fix:** Add explicit `columns:` projection matching actual caller usage:
  ```ts
  const profile = await db.query.profiles.findFirst({
    where: eq(schema.profiles.username, username),
    columns: {
      userId: true,
      username: true,
      displayName: true,
      bio: true,
    },
  });
  ```
- **Behavior delta:** None. Unused fields (dormant `avatarUrl`, `profilePictureUrl`, `profilePictureKind`, `mascotVariant`, `isPublic`, `createdAt`, `updatedAt`) were not consumed by callers.
- **Impact:** Minor — Postgres TOAST'd text fields are already lazy-fetched. Mainly a clarity/maintainability win, with a small wire-format reduction.
- **Verification:** Public profile page renders identically.
- **Risk:** None. If a future caller needs more fields, the projection extends naturally.
- **Effort:** ~5 lines.

### Tier 1 summary

| # | Change | DB queries saved per request | Net code delta |
|---|---|---|---|
| 1.1 | `createLog` dedup | 1 SELECT per log-create | −5 lines |
| 1.2 | `cache()` auth | 3+ JWT verifies on `/home`, 2+ on `/library`, similar elsewhere | +1 file, 14 sites simplified |
| 1.3 | Activity from library | 1 logs-JOIN query per `/home` load | +15 lines |
| 1.4 | SQL `isPrivate` filter | Bytes-over-wire when private logs exist | +1 line |
| 1.5 | Column projection | Minor; clarity win | +5 lines |

Cumulative impact on a `/home` cold load: from ~4 auth verifies + 3 DB queries → 1 auth verify + 1 DB query.

---

## Tier 2 — Database schema additions

Zero app-code risk. Two additive composite indexes, one Drizzle migration, no code changes outside `schema.ts`.

### 2.1 — Composite index `logs(user_id, updated_at DESC)`

- **File:** [lib/db/schema.ts:132-157](../../../lib/db/schema.ts)
- **Query pattern accelerated:** `WHERE userId = ? ORDER BY updatedAt DESC` — used by every default `/library` load, every `/home` load (via `getUserLibrary({})`), every `/u/[username]` page, and `getRecentActivity` (until Tier 1.3 lands).
- **Problem today:** Postgres uses the existing `(userId, gameId, isReplay)` unique index via left-prefix for the WHERE filter, then has a separate sort step for `ORDER BY updatedAt DESC` because that column isn't in the index. With 200+ logs per user, that's a real in-memory sort on every read.
- **Fix:**
  ```ts
  // inside pgTable("logs", { ... }, (table) => ({
  //   userGameIdx: uniqueIndex("logs_user_game_replay_uniq")...
  // + userUpdatedAtIdx: index("logs_user_updated_at_idx").on(table.userId, desc(table.updatedAt)),
  // }))
  ```
- **Behavior delta:** None. Query results identical.
- **Risk:** Low. Indexes increase INSERT/UPDATE cost (~5-15% each); see "Migration & rollout" below.

### 2.2 — Composite index `logs(user_id, status, updated_at DESC)`

- **File:** [lib/db/schema.ts:132-157](../../../lib/db/schema.ts)
- **Query pattern accelerated:** `WHERE userId = ? AND status = ? ORDER BY updatedAt DESC` — triggered every time a user clicks a `FilterChip` on `/library`.
- **Problem today:** No index covers both filter and sort together. Postgres uses the unique index for the userId filter, then in-memory filters by status, then sorts by updatedAt.
- **Fix:**
  ```ts
  // + userStatusUpdatedIdx: index("logs_user_status_updated_at_idx").on(
  //     table.userId, table.status, desc(table.updatedAt)),
  ```
- **Behavior delta:** None. Filter-chip queries become single index scans.

### Migration & rollout notes

1. **`pnpm db:generate` produces the migration SQL.** Review before applying — confirm only two `CREATE INDEX` statements appear; no inadvertent table or column changes.
2. **`CREATE INDEX` briefly locks writes on `logs`.** Sub-second on current low-traffic Supabase DB; effectively unmeasurable. If traffic grows, switch to `CREATE INDEX CONCURRENTLY` by hand-editing the migration file (Drizzle doesn't emit `CONCURRENTLY` by default).
3. **Run `ANALYZE logs;` after migration.** Postgres won't use the new indexes optimally until its statistics are refreshed. Drizzle migrations don't emit this; hand-add it to the migration file or run it manually post-migration via `db:studio`.
4. **Write-cost trade-off.** Going from 1 index (the unique) to 3 indexes on `logs` adds ~20-30% to INSERT/UPDATE cost. For a read-heavy app, this is the right trade.

### What we're *not* indexing (and why)

| Considered | Skipped because |
|---|---|
| `logs(user_id, rating DESC NULLS LAST)` for rating-sort | In-memory sort of 200-2000 rows is sub-millisecond at current scale. Add when measurement proves it's a hotspot. |
| `logs(game_id)` for "who else played X" | No query path uses it today (Phase 2+ feature). Premature. |
| FK indexes on `reviews.*`, `comments.*`, `notifications.*` | Those tables aren't queried yet — schema-only. Add when their consumer code lands. |
| `game_aliases(alias)` for search fallback | Search routes through Redis-cached RAWG, not the alias table. Not a hotspot. |

---

## Tier 3 — Client polish

Zero UI/UX risk. Four items, all behavior-preserving.

### 3.1 — `React.memo` on `LibraryPoster` and hot leaf SVG components

- **Files:** [components/library/library-poster.tsx](../../../components/library/library-poster.tsx), [components/pixel/hearts.tsx](../../../components/pixel/hearts.tsx), [components/pixel/status-icons.tsx](../../../components/pixel/status-icons.tsx), [components/pixel/platform-icons.tsx](../../../components/pixel/platform-icons.tsx), [components/mascot/mascot.tsx](../../../components/mascot/mascot.tsx), [components/ui/status-badge.tsx](../../../components/ui/status-badge.tsx)
- **Problem:** 50-200 `LibraryPoster` instances each contain nested static SVG components. When a poster's local `menuOpen` toggles, every child SVG re-renders for no reason. When the parent re-validates from TanStack with identical data, every poster re-renders.
- **Fix:** Wrap each component in `React.memo()`:
  ```tsx
  export const LibraryPoster = memo(function LibraryPoster({ item }: Props) {
    // existing body
  });
  ```
- **Behavior delta:** None. `React.memo` does shallow props comparison; if props are referentially equal, it skips re-render. Same render output, same effects, same accessibility.
- **Risk:** None. Memo is a fast-path optimization; falling through is the current behavior.
- **Effort:** Trivial — one wrap per component.

### 3.2 — `priority` prop on the first visible poster (LCP hint)

- **Files:** [components/library/library-shelf.tsx:37-39](../../../components/library/library-shelf.tsx), [components/library/library-poster.tsx:27-33](../../../components/library/library-poster.tsx)
- **Problem:** The LCP image on `/library` shelf view is the first poster's cover. Today every `<Image>` lazy-loads, including the first.
- **Fix:** Thread `priority` from `LibraryShelf` down to `LibraryPoster`, applied only to the first index:
  ```tsx
  // library-shelf.tsx — change the map to:
  {items.map((item, i) => (
    <LibraryPoster key={item.logId} item={item} priority={i === 0} />
  ))}

  // library-poster.tsx — accept and pass through:
  export const LibraryPoster = memo(function LibraryPoster({
    item, priority = false,
  }: { item: LibraryItem; priority?: boolean }) {
    // ...
    <Image src={item.game.coverUrl} alt={...} fill sizes={...} priority={priority} />
  });
  ```
  Also apply the same `priority={i === 0}` pattern in `library-list.tsx` (for list view's first row) and `status-stacks.tsx` (for the first poster in the first stack).
- **Behavior delta:** First image preloads. Visually identical otherwise. Better LCP on `/library`.
- **Risk:** None. `priority` is a Next.js built-in for exactly this case.
- **Effort:** Trivial — three prop additions across three files (shelf, list, stacks).

### 3.3 — `next/dynamic` for `react-easy-crop`

- **File:** [components/settings/avatar-uploader.tsx:4](../../../components/settings/avatar-uploader.tsx)
- **Problem:** `react-easy-crop` (~45KB gzip) is eagerly imported on every `/settings` page visit, including for users who never edit their avatar. Cropper code blocks initial settings hydration even when the crop dialog isn't open.
- **Fix:** Convert to `next/dynamic` with SSR disabled:
  ```tsx
  import dynamic from "next/dynamic";
  const Cropper = dynamic(() => import("react-easy-crop"), {
    ssr: false,
    loading: () => null,
  });
  ```
- **Behavior delta:** None visible. The cropper renders inside `<Dialog open={imageDataUrl !== null}>`, which is closed until file pick. The file-read (`FileReader.readAsDataURL`) takes ~50-200 ms, masking the dynamic chunk fetch.
- **Risk:** Very low. Verify on a throttled dev network: dialog opens, cropper appears within a few hundred ms — same perceived flow.
- **Effort:** ~3 lines changed.

### 3.4 — `content-visibility: auto` on library grid items

- **Files:** [components/library/library-poster.tsx:16-22](../../../components/library/library-poster.tsx) (className on outer `motion.div`), [components/library/library-list.tsx](../../../components/library/library-list.tsx) (className on row wrapper).
- **What it does:** Tells the browser to skip layout/paint for off-viewport items. DOM stays intact — Ctrl+F, accessibility tools, and scroll-anchoring all unchanged. When the user scrolls an item into view, the browser layouts/paints it on the fly.
- **Fix:** Add a CSS class:
  ```css
  /* In app/globals.css or a co-located stylesheet */
  .lib-item-cv {
    content-visibility: auto;
    contain-intrinsic-size: 0 240px;
  }
  ```
  `contain-intrinsic-size` prevents scrollbar jumps by reserving an estimated height for off-viewport items (240px is a rough estimate for a 140px-wide 2:3-aspect poster; adjust if visually wrong). Apply the class to:
  - `LibraryPoster`'s outer `motion.div` (the per-item wrapper inside `LibraryShelf`'s grid).
  - The row wrapper in `LibraryList`'s items.
  - **Not** to `LibraryShelf`'s parent `motion.div layout` ([library-shelf.tsx:29-30](../../../components/library/library-shelf.tsx)) — that's the grid container itself; applying `content-visibility` there would hide the whole grid until scroll.
- **Interaction with Framer Motion:** `LibraryShelf` wraps the grid in `motion.div layout` and `AnimatePresence mode="popLayout"` for poster enter/exit on filter changes. The parent's `layout` tracks the grid's own bounding box (defined by `grid-template-columns`), which is independent of children's content visibility. Per-item `content-visibility: auto` should not affect parent layout-tracking.
- **Behavior delta:** None visible. Same scroll behavior, same animations on entry, same visual feel. Initial render skips layout work for items below the fold.
- **Risk:** Low-medium. Framer Motion's `layoutId` morph (poster → game-detail modal) uses `getBoundingClientRect()`. The morph only triggers when the user clicks a poster (which is by definition in-view at click time, so `content-visibility` has resolved to "visible"), so this should be a non-issue, but warrants visual verification of the poster-to-modal morph on a scrolled library.
- **Effort:** Tiny — one CSS rule + classNames on two wrappers.
- **Fallback if morph breaks:** Scope `content-visibility: auto` to `LibraryList` only (no `layoutId` there). Shelf view loses this optimization but retains the morph.

### What we considered but dropped from Tier 3

- **`useDeferredValue` to replace `useDebounced` in palette search.** Vetoed: would fire RAWG searches on most keystrokes under low load (5× more API calls per typing session). Current 250 ms debounce is deliberate API rate-limiting.
- **`<Link prefetch={false}>` on posters.** Vetoed: Next.js 16 auto-decides prefetch per route. `/games/[slug]` is dynamic, so prefetch fires on hover by default — already correct behavior.

---

## Tier 4 — Build config & bundle analyzer

Zero runtime risk. Touches only `next.config.ts` and `package.json`. Provides a measurement source (the bundle analyzer outputs static HTML I can read) and applies high-confidence config defaults.

### 4.1 — Add `@next/bundle-analyzer`

- **Files:** [package.json](../../../package.json), [next.config.ts](../../../next.config.ts)
- **Install:** `pnpm add -D @next/bundle-analyzer`
- **Script:**
  ```json
  "scripts": {
    "analyze": "ANALYZE=true next build"
  }
  ```
- **Wrap config:**
  ```ts
  import bundleAnalyzer from "@next/bundle-analyzer";
  const withBundleAnalyzer = bundleAnalyzer({ enabled: process.env.ANALYZE === "true" });
  // ...
  export default withBundleAnalyzer(nextConfig);
  ```
- **Behavior delta:** None for the live app. `ANALYZE=true` is opt-in.
- **What it unlocks:** After running `pnpm analyze` once, `.next/analyze/client.html` and `.next/analyze/server.html` show treemaps of bundle composition. Findings can drive follow-up commits.
- **Risk:** None.
- **Effort:** Tiny.

### 4.2 — `next.config.ts` enhancements

- **File:** [next.config.ts](../../../next.config.ts)
- **Current state:** 9 lines, only `remotePatterns` configured.
- **Additions:**

  **(a) AVIF + longer image cache:**
  ```ts
  images: {
    remotePatterns: [{ protocol: "https", hostname: "media.rawg.io" }],
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24 * 30, // 30 days
  },
  ```
  - AVIF is typically 20-50% smaller than WebP for photographic content (game covers). Next.js negotiates per-request via `Accept` header.
  - 30-day `minimumCacheTTL` prevents re-encoding the same RAWG image on every cache miss. RAWG URLs are immutable — long cache is safe.

  **(b) Barrel-import optimization:**
  ```ts
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "framer-motion",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-slot",
    ],
  },
  ```
  Next.js rewrites `import { X } from 'pkg'` to direct deep imports, preventing whole-library inclusion. Next 15+ auto-optimizes many packages; explicit listing guarantees the rewrite.

  **(c) Strip console.* in production:**
  ```ts
  compiler: {
    removeConsole: { exclude: ["error", "warn"] },
  },
  ```
  Removes `console.log`/`.info`/`.debug` from the prod bundle; keeps `.error`/`.warn` for runtime debugging.

- **Behavior delta:** None visible. Same UI, same interactions. Smaller images shipped, smaller JS, no stripped error logging.
- **Risk:** None for (a) and (c). For (b): `optimizePackageImports` is `experimental` but stable for many releases. If a listed package breaks under rewrite, removing it from the list is one line.
- **Effort:** Small — one config edit.

### 4.3 — Tune Next.js Router cache (`staleTimes`)

- **File:** [next.config.ts](../../../next.config.ts)
- **Addition:**
  ```ts
  experimental: {
    optimizePackageImports: [...],
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
  ```
- **What it does:** Increases the Next.js Router cache lifetime for dynamic page navigation. Back/forward navigation to a recently-visited page becomes near-instant (RSC payload served from memory instead of re-fetched).
- **Why this is safe in our codebase:** Every write path calls `revalidatePath`, which invalidates the Router cache immediately. A stale page cannot outlive a write. TanStack Query already runs a 30 s `staleTime`, so the two layers align.
- **Behavior delta:** Back/forward navigation feels faster. No data staleness because writes invalidate the cache explicitly.
- **Risk:** Low. Theoretical edge case: a race between an in-flight `revalidatePath` and an active back-navigation. In practice, `revalidatePath` is synchronous from Next.js's view (it marks the cache invalid before the action returns), so this race shouldn't be observable.
- **Verification:** After landing, exercise the navigation patterns: log a game → navigate to `/home` → back to `/library` — confirm the new log appears (revalidation worked). Then click around `/library` ↔ `/home` rapidly without writes — confirm snappier navigation.
- **Effort:** Tiny — 4 lines added.

### Tier 4 summary

| # | Change | Win | Risk |
|---|---|---|---|
| 4.1 | `@next/bundle-analyzer` | Measurement source | Zero (opt-in) |
| 4.2a | AVIF + 30-day image cache | Smaller image bytes | Zero |
| 4.2b | `optimizePackageImports` | Smaller JS bundle | Very low |
| 4.2c | `removeConsole` in prod | Tiny JS bundle win | Zero |
| 4.3 | `staleTimes.dynamic: 30` | Instant back-nav within 30 s | Low |

---

## Tier 5 — Deliberately skipped (with rationale)

Optimizations considered, audited, and consciously left on the table. Each has a clear "when we'd revisit" trigger.

### 5.1 — Replacing Framer Motion `layout`/`motion.div` on posters with CSS keyframes

- **Where it would apply:** [components/library/library-poster.tsx:16-22](../../../components/library/library-poster.tsx) and other Framer Motion consumers.
- **Potential win:** Significant. 200 `motion.div layout` instances carry real cost (per-node ResizeObservers + measure passes on commit).
- **Why skip:** CSS animations cannot match Framer Motion's spring physics. The poster entry "feels" springy because of `transition={{ type: "spring", stiffness: 400, damping: 30 }}`. A cubic-bezier substitute would be subtly different — perceptible side-by-side. Vetoed by the zero-UX-impact constraint.
- **Revisit trigger:** If the bundle analyzer (Tier 4.1) shows Framer Motion >30% of the client bundle, or if a slightly-snappier-but-not-springy animation becomes acceptable.

### 5.2 — Virtual scrolling on library shelf

- **Potential win:** Constant-time render cost regardless of library size.
- **Why skip:** Virtual scrolling unmounts off-screen DOM. That breaks browser Ctrl+F (only finds rendered items), scroll-anchoring, and screen-reader navigation past the rendered window. All UX changes under the constraint.
- **Mitigation we're using instead:** Tier 3.4 (`content-visibility: auto`) keeps DOM intact but skips layout/paint for off-viewport items.
- **Revisit trigger:** When libraries reach 1000+ items and `content-visibility: auto` is insufficient.

### 5.3 — Pagination on `/library`

- **Potential win:** Bounded payload, fixed render cost.
- **Why skip:** Letterboxd-for-games is a "scroll your collection" experience. Pagination fundamentally changes user mental model. Out of scope.
- **Revisit trigger:** Never, unless product direction changes.

### 5.4 — `<Suspense>` streaming on dashboard

- **Potential win:** Dashboard sections appear as their data loads instead of waiting for the full `Promise.all`.
- **Why skip:** Changes perceived load order. Sections "pop in" instead of appearing together. UX change under the constraint.
- **Revisit trigger:** If/when dashboard TTI becomes a complaint vector and "things appear progressively" is acceptable.

### 5.5 — `useDeferredValue` replacing `useDebounced` in palette search

- **Why skip:** The 250 ms debounce is intentional RAWG API rate-limiting. `useDeferredValue` would fire searches on most keystrokes under low load (5× more API calls per typing session). Current setup (250 ms + 2-char min + 5-min TanStack cache + Redis cache) is well-tuned.

### 5.6 — Edge runtime for middleware

- **Where:** [middleware.ts](../../../middleware.ts) currently runs in Node.js.
- **Potential win:** Single-digit-millisecond cold starts vs. tens-to-hundreds for Node.
- **Why skip:** Architecture-level decision, beyond the audit scope. Requires verifying Supabase SSR cookie handling under the Edge runtime and changes the deployment surface.
- **Revisit trigger:** Phase 2/3 cold-start tightening.

### 5.7 — `unstable_cache` for hot read paths

- **Potential win:** Server-side memoization across requests for `getProfileByUsername` and similar reads.
- **Why skip:** Adds tag-based invalidation complexity. At current scale (sub-50ms reads), the complexity isn't justified. Tier 1.2 (`cache()` for auth) handles the intra-request duplication that matters at this scale.
- **Revisit trigger:** When profile reads are measurable hotspots under load (Phase 3+ social features).

### 5.8 — SQL `GROUP BY` rewrite of `getUserStats`

- **Where:** [lib/logs/server-actions.ts:224-257](../../../lib/logs/server-actions.ts)
- **Why skip:** Phase 1.5.15c (commit `3d81bac`) already addressed the worse waste (double-scan of logs on `/home`). The remaining `getUserStats` is dormant — no callers left after Phase 1.5. Rewriting dormant code is churn.
- **Revisit trigger:** When a real caller appears AND `EXPLAIN ANALYZE` shows the JS aggregation is a hotspot.

---

## Verification strategy

This audit cannot use empirical measurement (user away from PC). Verification is therefore:

1. **Static correctness:** Every change is paired with a "verification" note above that describes the visible behavior to confirm. After each tier lands, work through that tier's verification notes manually.
2. **Build artifacts (Tier 4 only):** After Tier 4 lands, run `pnpm analyze` once. The output HTML at `.next/analyze/client.html` and `.next/analyze/server.html` is a static artifact that captures bundle composition at a point in time. Save its top-level summary (rough bundle size per route) into the perf baseline doc as a "post-audit" snapshot.
3. **Optional manual sweep (when user returns to PC):** Cold-load `/library`, `/home`, `/u/<own-username>`, and `/settings` while watching the Next.js dev console. Confirm:
   - Auth verifications per page: 1 (Tier 1.2)
   - DB queries per `/home`: 1 logs-JOIN-games query (Tier 1.3)
   - Library queries use the new index (run `EXPLAIN ANALYZE` on a sample query in `db:studio`)
   - Bundle analyzer output unchanged routes other than expected reductions
4. **Append findings to the Phase 1.5 baseline doc** in an "Audit Tier 1-4 applied" appendix, mirroring the existing "Applied fixes (Task 15)" section.

---

## Risk register

| Risk | Tier | Mitigation |
|---|---|---|
| `cache()` helper leaks user A's auth into user B's request | 1.2 | `cache()` is per-request by React's contract; physically impossible across requests. |
| New indexes slow writes more than expected | 2.1, 2.2 | Acceptable — write volume is low relative to reads. If a regression appears, indexes are droppable. |
| Modal-intercept morph misbehaves with `content-visibility: auto` | 3.4 | Visual verification by clicking a poster after scrolling. Fallback: scope to list view only. |
| `optimizePackageImports` breaks a listed package's import | 4.2b | Manifests at build time, not runtime. Remove the offending package from the list. |
| `staleTimes.dynamic: 30` shows stale data after a write | 4.3 | All writes call `revalidatePath`; cache invalidates synchronously. Manual exercise confirms after landing. |
| `next/dynamic` for cropper introduces a visible loading flash | 3.3 | `loading: () => null` keeps dialog body empty for a few hundred ms; file-read latency masks the chunk fetch. Verify on throttled network. |

---

## Out of scope

- All Tier 5 items, with rationale documented above.
- Empirical measurement (no PC access for the user during this work).
- Architecture-level changes (Edge runtime, alternative DB drivers, alternative state managers).
- Phase 2+ features that don't exist yet (review queries, social graph queries, recommendation feed).
- Changes to existing UI/UX behavior (animations, scroll, virtualization, pagination, streaming load order).

---

## References

- **Phase 1.5 baseline + applied fixes:** [docs/superpowers/perf/2026-05-10-phase1.5-baseline.md](../perf/2026-05-10-phase1.5-baseline.md)
- **Phase 1.5 gate report:** [docs/superpowers/gates/2026-05-10-phase1.5-gate.md](../gates/2026-05-10-phase1.5-gate.md)
- **Next.js docs:** [Image Optimization](https://nextjs.org/docs/app/api-reference/components/image), [`staleTimes`](https://nextjs.org/docs/app/api-reference/next-config-js/staleTimes), [`optimizePackageImports`](https://nextjs.org/docs/app/api-reference/next-config-js/optimizePackageImports)
- **React `cache()`:** https://react.dev/reference/react/cache
- **CSS `content-visibility`:** https://web.dev/articles/content-visibility
