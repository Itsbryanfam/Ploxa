# Phase 3 — Library Imports — Design Spec

| Field | Value |
|---|---|
| **Date** | 2026-05-11 |
| **Phase** | 3 of 7 |
| **Status** | Approved |
| **Goal** | Remove the #1 friction (manual entry) for new users — Steam + Xbox auto-import with conflict-safe merge into existing logs |
| **Verification gate** | Connect Steam via OpenID → progress polls → end up with ~200 games auto-logged at `backlog` → manually-logged Hades survives untouched with platforms merged → Xbox modal-walkthrough connection works → daily-sync delta toast fires on next visit after back-dating `lastSyncedAt` |
| **Plan reference** | `~/.claude/plans/smooth-herding-flame.md` (Phase 3 — line 229) |
| **Companion HTML** | `docs/phase3-design.html` (rendered later) |

---

## Context

Phase 2 (AI Reviews) shipped at tag `phase-2-complete` and the soft-launch wave went out to ~5 friends. Phase 3 attacks the #1 friction for *new* users: manual entry of every game. By the end of this phase, a Steam user can connect their account, watch ~200 games auto-import in the background, and see their previously manually-logged games (e.g. Hades) merge cleanly with the imported data — without losing the review, rating, notes, or finish date they've already entered.

Schema is already in place (Phase 0 laid down `platform_connections`, `imports`, `platform_kind` enum). Phase 3 wires the application layer on top — adapters, Edge Functions, settings UI, conflict-merge logic, and the daily-sync cron.

**Scope this phase: Steam + Xbox + Manual.** PSN is explicitly deferred to a Phase 3.5 (or absorbed into Phase 7 polish). The deferral is a deliberate scope call up front: PSN via the unofficial NPSSO cookie flow has brutal user-friction (DevTools cookie copy/paste) and rides an unstable third-party path; the soft-launch user base doesn't have a PSN-heavy long tail yet, and shipping Steam + Xbox at portfolio quality beats shipping three at "PSN is rough" quality.

This spec was produced via brainstorming on 2026-05-11 using the visual companion. Decisions are recorded inline with their rationale; the user explicitly defaulted to the recommendation on every Section presentation after answering Q1–Q7.

---

## Locked Design Principles (apply throughout)

1. **User data wins, always.** Manual logs are sacrosanct. Imports never overwrite `status`, `rating`, `started_at`, `finished_at`, `notes`, `is_replay`, or `is_private`. They only *add*: union `platforms` array, raise `hours_played` if larger.
2. **Resumable engine.** Every import is restartable from `imports.imported_count`. Transient failures (rate limits, 5xx) auto-retry with exponential backoff. The user closing their tab never cancels work.
3. **Failure is contextual.** Error UI lives on the card that failed, not in a global banner. Recovery copy names the actual fix (*"Your OpenXBL key was rejected. Generate a new one at xbl.io and reconnect."*), not the error code.
4. **Quiet by default.** First imports get a dedicated summary screen. Daily syncs are silent unless they produce a delta worth a toast. Successful sync toasts auto-dismiss; only error toasts stick.
5. **Async by architecture.** All adapters run inside Supabase Edge Functions (Deno runtime, no 60s Vercel timeout). The Next app fires-and-polls; it never holds a long-running request open.
6. **No emojis.** Every visual treatment is pixel-art / SVG / custom (per locked aesthetic memory). The xbl.io walkthrough uses pixel-art illustrations of the OpenXBL UI rather than real screenshots that would go stale when xbl.io redesigns.
7. **Mascot is the guide, not the engine.** Mascot narrates the Xbox connection modal in `helpful` mood; does NOT appear in toasts (utilitarian); appears in the error-detail modal if the user clicks "See details →" (sardonic on hard errors).
8. **Steam-first polish.** Steam is the workhorse for this phase — most likely to be the friend-network's first connection. Xbox gets the same shape but acknowledges its third-party dependency in the UI (`Xbox · unofficial`).

---

## Information Architecture

### Routes

| Route | Purpose | Render strategy |
|---|---|---|
| `/settings` *(extended)* | Sidebar gains `Connections` entry; main content adds `#connections` section below `#profile` | RSC + client island for platform cards (TanStack Query polling) |
| `/api/auth/steam` | OpenID 2.0 start endpoint — redirects to `https://steamcommunity.com/openid/login` with our return-to URL | Node runtime |
| `/api/auth/steam/callback` | OpenID 2.0 return endpoint — verifies signature against Steam, extracts SteamID64, upserts `platform_connections`, triggers first import, redirects to summary route | Node runtime |
| `/api/connect/xbox` | POST target for OpenXBL key paste — validates key against `xbl.io/api/v2/account`, AES-GCM-encrypts, persists, triggers import | Node runtime |
| `/api/imports/[importId]/status` | Polled JSON endpoint returning current state of an import row | Node runtime |
| `/library/import/[importId]` | Post-import summary screen with merged / new / unmatched buckets | RSC + client island for polling until `status='completed'` |

No route under `/u/[username]/...` — imports are a private, per-user concern (Settings + the per-import summary URL).

### Entry points

1. **Onboarding nudge.** After the user reaches 5 logs (existing hook in onboarding per master plan line 324), an inline panel on `/home` says: *"Skip the manual entry — connect Steam or Xbox to bulk-import your library."* CTA → `/settings#connections`.
2. **Settings page anchor.** Direct nav target (`/settings#connections`) for users who proactively look for it.
3. **Empty-state on `/library`.** When `count(logs) === 0`, the empty-state CTA gains a secondary `Or connect Steam →` link next to the existing `Log your first game` primary.
4. **Toast deep-link.** Any active or errored import toast routes to `/settings#connections` and scrolls the relevant card into view.

### Sidebar nav update

[app/(app)/settings/page.tsx:18](app/(app)/settings/page.tsx:18) currently has only `Profile` with a `Future sections…` comment. Phase 3 makes it:

```
Settings
├── Profile          (#profile)     ← existing
└── Connections      (#connections) ← new
```

No `Account` / `Privacy` / `Notifications` yet — only land sections we ship. Existing `Future sections` comment is preserved.

---

## Architecture

### Adapter interface

Defined once in `lib/imports/adapters/types.ts`; each platform implements it.

```ts
export interface LibraryImporter {
  /** Authenticates the user and returns what we persist to platform_connections. */
  connect(input: ConnectInput): Promise<ConnectResult>;

  /** Returns a chunk of games. With `since`, returns only deltas since that timestamp. */
  fetchLibrary(
    connection: PlatformConnection,
    options: { cursor?: string; since?: Date },
  ): Promise<{ games: ImportedGame[]; nextCursor: string | null }>;

  /** Revokes tokens / cleans up. No-op for Steam; clears stored key for Xbox. */
  disconnect(connection: PlatformConnection): Promise<void>;
}

export type ConnectInput =
  | { kind: 'steam'; steamId: string }              // post-OpenID-verify
  | { kind: 'xbox';  openxblKey: string };          // post-paste

export interface ConnectResult {
  externalId: string;                                // Steam: SteamID64; Xbox: XUID
  accessTokenPlaintext: string | null;               // Xbox: the OpenXBL key (caller encrypts); Steam: null
  displayHandle: string | null;                      // gamertag / persona name (cached for UI)
}

export interface ImportedGame {
  externalId: string;          // Steam appid / Xbox titleId
  title: string;
  hoursPlayed: number | null;  // Steam: playtime_forever/60. Xbox: null (no playtime)
  lastPlayedAt: Date | null;
  releaseYear: number | null;  // optional hint to RAWG matching
}
```

### Engine — Supabase Edge Functions

Two functions, sharing a `_shared/import-engine.ts` core:

- **`import-platform`** — receives `{ importId }`. Loads the import row + connection, decrypts tokens as needed, instantiates the right adapter, pages `fetchLibrary`, RAWG-matches each game, runs merge.ts, upserts logs, updates `imports.imported_count` and `imports.conflicts_jsonb` after each chunk. On completion → `status='completed'`. On hard error → `status='failed'` + `error_message`. **Idempotent by design**: the `(user_id, game_id, is_replay)` unique constraint on `logs` plus the pure-function semantics of `merge.ts` make re-running the engine safe — duplicate inserts collide, merge updates converge. `imported_count` is for the progress UI, not for resume control. A retried run simply starts from the beginning; previously-imported games short-circuit through the existing-log code path.
- **`daily-sync`** — invoked by Supabase pg_cron at 04:00 UTC. Iterates `platform_connections WHERE is_active AND last_synced_at < now() - interval '23 hours'`. Creates one `imports` row per connection with `surfaced=false`, fires `import-platform` for each (capped at 10 concurrent).

Triggering from the Next app: `lib/imports/server-actions.ts → triggerImport()` writes the `imports` row and `fetch()`-es the Edge Function URL with the service-role key in the header. **Fire-and-poll**: the Server Action returns immediately with `importId`; the client polls via `/api/imports/<id>/status` every 2s through TanStack Query (`refetchInterval: status in ['queued','running'] ? 2000 : false`).

### Dependencies (new this phase)

Per the locked stack constraint, dep additions need to be explicit:

| Package | Purpose | Where |
|---|---|---|
| `openid` (npm — the older OpenID 2.0 library, not `openid-client`) | Steam OpenID 2.0 round-trip + signature verification | `app/api/auth/steam/route.ts` + `app/api/auth/steam/callback/route.ts` |
| — | OpenXBL access is plain `fetch` against `xbl.io/api/v2/*` — no library | `lib/imports/adapters/xbox.ts` |
| — | Supabase Edge Function code runs on Deno; standard Deno fetch + npm imports via `npm:` specifier work fine — no additional Deno deps | `supabase/functions/*` |

No dep removals. No version bumps. No router or DB or auth dep changes.

### Security model — Steam OpenID 2.0

Steam uses OpenID 2.0 (not OpenID Connect). Two mitigations against the well-known replay-attack class:

1. **`openid.return_to` strict-match.** Our `/api/auth/steam/callback` route verifies the `openid.return_to` parameter on the redirect-back exactly equals the URL we sent on the way out (`${NEXT_PUBLIC_APP_URL}/api/auth/steam/callback`). Mismatches reject 401.
2. **`check_authentication` round-trip with Steam.** Our callback re-POSTs the entire response to `https://steamcommunity.com/openid/login` with `openid.mode=check_authentication`. Steam re-validates the signature server-to-server and returns `is_valid:true` only for genuine, unreused responses. Anything else rejects 401.

We do *not* persist a per-request nonce — Steam's `check_authentication` is the trust anchor here, and the `openid` npm library handles both checks idiomatically.

### File layout (new code)

```
lib/imports/
├─ adapters/
│  ├─ types.ts             LibraryImporter, ImportedGame, ConnectInput/Result
│  ├─ steam.ts             Steam Web API + OpenID verify helpers
│  ├─ xbox.ts              OpenXBL key flow + delta-detection
│  └─ manual.ts            Pseudo-adapter (UI-only marker, no fetch)
├─ rawg-match.ts           Game title → RAWG match (appid/titleid → known mapping → alias → fuzzy by title+year)
├─ merge.ts                Pure conflict-merge function (user data wins, platforms union, hours max)
├─ encryption.ts           AES-GCM helpers (encrypt-on-insert, decrypt-on-use)
├─ server-actions.ts       triggerImport, syncNow, disconnectPlatform, listConnections
└─ select.ts               Drizzle projections for imports + platform_connections

supabase/functions/
├─ _shared/
│  └─ import-engine.ts     Adapter-agnostic loop (load → page → match → merge → upsert → progress)
├─ import-platform/
│  └─ index.ts             Edge function entry — Deno runtime
└─ daily-sync/
   └─ index.ts             Cron entry — kicks off per-user import-platform runs

components/imports/
├─ platform-card.tsx       Connection card (5 states: not-connected / connecting / importing / connected / error)
├─ xbox-connect-modal.tsx  3-step modal walkthrough (Q2 choice)
├─ import-summary.tsx      Renderer for /library/import/[importId] (Q4 choice)
├─ import-toast.tsx        Singleton bottom-right pill mounted in layout (Q3 choice)
└─ illustrations/
   ├─ xbl-step-1.tsx       Pixel-art SVG of xbl.io homepage
   ├─ xbl-step-2.tsx       Pixel-art SVG of xbl.io dashboard with API Key tab highlighted
   └─ xbl-step-3.tsx       Pixel-art SVG of the API key string + copy affordance

app/api/
├─ auth/steam/
│  ├─ route.ts             OpenID 2.0 start (redirect)
│  └─ callback/
│     └─ route.ts          OpenID 2.0 return (verify + persist + trigger import)
├─ connect/xbox/
│  └─ route.ts             POST OpenXBL key → validate → encrypt → persist → trigger import
└─ imports/
   └─ [importId]/
      └─ status/
         └─ route.ts       JSON status endpoint for polling

app/(app)/settings/_sections/
└─ connections-section.tsx New — renders 3 platform cards + Sync history drawer

app/(app)/library/import/[importId]/
├─ page.tsx                Summary screen (RSC)
└─ loading.tsx
```

### Environment additions

New entries in `.env.example` and `lib/env.ts`:

```
# Steam Web API key (admin-only; user does not provide their own)
# https://steamcommunity.com/dev/apikey
STEAM_API_KEY=

# OpenID return-to URL is computed from NEXT_PUBLIC_APP_URL — no separate var

# Supabase Edge Functions
SUPABASE_FUNCTIONS_URL=              # https://<project>.supabase.co/functions/v1
# SUPABASE_SERVICE_ROLE_KEY already exists from Phase 0 — reused here for service-role auth

# Token encryption (AES-GCM, base64-encoded 32-byte key)
IMPORT_ENCRYPTION_KEY=

# Xbox: user-provided per-account via UI, no app-wide key
```

All optional at boot per the existing `lib/env.ts` pattern. If `STEAM_API_KEY` is missing, the Steam platform card renders a developer-facing `Steam imports unavailable — set STEAM_API_KEY` state. Xbox card stays functional (key is user-provided). Manual card never depends on env.

### Schema additions

One additive Drizzle migration for app-table changes, plus a Supabase-only migration for pg_cron scheduling. No destructive changes.

```sql
-- Migration: 000X_phase3_imports.sql (Drizzle-generated, app schema)

-- Conflict + unmatched tracking, plus the cron-vs-foreground "did we show this yet" flag
ALTER TABLE imports
  ADD COLUMN conflicts_jsonb jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN unmatched_jsonb jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN surfaced boolean NOT NULL DEFAULT true;

-- conflicts_jsonb : [{ logId, gameId, rule: 'platform_merge' }, ...]
-- unmatched_jsonb : [{ externalId, title, platform }, ...]
-- surfaced        : false ONLY for cron-driven syncs awaiting toast display

-- Multi-platform support on logs (additive; old column kept for back-compat)
ALTER TABLE logs
  ADD COLUMN platforms text[];

-- New code reads: platforms ?? (platform_played_on ? [platform_played_on] : [])
-- Manual log creation in Phase 3 dual-writes to both.
-- Imports write to platforms[] directly.
-- The singular text column is deprecated but not dropped this phase.
```

```sql
-- Migration: 000Y_phase3_cron.sql (Supabase-applied directly; not Drizzle-managed)

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Store the function URL + service-role key as Postgres GUCs so the cron job
-- doesn't have them hard-coded. Set via Supabase dashboard or:
--   ALTER DATABASE postgres SET app.supabase_functions_url = '...';
--   ALTER DATABASE postgres SET app.supabase_service_role_key = '...';

-- Schedule the daily-sync Edge Function call
SELECT cron.schedule(
  'daily-import-sync',
  '0 4 * * *',                       -- 04:00 UTC daily
  $$
    SELECT net.http_post(
      url     := current_setting('app.supabase_functions_url') || '/daily-sync',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key'),
        'Content-Type',  'application/json'
      ),
      body    := '{}'::jsonb
    ) AS request_id;
  $$
);
```

This second migration lives under `supabase/migrations/` (not under Drizzle's `drizzle/`) because pg_cron + pg_net are Supabase extensions and Drizzle introspection doesn't model them. The Edge Function code itself ships separately via `supabase functions deploy`.

Encryption rules: `accessTokenEncrypted` / `refreshTokenEncrypted` columns already exist in `platform_connections`. We use Node `crypto.createCipheriv('aes-256-gcm', ...)` with `IMPORT_ENCRYPTION_KEY`. For Steam, both encrypted columns stay NULL (we only need SteamID, stored plaintext in `externalId`). For Xbox, the OpenXBL key is encrypted into `accessTokenEncrypted` with format `base64(iv):base64(ciphertext):base64(authTag)`. Plaintext key is *never* sent to the client after the initial paste.

**Encryption-key rotation is out of scope for Phase 3.** If `IMPORT_ENCRYPTION_KEY` ever changes, existing Xbox connections will fail to decrypt on next use and surface as the standard `error` card state with `Reconnect` CTA — the user re-pastes their key and the new ciphertext is written under the new master key. This is a known one-way migration; a proper key-rotation flow (envelope encryption with per-row data keys, atomic re-encrypt) is a Phase 7 polish concern.

> ⚠️ **Migration safety reminder** (per [feedback_drizzle_auth_users_gotcha.md](memory/feedback_drizzle_auth_users_gotcha.md)): grep the generated migration for `CREATE TABLE "auth"."users"` and strip if present, even though the offender was historically only the 0000 migration.

---

## Data Flow

### Flow A · First import (Steam OpenID)

```
[User clicks "Connect Steam" on /settings#connections]
         ↓
[GET /api/auth/steam → constructs OpenID 2.0 request]
   return_to = ${NEXT_PUBLIC_APP_URL}/api/auth/steam/callback
         ↓
[302 → steamcommunity.com/openid/login]
         ↓
[User signs in + approves "$YourApp will know your SteamID"]
         ↓
[GET /api/auth/steam/callback?openid.signed=…&openid.identity=…]
   Verify signature by re-POSTing to Steam's check_authentication endpoint.
   Extract SteamID64 from the openid.identity URL (suffix after /id/).
         ↓
   INSERT/UPDATE platform_connections
     (user_id, platform='steam', external_id=SteamID64,
      access_token_encrypted=NULL, is_active=true)
     ON CONFLICT (user_id, platform) DO UPDATE
     SET external_id = excluded.external_id, is_active = true
         ↓
   INSERT imports
     (user_id, platform='steam', status='queued', surfaced=true)
   → returns importId
         ↓
   fetch(${SUPABASE_FUNCTIONS_URL}/import-platform, {
     method: 'POST',
     headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
     body: JSON.stringify({ importId }),
   })  ← fire-and-forget; no await
         ↓
   302 → /library/import/<importId>
         ↓
[Client lands on summary route, RSC reads imports row + renders skeleton]
[Client-side island starts polling /api/imports/<id>/status every 2s]
         ↓
[Meanwhile, Edge Function execution begins:]
   UPDATE imports SET status='running', started_at=now()
         ↓
   adapter.fetchLibrary(connection, { cursor: undefined })
     → Steam GetOwnedGames API call → { games: [...all of them], nextCursor: null }
         ↓
   UPDATE imports SET total_count = games.length
         ↓
   For each chunk of 50 games:
     - rawg-match each title (appid → known mapping → alias → fuzzy title+year)
     - For each successfully matched game:
       - upsert(games) with the RAWG-backed catalog row
       - SELECT existing log for (user_id, game_id, is_replay=false)
       - call merge.ts → either INSERT new log OR UPDATE platforms/hours_played
       - if merged, append { logId, gameId, rule: 'platform_merge' } to conflicts_jsonb
       - if RAWG miss, append { externalId, title, platform: 'steam' } to unmatched_jsonb
     - UPDATE imports
         SET imported_count = imported_count + chunkLen,
             conflicts_jsonb = …,
             unmatched_jsonb = …
         ↓
   UPDATE imports SET status='completed', completed_at=now()
   UPDATE platform_connections SET last_synced_at=now()
         ↓
[Client's next poll returns status='completed']
[Summary screen swaps skeleton → final 2 (or 3) buckets]
[Toast in app layout: importing → success → auto-dismiss 5s]
```

### Flow A' · First import (Xbox key paste)

Identical to Flow A from "fetch import-platform Edge Function" onward. The connection step is different:

```
[User clicks "Connect Xbox" on /settings#connections]
         ↓
[XboxConnectModal opens — 3 steps with mascot + pixel-art illustrations]
   Step 3 input: textarea for OpenXBL key
         ↓
[Form submit → POST /api/connect/xbox { key }]
   Server validates by calling xbl.io/api/v2/account with the key in X-Authorization
   → returns { xuid, gamertag } if key is valid; 401 if not
         ↓
   On 401: return error to modal, modal shows "Key was rejected — try again"
         ↓
   On success:
   - AES-GCM-encrypt the plaintext key using IMPORT_ENCRYPTION_KEY
   - INSERT/UPDATE platform_connections
       (user_id, platform='xbox', external_id=xuid,
        access_token_encrypted=<ciphertext>, is_active=true)
       ON CONFLICT (user_id, platform) DO UPDATE …
   - INSERT imports (user_id, platform='xbox', status='queued', surfaced=true)
   - fire-and-forget POST to import-platform Edge Function
   - return { importId } to the modal
         ↓
[Modal closes, client navigates to /library/import/<importId>]
   (proceeds identically to Flow A from here)
```

### Flow B · Daily sync (cron-driven delta)

```
[Supabase pg_cron @ 04:00 UTC every day]
         ↓
   Invokes daily-sync Edge Function
         ↓
   SELECT * FROM platform_connections
     WHERE is_active
       AND (last_synced_at IS NULL OR last_synced_at < now() - interval '23 hours')
         ↓
   For each connection (parallel, capped at 10 concurrent):
     - INSERT imports
         (user_id, platform, status='queued', surfaced=FALSE)  ← key difference
     - fetch /import-platform { importId }
         ↓
   import-platform runs as in Flow A, but the adapter is called with
   { since: lastSyncedAt }. Adapter returns only delta:
     - Steam: filter for games where appid is new OR playtime_2weeks > 0
     - Xbox: full re-pull, then diff against Upstash-cached previous response
              (cache key: imports:xbox:last:<userId>, TTL: 25h)
         ↓
   Resulting imports row often has imported_count=0 (no delta most days).
   Row still gets status='completed' so the Sync history shows a heartbeat.
         ↓
[Next time user loads any authenticated route, app layout RSC runs:]
   SELECT * FROM imports
     WHERE user_id = $current_user
       AND surfaced = FALSE
       AND status = 'completed'
       AND imported_count > 0
         ↓
   If any rows: ImportToast renders delta state:
     "+3 games from Steam since you were last here · See →"
     Auto-dismiss after 8s; clicking → /library?source=steam&since=<ts>
         ↓
   UPDATE imports SET surfaced = TRUE WHERE id IN (those rows)
   (done in a Server Action invoked on toast mount)
```

### Flow C · Conflict merge (pure function, easy to unit-test)

`lib/imports/merge.ts`:

```ts
type ConflictRule = 'platform_merge';

export type MergeResult =
  | { action: 'insert'; row: NewLogPayload }
  | { action: 'update'; logId: string; set: Partial<Log>; rule: ConflictRule };

export function mergeImportedGame(
  imported: ImportedGame & { gameId: number },
  existing: Pick<Log, 'id' | 'platforms' | 'platformPlayedOn' | 'hoursPlayed'> | null,
  platform: PlatformKey,
): MergeResult {
  if (!existing) {
    return {
      action: 'insert',
      row: {
        gameId: imported.gameId,
        status: 'backlog',
        platforms: [platform],
        platformPlayedOn: platform,        // dual-write for back-compat
        hoursPlayed: imported.hoursPlayed,
      },
    };
  }

  const existingPlatforms = existing.platforms
    ?? (existing.platformPlayedOn ? [existing.platformPlayedOn] : []);
  const mergedPlatforms = uniq([...existingPlatforms, platform]);

  // Max-of: Steam can be authoritative if larger; manual is authoritative if larger.
  // Tolerable race; conservative choice.
  const mergedHours = max(existing.hoursPlayed, imported.hoursPlayed);

  return {
    action: 'update',
    logId: existing.id,
    set: { platforms: mergedPlatforms, hoursPlayed: mergedHours },
    rule: 'platform_merge',
  };
}
```

Rules locked:

| Field | Rule |
|---|---|
| `status` | Never overwritten |
| `rating` | Never overwritten |
| `started_at`, `finished_at` | Never overwritten |
| `notes` | Never overwritten |
| `is_replay`, `is_private` | Never overwritten |
| `platforms` | Unioned |
| `hours_played` | Max of existing and imported |
| `platform_played_on` (legacy) | Untouched (only manual UI writes it) |
| `reviews` row | Untouched — keyed on `(user_id, game_id)`, not affected by merge |

### Polling endpoint shape

```ts
// GET /api/imports/[importId]/status
// Returns 404 if importId doesn't exist or doesn't belong to the current user.
{
  id: "uuid",
  status: "queued" | "running" | "completed" | "failed",
  stuck: boolean,                  // see "Stuck-queue mitigation" below
  importedCount: 47,
  totalCount: 207,
  errorMessage: null | string,
  conflicts: [{ logId, gameId, rule: "platform_merge" }, ...],
  unmatched: [{ externalId, title, platform }, ...],
  startedAt: "iso8601" | null,
  completedAt: "iso8601" | null,
}
```

Client (TanStack Query): `refetchInterval: status in ['queued','running'] && !stuck ? 2000 : false`. Stale UI is acceptable — last-known progress until the next tick.

**Stuck-queue mitigation.** If the fire-and-forget POST to `import-platform` silently fails (rare — network blip during fetch), the `imports` row stays at `status='queued'` indefinitely and the user sees a frozen progress bar. The status endpoint treats any `queued` row older than 5 minutes as `stuck: true` in the response payload. The summary screen renders this as a `Retry now` button that re-fires the Edge Function with the same `importId`. Polling pauses while `stuck: true` so we don't spin uselessly.

---

## Failure Handling

### Transient (auto-retry, no user action needed)

| Trigger | Detection | Retry strategy |
|---|---|---|
| Steam rate-limit | HTTP 429 | Exponential: 1s, 2s, 4s, 8s, 16s, 32s; cap at 6 attempts |
| Steam 5xx | Server error | Same backoff |
| OpenXBL rate-limit (150/hr free) | HTTP 429 | Longer backoff: 5m, 10m, 20m, 40m, 60m, 60m |
| OpenXBL 5xx | Server error | Standard exponential |
| Supabase / DB hiccup | PG connection error | 3 retries, 500ms between |

All transient retries happen *inside* the Edge Function. The import is resumable, so each retry continues from `imported_count`. If retry storm exceeds 30s, toast updates to *"Importing (retrying)…"* to acknowledge the user.

### Hard (user action required)

| Trigger | Card state | Recovery copy | Primary button |
|---|---|---|---|
| Steam profile private | red | *"Your Steam profile is set to private. Set it to Public for 5 minutes so we can import, then you can flip it back. [How? →]"* | `Retry sync` |
| OpenXBL key revoked / 401 | red | *"Your OpenXBL key was rejected. Generate a new one at xbl.io and reconnect."* | `Reconnect` |
| SteamID lookup persistently failing | red | *"We couldn't reach Steam for your account. Reconnect to refresh the link."* | `Reconnect` |
| RAWG totally down | yellow | *"Our game catalog (RAWG) is having issues. Pausing for now — will retry when it's back."* | `Retry now` |

### Partial-success (data quality)

- Some games don't match anything in RAWG. Stored to `imports.unmatched_jsonb` as `[{ externalId, title, platform }]`. The summary screen shows them as a third bucket with a `Help us match these →` link (currently inert — Phase 4 owns the manual-match UI).

### Failure surfacing

- **Toast**: error state stays visible until clicked or dismissed. Clicking deep-links to `/settings#connections` and auto-scrolls the failing card into view.
- **Card**: red border, contextual recovery copy, primary action button replaces "Sync now."
- **Mascot**: appears only if the user clicks "See details →" inside the card's expanded state. Mascot voice on hard errors is sardonic-insider (per Phase 2 voice rules): *"That key didn't work. Maybe it expired? Microsoft is making us guess."*

---

## UI Components

### `<PlatformCard>` — five states

Driven by `(platform_connection, latest_import_for_this_platform)`:

| State | When | Visual |
|---|---|---|
| `not-connected` | No connection row, or `is_active=false` | Neutral border. `Connect` primary button. Subtitle: short value prop. |
| `connecting` | OpenID round-trip / key validation in flight | Neutral border + spinner. *"Verifying with Steam…"* |
| `importing` | Latest import row `status='running'` | Accent border (purple). Progress bar + `47 / 207 games`. |
| `connected` | Connection active + no running import | Neutral border. `Connected · @gamertag · 207 games · 2h ago`. Inline `Sync now` + kebab (`Re-import full` / `Disconnect`). |

**`Sync now` vs `Re-import full` — distinct actions:**

- `Sync now` is a **delta sync.** Calls `import-platform` with `since=lastSyncedAt`. Fast (typically <5s, no games returned most invocations). Surfaced inline as the primary card button.
- `Re-import full` clears `platform_connections.last_synced_at` and calls `import-platform` with `since=undefined`, forcing a fresh full pull. The conflict-merge logic still protects user data (it's pure and idempotent — re-running it never overwrites edits). Hidden in the kebab because it's rarely needed — escape hatch for "imports look wrong, start over."
| `error` | Latest import row `status='failed'` OR last validation failed | Red border. Recovery copy. Contextual primary button. |

### `<XboxConnectModal>` — 3-step wizard

Each step has: progress bar (1/3, 2/3, 3/3), mascot speech bubble in `helpful` mood, pixel-art illustration of xbl.io, Back/Next buttons.

1. **Intro** — *"Microsoft doesn't ship a public games API. We use a community service called OpenXBL. It's stable."* + button: `Open xbl.io in new tab ↗`
2. **Get key** — *"On the xbl.io dashboard, click the API Key tab and copy the long string."* + illustration of the dashboard with API Key tab highlighted
3. **Paste** — *"Paste it here. We'll encrypt it before storing."* + textarea + `Connect Xbox` primary

### `<ImportToast>` — singleton in app layout

Mounted in `app/(app)/layout.tsx`. State machine, persisted via TanStack Query cache so it survives navigation:

| State | Trigger | Behavior |
|---|---|---|
| hidden | No active import + no unsurfaced delta | Not rendered |
| importing | `imports` row with `status in ('queued','running')` | Pill bottom-right, progress bar, clickable → `/settings#connections` |
| success | Recent `imports.completed_at < 5s ago` AND first-import surface | Success pill, auto-dismiss 5s |
| error | Latest `imports.status='failed'` AND unacknowledged | Red pill, sticky (no auto-dismiss), clickable |
| delta | Unsurfaced cron import found on app mount | `"+3 games from Steam since you were last here"` pill, clickable → `/library?source=steam&since=<ts>`, marks rows `surfaced=true` on mount |

**Multi-platform delta on the same return visit:** if both Steam and Xbox produce non-zero deltas while the user is away, render **one** aggregated toast with per-platform breakdown: `"+3 from Steam · +5 from Xbox · See →"`. Clicking → `/library?source=imports&since=<earliest_ts>`. Both rows are marked `surfaced=true`. The toast still auto-dismisses at 8s.

### `<ImportSummary>` — `/library/import/[importId]`

```
┌─────────────────────────────────────────────────┐
│  Steam import complete                          │
│  207 games · 3 already in your library          │
├─────────────────────────────────────────────────┤
│  Merged with existing logs                      │
│  [Hades] [Outer Wilds] [Celeste]                │
│  Your status, rating, and notes were kept.      │
│  Now also marked as on Steam.                   │
├─────────────────────────────────────────────────┤
│  204 new — added as backlog                     │
│  [grid of 204 cover thumbnails]                 │
├─────────────────────────────────────────────────┤
│  9 unmatched (optional — only if > 0)           │
│  Bootleg Game Collector's Edition · …           │
│  Help us match these → (Phase 4)                │
└─────────────────────────────────────────────────┘
        Continue to library →   (appears after 5s)
```

### `<ConnectionsSection>` — `/settings#connections`

```
Connected platforms
Auto-import your library from where you play.

┌ Steam card ────────────────────────────────────┐
│ ⨂ Steam        Connected · @bryan · 207 games │
│                Last synced 2h ago  [Sync now] ⋮│
└────────────────────────────────────────────────┘
┌ Xbox card ─────────────────────────────────────┐
│ ⨉ Xbox         · unofficial                    │
│                Not connected     [Connect Xbox]│
└────────────────────────────────────────────────┘
┌ Manual card (dashed) ──────────────────────────┐
│ ⌧ Manual       Switch + physical               │
│                12 games        [Log a game →]  │
└────────────────────────────────────────────────┘

                                Sync history (12) ▾
```

`Sync history` expands an in-place list of the user's last 10 `imports` rows, each clickable to its summary URL.

---

## Verification Gate

Phase 3 ships when **all** of these work on staging:

1. **Connect Steam via OpenID** — click `Connect Steam`, complete the Steam OpenID round-trip, land on `/library/import/<importId>` skeleton.
2. **First import completes** — progress polls every 2s, summary screen swaps in with ~200 games at `backlog`, `hoursPlayed` populated where Steam reports playtime, `platforms = ['steam']`, `platformPlayedOn = 'steam'`.
3. **Conflict merge** — a pre-existing manually-logged Hades (status `completed`, rating 4.5, notes filled) survives the import: status, rating, notes, `finishedAt` all unchanged. `platforms` is now `['pc', 'steam']`. `platformPlayedOn` is still `'pc'`. Summary screen shows it under "Merged with existing logs".
4. **Xbox connection modal** — `Connect Xbox` opens the 3-step modal, mascot copy renders in `helpful` mood, pixel-art illustrations load, key paste validates against `xbl.io/api/v2/account`, the key is AES-GCM-encrypted in `access_token_encrypted` (SQL spot-check: value is opaque ciphertext, not the raw key), import triggers.
5. **Daily sync produces delta toast** — manually back-date `platform_connections.last_synced_at` to 25h ago, invoke `daily-sync` Edge Function via `supabase functions invoke`, log one new game on Steam in the wild, then on next app mount: new game appears in `/library` AND the `+1 game from Steam` toast fires AND clicking the toast lands at `/library?source=steam&since=<ts>`. The `imports.surfaced` flag flips to `true` after display.
6. **Error states** — submit an obviously-invalid OpenXBL key (`"bad"`), Xbox card flips to red state with recovery copy *"Your OpenXBL key was rejected. Generate a new one at xbl.io and reconnect."* and `Reconnect` button. Toast displays sticky error.
7. **Disconnect** — kebab → `Disconnect` on Steam card, confirmation modal: *"Your imported games stay. We'll just stop syncing."*, confirm, card reverts to `not-connected`, all 207 logs remain in `/library`, `platform_connections.is_active = false` (verified via SQL).
8. **Resumability** — kill the Edge Function mid-import (manually halt logs), restart by hitting `Sync now`, see the import resume from where it stopped (not duplicate already-imported games — `(user_id, game_id, is_replay)` unique constraint prevents this anyway, but progress counter should keep moving forward).

---

## Non-goals (explicit — captured to prevent scope creep)

- **PSN adapter** — deferred to Phase 3.5 or absorbed into Phase 7 polish. NPSSO cookie flow + Sony's unstable unofficial API don't fit the polish bar this phase.
- **Auto-promote `backlog` → `playing`** when Steam playtime jumps from 0 → significant. Phase 4 territory (Taste Fingerprint integrates playtime signals).
- **`log_platforms` junction table** + dropping `logs.platformPlayedOn`. Dual-write to `platforms[]` + `platformPlayedOn` is good enough for Phase 3. The cleanup is Phase 5+ work.
- **"Help us match these" manual-match UI** for RAWG misses — surface the bucket on the summary screen but the action link is inert until Phase 4.
- **Notifications primitive** for sync results — the toast is enough for now; Phase 5 designs notifications holistically (email digest, in-app bell, etc.).
- **Barcode scanner** for the Manual platform — flagged in master plan as a future hook; not Phase 3.
- **Steam `GetRecentlyPlayedGames`** endpoint — currently unused; could power "started playing X" detection in Phase 4.
- **Per-platform import settings** ("don't import games under 10 minutes", "exclude family-sharing", etc.). All-or-nothing pulls this phase.

---

## Decision Log

Decisions made during brainstorming on 2026-05-11 (user defaulted to recommendation on every Section presentation after answering Q1–Q7):

| # | Question | Choice | Reasoning |
|---|---|---|---|
| 1 | MVP scope | Steam + Xbox + Manual (PSN deferred) | NPSSO cookie flow has brutal friction + unstable third-party API; soft-launch base isn't PSN-heavy |
| 2 | Xbox connection UX | 3-step modal walkthrough with pixel-art illustrations + mascot narration | Modal's polish ceiling justifies the extra component; pixel-art doesn't go stale when xbl.io redesigns |
| 3 | Sync progress surface | Persistent bottom-right toast (Letterboxd / Spotify pattern) | Familiar pattern, cross-route persistence, gracefully handles tab close |
| 4 | Conflict resolution surface | Post-import summary screen at `/library/import/<importId>` | One-time experience justifies dedicated route; doubles as a portfolio screenshot |
| 5 | Connected Platforms layout | Card grid (3-up) — inline `Sync now`, kebab for destructive | 2 connectors + manual is a small set; cards beat rows for skim density at this scale |
| 6 | Failure UX location | Inline on the card (red border + contextual recovery copy) | Spatial mapping to the platform that failed; no banner indirection |
| 7 | Daily sync delta surface | Toast on return (`+3 games from Steam`) with `surfaced` flag | Proves the connection is doing work without bringing in notification primitive |

---

End of spec.
