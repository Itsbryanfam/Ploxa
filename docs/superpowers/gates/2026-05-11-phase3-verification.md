# Phase 3 — Library Imports — Verification Gate

| Field | Value |
|---|---|
| **Date** | 2026-05-11 |
| **Phase** | 3 of 7 |
| **Spec** | `docs/superpowers/specs/2026-05-11-phase3-library-imports-design.md` |
| **Plan** | `docs/superpowers/plans/2026-05-11-phase3-library-imports-plan.md` |
| **Tag** | `phase-3-complete` — **PENDING** (applied after user runs DEFERRED gate items) |

---

## Automated Checks (this agent — HEAD after 19 Phase 3 commits)

### Smoke scripts

| Script | Result |
|---|---|
| `scripts/smoke-encryption.ts` | **PASS 7/7** |
| `scripts/smoke-rawg-match.ts` | **PASS 10/10** |
| `scripts/smoke-merge.ts` | **PASS 12/12** |

Smoke detail:
- **encryption** — round-trip ASCII/empty/unicode, stored 3-segment base64 format, random IV, tampered authTag rejection, malformed value rejection
- **rawg-match** — lowercase, trim, strip punctuation, 5 edition-suffix variants, unicode preserve, whitespace collapse, all-punct→empty
- **merge** — insert/update paths, platform union, max-hours logic (6 cases), null preservation, merge-set exclusion of status/rating/notes

### Build chain on HEAD

| Step | Result |
|---|---|
| `pnpm typecheck` | **PASS** — exit 0, no errors |
| `pnpm lint` | **PASS** — 0 errors, 3 pre-existing warnings (2× `<img>` in `avatar.tsx` [held from Phase 1.5], 1× `_connection` unused-var in `lib/imports/adapters/xbox.ts`) |
| `pnpm build` | **PASS** — Turbopack compiled successfully; all 24 routes present including new Phase 3 routes (`/api/auth/steam`, `/api/auth/steam/callback`, `/api/connect/xbox`, `/api/imports/[importId]/status`, `/api/imports/latest`, `/library/import/[importId]`, `/settings`) |

### Infrastructure

| Check | Result |
|---|---|
| Edge Function `import-platform` | **ACTIVE** — verify_jwt: false, version: 1 |
| Edge Function `daily-sync` | **ACTIVE** — verify_jwt: false, version: 1 |
| pg_cron `daily-import-sync` | **CONFIRMED** — active=true, schedule=`0 4 * * *` |
| Schema `imports.conflicts_jsonb` | **PRESENT** — type: jsonb |
| Schema `imports.unmatched_jsonb` | **PRESENT** — type: jsonb |
| Schema `imports.surfaced` | **PRESENT** — type: boolean |
| Schema `logs.platforms` | **PRESENT** — type: text[] (ARRAY) |

All 4 schema columns from migration 0003 confirmed via `information_schema.columns`.

### Live debugging + performance lifts (2026-05-12)

During the user's first live test pass, three bugs and two architectural gaps were found and fixed. All committed to main; documented here for the gate record.

**Bug fixes**

| # | Bug | Symptom | Resolution | Commit |
|---|---|---|---|---|
| 1 | `SUPABASE_FUNCTIONS_URL` missing from local `.env` | Steam OpenID callback 500 after successful round-trip | Added to `.env` | (local) |
| 2 | OpenXBL response wrapped under `.content`; adapter never unwrapped | Xbox modal showed "key wasn't accepted" 401 despite valid key | Read `response.content?.profileUsers` / `raw.content?.titles` with fallback | `20d830f` |
| 3 | `imports.{conflicts,unmatched}_jsonb` stored as JSON-stringified strings | `jsonb_typeof = 'string'` instead of `'array'`; summary screen couldn't render buckets | Pass JS arrays bare; let postgres.js auto-serialize for jsonb columns | `6b09952` |

**Architectural lifts (folded forward from Phase 4)**

| # | Issue | Resolution | Commit |
|---|---|---|---|
| A | Local `games` table starts empty → 100% of first-import matches miss → everything goes to `unmatched_jsonb` | **RAWG-on-miss fallback** in `matchToRawg`: call RAWG search → upsert into games → return new id | `b4bc3b2` |
| B | Edge Function WORKER_RESOURCE_LIMIT (~150s wall clock) cuts off large first-imports | **Resume support**: `runImport` reads `imported_count` from DB and skips already-processed games on re-invocation; conflicts/unmatched arrays hydrated from existing jsonb | `dbd7639` |
| C | Serial loop in `runImport`: 50 games × ~600ms each = 30s per chunk = 150s for 234 games (exactly at the limit) | **Parallel within chunks** (concurrency cap 10) + **atomic UPSERT** replaces 2-step SELECT-then-INSERT-or-UPDATE with one `ON CONFLICT DO UPDATE` carrying merge rules SQL-side. Eliminates DB round-trip per game and a latent parallel-race. | `c4edf21` |
| D | Even with the above, niche games (~5-20% of any user's library) still need a RAWG fetch during import | **One-off catalog seed**: `scripts/seed-rawg-catalog.ts` pre-populates top 5,000 most-added-on-RAWG games into `games`. ~125 RAWG calls (~0.6% of free monthly budget), ~10MB storage. Idempotent. | `8255edc` |

**Live benchmark (itsbryanfam, 234-game Steam library)**

| Pass | Engine time | Status | Logs landed |
|---|---|---|---|
| Pre-lift (serial loop) — Pass 1 of N | 150.6s | failed (WORKER_RESOURCE_LIMIT) | 110 |
| Pre-lift — Pass 2 of N | timeout | running (cursor at 150) | 157 |
| Pre-lift — Pass 3 of N (with resume) | 112s | completed | 225 |
| **Post-lift (parallel + UPSERT) — single pass** | **32.9s** | **completed** | 225 |

Library size headroom on Free tier: ~1500-2000 games per pass. Realistic gamers covered by single-pass behavior.

**Catalog state after seed**

| Metric | Before session | After seed |
|---|---|---|
| `games` rows | 3 | **5,053** |
| With cover_url | 3 | 5,049 (99.9%) |
| With rawg_rating | 3 | 5,053 (100%) |

Spot-check (typical Steam-library mainstream titles): Celeste, Cyberpunk 2077, Dota 2, Elden Ring, Hades, Half-Life 2, Hollow Knight, Left 4 Dead 2, Outer Wilds, Portal 2, Stardew Valley — **all present with full metadata**.

### Edge Function end-to-end (added after secrets-set pass on 2026-05-11)

After the user provided a Supabase PAT, three Edge Function secrets were set via `supabase secrets set`:

| Secret | Status |
|---|---|
| `DATABASE_URL` | **SET** via CLI |
| `STEAM_API_KEY` | **SET** via CLI |
| `IMPORT_ENCRYPTION_KEY` | **SET** via CLI |
| `SUPABASE_SERVICE_ROLE_KEY` | **AUTO-INJECTED** — Supabase reserves `SUPABASE_*` names and auto-injects them into every Edge Function. The CLI rejected manual sets; the auto-injected value matches our `sb_secret_*` key (verified below). |

Live curl smoke against both deployed functions:

| Test | Request | Result | Interpretation |
|---|---|---|---|
| `POST /functions/v1/import-platform` with valid `apikey` header + bogus `importId` | `{"importId":"00000000-..."}` | **HTTP 404 "import not found"** | Auth ✅ (got past the apikey check), DB query ran ✅ (read `imports` table, no match), function code wired correctly |
| `POST /functions/v1/daily-sync` with valid `apikey` header | `{}` | **HTTP 200 `{"scheduled":0}`** | Auth ✅, DB query ran ✅ (scanned `platform_connections`, none past 23h), function code wired correctly |

This confirms:
- All 4 Edge Function env vars are accessible at runtime
- The `apikey` header auth check (added in commit `4f9ccb3`) works with the sb_secret_* format
- Postgres connectivity (via `DATABASE_URL`) works from the Edge Function runtime
- The pg_cron Vault-based dispatch path (Task 3) will work once a real connection exists

---

## 8-Item Verification Gate (spec § Verification Gate)

### 1. Connect Steam via OpenID — DEFERRED — user action required

**Pre-requisite:** Set Edge Function secrets in Supabase Dashboard → Settings → Edge Functions → Secrets:
- `DATABASE_URL` (from `.env`)
- `SUPABASE_SERVICE_ROLE_KEY` (from `.env`, begins with `sb_secret_*`)
- `STEAM_API_KEY` (from `.env`)
- `IMPORT_ENCRYPTION_KEY` (from `.env`, generated during Task 11)

**Steps:**
1. Visit `/settings#connections` while logged in
2. Click **Connect Steam** on the Steam card
3. Verify the OpenID round-trip completes and you land on `/library/import/<importId>` with an import skeleton/progress UI
4. Update this item with: screenshot of the import page, the SteamID in the URL or SQL evidence

**SQL spot-check:**
```sql
SELECT id, status, imported_count, total_count, platform
FROM imports
WHERE user_id = '<your-uuid>'
ORDER BY created_at DESC LIMIT 1;
```

---

### 2. First import completes — DEFERRED — depends on item 1

**Steps:**
1. After item 1, watch `imported_count` climb toward `total_count` in the import progress UI
2. When `status = 'completed'`, screenshot the `/library/import/<importId>` summary page
3. Verify the Imported / Merged / Skipped / Unmatched buckets are populated

**SQL spot-check:**
```sql
SELECT id, status, imported_count, total_count, completed_at,
       jsonb_array_length(conflicts_jsonb) AS conflicts,
       jsonb_array_length(unmatched_jsonb) AS unmatched
FROM imports
WHERE user_id = '<your-uuid>'
ORDER BY created_at DESC LIMIT 1;
```

Expected: `status='completed'`, `imported_count = total_count`, `completed_at IS NOT NULL`.

---

### 3. Conflict merge — DEFERRED — requires pre-existing manual log (Hades)

**Pre-requisite:** Before importing, manually log Hades with existing user data:
```sql
INSERT INTO logs (user_id, game_id, status, rating, notes, platform_played_on, platforms)
SELECT '<your-uuid>', id, 'completed', 4.5, 'loved it', 'pc', ARRAY['pc']
FROM games WHERE slug = 'hades';
```

**Steps:**
1. Run a full Steam re-import: Steam card kebab → **Re-import full**
2. After completion, run:
```sql
SELECT status, rating, notes, platforms, platform_played_on, hours_played
FROM logs
WHERE user_id = '<your-uuid>'
  AND game_id = (SELECT id FROM games WHERE slug = 'hades');
```
3. Expected: `status='completed'`, `rating=4.5`, `notes='loved it'`, `platforms=['pc','steam']`, `platform_played_on='pc'` (merge never overwrites these fields)
4. On the summary page, verify Hades appears in the **Merged** bucket (not Imported)

---

### 4. Xbox connect modal — DEFERRED — requires real OpenXBL API key

**Steps:**
1. Click **Connect Xbox** on the Xbox card in `/settings#connections`
2. Verify the 3-step modal opens with mascot copy and pixel-art illustrations at each step
3. In step 3, paste a real OpenXBL key → submit
4. Verify the key encrypts and an import triggers

**SQL spot-check:**
```sql
SELECT
  external_id,
  length(access_token_encrypted) > 0                                              AS has_ciphertext,
  access_token_encrypted ~ '^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$' AS format_ok
FROM platform_connections
WHERE user_id = '<your-uuid>' AND platform = 'xbox';
```
Expected: `has_ciphertext=true`, `format_ok=true`. The plaintext key must NOT appear in the column.

---

### 5. Daily sync produces delta toast — DEFERRED — depends on items 1–2

**Steps:**
1. Back-date the Steam connection so daily-sync considers it stale:
```sql
UPDATE platform_connections
SET last_synced_at = NOW() - INTERVAL '25 hours'
WHERE user_id = '<your-uuid>' AND platform = 'steam';
```
2. Ensure at least one Steam game has `playtime_2weeks > 0` (buy/launch a game, or confirm this via Steam API)
3. Invoke daily-sync: `supabase functions invoke daily-sync --body '{}'`
4. Wait ~30 s, then reload the app — the delta toast **`+N games from Steam since you were last here`** should appear bottom-right
5. Verify `surfaced` flips to `true` after toast display:
```sql
SELECT surfaced, imported_count
FROM imports
WHERE user_id = '<your-uuid>'
ORDER BY created_at DESC LIMIT 1;
```

---

### 6. Error states render — DEFERRED — requires live UI walkthrough

**Steps:**
1. Click **Connect Xbox** → in step 3, paste literally `bad` (an obviously invalid key) → submit
2. Verify the modal shows inline error: *"That key wasn't accepted."* and stays open on step 3 (does not dismiss)
3. (Optional) Force an import failure and verify the Steam card enters the error state with a **Retry now** CTA

---

### 7. Disconnect — DEFERRED — depends on items 1–2

**Steps:**
1. On the Steam card: kebab menu → **Disconnect** → confirm in the dialog
2. SQL verification:
```sql
SELECT is_active, access_token_encrypted
FROM platform_connections
WHERE user_id = '<your-uuid>' AND platform = 'steam';
```
Expected: `is_active=false`, `access_token_encrypted IS NULL`
3. Visit `/library` — all previously-imported logs must still be visible (disconnect does NOT delete logs)

---

### 8. Resumability — DEFERRED — requires mid-flight Edge Function kill

**Steps:**
1. Trigger **Re-import full** on Steam (expect ~207 games)
2. Mid-flight (~50/207 progress), kill the Edge Function via Supabase Dashboard → Edge Functions → `import-platform` → Stop
3. Observe `imports.status` transitions to `failed`
4. Click **Retry now** from the failed import card
5. Verify the second run completes and:
```sql
SELECT COUNT(*) FROM logs
WHERE user_id = '<your-uuid>'
  AND 'steam' = ANY(platforms);
```
Expected: `207` rows, not `414` (idempotent upsert, no duplicates)

---

## Open Follow-ups (NOT blocking the gate; documented for Phase 4+)

- **Edge Function secrets** must be set before items 1–8 work end-to-end (see item 1 pre-requisites above)
- **STEAM_API_KEY vs STEAM_WEB_API_KEY**: `.env` has both names (noted during Task 6); pick one canonical name and remove the other in a follow-up cleanup PR
- **Manual-match UI for unmatched RAWG titles** — the "Help us match these →" link in `ImportSummary` is inert; Phase 4 territory
- **`ConnectionSummary.latestImport.errorMessage`** — read via a narrowed cast in `lib/imports/server-actions.ts` but not formally in the interface; add for type cleanliness in a follow-up
- **PSN adapter** — deferred to Phase 3.5 or Phase 7 polish per spec; no PSN work in current scope
- **Drop `logs.platform_played_on`** once all rows dual-written — Phase 5+ work; column retained for backward compat
- **`logs.platforms` hour-tracking** — only Steam reports `hours_played`; Xbox always null until OpenXBL exposes it
- **`vault.create_secret` duplicate-name handling** — Task 3 manual steps assume single insertion; idempotency requires `vault.update_secret` instead; manual ops must check first

---

## Poster art lift (2026-05-11, post-verification polish)

Surfaced during the user's first visual spot-check: every 2:3 portrait slot
in the UI (library shelf, status stacks, review cards, import summary, palette
search/preview) was being fed RAWG's `background_image` — a 16:9 landscape
hero shot — and cropped via `object-cover` down to portrait. The result lost
the title text in basically every case, making imported games hard to
recognize at a glance.

Folded back into Phase 3 rather than deferred. Plan: `docs/superpowers/plans/2026-05-11-poster-art-plan.md`.

**Architecture**

Two new additive columns on `games`: `poster_url`, `poster_source` (`steam` |
`sgdb` | `rawg`). Resolution chain in `lib/games/poster-source.ts`:

1. Steam Storefront search (`/api/storesearch`) → top appid whose normalized
   title clears a 0.8 token-set similarity bar → HEAD-check Steam CDN
   `library_600x900_2x.jpg`. Free, no key, no documented rate limit.
2. SteamGridDB autocomplete → `/grids/game/<id>?dimensions=600x900&types=static`.
   Only fires when `SGDB_API_KEY` is set (optional env var).
3. Null. UI gracefully falls back to legacy landscape `coverUrl`.

UI patches: every 2:3 slot now reads `posterUrl ?? coverUrl`. Hero strip in
`game-detail.tsx` (`h-72` full-bleed) deliberately stays on `coverUrl` —
landscape IS correct there.

Async enrichment hook: `enrichPostersForImport()` server action runs once
when the import-summary page mounts, so RAWG-on-miss insertions from a
fresh import get art shortly after — no user-facing wait.

**Backfill results (2026-05-11, both passes)**

Ran `scripts/backfill-posters.ts` against the 5,053-game catalog in two
passes — first Steam-only, then SGDB enabled for the long tail.

| Source | Catalog rows | % | Wall time |
|---|---|---|---|
| Steam CDN (pass 1, concurrency=8) | 2,878 | 57.0% | 761s |
| SteamGridDB (pass 2, concurrency=4) | 1,885 | 37.3% | 574s |
| **Combined** | **4,763** | **94.3%** | 1,335s total |
| Long-tail null | 290 | 5.7% | — |
| Errors across both passes | 0 | — | — |

Hit rate on the test user's actual imported library: **212/227 games
(93.4%)** now have portrait box art (up from 144/227 = 63.4% after the
Steam-only pass). The remaining 15 are obscure/regional/indie titles
SGDB doesn't carry; they fall back to RAWG landscape via `posterUrl ?? coverUrl`.

**Drive-by bug found**

Surfaced via the new dev-server check at the end of the lift: every
`/library` render with unsurfaced imports threw a 500 inside
`markImportsSurfaced()`. The function used Drizzle's `sql` tagged
template — `sql\`${imports.id} = ANY(${importIds})\`` — which binds
the array as a stringified value, producing the postgres error
*"Array value must start with `{`"*. Replaced with `inArray()` from
drizzle-orm. Same fix pattern as several other places in the codebase
that already use `inArray`.

**Commits**

| # | Commit | Subject |
|---|---|---|
| Plan + schema | `01f41d6` | feat(games): add posterUrl + posterSource columns |
| Resolver + smoke | `f9482a7` | feat(games): portrait box-art resolver (Steam CDN + SGDB) |
| UI + backfill + drive-by | `f16ec55` | feat(games): use portrait posterUrl across all 2:3 slots |

**Verification**

- `pnpm typecheck` ✅ exit 0
- `pnpm lint` ✅ 0 errors (3 pre-existing warnings unchanged)
- `pnpm build` ✅ all 24 routes
- `scripts/smoke-poster-source.ts` ✅ 9/9 cases (Portal 2 / Hades /
  Stardew Valley / DOOM Eternal / Witcher 3 GOTY / Mario Odyssey
  → null / Bloodborne → null / gibberish → null)
- DB confirmation: `SELECT poster_source, COUNT(*) FROM games GROUP BY poster_source` returns `steam=2877, null=2176`

**Open follow-up** (optional, doesn't block phase-3-complete tag)

- ~~Add `SGDB_API_KEY` to `.env` and re-run `backfill-posters.ts`~~ —
  ✅ done same day; 1,885 additional posters resolved, catalog now at
  94.3% portrait coverage.
- The resolver caches no responses; if Storefront search becomes a
  cost concern at scale, wrap `steamSearch` with Redis TTL.

---

## Tag

`phase-3-complete` — **PENDING** — apply after running the 8 DEFERRED gate items above:

```powershell
git tag phase-3-complete
git push origin main --tags
```
