# IGDB Mechanics Integration — Design Spec

| Field | Value |
|---|---|
| **Date** | 2026-05-13 |
| **Status** | Approved |
| **Goal** | Populate the empty `mechanics` column on the taste page by integrating IGDB's structured gameplay metadata. Add `game_modes` and `player_perspectives` as separate facets. AI fallback covers the ~5% of games IGDB doesn't carry. |
| **Verification gate** | (a) DB query: `with_mechanics > 4750` (≥94% of 5,053 games) AND `with_modes > 4750` AND `with_perspectives > 4750`. (b) Manual: `/u/itsbryanfam/taste` Top Mechanics card shows ≥5 entries with non-zero bars; the AI narrative references at least one mechanic term after Refresh fingerprint. |
| **Origin** | Surfaced during the 2026-05-13 taste-page outage debug. RAWG has no mechanics field → catalog-wide gap → mechanics card shows "No signal yet" for all users. Memory entry: `taste_page_outage_2026_05_13.md`. |
| **Companion HTML** | None — architectural spec, no UI mockups required. |

---

## Context

The taste page (`/u/{name}/taste`) was non-functional 2026-05-13 due to three stacked production bugs. Two were fixed earlier in the session: missing Edge Function deploys, and bare-row imports. The third — empty `mechanics` column — couldn't be fixed at the source because RAWG simply doesn't provide mechanics data. A research agent compared 7 alternative sources; IGDB was the only option that is simultaneously **robust** (structured fields, not freeform tags), **legal** (free for non-commercial; the Twitch DSA's 24h-cache rule applies to Twitch Content not third-party game metadata), **easy to map** (every field returns a clean string array via the GraphQL-like `/games` endpoint), and has the **coverage** (~95% of typical Steam libraries via `external_games.uid` Steam-appid mapping).

The user holds the Twitch app credentials in `.env` (DEV ONLY — to be rotated before any production deploy or public-PR merge). Production deploy of IGDB-using code is out of scope for this spec; we ship the dev-environment integration + run the catalog backfill against the live DB, then the user rotates secrets and deploys IGDB code in a follow-up.

---

## Locked Design Principles

1. **Steam appid is the precision bridge; name+year is the fallback; AI is the safety net.** Each step degrades precision but increases coverage. End-state target: ≥99% of catalog has at least one mechanics entry.
2. **Three facets, three columns, three vectors.** Game modes, player perspectives, and mechanics each get their own DB column, their own taste-engine vector, and their own UI card. IGDB's themes facet merges into the existing `themes` column with set-union (denser data than RAWG tags alone).
3. **Vocabulary is pinned, hand-curated, and the source of truth for both IGDB normalization and AI fallback.** A single `lib/igdb/vocabulary.ts` file defines what counts as a valid value in any column. IGDB results filter through it; AI prompts constrain to it. Same shape regardless of source.
4. **Token cache in Postgres, shared between Next-side and Edge-side.** Refetch only when within 5 minutes of expiry. ~1 token call per ~60 days at steady state.
5. **Backfill is idempotent and resume-safe.** Every backfill script honors `BACKFILL_LIMIT` and `BACKFILL_DRY_RUN=1`, matches the convention in `scripts/backfill-rawg-detail.ts`. Each game's resolution status is recorded (`igdb_resolved_at`, `igdb_id`) so re-runs and AI-fallback runs trivially target the right rows. `steam_appid` is filled as a side-effect of Phase 1 (read from IGDB's `external_games` records) rather than from a separate backfill pass — no separate audit-chain reconstruction needed.
6. **DEV credentials only.** Production deploy of IGDB code is a separate session. The current secrets stay out of `vercel env` and Supabase Function secrets until rotated.

---

## Decision log

Three clarifying questions locked the architecture; three design sections were approved as recommended without amendment.

| # | Question | Decision | Rationale |
|---|---|---|---|
| 1 | Session scope | **Full scope: MVP + import hook + AI fallback** | User explicitly chose the most ambitious option. Single-session delivery accepted as ~4–6 hr lift. |
| 2 | RAWG → IGDB id mapping strategy | **Steam appid bridge (with name+year fallback, AI fallback for the rest)** | IGDB's `external_games` endpoint resolves Steam appid → IGDB id with one batched call per 500 games. Highest precision at the cost of one new schema column. |
| 3 | Mechanics shape (one column vs multi-facet) | **Separate columns per IGDB facet** | Three facets are semantically distinct enough to weigh differently in future AI prompts. Modest schema work upfront preserves flexibility. UI grows from 2x2 to 3x2 grid. |

| # | Section | Decision |
|---|---|---|
| S1 | Architecture + Schema | Approved as recommended: `lib/igdb/` package, `supabase/functions/_shared/igdb-engine.ts` mirror, 5 schema additions, `app_secrets` token-cache table. |
| S2 | Vocabulary + AI fallback | Approved as recommended: pinned vocab file with one-time hand-curation pass, IGDB themes merged into existing themes column with dedup, AI fallback writes to the same columns with constrained allow-list. |
| S3 | Backfill + import hook + verification | Approved as recommended: 4-phase backfill execution, Edge import-platform v11 hook, 3x2 chart-grid layout, automated coverage queries + manual page reload. |

---

## Architecture

### File layout

```
lib/igdb/
  client.ts              IGDB HTTPS client (POST /games, /external_games, /themes, /keywords)
  twitch-oauth.ts        App-access-token getter with TTL cache
  resolver.ts            RAWG game id → IGDB id via Steam appid bridge + name+year fallback
  vocabulary.ts          Pinned allow-list (game_modes / perspectives / themes / mechanics)
  normalize.ts           Cleanup: lowercase fold for dedup, drop noise, cap at 20 per facet

scripts/
  refresh-igdb-vocab.ts       Phase 0 setup: pull /themes + /keywords, hand-curate, write vocabulary.ts
  backfill-igdb.ts            Phase 1: resolve+enrich every games row; side-effect-fills steam_appid
  backfill-mechanics-ai.ts    Phase 2: AI fallback for IGDB-missed games

supabase/functions/_shared/
  igdb-engine.ts         Deno mirror of lib/igdb/{client,twitch-oauth,resolver}.ts (used by import-engine.ts)

components/taste/
  chart-grid.tsx         Extended from 2x2 to 3x2: Genres / Themes / Mechanics / Modes / Perspectives / Session Length
```

`lib/igdb/` mirrors the `lib/rawg/` pattern. Both Next-side server actions and the Edge import hook share the same vocabulary + normalization rules; the Deno mirror in `_shared/igdb-engine.ts` is byte-identical-by-policy to the Node-side, same convention as `_shared/import-engine.ts` mirroring `lib/imports/merge.ts`.

### Code dependencies

```
lib/igdb/client.ts ──depends on──▶ lib/igdb/twitch-oauth.ts ──depends on──▶ app_secrets table
lib/igdb/resolver.ts ──depends on──▶ lib/igdb/client.ts
lib/igdb/normalize.ts ──depends on──▶ lib/igdb/vocabulary.ts
scripts/backfill-igdb.ts ──depends on──▶ {lib/igdb/resolver, lib/igdb/client, lib/igdb/normalize}
supabase/functions/_shared/igdb-engine.ts ──vendors──▶ lib/igdb/{client,twitch-oauth,resolver,normalize,vocabulary}
```

---

## Schema changes — Drizzle migration `0008_igdb_facets`

**Additions to `games` table:**
```ts
steamAppid:           integer("steam_appid"),                                       // for IGDB resolver via external_games
gameModes:            text("game_modes").array(),                                   // ["Single player", "Multiplayer", ...]
playerPerspectives:   text("player_perspectives").array(),                          // ["First person", "Third person", ...]
igdbId:               integer("igdb_id"),                                           // null = either unresolved OR resolved-and-not-found
igdbResolvedAt:       timestamp("igdb_resolved_at", { withTimezone: true }),        // null = never tried
```

`mechanics text[]` already exists (since Phase 0); we now populate it.
`themes text[]` already exists; IGDB themes facet merges in via set-union.

**New table `app_secrets`:**
```ts
appSecrets = pgTable("app_secrets", {
  key:       varchar("key", { length: 64 }).primaryKey(),  // e.g. "igdb_app_token"
  value:     text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```
RLS: service-role only (no policies = default deny under RLS-on; we leave RLS off this table since it's never exposed via PostgREST and only touched by `lib/igdb/twitch-oauth.ts` + the Edge mirror via `DATABASE_URL`).

**Migration generation:** `pnpm drizzle-kit generate`. Per project memory ([Drizzle auth.users gotcha](C:\Users\corte\.claude\projects\C--Projects-Letterboxd-for-Games\memory\feedback_drizzle_auth_users_gotcha.md)) — grep generated SQL for `CREATE TABLE "auth"."users"` and strip if present.

**Index:** `CREATE INDEX games_steam_appid_idx ON games (steam_appid) WHERE steam_appid IS NOT NULL;` to keep the resolver lookups fast.

---

## Token storage

Twitch app-access-tokens have a ~60-day TTL. We obtain via the OAuth client-credentials flow:

```http
POST https://id.twitch.tv/oauth2/token
  ?client_id=$IGDB_CLIENT_ID
  &client_secret=$IGDB_CLIENT_SECRET
  &grant_type=client_credentials
```

Response: `{ access_token, expires_in (seconds), token_type: "bearer" }`.

`lib/igdb/twitch-oauth.ts` exports `getAppAccessToken(): Promise<string>`:
1. SELECT from `app_secrets WHERE key = 'igdb_app_token'`. If row exists AND `expires_at > NOW() + interval '5 min'`, return the cached value.
2. Otherwise: POST to Twitch token endpoint, parse response, UPSERT into `app_secrets` with `expires_at = NOW() + (expires_in - 300) seconds` (5-min safety margin baked in), return the new token.
3. On Twitch HTTP 5xx: retry once after 1s; if still failing, throw `TwitchTokenUnavailableError` (caller decides whether to retry or surface as backfill failure).

The Deno mirror in `supabase/functions/_shared/igdb-engine.ts` is identical, just using `postgres` directly instead of the Drizzle client.

**No client-side use.** Token reading is `server-only`; Next-side calls IGDB only from server actions / scripts.

---

## Vocabulary

`lib/igdb/vocabulary.ts` exports four `Set<string>` allow-lists:

```ts
export const IGDB_GAME_MODES: ReadonlySet<string>;          // ~6 terms (IGDB enumerates these explicitly)
export const IGDB_PLAYER_PERSPECTIVES: ReadonlySet<string>; // ~7 terms
export const IGDB_THEMES: ReadonlySet<string>;              // ~22 terms
export const IGDB_MECHANICS: ReadonlySet<string>;           // ~150 terms — hand-curated from IGDB /keywords top-N
```

The first three are essentially fixed (IGDB rarely adds new modes/perspectives/themes). The mechanics set is the curated subset of IGDB's keywords endpoint.

### Generation flow (one-time + occasional refresh)

`scripts/refresh-igdb-vocab.ts`:
1. POST `/themes` with `fields name; limit 50;` → all themes (~22 today).
2. POST `/player_perspectives` with `fields name; limit 20;` → all perspectives (~7).
3. POST `/game_modes` with `fields name; limit 20;` → all modes (~6).
4. POST `/keywords` with `fields name, games_count; sort games_count desc; limit 500;` → top-500 community keywords by usage.
5. Print the keyword list to stdout with `games_count` for hand-review. The user marks each keyword keep/drop in a checklist; the script writes the kept ones into `vocabulary.ts`.

**Hand-curation criteria (drop):**
- Platform/engine names (Linux, Unity, Unreal, Steam Cloud)
- Pure genres covered elsewhere (FPS, RPG, Adventure)
- Themes that overlap with the IGDB themes facet (Horror, Sci-fi)
- One-game noise (`games_count < 50` is a useful cutoff)
- Subjective adjectives (Cute, Edgy, Casual)

**Hand-curation criteria (keep):**
- Gameplay-structure terms (Roguelike, Permadeath, Crafting, Procedural Generation, Turn-Based Combat)
- Distinct mechanics (Deck Building, Souls-like, Time Loop, Bullet Hell)
- Movement/combat verbs (Stealth, Parry, Wall Jumping)

The kept set is committed to git; `vocabulary.ts` is a generated-but-checked-in file with a header comment naming the script that produced it.

---

## Normalization

`lib/igdb/normalize.ts` exports `normalizeFacets(rawFacets)`:

```ts
type RawIgdbFacets = {
  game_modes: string[];
  player_perspectives: string[];
  themes: string[];
  keywords: string[];
};
type NormalizedFacets = {
  gameModes: string[];
  playerPerspectives: string[];
  themes: string[];      // for set-union merging into the existing themes column
  mechanics: string[];   // from IGDB keywords, allow-listed
};

function normalizeFacets(raw: RawIgdbFacets): NormalizedFacets;
```

For each input array:
1. Filter through the allow-list for that facet (case-insensitive comparison; preserve canonical IGDB casing for display).
2. Lowercase-fold for deduplication.
3. Cap at 20 entries per facet (matches the existing themes cap; bounds DB array sizes).

The output `themes` array is *additional* themes from IGDB; the caller merges with the existing `themes` column using set-union (case-insensitive dedup).

---

## RAWG → IGDB id resolver

`lib/igdb/resolver.ts` exports `resolveIgdbIds(games)`:

```ts
type GameToResolve = { id: number; title: string; releaseYear: number | null; steamAppid: number | null };
type ResolvedIds = Map<number /* games.id */, number | null /* igdbId, null = not found */>;

function resolveIgdbIds(games: GameToResolve[]): Promise<ResolvedIds>;
```

**Strategy** (per-batch of 500):
1. **Bucket A: has steamAppid.** Single POST `/external_games` with `fields game,uid; where uid = ('730','440',...) & category = 1; limit 500;` → returns `{ game: igdbGameId, uid: steamAppid }[]`. Map back to our games.id by appid.
2. **Bucket B: no steamAppid (or Bucket A miss).** For each game, single POST `/games` with `fields id; where name = "X" & first_release_date > Y & first_release_date < Z; limit 1;` (year window: ±1 year). Run with concurrency=4 to respect IGDB's 4 req/sec rate cap. Returns the IGDB id or null.

Both buckets resolve in the same call; output is a single Map. Failures (HTTP errors, timeouts) → null entries in the map; caller decides whether to retry.

---

## Backfill execution — 3 phases

Run in strict order. Each phase exits cleanly before the next starts.

**Note on Steam appid:** The original Steam externalId isn't preserved on logs (only `platform_played_on='steam'` is recorded). Reconstructing appids from `imports.unmatched_jsonb` audit chains is unreliable for completed imports. **Resolution:** we don't backfill `steam_appid` directly. Instead, IGDB Phase 1 fetches `external_games.uid` as part of the facets request and we write `games.steam_appid = uid` as a side-effect for any game where IGDB returns a Steam external_games entry. Games that fail IGDB resolution stay with `steam_appid IS NULL` — they go to AI fallback (Phase 3) and don't need a Steam appid anyway. New imports (post-import-platform v11) set `steam_appid` directly from the Steam externalId during the enrichment hook, no audit-chain reconstruction required.

This collapses what was originally planned as 4 phases into 3.

### Phase 0 (manual setup) — Vocabulary refresh + hand-curation

`scripts/refresh-igdb-vocab.ts` (described above). User runs this once and reviews the keyword list. Output committed to git as `lib/igdb/vocabulary.ts`.

ETA: ~10 min including hand-curation pass.

### Phase 1 — IGDB backfill (resolution + facets + side-effect appid backfill)

`scripts/backfill-igdb.ts`:
1. SELECT `id, title, EXTRACT(YEAR FROM released) AS release_year, steam_appid FROM games WHERE igdb_resolved_at IS NULL` (5,053 candidates initially).
2. For each batch of 500: call `resolveIgdbIds()`. For Steam-appid-bucket games: also write `steam_appid` back if discovered.
3. For each non-null IGDB id: POST `/games` with `fields game_modes.name, player_perspectives.name, themes.name, keywords.name, external_games.uid, external_games.category; where id = (...);` → up to 500 games per request.
4. For each row: call `normalizeFacets()`, merge themes via set-union, UPDATE games row with `game_modes`, `player_perspectives`, `themes` (merged), `mechanics`, `igdb_id`, `igdb_resolved_at = NOW()`, `steam_appid` (if discovered).
5. For each null IGDB id (resolution failed): UPDATE `igdb_resolved_at = NOW(), igdb_id = NULL` so Phase 4 can pick them up.
6. Honor `BACKFILL_LIMIT`, `BACKFILL_DRY_RUN`. Progress log every 100 games. Resume-safe (re-querying `igdb_resolved_at IS NULL` skips done rows).

Concurrency: 4 (IGDB rate cap is 4 req/sec). At 500 games per request, the batched fetch dominates over the per-game fallback queries.

ETA: ~25 min for 5,053 games.

### Phase 2 — AI fallback

`scripts/backfill-mechanics-ai.ts`:
1. SELECT `id, title, genres, description FROM games WHERE igdb_resolved_at IS NOT NULL AND igdb_id IS NULL AND (mechanics IS NULL OR array_length(mechanics, 1) = 0)` (estimated ~250 candidates).
2. For each: build prompt with the game's title + genres + description + the full vocabulary inline.
3. Call `callRouter({ feature: "mechanics_fallback", system, user, maxTokens: 300 })`. Same multi-provider router used elsewhere; telemetry rows written to `ai_calls`.
4. Parse with `safeParseJson` → drop any value not in its allow-list → cap each array at 20.
5. UPDATE games row with `game_modes`, `player_perspectives`, `mechanics` (no themes from this path; we don't trust the AI to invent themes that align with the IGDB taxonomy without the IGDB context).
6. Concurrency: 5 (router providers vary; 5 is a safe shared cap).

ETA: ~5 min for ~250 games.

---

## Import hook

`supabase/functions/_shared/import-engine.ts` `searchRawgAndUpsert`: after the existing INSERT, if the imported game came from Steam (caller passes the externalId as `steam_appid`), invoke `enrichWithIgdb(sql, gameId, steamAppid)`:

1. POST IGDB `/external_games` with the single appid.
2. If resolved: POST `/games` with the IGDB id, normalize, UPDATE games row.
3. Failures swallowed — game still lands with mechanics empty; the next backfill pass picks it up.

For Xbox/manual imports (no Steam appid known): set `igdb_resolved_at = NOW()` and skip; AI-fallback eligible.

Adds ~600ms per newly-discovered game (one extra IGDB resolution + one facets fetch). Acceptable in the import flow's existing concurrency-10 wave processing.

Redeploy as `import-platform v11`.

---

## UI updates

`components/taste/chart-grid.tsx` extends from 2×2 to 3×2 layout:

```
| Top Genres        | Top Themes        |
| Top Mechanics     | Game Modes        |
| Player Perspective| Session Length    |
```

Each new card uses the existing `ChartCard` + `ScoreBar` primitives. The component's signature gains two new props on `vectors`:

```ts
vectors: {
  genre: SparseVector;
  theme: SparseVector;
  mechanic: SparseVector;
  gameMode: SparseVector;          // NEW
  playerPerspective: SparseVector;  // NEW
};
```

`lib/taste/aggregate.ts` `aggregateFingerprint` gains corresponding accumulators (mirror of mechanics; same weight × sign math). `lib/taste/server-actions.ts` `getFingerprint` SELECTs the two new columns, passes them through to the aggregator. `supabase/functions/_shared/taste-engine.ts` mirror: same additions.

`lib/taste/prompts.ts` `buildNarrativePrompt` and the rerank prompt: append `fmtVector("Game Modes", v.gameMode)` and `fmtVector("Player Perspectives", v.playerPerspective)` to the user-prompt blocks. The prompt-version constant bumps to `"v2"` (see project memory: bumping `NARRATIVE_PROMPT_VERSION` re-narrates users via the drift cron).

---

## Verification

### Automated coverage query

```sql
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE mechanics IS NOT NULL AND array_length(mechanics, 1) > 0) AS with_mechanics,
  COUNT(*) FILTER (WHERE game_modes IS NOT NULL AND array_length(game_modes, 1) > 0) AS with_modes,
  COUNT(*) FILTER (WHERE player_perspectives IS NOT NULL AND array_length(player_perspectives, 1) > 0) AS with_perspectives,
  COUNT(*) FILTER (WHERE igdb_resolved_at IS NOT NULL) AS resolved,
  COUNT(*) FILTER (WHERE igdb_id IS NOT NULL) AS igdb_matched,
  COUNT(*) FILTER (WHERE steam_appid IS NOT NULL) AS with_steam_appid
FROM games;
```

**Pass criteria:** `with_mechanics ≥ 4750` (≥94%) AND `with_modes ≥ 4750` AND `with_perspectives ≥ 4750`. The AI-fallback contribution counts toward `with_mechanics` even when `igdb_id IS NULL`.

### Manual

1. Reload `/u/itsbryanfam/taste`. The 3×2 grid should render.
2. Top Mechanics card shows ≥5 entries with non-empty bars.
3. Game Modes card shows ≥3 entries (Singleplayer, Multiplayer, Co-op typical for a Steam library).
4. Player Perspectives card shows ≥2 entries.
5. Click Refresh fingerprint. Wait for "Fingerprint refreshed" toast.
6. New narrative includes at least one mechanic term ("roguelike", "stealth", "permadeath", etc.) — measured by spot-check, not asserted.

### Test coverage

Vitest coverage for: `lib/igdb/normalize.ts` (allow-list filtering, dedup, cap-at-20), `lib/taste/aggregate.ts` (extended for new facets), `lib/igdb/resolver.ts` (Steam appid bucket vs name+year fallback, mocked IGDB responses).

---

## Out of scope

- Production deploy of IGDB code. Dev-only this session; user rotates secrets, then deploys in a follow-up.
- New games schema/UI for individual game pages (lib/games/server-actions.ts game-detail-page render). The IGDB data lands in the games table and is available for rendering, but no game-detail-page changes ship in this spec.
- Periodic re-fetch cron (e.g. weekly refresh of games whose IGDB data is >90 days old). Backfill is one-shot; staleness is acceptable for now.
- Multi-language support. IGDB returns English by default; vocabulary is English-only.
- Migrating existing themes column to canonical-case dedup. We merge IGDB themes in via case-insensitive dedup but don't normalize the existing RAWG-sourced themes.
- Updating the rerank-recs Edge Function prompt — `buildRerankPrompt` already includes `themes` and `mechanics` per candidate; modes/perspectives could be added later but YAGNI for now.

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| IGDB rate limit (4 req/sec) trips during backfill | Concurrency=4 cap; batch size 500/request keeps total request count low |
| Twitch token expires mid-backfill | TTL cache refreshes 5 min before expiry; backfill duration ~25 min < 60-day TTL by ~7 orders of magnitude |
| AI fallback hallucinates non-vocabulary values | Strict allow-list filter on output; values not in vocab dropped silently; telemetry tracks hit rate |
| Vocabulary drift (IGDB adds keywords; ours go stale) | `refresh-igdb-vocab.ts` is rerunnable; `vocabulary.ts` header records last-refreshed date |
| Steam appid backfill incorrect (wrong appid → wrong game) | We resolve via IGDB's `external_games`, which uses Steam's own appid; if IGDB's mapping is wrong, our mechanics will be wrong (acceptable — same-source error) |
| User rotates secrets mid-backfill | Backfill picks up env-var changes only on next process start; if rotated mid-run, current run continues with old token until expiry, then fails. User has been told not to rotate until session ends. |
| Migration breaks during apply | Standard `apply_migration` rollback path; the schema additions are additive (new columns + new table), no destructive changes |

---

## Implementation order (to be expanded by writing-plans skill)

1. Drizzle migration `0008_igdb_facets` — apply via `mcp__supabase__apply_migration`
2. `lib/igdb/twitch-oauth.ts` + Vitest test
3. `lib/igdb/client.ts` + Vitest test (mocked fetch)
4. `lib/igdb/vocabulary.ts` + `scripts/refresh-igdb-vocab.ts` + user hand-curation pass
5. `lib/igdb/normalize.ts` + Vitest test
6. `lib/igdb/resolver.ts` + Vitest test (mocked IGDB responses)
7. `scripts/backfill-igdb.ts` — dry-run on 5 games, then full run
8. `scripts/backfill-mechanics-ai.ts` — dry-run on 5 games, then full run
9. `lib/taste/aggregate.ts` + `supabase/functions/_shared/taste-engine.ts` mirror — extend for new facets
10. `lib/taste/server-actions.ts` `getFingerprint` — extend SELECT + aggregator inputs
11. `lib/taste/prompts.ts` + `supabase/functions/_shared/prompts.ts` mirror — append modes/perspectives blocks; bump `NARRATIVE_PROMPT_VERSION` to `"v2"`
12. `components/taste/chart-grid.tsx` + `tier-narrative.tsx` — extend props for new vectors, render 3×2 grid
13. `supabase/functions/_shared/igdb-engine.ts` mirror — vendored copy of lib/igdb/{client,twitch-oauth,resolver,normalize,vocabulary}
14. Extend `searchRawgAndUpsert` to call new `enrichWithIgdb()`; redeploy `import-platform v11`
15. Run automated coverage query; manual page reload + Refresh fingerprint to verify
