# Poster Art Sourcing — Implementation Plan

> **Folded into Phase 3 polish.** Same-session inline execution (matches the perf-audit precedent — see `phase_2_complete.md`/`whole_app_audit_complete.md`). No subagent dispatch; full context is in-session.

**Goal:** Replace RAWG landscape hero shots with proper portrait (2:3) box art in every poster slot, so imported games are instantly recognizable by their iconic cover art.

**Architecture:** Add `games.posterUrl` (+ `posterSource` for diagnostics) as additive columns. Resolution chain at write-time: Steam Storefront search → Steam CDN library art → SteamGridDB (if key set) → null. UI reads `posterUrl ?? coverUrl`; the existing `coverUrl` (landscape RAWG art) is retained and continues to drive the `game-detail.tsx` hero strip where landscape IS correct.

**Tech stack additions:** Zero new deps. One optional env var: `SGDB_API_KEY` (free; https://www.steamgriddb.com/profile/preferences/api).

---

## Verified externals

| Source | URL pattern | Auth | Behavior |
|---|---|---|---|
| Steam Storefront search | `https://store.steampowered.com/api/storesearch/?term=<title>&l=english&cc=us` | none | Returns `items[].id` (appid) + `items[].name`, Steam-ranked. No documented rate limit. |
| Steam CDN library art | `https://cdn.cloudflare.steamstatic.com/steam/apps/<appid>/library_600x900_2x.jpg` | none | 200 if exists, 404 if not. No rate limit. |
| SteamGridDB | `https://www.steamgriddb.com/api/v2/search/autocomplete/<term>` + `/grids/game/<id>` | `Authorization: Bearer <key>` | JSON; free tier sufficient for backfill + import-time lookups. |

Verified live 2026-05-11: `curl -sI .../library_600x900_2x.jpg` returns 200 for appid 620 (Portal 2). `storesearch` returns ranked `items[].id`. SGDB rejects bad keys with `{"success":false,"errors":["Invalid key format"]}` confirming auth format.

---

## File map

| Action | Path | Purpose |
|---|---|---|
| Create | `lib/games/poster-source.ts` | Pure resolver: `resolvePoster({title, knownSteamAppId?}) → {url, source}` |
| Create | `scripts/backfill-posters.ts` | One-time backfill for 5,053 seeded games |
| Create | `scripts/smoke-poster-source.ts` | Sanity smoke for the resolver (Portal 2 / Hades / one console-exclusive) |
| Create | `supabase/migrations/0003_poster_columns.sql` | Drizzle-generated additive migration |
| Modify | `lib/db/schema.ts` | Add `posterUrl`, `posterSource` to `games` |
| Modify | `lib/games/server-actions.ts` | Add `enrichPostersForImport(importId)` server action |
| Modify | `lib/logs/select.ts` | Include `posterUrl` in LibraryItem projection |
| Modify | `lib/logs/library-item.ts` | LibraryItem type gains `posterUrl: string \| null` |
| Modify | `components/library/library-poster.tsx` | `posterUrl ?? coverUrl` |
| Modify | `components/library/status-stacks.tsx` | same |
| Modify | `components/reviews/review-card.tsx` | same |
| Modify | `components/reviews/review-list-card.tsx` | same |
| Modify | `components/imports/import-summary.tsx` | same |
| Modify | `components/palette/game-search-results.tsx` | same |
| Modify | `app/(app)/library/import/[importId]/page.tsx` | Fire-and-forget `enrichPostersForImport` after render |
| Modify | `lib/env.ts` | Optional `SGDB_API_KEY` |
| Modify | `docs/superpowers/gates/2026-05-11-phase3-verification.md` | Append lift summary |

UNCHANGED: `components/game/game-detail.tsx` hero strip — landscape `coverUrl` is correct there (`h-72`, full-bleed).

---

## Tasks

### Task 1: Schema migration

**Goal:** Add `posterUrl` + `posterSource` to `games`. Additive only.

**Steps:**
1. Edit `lib/db/schema.ts` — add two columns on `games`:
   ```ts
   posterUrl: text("poster_url"),
   posterSource: text("poster_source", { enum: ["steam", "sgdb", "rawg"] }),
   ```
2. `pnpm drizzle-kit generate` — name the migration `0003_poster_columns`.
3. **Grep generated SQL for `CREATE TABLE "auth"."users"`** (locked constraint). Strip if present.
4. Apply via Supabase: `pnpm tsx scripts/run-migration.ts 0003_poster_columns.sql` (or whatever convention this project uses — check existing migration runner).
5. **Verify:** `pnpm typecheck`. Smoke: `psql -c "SELECT poster_url, poster_source FROM games LIMIT 1"`.

### Task 2: Poster resolver module

**Goal:** Pure-ish `resolvePoster()` that walks the chain Steam→SGDB→null.

**Steps:**
1. Create `lib/games/poster-source.ts`:
   ```ts
   export type PosterSource = "steam" | "sgdb";
   export interface PosterResult { url: string; source: PosterSource }

   export async function resolvePoster(input: {
     title: string;
     knownSteamAppId?: number;
   }): Promise<PosterResult | null>
   ```
2. Implementation:
   - If `knownSteamAppId` → HEAD `library_600x900_2x.jpg` → 200 returns `{url, source:"steam"}`.
   - Else: `storesearch?term=<title>` → take `items[0]` if `items[0].name` matches title with a reasonable similarity threshold (Levenshtein/Jaro on lowercase-stripped strings); HEAD-check that appid's CDN art.
   - On miss: if `SGDB_API_KEY` set, `/search/autocomplete/<term>` → `/grids/game/<id>?dimensions=600x900&types=static` → first `items[].url`.
   - Always `try/catch` per source; on error fall through to the next source.
3. Smoke script `scripts/smoke-poster-source.ts`:
   - Resolve "Portal 2" → expect Steam source, appid 620
   - Resolve "Hades" → expect Steam source
   - Resolve "Mario Odyssey" (no Steam release) → expect SGDB (if key) or null
   - Resolve `gibberish_no_game_xyz` → expect null
4. **Verify:** `pnpm tsx --env-file=.env scripts/smoke-poster-source.ts`.

### Task 3: Backfill script

**Goal:** Populate `posterUrl` + `posterSource` for all 5,053 seeded games where it's null.

**Steps:**
1. Create `scripts/backfill-posters.ts`:
   - Select rows from `games` where `poster_url IS NULL`, ordered by `cached_at` desc (newest first → user-facing recent games get art first).
   - Process in waves of CONCURRENCY=8 (matches storesearch politeness).
   - For each game: call `resolvePoster({title})`. Update row with `posterUrl`, `posterSource`.
   - Resume-safe (idempotent re-runs skip already-populated rows).
   - Progress log every 100 games.
   - Final summary: total resolved by source (steam/sgdb/null), elapsed time.
2. Run: `pnpm tsx --env-file=.env scripts/backfill-posters.ts`.
3. **Verify:** `SELECT poster_source, COUNT(*) FROM games GROUP BY poster_source`.

### Task 4: Async enrichment after import

**Goal:** New games created via RAWG-on-miss in the import pipeline get poster art shortly after.

**Steps:**
1. In `lib/games/server-actions.ts`, add server action:
   ```ts
   export async function enrichPostersForImport(importId: string): Promise<{enriched: number}>
   ```
   Implementation: find game_ids that were inserted in this import's window where `poster_url IS NULL`, run resolver, update rows. Cap at e.g. 200 games per call (typical import size).
2. In `app/(app)/library/import/[importId]/page.tsx`: after the page renders, call `enrichPostersForImport(importId)` via a `<EnrichTrigger>` client component (`useEffect` once on mount, no UI). Fire-and-forget — no spinner, no blocking; the next refresh of the library page picks up new art.
3. **Verify:** Manual smoke — disconnect Steam, reconnect, watch posters fill in on the summary screen.

### Task 5: UI patches

**Goal:** Every 2:3 portrait slot reads `posterUrl ?? coverUrl`.

**Steps:**
1. Update `lib/logs/select.ts` and `lib/logs/library-item.ts` (and any other LibraryItem-producing query) to include `posterUrl`.
2. Update 6 components (listed in file map) to use `item.game.posterUrl ?? item.game.coverUrl` (or equivalent).
3. Update palette `game-search-results.tsx` to thread `posterUrl` through the selectGame payload.
4. **Verify:** `pnpm typecheck && pnpm lint`.

### Task 6: Final verification

**Goal:** Lift is ready to commit.

**Steps:**
1. `pnpm typecheck && pnpm lint && pnpm build`.
2. `pnpm dev` → spot-check `/library`, `/home`, `/games/[slug]` (hero stays landscape; posters in the modal/related-games strip become portrait).
3. Commit with `feat(games): portrait box art via Steam CDN + SGDB`.

### Task 7: Gate doc update

**Goal:** Record the lift in the Phase 3 verification gate doc.

**Steps:**
1. Append a "Poster art lift" section to `docs/superpowers/gates/2026-05-11-phase3-verification.md`.
2. Note: backfill resolved counts by source, before/after screenshots (or note "user to confirm visually"), commit hashes.
3. Commit `docs: log poster-art lift in Phase 3 gate doc`.

---

## Constraint compliance

- ✅ No emojis (resolver doesn't render UI; UI patches preserve existing pixel/SVG aesthetic).
- ✅ No new npm deps (raw `fetch()` against documented REST endpoints).
- ✅ No dep swaps. AI router untouched.
- ✅ Mascot voice / placement untouched.
- ✅ Framer Motion left alone in library/games-modal components.
- ✅ Drizzle migration grep'd for `auth.users` before applying.
- ✅ Additive-only schema change. Existing `coverUrl` reads unaffected.

## Rollback

`posterUrl` defaults to NULL. UI fallback (`?? coverUrl`) means if the backfill is rolled back, every slot still renders the (current, slightly wrong) RAWG hero — zero visual regression vs. today. Migration can be reverted by `ALTER TABLE games DROP COLUMN poster_url, DROP COLUMN poster_source` (no FKs, no data loss for retained `coverUrl`).
