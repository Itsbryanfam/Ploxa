# Phase 6 — Recaps (Year-in-Review + Monthly Mini-Recap + Featured List) — Design Spec

| Field | Value |
|---|---|
| **Date** | 2026-05-14 |
| **Phase** | 6 of 7 |
| **Status** | Approved (brainstormed 2026-05-14) |
| **Goal** | Spotify-Wrapped-energy year-in-review for the game tracker: cinematic pixel-art pageant of 11 scenes per user-year, AI-captioned at seven moments (five per monthly variant), share-card OG per scene, lazy generated on first view with email pre-warm for the engaged cohort. Same engine drives a 7-scene monthly mini-recap. Plus a single-row "featured list" admin pin on `/discover` for the editorial-credibility lever the master plan called out — without building a new content pipeline. |
| **Verification gate** | First-view of `/u/{u}/year/{Y}` produces a payload-complete pageant within 10s; cached views <100ms. Sparse-data users (<10 logs) see a graceful mascot empty state, no AI calls, no row written. Monthly route skips three yearOnly scenes (taste evolution, surprise, reviewing arc) automatically. Email cohort gets pre-warmed rows; click-through is instant. Private profiles 404 the pageant for non-followers but still serve OG share images. 10 automated + 5 manual criteria, see verify gate table at end. |
| **Plan reference** | `~/.claude/plans/smooth-herding-flame.md` (Phase 6 — line 283) |
| **Companion HTML** | `docs/phase6-design.html` (rendered later) |

---

## Context

Phase 5 closed on 2026-05-13 (tag `phase-5-complete`, commit `a2f6170`) — beta launch milestone, full social graph + feed + lists + notifications + email digest + moderation. The five intervening sweeps shipped between then and 2026-05-14: production launch (2026-05-13), Codex audit fixes (2026-05-13), settings overhaul (2026-05-14, tag `settings-overhaul-complete`), IGDB integration backfilling mechanics + modes + perspectives to 99.9% / 98.3% / 79.7% coverage (2026-05-14), the 2026-05-14 audit fix sweep (27 commits, tag `audit-fixes-2026-05-14`), and the Tier 3 polish sweep (tag `tier3-polish-2026-05-14`). Then the brand rename to Ploxa landed (commit `506f9c8`).

The app today is feature-complete as a social game tracker with an AI taste layer, deployed to `ploxa.vercel.app` (repo `Itsbryanfam/Ploxa`). Beta-launch-grade.

Phase 6 turns the dial on the marquee viral moment. From the master plan: "Spotify Wrapped energy." From the Phase 5 next-phase guidance: "Aggregate `logs` + `reviews` + `lists` + taste evolution into a year-in-review payload (heavy batch job), AI-generate the narrative arc using the existing multi-provider router, render pixel-art animated cards." The `year_in_reviews` table already exists in `lib/db/schema.ts:749` as a forward-looking placeholder — no app reads yet.

**Scope this phase:** Full year-in-review + monthly mini-recap variant + a small editorial-pin affordance on `/discover`. The master plan's third Phase-6 line item ("editorial highlights / staff picks of 2026") is reframed: the lists feature already lets the admin create and publish a "Staff picks 2026" list; what was missing was a way to *feature* it. A 4-column `featured_lists` table + a one-page `/admin/featured` surface unlocks the editorial lever in a few hours of work, without building a separate content pipeline.

**Out of scope this phase:** Commissioned mascot art (deferred to Phase 7 Polish). Per-scene audio (no audio anywhere in pageant — visual + reduced-motion-respecting only). Public launch announcements / marketing site (Phase 7). Onboarding hook ("preview your year as a logged-out visitor") — Tier 3 polish candidate, not core.

This spec was produced via brainstorming on 2026-05-14 (text-only). Decisions recorded inline in the Decision Log; user picked the more ambitious option on 5 of 6 framing questions, defaulted to recommendation on the 6th.

---

## Locked Design Principles (apply throughout)

1. **Lazy generate-on-view, cache forever.** The `year_in_reviews` row is written once per `(user_id, year)` on first view. Past-year rows never invalidate. Current-year invalidates weekly via cron Jun 1 – Nov 30, then locks Jan 5 of the following year via `locked_at`. No pre-generation for users who never visit. Reduces AI spend to actual demand; aligns with Phase 5's pull-on-read principle.

2. **Email pre-warm for the cohort.** The "your year is ready" cron does TWO things in the same batch worker: send the email AND warm the cache row. Click-through is instant. Reuses Phase 5 digest cron pattern exactly — header-secret gated API route at `/api/internal/recap-email/run`, BATCH_CONCURRENCY=5 worker pool, Vault `phase6_cron_secret` (separate from `phase5_cron_secret`), per-row try/catch so one failure doesn't poison the batch.

3. **Engine parameterized by window.** A single aggregator function `buildRecap({userId, windowStart, windowEnd, mode: 'yearly'|'monthly'})` produces the payload for both surfaces. The scene catalog tags entries with `yearOnly?: true`; monthly mode filters those out automatically. One code path, two consumers — ~90% shared code, ~10% surface differences (route handler, cache table, OG path, email subject).

4. **Captioned scenes via existing AI router.** Each AI caption is one `lib/ai/router.ts` call with a shared zod schema `{caption: z.string().min(8).max(140)}`. Five scenes have AI captions in YIR mode (genre dominance, mechanic love, surprise, taste evolution, GotY), plus opening + closing — seven calls total per user. Monthly: five calls (yearOnly skipped). Failures fall back to deterministic `fallbackTemplate(payload)` strings — the pageant never breaks because of a flaky provider. Phase 2 retry-policy precedent.

5. **Mascot leads scene-to-scene.** The pageant auto-advances with mascot-beat → caption-reveal → data-viz-reveal → next-scene-transition. Framer Motion choreography via `AnimatePresence`. Reuses existing mascot poses from `components/mascot/states.ts` where they fit. Commissioned scene-specific pixel art is deferred to Phase 7 Polish — Phase 6 ships with the existing pose vocabulary and per-scene styling/framing variations.

6. **Visibility inherits from profile.** If `profile.visibility === 'private'`, `/u/{username}/year/{year}` 404s for non-followers (matches existing private-profile behavior set up in Phase 5 settings overhaul). OG share image is always public regardless — initiating the share via the share button IS the consent. Phase 4 taste card OG precedent: `/og/year/[username]/[year]` returns 200 even when the page route returns 404 to that viewer.

7. **Sparse-data floor at 10 logs in window.** Below 10, aggregator returns `{tier: 'too_sparse'}`. Page renders mascot empty state ("come back when you've logged a few more — I need material to work with"), no row written, no AI calls fired. Visit doesn't poison the cache; user can retry tomorrow once they've logged enough.

8. **Every scene shareable, closing summary featured.** Each scene card has a small `<Share2>` icon top-right (Web Share API with copy-link + Twitter fallback). Each scene maps to a `/og/year/[username]/[year]/scene/[i]/route.tsx` parameterized OG endpoint. The closing summary card is the BIG share moment — full Twitter + Discord + Copy-link buttons replace the small icon.

9. **Featured-list pin = single-row config.** New `featured_lists` table (one active row per surface). Admin route `/admin/featured` env-gated alongside `/admin/reports` via `ADMIN_USER_IDS`. Pinned list appears above existing trending sections on `/discover` landing. Pin pointer only — no new content pipeline. The pinned list itself is a regular admin-authored public list via the existing Phase 5 lists feature.

10. **Mascot stays in its lane.** Mascot present on pageant scenes + share moments. Absent from admin `/admin/featured` and from the sparse-data error state (lucide icons + neutral copy there). Same constraint as Phase 4 + Phase 5 — celebratory + state-indicator only by default, never near administrative or error contexts.

---

## Decision Log

Six decisions made during the 2026-05-14 brainstorm. Each table entry: question · options considered · choice + rationale.

| Q | Question | Options | Choice |
|---|---|---|---|
| 1 | Scope of Phase 6 | (A) Year-in-Review only · (B) YIR + monthly · (C) YIR + monthly + editorial-list pin · (D) YIR + editorial | **C — YIR + monthly + featured-list pin.** Featured-list reuses existing lists infra; cost is a single table + a tiny admin surface. Monthly reuses the YIR engine for ~10% delta. The "all three pillars from the master plan" outcome at the cost of one. |
| 2 | Presentation format | (A) Cinematic pageant (Spotify Wrapped) · (B) Reflective scrollable report (Letterboxd YIR) · (C) Hybrid scroll-paged | **A — Cinematic pageant.** What "Spotify Wrapped energy" means in 2026. The only of the three that produces a recordable share moment; mascot-leads-narrative makes sense only in a pageant. Mobile-first vertical 9:16; desktop falls back to centered phone-shape backdrop. |
| 3 | Scene count | (A) Lean 8 · (B) Classic 11 · (C) Grand 14 | **B — Classic 11.** Hits all game-tracker-specific moments (taste evolution, mechanic love, surprise outlier) without crossing into Wrapped-fatigue territory. Substitution map ensures floor of 8 scenes for any qualifying user. |
| 4 | AI scope | (A) Minimal: opening + closing only · (B) Captioned scenes: opening + closing + 5 caption scenes · (C) Full arc: one big call generating all captions | **B — Captioned scenes.** Maps to AI router's strength (bounded retryable calls per zod schema). Authoring concentrated on scenes where AI feels magical (Surprise, Taste evolution) — data scenes stay crisp. Per-scene fallback templates available if a call fails. |
| 5 | Generation trigger | (A) Cron-everyone precompute · (B) Lazy first-view + email pre-warm · (C) Pure lazy | **B — Lazy first-view + email pre-warm.** Pay-per-view cost; email cohort gets instant click-through via batch pre-warm in same worker as email send. Reuses Phase 5 digest cron pattern. |
| 6 | Monthly recap shape | (A) Full 11 adapted · (B) Lean monthly 7-scene subset · (C) Drastically different scenes | **B — Lean monthly 7-scene subset.** Same engine, scenes tagged `yearOnly: true` are filtered. Three drops: taste evolution (needs full year baseline), surprise (statistical outlier needs year), reviewing arc (year-summary moment). Also Top 5 → Top 3 and longest-game folded into Game-of-the-Month. |

---

## Architecture — module layout

| Path | Purpose |
|---|---|
| `lib/recaps/aggregate.ts` | `buildRecap({userId, windowStart, windowEnd, mode})` — pure function. Queries logs/reviews/lists/taste; returns typed `RecapPayload` or `{tier: 'too_sparse'}`. |
| `lib/recaps/scenes.ts` | Scene catalog — 11 entries each `{id, requiredData, aiCaption: boolean, yearOnly?: boolean, fallbackTemplate(payload)}`. |
| `lib/recaps/captions.ts` | `generateCaption(scene, payload)` — calls `lib/ai/router.ts` with `CaptionSchema` zod. Falls back to scene's `fallbackTemplate` on any failure path. Writes to `ai_calls` telemetry table. |
| `lib/recaps/featured.ts` | `getActiveFeaturedList(surface)` + `pinFeaturedList(listId, expiresAt?)` + `unpinFeaturedList(surface)`. Admin-only writes. |
| `lib/recaps/types.ts` | `RecapPayload`, `Scene`, `SceneId`, `RecapMode` types. |
| `lib/recaps/window.ts` | Helpers: `yearWindow(year) → {start, end}`, `monthWindow(year, monthIndex) → {start, end}`. |
| `app/(app)/u/[username]/year/[year]/page.tsx` | YIR page — server component. Cache-or-build, renders `<Pageant>`. |
| `app/(app)/u/[username]/year/[year]/loading.tsx` | Mascot "I'm reviewing your year…" loading state. |
| `app/(app)/u/[username]/month/[yyyymm]/page.tsx` | Monthly recap — same shape, `mode: 'monthly'`. |
| `app/(app)/u/[username]/month/[yyyymm]/loading.tsx` | Monthly variant of loading state. |
| `app/og/year/[username]/[year]/route.tsx` | Summary share-card OG (Satori). |
| `app/og/year/[username]/[year]/scene/[i]/route.tsx` | Per-scene share-card OG. |
| `app/og/month/[username]/[yyyymm]/route.tsx` | Monthly summary OG. |
| `app/og/month/[username]/[yyyymm]/scene/[i]/route.tsx` | Monthly per-scene OG. |
| `app/api/internal/recap-email/run/route.ts` | Header-secret gated batch worker — pre-warm + email send. |
| `app/(app)/admin/featured/page.tsx` | Admin pin affordance (env-gated, mirrors `/admin/reports`). |
| `components/recaps/Pageant.tsx` | Client scene sequencer — Framer Motion auto-advance, swipe + keyboard + tap, mute toggle, progress bar. |
| `components/recaps/SparseDataState.tsx` | Mascot empty state for <10 logs. |
| `components/recaps/FeaturedListCard.tsx` | Render on `/discover` landing for pinned list. |
| `components/recaps/scenes/{opening,stats_total,top_games,goty,genre_dominance,mechanic_love,surprise,taste_evolution,longest_game,reviews,closing}.tsx` | 11 scene components, each `(payload, caption, isActive) → JSX`. |
| `lib/email/recap-template.tsx` | React Email template — yearly + monthly variants. |
| `supabase/migrations/20260514_0001_phase6_recap_cron.sql` | pg_cron entries — current-year weekly invalidation + email cron. |
| `lib/db/migrations/0016_phase6_recaps.sql` | Tables + indexes (`monthly_recaps`, `featured_lists`, `year_in_reviews` columns, `profiles.last_recap_sent_at`). |
| `lib/db/migrations/0017_phase6_enum.sql` | Standalone `ALTER TYPE email_digest_cadence ADD VALUE 'monthly'`. |
| `scripts/verify-phase-6.ts` | 10-group automated gate. |
| `tests/unit/recaps/*.test.ts` | Aggregator + scenes + captions + featured + window unit tests. |
| `tests/e2e/phase6-pageant.spec.ts` | Playwright smoke — first-view aggregator + cache hit + private-profile 404. |

---

## Data model — migration 0016 + 0017

### 0016 — tables + indexes

```sql
-- monthly_recaps: parallel to year_in_reviews but month-windowed
CREATE TABLE monthly_recaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  year integer NOT NULL,
  month_index integer NOT NULL CHECK (month_index BETWEEN 1 AND 12),
  payload jsonb NOT NULL,
  share_image_hash varchar(32),
  generated_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz
);
CREATE UNIQUE INDEX monthly_recaps_user_year_month_uniq
  ON monthly_recaps(user_id, year, month_index);

-- year_in_reviews additions for locking + share-image cache busting
ALTER TABLE year_in_reviews
  ADD COLUMN share_image_hash varchar(32),
  ADD COLUMN locked_at timestamptz;

-- featured_lists: single-active-row-per-surface pin
CREATE TABLE featured_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  surface varchar(32) NOT NULL,         -- 'discover_landing' is the only value initially
  pinned_at timestamptz NOT NULL DEFAULT now(),
  pinned_until timestamptz,             -- NULL = indefinite
  pinned_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX featured_lists_surface_active_uniq
  ON featured_lists(surface)
  WHERE pinned_until IS NULL OR pinned_until > now();

-- profiles: dupe-prevention for recap email cron
ALTER TABLE profiles
  ADD COLUMN last_recap_sent_at timestamptz;
```

### 0017 — enum extension (separate migration)

```sql
-- ALTER TYPE … ADD VALUE cannot run inside a transaction with our migration harness;
-- isolating to its own migration file per the project convention.
ALTER TYPE email_digest_cadence ADD VALUE IF NOT EXISTS 'monthly';
```

### RLS notes

- `monthly_recaps` + `year_in_reviews`: server-only reads (no client direct access — same as `taste_fingerprints`). No new RLS policies required; existing service_role-on-server pattern.
- `featured_lists`: public SELECT (the pin is meant to be visible to everyone on `/discover`). Writes gated at application layer via `ADMIN_USER_IDS` check — defense-in-depth RLS policy denies all non-server writes.
- Memory note: per `feedback_drizzle_auth_users_gotcha.md`, grep the generated migration for `CREATE TABLE "auth"."users"` and strip if present.
- Memory note: per `feedback_drizzle_snapshot_chain_drift.md`, ensure snapshot chain remains valid after `drizzle-kit generate` — verify with the `db:check` CI gate added in audit T17.

---

## Cache-or-build flow

The flow for first view of `/u/{username}/year/2026`:

```
1. Resolve username → userId via existing helper; viewer auth check via getCachedUser()
2. Apply private-profile gate via redactPrivateProfile pattern
   → 404 for non-followers if profile.visibility = 'private'
3. SELECT * FROM year_in_reviews WHERE (user_id, year) = ($1, $2)
4. If row exists AND (
       locked_at IS NOT NULL                            -- past year, frozen forever
       OR year > EXTRACT(YEAR FROM now())               -- future year (shouldn't happen, defensive)
       OR (year = EXTRACT(YEAR FROM now())              -- current year
           AND generated_at > now() - interval '7 days')
   ):
   → render <Pageant payload={row.payload}/>
5. Else (no row OR stale current-year row):
   a. windowStart = `${year}-01-01T00:00:00Z`
      windowEnd   = `${year + 1}-01-01T00:00:00Z`
   b. payload = buildRecap({userId, windowStart, windowEnd, mode: 'yearly'})
   c. If payload.tier === 'too_sparse':
        → render <SparseDataState/>; no row written; no AI calls; return.
   d. captions = await Promise.all(
        scenes.filter(s => s.aiCaption && payload.scenes.includes(s.id))
              .map(s => generateCaption(s, payload))
      )
   e. payload.captions = captions
   f. INSERT INTO year_in_reviews(user_id, year, payload, share_image_hash, generated_at)
      VALUES ($1, $2, $3, $4, now())
      ON CONFLICT (user_id, year) DO UPDATE SET
        payload = EXCLUDED.payload,
        share_image_hash = EXCLUDED.share_image_hash,
        generated_at = now()
   g. render <Pageant payload={payload}/>
```

### Loading state during step (d)

Server component split via Next.js 16 React Server Components streaming:
- Sync stats stream first via `<Suspense>` (aggregator queries are fast — <500ms typical)
- AI captions arrive in a second streamed boundary with mascot fallback ("I'm reviewing your year…" + mascot pulsing)
- Total time-to-pageant on first view: 5–10s (dominated by AI router latency; mostly Cerebras/Groq fast paths)
- Subsequent views: <100ms cache hit

### Locking

A separate pg_cron job runs Jan 5 each year at 12:00 UTC:
```sql
UPDATE year_in_reviews
   SET locked_at = now()
 WHERE year = EXTRACT(YEAR FROM now())::int - 1
   AND locked_at IS NULL;
```

After lock, even the "Refresh my year" button no-ops (page surfaces "your {year} is in the books" instead).

### Refresh button (current year only)

Below the pageant on current-year `/year/{Y}` pages, a "Refresh my year" button:
- Rate-limited 1/day per user via existing `enforceRateLimit({scope, identifier, limit, windowSeconds})` helper
- POSTs to a server action that re-runs steps 5b–5f from the flow above
- No-op on past-year pages (button not rendered when `locked_at IS NOT NULL`)

---

## Email pre-warm cron flow

API route: `app/api/internal/recap-email/run/route.ts` — header-secret gated via `X-Cron-Secret` against Vault `phase6_cron_secret`, mirrors Phase 5 `/api/internal/digest/run` exactly.

### Worker loop (per scheduled invocation)

```
1. Read X-Cron-Secret header; timingSafeEqual against vault.decrypted_secrets WHERE name='phase6_cron_secret'
2. Read body { mode: 'annual_preview' | 'annual_locked' | 'monthly' }
3. Compute cohort:
   - annual_preview: cadence IN ('daily','weekly','monthly') AND ≥10 logs YTD
   - annual_locked: same cohort, for prior year
   - monthly: cadence='monthly' AND ≥10 logs in prior month
4. For each user in cohort (workerPool with BATCH_CONCURRENCY=5):
   a. Skip if profiles.last_recap_sent_at >= (run window start) — dedupe guard
   b. buildRecap() + generateCaption() → payload
   c. UPSERT into year_in_reviews OR monthly_recaps
   d. If mode='annual_locked': also SET locked_at = now()
   e. Render recap-template.tsx with payload preview + CTA link
   f. Resend.emails.send(); CHECK sendResult.error explicitly (Resend doesn't throw)
   g. On success: UPDATE profiles SET last_recap_sent_at = now() WHERE id = $1
5. Return { sent, candidates, skipped, errors }
```

### Schedule

| Schedule (UTC) | cron expr | Mode | Cohort filter |
|---|---|---|---|
| Dec 1, 12:00 | `0 12 1 12 *` | `annual_preview` | `cadence IN (daily,weekly,monthly)` AND ≥10 logs YTD |
| Jan 5, 12:00 | `0 12 5 1 *` | `annual_locked` | Same |
| 3rd of every month, 12:00 | `0 12 3 * *` | `monthly` | `cadence='monthly'` AND ≥10 logs in prior month |

### Cron infrastructure (mirrors Phase 5 digest)

Migration `supabase/migrations/20260514_0001_phase6_recap_cron.sql`:
- Create vault secret `phase6_cron_secret` (32-char hex, generated via `crypto.randomBytes(32).toString('hex')` — set CRON_SECRET env to the SAME value in Vercel)
- Create three pg_cron jobs (one per schedule above), each POSTing to `/api/internal/recap-email/run` with `X-Cron-Secret` and the appropriate `mode` body

### Email templates

`lib/email/recap-template.tsx` exports `RecapEmail({mode, payload, recapUrl})`:
- Yearly variant ("Your 2026 in games"): mascot illustration in header, top game cover + title, top genre + count, hero CTA "See your year →"
- Monthly variant ("Your May 2026 recap"): same shape, smaller hero, mascot in a different pose
- Both variants include unsubscribe footer (reuses existing `lib/email/unsubscribe-token.ts` JWT, encodes the relevant cadence)

---

## Scene catalog

### Full 11-scene catalog

| # | Scene id | YIR | Monthly | AI? | Required data | Fallback template |
|---|---|---|---|---|---|---|
| 1 | `opening` | ✓ | ✓ | ✓ | `displayName, totalGames, window` | `Welcome to your {window} in games — {totalGames} to look back on.` |
| 2 | `stats_total` | ✓ | ✓ | – | `totalGames, totalHoursPlayed?, completedCount, droppedCount` | data only — counts tick up via Framer Motion |
| 3 | `top_games` | ✓ (Top 5) | ✓ (Top 3) | – | top games by rating + cover URLs | data only — poster stack reveal |
| 4 | `goty` (yearly) / `gom` (monthly) | ✓ | ✓ | ✓ | `topGame {title, rating, status, coverUrl}` | `Your top-rated game: {title}, {rating}/5.` |
| 5 | `genre_dominance` | ✓ | ✓ | ✓ | `topGenre, topGenrePct, secondGenre, secondGenrePct` | `{topGenre} owned your {window} — {topGenrePct}% of your library.` |
| 6 | `mechanic_love` | ✓ | ✓ | ✓ | `topMechanic` (IGDB facet via taste fingerprint) | `Your love language: {topMechanic}.` |
| 7 | `surprise` | ✓ | – (yearOnly) | ✓ | AI-derived outlier `{gameTitle, surpriseGenre, surpriseRating, baselineAvg}` | `Your biggest surprise: {gameTitle}, rated {surpriseRating}/5.` |
| 8 | `taste_evolution` | ✓ | – (yearOnly) | ✓ | Q1 fingerprint vs Q4 fingerprint dominant-axis diff | `From {q1Vibe} to {q4Vibe}.` |
| 9 | `longest_game` | ✓ | ✓ | – | Steam playtime → game; substitute: most-replayed via status transitions | data only — hourglass animation |
| 10 | `reviews` | ✓ | – (yearOnly) | – | `reviewCount, favoriteReviewSnippet (60 chars)` | data only — quill animation |
| 11 | `closing` | ✓ | ✓ | ✓ | summary stats grid | `That was your {window}. Share it?` |

### Substitution map — graceful degradation

| Missing data | Action |
|---|---|
| No Steam playtime data | `longest_game` substitutes `most_replayed` (uses `logs.status='replaying'` count + status-transition count). Both still data-only, same scene component with different copy. |
| 0 reviews written | `reviews` skipped. YIR-only anyway; user gets 10 scenes instead of 11. |
| <3 distinct mechanics in window | `mechanic_love` substitutes `top_theme` (IGDB theme facet — themes are denser than mechanics). |
| Single-quarter activity (no Q1 logs OR no Q4 logs) | `taste_evolution` skipped. Backfill with `completion_ratio` scene from grand pack. |
| Surprise heuristic finds no outlier (rating variance <0.5 across genres) | `surprise` skipped. Backfill with `mood_themes` scene (IGDB themes most-represented). |
| ≥10 logs but missing both Steam playtime AND has 0 reviews | YIR-mode still produces 9 scenes (drops `longest_game` substitute path entirely + drops `reviews`). Still above the 8-scene floor. |

### Scene count guarantee

- Sparse-data threshold: <10 logs in window → empty state, no scenes
- ≥10 logs floor: 8 scenes always present — `opening`, `stats_total`, `top_games`, `goty`, `genre_dominance`, `mechanic_love` (or `top_theme`), `longest_game` (or `most_replayed`), `closing`
- Maximum: 11 scenes (YIR), 7 scenes (monthly)

---

## AI captioning

### Shared schema (all scenes)

```ts
const CaptionSchema = z.object({
  caption: z.string().min(8).max(140),
});
```

### Shared system-prompt constraints (baked into every prompt)

- No emojis (project rule — see `feedback_custom_assets_no_emojis.md`)
- No exclamation marks
- Address the user as "you"
- Single sentence
- Voice: "knowing observer — warmer than analytics, less performative than a marketing tagline"

### Per-scene prompts

Full text lives in `lib/recaps/prompts.ts`. Shape (one example):

```ts
const GENRE_DOMINANCE_PROMPT = `You are writing the caption for a year-in-review scene that reveals
the user's dominant genre of the year.

Data:
- top genre: {topGenre}
- percentage of library in that genre: {topGenrePct}%
- second genre: {secondGenre} ({secondGenrePct}%)

Constraints:
- No emojis
- No exclamation marks
- Address user as "you"
- One sentence
- 140 chars max
- Voice: knowing observer

Output: { "caption": string }`;
```

Six prompts in this exact shape (one per AI-tagged scene type): `opening`, `goty`, `genre_dominance`, `mechanic_love`, `surprise`, `taste_evolution`, `closing`.

### Retry policy

1. `lib/ai/router.ts` internal fallback chain (Cerebras → Groq → CF Workers AI → DeepSeek overflow) — handled by router itself
2. Zod validation failure → one router retry with stricter prompt suffix ("Output ONLY valid JSON matching the schema.")
3. Still failing → deterministic `fallbackTemplate(payload)` runs synchronously
4. `ai_calls` row written for every attempt path (existing telemetry table) — `success=true` for valid response, `success=false` with `error_message` for fallback path

### Telemetry-derived cost ceiling

At ~3000 tokens per user × estimated 1000 cohort users at year-end (Dec 2026) ≈ 3M tokens. Cerebras + Groq free tiers handle this comfortably; DeepSeek overflow is fractions of a cent. No new spend.

---

## Pageant UI behavior + accessibility

`components/recaps/Pageant.tsx` — client component, props `{payload, mode}`:

| Aspect | Behavior |
|---|---|
| **Layout** | Full-viewport vertical card · mobile native 9:16 · desktop = phone-shape (max-width ~420px) centered with blurred backdrop (Spotify Wrapped web pattern) |
| **Advance** | Auto-advance every 8s default. Scene-specific overrides via `Scene.holdDuration?` (e.g., `top_games` holds 10s for poster stack reveal). |
| **Progress** | Top-edge progress bar with N segments (11 YIR / 7 monthly). Segment fills L-to-R during hold; instant-fills on skip-forward. |
| **Controls** | Tap left-third = back · tap right-third = forward · tap middle = pause/resume · Swipe left/right matches tap zones · Keyboard: ← → space (pause) Esc (exit). |
| **Pause state** | Auto-advance timer freezes. Mascot enters idle pose. "Tap to continue" hint appears after 3s of pause. Resume from same hold-position. |
| **Transitions** | Framer Motion `AnimatePresence` — fade + slide-up entry (250ms), fade + slide-down exit (200ms). Per-scene data-viz reveals (numbers tick, charts draw, posters fly in) staged at +200ms after scene entry. |
| **Mascot** | One pose per scene type (reuse existing poses from `components/mascot/states.ts` where they fit; commissioned art deferred to Phase 7). Subtle pulse/bounce idle animation. **No audio anywhere in pageant.** |
| **Share affordance** | Small `<Share2>` icon top-right on every scene → Web Share API with prefilled URL + OG card. Closing scene replaces small icon with three big CTA buttons (Twitter · Discord · Copy link). |
| **Mute/skip toggles** | Small "skip to summary" button bottom-edge (a11y feature — jumps to closing scene). No audio so no mute. |
| **Exit** | Esc or back-arrow icon top-left → returns to `/u/{username}` profile (not browser-back, to preserve email entry-point). |

### Accessibility

- Each scene `<section aria-label="...">` with the scene type
- Caption text always visible (not behind animation gates); screen reader reads on scene-enter
- `prefers-reduced-motion: reduce` honored — instant transitions (0ms), no animated data viz (numbers/charts render in final state instantly)
- Screen-reader-only "skip to closing summary" link at top of pageant
- Focus management: focus moves to scene container on advance; Esc returns focus to where pageant was entered from
- Color contrast: all caption text on dark scene background ≥ WCAG AA (4.5:1) — verified via existing `--text` / `--text-dim` tokens which were swept to AA in audit T07

---

## Share affordance

### OG endpoints

Single Satori pattern (mirrors Phase 4 `/api/og/taste` + audit T23):

| Route | Purpose | Dimensions |
|---|---|---|
| `app/og/year/[username]/[year]/route.tsx` | Closing summary share card | 1200×630 |
| `app/og/year/[username]/[year]/scene/[i]/route.tsx` | Per-scene share card (parameterized) | 1200×630 |
| `app/og/month/[username]/[yyyymm]/route.tsx` | Monthly summary share card | 1200×630 |
| `app/og/month/[username]/[yyyymm]/scene/[i]/route.tsx` | Monthly per-scene share card | 1200×630 |

### Card design

- Background: dark gradient (`--bg` → `--bg-elev`) with subtle pixel-art star field overlay
- Hero: scene-specific content
  - `opening` / `closing`: hero text + mascot + year/window large
  - `top_games`: poster stack of top 3 covers + numbers
  - `goty`: full-bleed game cover with title overlay + rating chip
  - `genre_dominance`: large genre name + percentage donut sliver
  - `mechanic_love`: mechanic name + small icon
  - `surprise`: game cover + rating + delta annotation
  - `taste_evolution`: two-column Q1/Q4 vibe comparison
- Footer: `ploxa.vercel.app/u/{username}/year/{year}` + small Ploxa wordmark

### Share button UX

- Small `<Share2>` icon top-right on every scene during pageant
- Tap → `navigator.share()` (Web Share API) with title/text/URL prefilled
- URL pattern `https://ploxa.vercel.app/u/{username}/year/{year}?scene={i}` — visiting jumps pageant to that scene
- Web Share API unavailable → fallback `<ShareModal>` (existing pattern from Phase 5 list-share) with Copy-link + Twitter + Discord buttons
- Closing scene: replaces small icon with three big buttons inline (Twitter · Discord · Copy link)

### generateMetadata

The year + month page routes implement `generateMetadata({searchParams})` reading the `?scene` query param:
- `?scene=undefined` → summary OG endpoint (closing card)
- `?scene=4` → scene-4 OG endpoint
- Twitter card type: `summary_large_image`

### Privacy reminder

OG endpoints return 200 regardless of profile visibility — the act of sharing the URL IS the consent. The pageant page itself still 404s for non-followers if private. Pattern matches Phase 4 `/api/og/taste/[username]` precedent.

---

## Monthly mini-recap engine reuse

| Surface | YIR | Monthly |
|---|---|---|
| Route | `/u/{u}/year/{year}` | `/u/{u}/month/{yyyymm}` (e.g. `202605` for May 2026) |
| Cache table | `year_in_reviews` | `monthly_recaps` |
| Aggregator call | `buildRecap({mode: 'yearly', windowStart, windowEnd})` | `buildRecap({mode: 'monthly', windowStart, windowEnd})` |
| Scene catalog filter | All 11 | `scenes.filter(s => !s.yearOnly)` → 7 |
| AI calls | 7 (opening, goty, genre, mechanic, surprise, taste_evolution, closing) | 5 (opening, gom, genre, mechanic, closing) |
| Email cadence trigger | `daily`/`weekly`/`monthly` | `monthly` only |
| Email cron schedule | Dec 1 + Jan 5 | 3rd of month |
| Email template | `recap-template.tsx` (mode=yearly) | Same file, mode=monthly |
| OG route family | `/og/year/...` | `/og/month/...` |
| Substitution map | All entries apply | Year-only substitutions (taste_evolution, surprise) don't fire |

**Shared code ratio: ~90%.** The 10% delta: route handlers, cache-table SELECT/UPSERT statements, OG path constants, email subject lines.

**Window helpers** (`lib/recaps/window.ts`):
- `yearWindow(year: number) → { start: Date, end: Date }` — Jan 1 to Jan 1 of next year, UTC
- `monthWindow(year: number, monthIndex: 1-12) → { start: Date, end: Date }` — first of month to first of next month, UTC

---

## Featured-list admin

### Admin route

`app/(app)/admin/featured/page.tsx` — env-gated by `ADMIN_USER_IDS` (existing pattern from `app/(app)/admin/reports/page.tsx`):

UI sections:
- **Currently pinned** — `<FeaturedListCard>` preview + "Unpin" button + expiry countdown if `pinned_until` set
- **Pin a new list** — list-picker form (autocomplete of admin's own public lists by default; can also paste any public list URL), optional `pinned_until` date picker
- **Recent pins history** — read-only table of past pins (last 10) for context

### Server actions (`lib/recaps/featured.ts`)

```ts
"use server";

export async function getActiveFeaturedList(surface: string) {
  // SELECT row WHERE surface=$1 AND (pinned_until IS NULL OR pinned_until > now()) LIMIT 1
  // Wrapped in cache() for the request
}

export async function pinFeaturedList(input: { listId: string; pinnedUntil?: Date | null }) {
  // 1. assertAdmin() — derives session userId, checks against ADMIN_USER_IDS
  // 2. Validate list exists + is public
  // 3. Close any existing active pin: UPDATE featured_lists SET pinned_until = now() WHERE surface = $1 AND (pinned_until IS NULL OR pinned_until > now())
  // 4. INSERT new row
  // 5. revalidatePath('/discover'); revalidatePath('/admin/featured')
}

export async function unpinFeaturedList(surface: string) {
  // assertAdmin(); UPDATE existing active row to pinned_until = now()
}
```

### Render on `/discover` landing

Edit `app/(app)/discover/page.tsx`:
- Above the existing "Popular games" / "Trending reviews" / "People to follow" sections
- New `<FeaturedListCard list={pinnedList}/>` rendered only when `getActiveFeaturedList('discover_landing')` returns a row
- Card shows: list cover (composed from item covers — same poster-grid pattern as existing `<ListCard>` from Phase 5), title, "Picked by us · {item count} games", click → existing `/u/{author}/lists/{slug}` route
- Hidden cleanly when no active pin (no empty-state UI; section just absent — `null` return)

---

## Email cohort + cron schedule

See "Email pre-warm cron flow" section above for the worker loop. Schedule summary:

| When (UTC) | cron expr | Mode | Cohort filter | Email subject |
|---|---|---|---|---|
| Dec 1, 12:00 | `0 12 1 12 *` | `annual_preview` | `cadence IN (daily,weekly,monthly)` AND ≥10 logs YTD | "Your {year} in games — preview is ready" |
| Jan 5, 12:00 | `0 12 5 1 *` | `annual_locked` | Same cohort, for prior year | "Your {year} is in the books" |
| 3rd of month, 12:00 | `0 12 3 * *` | `monthly` | `cadence='monthly'` AND ≥10 logs in prior month | "Your {Month} {year} recap" |

### Operator pre-deploy checklist (mirrors Phase 5 digest setup)

1. Generate `phase6_cron_secret` (32-char hex via `crypto.randomBytes(32).toString('hex')`)
2. Set `RECAP_CRON_SECRET` env var in Vercel to the same value (or reuse `CRON_SECRET` if we collapse — design decision below)
3. Create Vault secret: `SELECT vault.create_secret('<value>', 'phase6_cron_secret', 'X-Cron-Secret header for /api/internal/recap-email/run');`
4. Apply migration 0016 + 0017 + the Phase 6 cron migration
5. Verify pg_cron jobs scheduled: `SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname LIKE 'phase6%';`

**Secret reuse note:** Phase 5 uses `phase5_cron_secret` for the digest endpoint. We *could* reuse it for Phase 6 by changing the worker to read mode-from-body — but that couples the two cron lifecycles. Cleaner to have a separate Phase 6 secret + endpoint; cost is one extra Vercel env var + one extra Vault row.

---

## Verify gate — Phase 6 (10 automated + 5 manual)

### Automated (`scripts/verify-phase-6.ts`, mirrors Phase 5 shape with 10 groups)

| # | Criterion | How verified |
|---|---|---|
| G1 | Aggregator returns `{tier: 'too_sparse'}` for <10 logs in window — no AI calls fired, no row written | Seed user with 9 logs; call `buildRecap`; assert `tier==='too_sparse'`; assert `ai_calls` count unchanged; assert `year_in_reviews` count unchanged |
| G2 | Aggregator produces zod-validated payload for ≥10 logs | Seed user with 15 logs; call `buildRecap`; assert `RecapPayloadSchema.parse(payload)` succeeds |
| G3 | Scene catalog: `mode='monthly'` returns exactly 7 scenes (yearOnly skipped) | Import scenes catalog; filter by mode; assert length |
| G4 | Substitution: no-Steam user gets `most_replayed` not `longest_game` | Seed user with logs but no Steam platform_connection; assert payload.scenes contains `most_replayed`, not `longest_game` |
| G5 | AI caption failure → fallback fires; pageant payload complete; `ai_calls` row with `success=false` | Mock router to throw; call `generateCaption`; assert returned caption matches `fallbackTemplate(payload)`; assert `ai_calls` row created |
| G6 | First view: INSERT into `year_in_reviews`. Second view: cache hit. | Simulate two sequential calls; assert one INSERT then one SELECT-only |
| G7 | Current-year staleness: row >7d old re-runs; <7d returns cached | Insert row with `generated_at = now() - 8 days`; call cache-or-build; assert re-run. Repeat with `now() - 6 days`; assert cached. |
| G8 | Locked year: refresh action no-ops | Insert row with `locked_at = now()`; call refresh server action; assert no `ai_calls` rows added |
| G9 | Featured-list: public read on `/discover`; non-admin write rejected | SELECT public; assert non-admin `pinFeaturedList()` throws `NotAdmin` |
| G10 | Private profile: `/year/{Y}` 404s for non-follower; `/og/year/...` still 200s | Set profile.visibility=private; fetch as different user; assert 404 on page, 200 on OG |

### Manual (operator verifies post-deploy)

| # | Criterion |
|---|---|
| M1 | Pageant auto-advance plays through all scenes on mobile (375px) + desktop (1440px); transitions smooth; no layout shift |
| M2 | All controls work: swipe + keyboard ←→ + tap-third-zones + space-to-pause + Esc-to-exit; pause is sticky until tap-resume |
| M3 | OG share cards render correctly in Twitter Card Validator + Discord embed preview + a real Twitter post; per-scene URLs jump to correct scene |
| M4 | "Your year is ready" email delivered to operator's test address; click → pageant opens instantly (no loading state, pre-warmed) |
| M5 | `prefers-reduced-motion: reduce` honored — instant transitions, no animated data viz, captions still readable |

---

## Out of scope (explicit)

- **Commissioned mascot pixel art** — Phase 6 ships with existing pose vocabulary from `components/mascot/states.ts`. Per-scene custom commissioned art is Phase 7 polish.
- **Audio in pageant** — no audio anywhere. Spotify Wrapped famously has audio; we don't. Visual + reduced-motion-respecting only.
- **Instagram Story 1080×1920 OG variant** — v1 ships 1200×630 only. Story-aspect variant is a Tier 3 polish item if engagement signals justify it.
- **Public landing page for non-logged-out visitors** — visiting `/u/{username}/year/{Y}` while logged-out redirects to `/login?next=...`. Onboarding-flow showing a generic "preview your year" stub is out of scope.
- **Multi-year navigation widget** — past-year URLs work (`/year/2025`, `/year/2024`) but there's no in-app year-switcher. Users navigate via URL or the email link.
- **Year-in-review for years where data didn't exist** — pre-Phase-1 logs exist via Steam imports but most have sparse metadata. We don't gate years; the sparse-data floor at 10 logs is the only filter.
- **Featured-list scheduling beyond single pin** — no queue of upcoming featured lists; admin pins one at a time. If a queue is needed it's Tier 3.
- **Per-user featured-list overrides** (e.g., "show me a different featured list because I already followed this one") — out of scope.
- **Replacing Framer Motion with another animation library** — animation budget is Framer Motion; bespoke physics is out of scope (per `no visual loss` constraint from prior phases).

---

## Open questions / risks

1. **Mascot pose vocabulary may be too small for 11 scenes.** Existing `components/mascot/states.ts` has ~6–8 poses. Phase 6 will reuse + reframe via styling rather than commission new art. Pose-to-scene mapping is a writing-plans concern, not spec.
2. **AI caption latency variance.** Cerebras/Groq fast paths are ~500ms–1s; DeepSeek overflow path is 2–4s. Worst case per-user generation: ~7×4s = 28s tail. Mitigation: `Promise.all` parallelizes the 7 calls — wall-clock ≈ slowest single call. Realistic p95 is ~5–10s on first view.
3. **Locking edge case across timezones.** Cron at Jan 5 12:00 UTC means users in UTC+14 see their year "locked" at 02:00 local Jan 6. Acceptable; no user-facing surprise because most users won't be hammering refresh at year boundaries.
4. **Featured-list cascade on list-delete.** If admin deletes a list that's currently pinned, the `ON DELETE CASCADE` on `featured_lists.list_id` drops the row. `/discover` falls back to no-pin cleanly. Acceptable.
5. **Recap email dupe-prevention if cron fires twice.** `profiles.last_recap_sent_at` is checked at step (a) of the worker loop; idempotent. If pg_cron mis-fires (it's been known to under heavy load), the dedupe guard catches it.
6. **Monthly cohort may be empty for months.** If no users have `cadence='monthly'`, the 3rd-of-month cron fires + writes no emails. Same shape as Phase 5 digest M1 ("worked but 0 candidates" smoke test). Not a problem.
7. **Generation cost at scale.** At 10K users with 50% engagement at year-end, ~5K × 3000 tokens = 15M tokens. Still inside Cerebras free tier ceiling. Beyond 100K users, DeepSeek overflow becomes a non-trivial line item — re-evaluate in Phase 7.

---

## Branch state at start

- Branch off `main` at `dcf6717` (head of `main` as of 2026-05-14)
- Working tree clean
- Production at `ploxa.vercel.app` is healthy
- Migration chain: 0015 is the latest applied (audit T16 — reports composite index)
- Tags landed since Phase 5: `phase-5-complete`, `audit-fixes-2026-05-13`, `settings-overhaul-complete`, `audit-fixes-2026-05-14`, `tier3-polish-2026-05-14`
- Next migration numbers: 0016 (Phase 6 tables), 0017 (Phase 6 enum extension)
