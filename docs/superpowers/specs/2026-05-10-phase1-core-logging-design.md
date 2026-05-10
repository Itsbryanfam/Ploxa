# Phase 1 — Core Logging — Design Spec

| Field | Value |
|---|---|
| **Date** | 2026-05-10 |
| **Phase** | 1 of 7 |
| **Status** | Approved |
| **Goal** | A useful personal game tracker — end of phase = you can dogfood it |
| **Verification gate** | Search "Hades" → log as Completed with rating 9 → see it on library page filtered to Completed |
| **Plan reference** | `~/.claude/plans/smooth-herding-flame.md` |
| **Companion HTML** | `docs/phase1-design.html` |

---

## Context

Phase 0 shipped the foundation: auth, design system tokens, mascot stub, full Drizzle schema applied to live Supabase, RLS policies for all 18 tables, and the cockpit-dashboard placeholder.

Phase 1 turns this scaffolding into a real product surface. By the end, the developer is dogfooding their own game library through the app — searching, logging, viewing, filtering, and editing. No AI yet (that's Phase 2). No imports yet (Phase 3). No social yet (Phase 5).

This spec was produced through brainstorming on 2026-05-10. The user explicitly chose ambitious options at every fork; this design reflects those choices.

---

## Locked Design Principles (apply throughout)

1. **Letterboxd-but-better.** Use Letterboxd as the reference for IA and identity, but improve every load-bearing interaction (filter responsiveness, animations, mascot moments, visual polish).
2. **Raycast-class polish.** Dark mode primary, generous whitespace, refined micro-interactions, ⌘K-driven workflows.
3. **Custom assets over emojis.** Every UI element uses custom pixel-art / SVG. Emojis are an anti-pattern. The site must feel hand-crafted, not AI-generated. (See `feedback_custom_assets_no_emojis.md` in user memory.)
4. **Mascot restraint.** Mascot is celebratory + state-indicator only. No Clippy-style chat interruptions. Voice = sardonic insider.
5. **Premium pixel art as accents** — mascot, hearts, status badges, shelf framing, empty states. Not the whole UI.
6. **YAGNI past Phase 1.** Anything in scope for Phase 2-7 is explicitly deferred (see "Out of Scope" below).

---

## Information Architecture

### Routes

| Route | Purpose | Render strategy |
|---|---|---|
| `/` | **Cockpit dashboard** — mascot greeting, Status Shelf hero, recent activity, stats strip | RSC shell + TanStack Query islands |
| `/library` | **Poster wall** (default) with three view toggles: poster wall · list · status shelf | RSC shell + TanStack Query for grid |
| `/games/[slug]` | **Game detail** — full route when accessed directly (shared link, refresh, new tab) | RSC for static content + client island for log card |
| `/games/[slug]` *(intercepted)* | **Game detail panel** — slide-over presentation when navigated to from inside the app | Client overlay via Next.js parallel/intercepting routes |
| `/u/[username]` | **Profile** — header, tabs (Library / Reviews stub / Lists stub), stats. Phase 1 ships own-profile primarily; public viewing technically works via RLS but UI polish for "viewing someone else" is Phase 5 | RSC + TanStack Query |
| `/login`, `/signup`, `/auth/callback` | Existing | Existing |
| `/dashboard` *(legacy)* | Redirect → `/` | Redirect |

### Global UI

- **App shell** (mounted at `app/(app)/layout.tsx`) contains the header bar with the faux search input ("Search games... ⌘K") and the global Cmd+K palette mounted as a portal.
- **Header bar** is sticky on scroll, blurred-glass background, contains: app logo (left), faux-search input (center), profile menu / mascot variant indicator (right).
- **Cmd+K palette** is a single global client component triggered by ⌘K / Ctrl+K from anywhere in the authenticated app. Has multiple internal states: `idle → searching → results → quick-log → submitted`.

---

## Data Flow

### Search → log roundtrip

```
[User types in palette]
         ↓ debounce 250ms, min 2 chars
[Server action: searchGames(query)]
         ↓
   Upstash KV?  ──hit──→ return results (5–20ms)
         ↓ miss
   RAWG live   ─→ write-through to KV (24h TTL) ─→ return results (~200–500ms)
                                                          ↓
                                          [Palette renders typeahead grid w/ covers]
                                                          ↓ user picks one
                                          [Quick-log form: status chips + heart rating + 1-line note]
                                                          ↓ submit (server action)
                              [Server action: createLog(rawgGameId, status, rating, note)]
                                                          ↓
                              [Upsert into games (write-through to KV + Postgres)]
                                                          ↓
                              [Insert into logs as auth user (RLS-enforced)]
                                                          ↓
                              [Return new log row]
                                                          ↓
                              [Client: invalidate TanStack queries: 'library', 'cockpit-shelf', 'recent-activity']
                                                          ↓
                              [Toast (custom pixel checkmark) + mascot celebrating + palette closes]
                                                          ↓
                              [Library page receives invalidation → FLIP-animates new poster in]
```

### Cache strategy (locked: Vercel KV via Upstash)

| Layer | Contents | TTL |
|---|---|---|
| Upstash KV | RAWG search responses (keyed by normalized query) | 24h |
| Upstash KV | RAWG game-detail JSON (keyed by RAWG game id) | 7 days |
| Postgres `games` table | Permanent record of every game ever logged or detail-viewed | indefinite (`cached_at` for soft refresh after 30d) |
| Postgres `game_aliases` | Alternate spellings / abbreviations users have searched (Phase 2+ may auto-populate from typo-corrected searches) | indefinite |

### Server / Client boundary

| Concern | Pattern |
|---|---|
| Initial page renders (dashboard, library, detail, profile shells) | **React Server Components** — fast paint, SEO-friendly |
| Reactive lists (library grid, status shelf, palette typeahead) | **TanStack Query** — `initialData` hydrated from RSC, then live |
| Mutations (create log, edit log, delete log, change status) | **Server Actions** co-located with components, return new data, invalidate TQ keys |
| RAWG calls + KV cache | **Server-only modules** — never imported by client code |
| All DB reads/writes from server (RSC + server actions) | **Drizzle** (postgres.js) — already wired in `lib/db/index.ts`, connects as the DB owner so RLS is bypassed. User-scoped queries MUST explicitly filter by `session.user.id` (e.g. `where(eq(logs.userId, session.user.id))`) — code-level enforcement is the primary safeguard for Phase 1. |
| Auth (login, signup, session, JWT verification) | **`@supabase/ssr`** — already wired in `lib/supabase/{client,server,middleware}.ts` |
| RLS posture | RLS policies (`lib/db/policies/0001_initial.sql`) remain active as **defense-in-depth backstop**. Phase 1 server code doesn't engage them, but they protect against any future client-direct queries via Supabase JS (Phase 5+ social-graph reads). |
| URL state for filters/sort | **`searchParams`** (e.g. `/library?status=playing&sort=rating-desc&view=grid`) for shareability + back button |

---

## Component Inventory (new for Phase 1)

### UI primitives (all custom-asset where applicable)

| Component | Notes |
|---|---|
| `<HeartRating>` | 10 Minecraft-style pixel hearts in a row. Click left/right half for 0.5 increments. Hover preview. Full / half / empty states. Controlled + uncontrolled modes. **Custom SVG asset.** |
| `<StatusBadge>` | Pixel icon + label per status. 6 sprites: Backlog / Playing / Completed / Dropped / On Hold / Wishlist. **Custom 16×16 SVG sprites.** |
| `<PixelCheckmark>`, `<PixelX>`, `<PixelInfo>` | Toast and inline status icons. Replace generic ✓ / × / ℹ glyphs. |
| `<PixelSpinner>` | Replaces generic CSS spinners. Pixel-art rotating frame or mascot `thinking` mood. |
| `<PlatformIcon>` | Pixel-art Steam / Xbox / PSN / Switch / PC icons. Used on detail page and log cards. |
| `<ShelfFrame>` | Pixel-art wooden shelf wrapper for the library grid. SVG/PNG asset behind the poster wall. |
| `<FilterChip>` | Pixel-art "sticky note" pinned to the shelf, used for status filters. |

### Feature components

| Component | Responsibility |
|---|---|
| `<CommandPalette>` | Global, ⌘K-triggered, multi-state portal. Owns `idle → searching → results → quick-log → submitted` state machine. |
| `<HeaderSearchInput>` | Faux input in the header bar that opens the palette on click and shows the ⌘K hint. |
| `<GameSearchResults>` | Typeahead result rows w/ cover thumbnail, title, year, platforms. Keyboard-navigable. |
| `<QuickLogForm>` | Inline form rendered inside palette after a result is picked. Fields: status chips, heart rating, optional one-line note. |
| `<LibraryGrid>` | Poster wall view. Default density: ~120-140px wide covers, 6-8 per row at desktop widths. Hover reveals overlay chip with rating + status. |
| `<LibraryList>` | Info-dense list view: cover thumbnail (60px), title, hearts, status badge, dates, hours. Sortable by clicking column headers. |
| `<StatusShelf>` | Horizontal carousels per status (Playing / Up Next / Recently Completed / Wishlist). Used by both dashboard hero AND library "shelf view" toggle. |
| `<FilterChips>` | Pixel-styled status filter chips above the library grid. Animate on change. |
| `<SortDropdown>` | Sort options dropdown. Triggers FLIP-animated grid re-layout via Framer Motion. |
| `<GameDetail>` | Game detail content. Used in BOTH the intercepted slide-over panel AND the full `/games/[slug]` route. Cover hero, RAWG metadata, screenshots gallery, description, your log card, log-it CTA. |
| `<LogCard>` | Your log on the detail page: status badge + heart rating + dates + hours + platform + notes preview + Edit-log button. |
| `<EditLogModal>` | Full-form log editor (all schema fields: status, rating, started/finished dates, hours, platform played, replay flag, privacy, notes). |
| `<MascotGreeting>` | Dashboard mascot with context-aware copy. Picks line from `lib/mascot/copy.ts` based on time-of-day + days-since-last-log + currently-playing context. |
| `<EmptyState>` | Reusable: mascot illustration + scenario-specific copy. Used on library, filtered library, palette no-results, etc. |
| `<ActivityTimeline>` | Recent-logs feed for dashboard (last 10 events). |
| `<StatsStrip>` | Count summary: total / by status / average rating. |

### Server modules

| Module | Exports |
|---|---|
| `lib/rawg/client.ts` | `rawgFetch(path, params)` — auth, retry, rate-limit aware. Server-only. |
| `lib/rawg/cache.ts` | KV read-through wrappers: `cachedSearch(q)`, `cachedGameDetail(id)`. Server-only. |
| `lib/rawg/types.ts` | Zod-validated typed RAWG response shapes. |
| `lib/games/server-actions.ts` | `searchGames(q)`, `getGameDetail(slug)`, `upsertGameFromRawg(rawgGame)`. |
| `lib/logs/server-actions.ts` | `createLog`, `updateLog`, `deleteLog`, `getUserLibrary(filters)`, `getRecentActivity(userId, limit)`, `getStatusShelf(userId)`. |
| `lib/mascot/copy.ts` | Central registry of all hand-written mascot lines, keyed by scenario. Picks variants based on context. Voice = sardonic insider. |
| `lib/cache/redis.ts` | (Already exists.) Singleton Upstash client. |

---

## Library Page — Three Views

### Default: Poster Wall (Letterboxd-style)

- Small covers (~120-140px wide), 6-8 per row at desktop widths
- No always-visible labels; hover overlay shows rating + status as a pixel-art chip
- Filter chips at top (`All / Playing / Completed / Backlog / Wishlist / Dropped / On Hold`)
- Sort dropdown with smooth FLIP re-layout
- **Pixel-art shelf framing** — the entire wall sits inside a pixel-art wooden shelf graphic with the mascot peeking from one corner
- Empty state per filter: mascot + scenario-specific copy

### Toggle 1: List View (info-dense)

- Cover thumbnail (60px) + title + heart rating + status badge + dates + hours
- Sortable inline by clicking column headers
- Best for "I want to scan and find a specific game"

### Toggle 2: Status Shelf (cockpit-style)

- Horizontal carousels per status: Playing → Up Next (Backlog) → Recently Completed → Wishlist
- Steam Big Picture vibe but with custom shelf graphics
- Best for "what am I in the middle of right now?"
- The cockpit dashboard reuses this same component as its hero

### Tactile transitions (across all views)

- Status changes (e.g. Backlog → Playing) animate the poster physically across the wall via Framer Motion's FLIP technique
- Mascot reacts (`celebrating` for completions, `pointing` when something joins Playing)
- Sort/filter changes animate the grid re-layout (no hard cuts)

---

## Mascot Integration

Voice: **sardonic insider** (locked). All copy lives in `lib/mascot/copy.ts` for easy review/iteration.

### Phase 1 moments

| Trigger | Mood | Copy strategy | Example |
|---|---|---|---|
| Dashboard load | `waving` → `idle` | Variants by (time-of-day, days-since-last-log, currently-playing) | "Welcome back. You picked up Hades 4 days ago — still going?" |
| After log submit | `celebrating` (1.5s) → `idle` | Variants by (status, rating bucket) | "9.5 hearts. That's basically a marriage proposal." |
| Empty library (no games) | `pointing` | Onboarding nudge | "Empty shelf. The classic 'I'll start tomorrow' move." |
| Empty filtered library | `confused` | Status-specific | (Wishlist empty) "No wishlisted games. You're either disciplined or in denial." |
| Palette searching | `thinking` (small, in palette corner) | none | — |
| No palette results | `confused` (small) | Short | "Nothing matches. Try actual spelling?" |
| 404 / errors | `confused` | Short | "This game doesn't exist. Or maybe you do." |

### Authoring guidelines

- **Tone calibration:** "ribs you about your backlog, never insults your taste." When in doubt, dial down ~10%.
- **Length:** one sentence, occasionally two. Never a paragraph.
- **No emojis.** No exclamation marks for emphasis (use phrasing instead).
- **Game culture awareness:** references like "soulslike," "roguelike," "Stockholm syndrome" (in jest) are on-brand. References to "epic" or "wholesome" are off-brand.
- **Variant count per moment:** 3-5 variants per scenario, picked by deterministic hash of (date + scenario) so the same day = same line (avoids whiplash from refresh).

Total: ~25-35 strings to author in Phase 1.

---

## Custom Assets Required for Phase 1

These need to be designed/sourced before or during implementation. Pixel-art aesthetic, palette: `--accent #7c5cff`, `--pixel #ffb84a`, custom palette extensions as needed for icons.

| Asset | Purpose | Priority |
|---|---|---|
| 10 hearts (full / half / empty) | Rating widget | **Required** for verification gate |
| 6 status icons (Backlog / Playing / Completed / Dropped / On Hold / Wishlist) | Status badges everywhere | **Required** |
| Pixel checkmark + X | Toast confirmations | **Required** |
| Pixel-art shelf graphic | Library frame | **Required** for "Letterboxd-but-better" identity |
| 4-5 platform icons (PC / Steam / Xbox / PSN / Switch) | Detail page + log card | **Required** |
| Pixel spinner / loading frames | Replaces generic spinner | Required (can use mascot `thinking` as fallback) |
| Mascot variants for moods | Already shipping (placeholder); commissioned art is Phase 7 | Existing |
| Empty-state illustrations | Compose mascot + scenario-specific tableau | Reuse mascot + composition |
| Pixel "sticky note" for filter chips | Library filter UI | Nice-to-have (can degrade to styled chip) |

Stub strategy: where a final asset isn't ready, use simple SVG approximations that are visually intentional (not generic Tailwind defaults). Mark with `// TODO: replace with commissioned/refined pixel art` for Phase 7 polish.

---

## Acceptance Criteria (Verification Gate)

The plan's stated gate, broken into checkable steps:

1. ☐ Visit `/` while signed out → redirect to `/login`
2. ☐ Sign in → land on `/` (cockpit dashboard) → see mascot greeting + empty Status Shelf + onboarding mascot moment
3. ☐ Press ⌘K → palette opens → type "Hades" → results stream in within 500ms (RAWG live first time, KV cached thereafter)
4. ☐ Click "Hades" result → palette transitions to quick-log form → pick `Completed` → click hearts to set rating to 9.0 → submit
5. ☐ Toast appears with custom pixel checkmark + mascot briefly celebrates → palette closes
6. ☐ Dashboard updates: Hades appears in "Recently Completed" carousel
7. ☐ Navigate to `/library` → poster wall shows Hades cover (with shelf frame)
8. ☐ Click "Completed" filter chip → grid filters to just Hades (FLIP animation)
9. ☐ Click Hades poster → slide-over panel opens with full game detail + your log card
10. ☐ Refresh the page while panel is open → loads as full `/games/hades` route (intercepting routes contract)
11. ☐ Toggle library to "Status Shelf" view → Hades appears in Completed shelf
12. ☐ Toggle to "List" view → info-dense row with cover thumbnail, title, hearts, status, dates
13. ☐ Sort by rating descending → Hades is at the top
14. ☐ Edit log via `<EditLogModal>` → set hours_played to 35, platform to "Steam Deck", finished_at to today → save → see updated log card on detail page

---

## Out of Scope (Don't Build in Phase 1)

| Deferred to | What |
|---|---|
| **Phase 2** | AI review drafts · AI-generated mascot copy · AI provider router · `ai_calls` telemetry · review writing flow · public review URLs |
| **Phase 3** | Library imports (Steam / Xbox / PSN) · platform connections UI · background sync · conflict resolution |
| **Phase 4** | Recommendations · taste fingerprint · similar-games on detail page · "what should I play next" page |
| **Phase 5** | Comments · follows · public profile polish · lists · notifications · activity feed of friends · likes |
| **Phase 6** | Year-in-Review · Spotify Wrapped-style cards |
| **Phase 7+** | The "Den" view (planted as moonshot during brainstorming) · commissioned mascot artwork · public launch |

---

## Open Questions / Known Risks

| # | Item | Mitigation |
|---|---|---|
| 1 | Intercepting routes UX on mobile (slide-over panel might feel cramped on small screens) | Test mobile early; fall back to bottom-sheet presentation on `width < 768px` |
| 2 | RAWG free-tier rate limit (20k/month) under any unexpected traffic | KV cache + per-IP rate limiting in server action; surface "rate limited, try again" copy with mascot |
| 3 | FLIP animations on large libraries (200+ games) may stutter | Virtualize the grid (TanStack Virtual or react-window) once library exceeds ~60 items |
| 4 | Custom assets timing — pixel hearts need to ship before quick-log works | Author hearts in week 1 of Phase 1, before quick-log implementation begins |
| 5 | Mascot copy authoring is creative work — easy to underestimate | Budget half a day in week 6 specifically for copy authoring + tone review |
| 6 | Drizzle's `db:generate` keeps emitting `CREATE TABLE auth.users` (known gotcha) | Documented in `feedback_drizzle_auth_users_gotcha.md`; strip after every generate |
| 7 | Year-in-reviews access pattern undefined (currently owner-only) | Revisit when Phase 6 starts; not a Phase 1 concern |

---

## Testing Strategy

Phase 1 relies on the **manual verification gate** (14 checks above) as the primary correctness signal. Automated testing is intentionally deferred:

- **No unit/integration tests for Phase 1.** Most code is straightforward orchestration of Supabase / Drizzle / RAWG / UI primitives. Bug surface area is shallow; the cost-benefit of test infrastructure is poor at this stage.
- **Type safety as first defense.** TypeScript strict + Drizzle's typed queries + Zod for RAWG response validation catch most class-of-bug at compile time.
- **Smoke testing via the verification gate.** Run through all 14 checks manually before declaring the phase complete. Repeat after any subsequent refactor.
- **First automated tests arrive Phase 4-5** when complex pipelines (taste fingerprint generation, recommendation ranking, AI provider failover) have meaningful regression risk.
- **Browser testing** during week 6 polish: manually verify Cmd+K palette and intercepting routes in Chrome / Safari / Firefox desktop + iOS Safari + Chrome Android.

If a Phase 1 task's bug surface turns out to be deeper than expected (e.g. tactile transitions stuttering across many edge cases), add a targeted test then — don't pre-emptively scaffold a test runner.

---

## Implementation Plan (next step)

This spec is the input to the **writing-plans** skill, which will break Phase 1 into bite-sized tasks with explicit acceptance criteria, file paths, and dependencies. Estimated breakdown:

- **Week 3:** RAWG client + cache + custom assets (hearts, status icons, checkmark) + design-system additions
- **Week 4:** Cmd+K palette + search flow + quick-log form + server actions for `createLog`
- **Week 5:** Library page (all 3 views) + filter chips + sort + tactile transitions + game detail page (panel + full route via intercepting routes)
- **Week 6:** Dashboard cockpit + StatusShelf + ActivityTimeline + StatsStrip + EditLogModal + mascot copy authoring + verification gate run-through + polish

Verification gate (the 14 checks above) must pass before phase is considered complete.
