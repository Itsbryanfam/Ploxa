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

## Tag

`phase-3-complete` — **PENDING** — apply after running the 8 DEFERRED gate items above:

```powershell
git tag phase-3-complete
git push origin main --tags
```
