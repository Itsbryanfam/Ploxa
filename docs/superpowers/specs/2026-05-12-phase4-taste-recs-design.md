# Phase 4 — Taste Fingerprint + Recommendations — Design Spec

| Field | Value |
|---|---|
| **Date** | 2026-05-12 |
| **Phase** | 4 of 7 |
| **Status** | Approved |
| **Goal** | The differentiating "AI-first" feature — aggregate logs/reviews into vectors, generate a narrative taste read, surface hybrid recommendations with mood/time/platform context, ship a shareable trading-card image. |
| **Verification gate** | 30+ logs → fingerprint with non-trivial narrative summary → 5 recommendations with cogent per-game reasons that reference filter context → share trading-card image to social media with correct preview rendering |
| **Plan reference** | `~/.claude/plans/smooth-herding-flame.md` (Phase 4 — line 243) |
| **Companion HTML** | `docs/phase4-design.html` (rendered later) |

---

## Context

Phase 3 closed yesterday (2026-05-12, tag `phase-3-complete`, commit `0be6fa7`). Library Imports shipped — Steam + Xbox + Manual all working, 33/33 automated checks pass plus 4 manual gate items verified. A brand-new user can now connect Steam and have ~200 backlog rows in their library within seconds.

Phase 4 takes that data and *makes meaning of it*. The fingerprint generator turns the user's logs/reviews/ratings into a quantitative taste profile (genre/theme/mechanic vectors + length preference distribution). The narrative generator turns those vectors into a 2–3 sentence read voiced by the mascot. The recommendation engine combines the fingerprint with filter context (mood / time available / platform owned) to suggest games via a hybrid pipeline (metadata-similarity prefilter → AI rerank). The share card surfaces the fingerprint as a Twitter/Discord-shareable trading card via Vercel OG.

Phase 4 is the **differentiating feature** that justifies the "AI-first" positioning of the product — Letterboxd has lists and stats, but no taste read. This is the phase where the app earns its category.

Schema is already in place from Phase 0 (forward-looking `tasteFingerprints` and `recommendations` tables exist with explicit `// Forward-looking: Phase 4` comments). Phase 4 wires the application layer on top — aggregation engine, Edge Functions for AI calls, two new pages, OG endpoint, drift cron, and feedback loop integration with the existing log/review system.

**Scope this phase: full master-plan deliverable.** All 6 surfaces named in the plan ship: fingerprint generation pipeline, fingerprint visualization page, share card via Vercel OG, hybrid recommendation engine, "What should I play next?" page with filters, per-recommendation feedback loop.

This spec was produced via brainstorming on 2026-05-12 (text-only, no visual companion — user was on mobile). Decisions are recorded inline with their rationale; the user defaulted to the recommendation on every question and design section.

---

## Locked Design Principles (apply throughout)

1. **Vectors are deterministic, narrative is eventual.** Vector math is pure SQL aggregation over logs/reviews — recomputes live on every log change, ~50ms even for power users. The AI narrative summary lags vectors and is regenerated only on milestone-cross / explicit-refresh / drift-cron. This keeps live UI feel responsive without runaway AI cost.
2. **Privacy gates display, not aggregation.** Private logs (`isPrivate=true`) DO feed the user's own fingerprint vectors and narrative. The page (`/u/{name}/taste`) and OG endpoint (`/api/og/taste/{name}`) 404 when `users.is_public=false`, but the fingerprint *itself* always considers the user's full library. The user themselves always sees their full fingerprint.
3. **One toggle.** Fingerprint visibility inherits `users.is_public` from the existing profile-level flag. No new schema column for privacy. No separate setting.
4. **Recommendations are a funnel into the library.** "Save for later" creates `log(status='backlog')`. "Play this" creates `log(status='playing')`. "Not for me" marks the rec dismissed and feeds the next rerank as negative context. The feedback loop closes through the existing log system — no parallel feedback table, no vector mutation from feedback (vectors stay log-derived).
5. **Tier-aware UX.** The fingerprint page renders four distinct states (empty / sparse / sharpening / full) at 0 / 1–9 / 10–29 / 30+ logs. Each tier teaches the user what to do next. Mascot pose changes per tier.
6. **Cost discipline.** AI calls are invoked from Supabase Edge Functions, never from Vercel routes. Rate-limit refresh button to 3/24h. Drift cron only regenerates when vectors moved > 0.25 cosine distance since last narrative. Realistic monthly bill at 1k active users: ~$25/month, host-paid (no BYOK).
7. **No emojis.** All UI is pixel-art / SVG / custom (locked aesthetic). Score bars are pixel-art 8-cell components. Mascot pose mapping uses pre-rendered pixel-art sprites.
8. **Mascot is the guide, not the engine.** Mascot has a defined pose per surface: `excited` (empty), `helpful` (sparse + play-next flow), `narrating` (sharpening + full fingerprint), `thinking` (during AI calls), `celebrating` (first fingerprint milestone unlock). No emoji fallbacks anywhere.

---

## Decision log

Eight clarifying questions locked the architecture before design sections were written. All defaulted to recommendation (C/D pattern from Phase 3 brainstorming).

| # | Question | Decision | Rationale |
|---|---|---|---|
| 1 | What counts as a "log" for fingerprint purposes? | **Weighted blend** | Backlog rows have implicit signal (bundles cluster by genre); rated logs have explicit signal. Mixing both keeps the 30-log gate reachable without forcing 30 ratings. |
| 2 | When does the fingerprint regenerate? | **Vectors live, narrative lazy** | Vectors are free SQL math (live charts feel alive). Narrative is the expensive part — refresh / milestone / weekly drift-cron triggers prevent runaway cost. |
| 3 | How are recommendations stored and served? | **Hybrid** | Candidate pool precomputed on log/rating change; filter-aware AI rerank cached per `(userId, moods, time, platforms)` for 7 days. Filters genuinely reshape recs without per-visit AI cost. |
| 4 | Where does the fingerprint live, and who can see it? | **Inherits `users.is_public`** | Zero new schema, zero new toggle, consistent with existing profile gating. Share card always works (user-initiated). |
| 5 | Recommendation feedback semantics | **3 buttons = log writes** | Play this / Save for later / Not for me. Save = `log(status='backlog')`. Dismissed feeds next rerank as negative context. Closed loop through the existing library system. |
| 6 | Experience scales with log count | **Tiered: empty / sparse / sharpening / full** | Gradual reveal teaches the user. Mascot has clear role per state. 10-log threshold is a milestone, not a gate. |
| 7 | Mood taxonomy | **App-level allowlist + zod, multi-select up to 2** | No DB migration to add moods. Cap of 2 prevents cache explosion and contradictory combinations. |
| 8 | Share card design | **Trading card** | Pixel-art mascot portrait (pose maps to taste cluster) + stats panel + 3-line summary. Distinctive visual identity, on-brand pixel aesthetic. |

| # | Question | Decision | Rationale |
|---|---|---|---|
| Build strategy | How do we sequence 6 weeks? | **Spiral** | Each week ships something testable. Risk front-loaded (vectors W1). AI staged (narrative W2, rerank W4). Polish week (W6) is predictable in scope. |

---

## Information Architecture

### Routes

| Route | Purpose | Render strategy |
|---|---|---|
| `/me/taste` | Owner shortcut to own taste page; always accessible regardless of `is_public` | RSC redirects to `/u/{ownUsername}/taste` |
| `/u/[username]/taste` | Public-or-owner fingerprint page (Phase 4 + Phase 5 entry) | RSC + client island for chart animations + refresh button |
| `/play-next` | Mascot-driven flow (time → mood → platform → 5 recs) | RSC + client islands for filter chips, mascot transitions, rec cards |
| `/api/og/taste/[username]` | Vercel OG trading-card endpoint | Edge runtime |

No sidebar nav additions; discovery is via cockpit cards on `/home` and the profile dropdown.

### Entry points

1. **`/home` cockpit cards** (two new):
   - **"Your taste"** — tier badge + 1-line narrative excerpt + chart thumbnail + `View →` to `/me/taste`. Hidden when `tier === 'empty'` (replaced by "Log your first game" CTA).
   - **"What should I play?"** — mascot pose + button to `/play-next`. Hidden when `tier === 'empty'`.
2. **Profile dropdown** — gains `View your taste` link to `/me/taste`.
3. **Phase 5 profile page** — `/u/{username}` will surface a Taste tab/section in Phase 5; Phase 4 ensures the route alone exists for any visitor when `is_public=true`.
4. **Milestone toast** (one-shot) — when a log write crosses the 10-log threshold, a celebration toast offers a link to the freshly-generated fingerprint.

---

## Architecture

### Module layout (new files)

```
lib/
├── taste/
│   ├── aggregate.ts              # Pure SQL → vector aggregation (weighted blend per Q1)
│   ├── vectors.ts                # Cosine similarity, drift detection
│   ├── narrative.ts              # AI narrative orchestration (calls provider router)
│   ├── tier.ts                   # tierForUser(logCount)
│   ├── triggers.ts               # triggerOnLogWrite — milestone + cache invalidation
│   ├── prompts.ts                # buildNarrativePrompt, buildRerankPrompt
│   ├── playstyle.ts              # Mechanic → playstyle string mapping (for share card)
│   └── server-actions.ts         # refreshFingerprint, getFingerprint
├── recs/
│   ├── candidate-pool.ts         # Metadata-similarity prefilter (top 50)
│   ├── rerank.ts                 # AI rerank orchestrator
│   ├── cache.ts                  # Cache key hashing
│   ├── moods.ts                  # Mood/time/platform allowlists + zod
│   └── server-actions.ts         # getRecs(filters), refillRecs, dismissRec, saveRecForLater, playRec
└── og/
    ├── taste-card.tsx            # Vercel OG JSX component
    └── dominant-pose.ts          # vectors → MascotPose mapping

app/
├── (app)/
│   ├── me/
│   │   └── taste/page.tsx        # Owner redirect to /u/{ownUsername}/taste
│   ├── u/[username]/
│   │   └── taste/page.tsx        # Tier-aware page (empty / sparse / sharpening / full)
│   └── play-next/
│       ├── page.tsx              # 3-step filter flow + results
│       └── _components/
│           ├── mascot-prompt.tsx
│           ├── filter-chips.tsx
│           └── rec-card.tsx
└── api/
    └── og/taste/[username]/route.ts   # Vercel OG endpoint (Edge runtime)

supabase/functions/
├── refresh-fingerprint/index.ts       # Aggregate + AI narrative + save
├── rerank-recs/index.ts               # AI rerank with filter context + persist cache
└── taste-drift-cron/index.ts          # Daily — regenerate drifted narratives

scripts/
└── verify-phase-4.ts                  # 39 automated checks + manual item list
```

### Data flow

```
[user logs/rates game]
        │
        ▼
[logs / reviews]  ──▶  aggregate.ts (SQL, ~free)  ──▶  tasteFingerprints.vectors + .vectorsGeneratedAt
                                                                │
                          [milestone OR refresh OR cron]        │ (drift detect)
                                       │                        ▼
                                       ▼              refresh-fingerprint Edge Function
                                       │                        │
                                       └────────────────────────▼
                                                       tasteFingerprints.narrativeSummary
                                                       tasteFingerprints.narrativeModelVersion
                                                       tasteFingerprints.narrativeSnapshotVectors

                          ┌─────────────────────────────────────────────────────┐
                          │ candidate-pool.ts → top-50 metadata sim              │
                          │ (regenerated on log change as bg task)                │
                          └───────────────────────┬─────────────────────────────┘
                                                  │
                       [user opens /play-next]    │
                                                  ▼
                          ┌──────────────────────────────────────────────────────┐
                          │ Cache hit on (userId, moods, time, plats)?           │── yes ─▶ render cached
                          └──────────────────────┬───────────────────────────────┘
                                                 │ no
                                                 ▼
                          ┌──────────────────────────────────────────────────────┐
                          │ rerank-recs Edge Function                             │
                          │   in: 50 candidates + fingerprint + filters +        │
                          │       dismissed-game-ids                              │
                          │   out: top 5 + per-game reasoning                     │
                          └──────────────────────┬───────────────────────────────┘
                                                 ▼
                          recommendations table (with cacheKey)
```

### Why Edge Functions for AI calls

Phase 2's `/api/reviews/draft-stream` runs on Vercel because it's a fast user-facing stream. Phase 4's AI calls are slower batch-style operations (3–5s narrative, 5–10s rerank) and shouldn't tie up Next request slots. Same reasoning as Phase 3's `import-platform`. Reuses the `_shared/auth.ts` (`requireServiceRole`) helper Phase 3 introduced. Zero new auth surface.

### Schema additions (one migration: `0006_phase4_taste.sql`)

Three new columns, one rename, two new indexes. No new tables.

```sql
-- tasteFingerprints
ALTER TABLE taste_fingerprints
  RENAME COLUMN generated_at TO vectors_generated_at;
ALTER TABLE taste_fingerprints
  ADD COLUMN narrative_generated_at timestamptz,
  ADD COLUMN narrative_snapshot_vectors jsonb,
  RENAME COLUMN model_version TO narrative_model_version;

-- recommendations
ALTER TABLE recommendations
  ADD COLUMN cache_key text;

CREATE INDEX recommendations_user_cache_key_idx
  ON recommendations (user_id, cache_key, generated_at)
  WHERE dismissed = false;

CREATE INDEX recommendations_user_dismissed_idx
  ON recommendations (user_id, generated_at DESC)
  WHERE dismissed = true;
```

The Drizzle schema gets matching changes plus the existing `// Forward-looking: Phase 4` comments are removed.

---

## Vector aggregation engine

### Per-log weight (Q1 blend made concrete)

```ts
// lib/taste/aggregate.ts
function weight(log: Log, review: PublishedReview | null): number {
  let w: number;
  if (log.rating != null) {
    const intensity = Math.abs(Number(log.rating) - 5.0) / 5.0;  // 0..1
    w = 1.0 * (1 + 0.3 * intensity);  // 1.0 .. 1.3
  } else if (['playing', 'completed', 'played', 'dropped'].includes(log.status)) {
    w = 0.6;
  } else if (log.status === 'backlog' || log.status === 'wishlist') {
    w = 0.2;
  } else {
    w = 0;
  }
  if (review) w *= 1.15;  // Review-bearing logs get a small boost
  return w;
}
```

### Per-log sign

```ts
function sign(log: Log): -1 | 0 | 1 {
  if (log.rating != null) {
    const r = Number(log.rating);
    if (r < 4) return -1;   // explicit dislike
    if (r > 6) return +1;   // explicit like
    return 0;               // neutral — no directional signal
  }
  if (log.status === 'dropped') return -1;  // implicit dislike
  return +1;                                 // backlog/engaged = weak positive
}
```

A rating of 2 on a Roguelike actively *pushes the vector away* from Roguelike. Distinguishes "no signal" (vector entry ≈ 0) from "active rejection" (vector entry negative). Rec rerank uses negative values as soft avoid signals.

### Per-genre score

For genre `G`:
```
raw[G]   = Σ over logs ( sign(log) × weight(log, review) × hasGenre[log][G] )
totalW   = Σ over logs ( weight(log, review) )
score[G] = raw[G] / max(1, totalW)   // → in [-1, +1]
```

Same formula for `theme_vector` and `mechanic_vector`.

### Length preference

Bucketed distribution from `games.playtime_avg_hours`, normalized to sum to 1.0:

```ts
type LengthPreference = {
  "<5h":    number;
  "5-10h":  number;
  "10-30h": number;
  "30-60h": number;
  "60h+":   number;
};
```

Same weighting; no sign (length is descriptive, not preference).

### Difficulty preference — deferred

`games` table has no `difficulty` field. Reliable derivation (text-mining reviews + Metacritic ratios) is its own mini-project. **Phase 4 ships `difficulty_preference = '{}'::jsonb`** and notes it as future work (Phase 6 polish). The column stays in schema; the AI prompt doesn't reference it.

### Drift detection (powers the weekly cron)

```ts
function drift(current: Vectors, snapshot: Vectors | null): number {
  if (!snapshot) return Infinity;  // never narrated → definitely drift
  return Math.max(
    1 - cosineSim(current.genre,    snapshot.genre),
    1 - cosineSim(current.theme,    snapshot.theme),
    1 - cosineSim(current.mechanic, snapshot.mechanic),
  );
}
// Regenerate narrative if drift > 0.25 (tune in W2)
```

Snapshot of vectors at narrative-generation time stored in `narrative_snapshot_vectors`. Cosine similarity treats vectors as sparse maps; missing keys are 0.

### Performance budget

One aggregation pass for a 1000-log power user:
- One SQL query (uses existing `logs_user_updated_at_idx`): ~1ms
- TypeScript aggregation over 1000 rows × ~30 genres: 1–5ms
- Total: < 50ms per refresh. Synchronous in server action is fine.

For 10k-log accounts (Phase 6+), push to Postgres `jsonb_object_agg`. Not Phase 4's problem.

---

## AI pipeline

Two calls. Both reuse the **Phase 2 provider router** (Cerebras → Groq → Cloudflare → DeepSeek). Both are batch (not streamed). Prompts in `lib/taste/prompts.ts`, versioned via constants.

### Call 1 — Narrative generation

**Trigger paths:**
- User clicks "Refresh fingerprint" (rate-limited 3/24h)
- User crosses a milestone (10, 25, 50, 100, 250 logs) — fired via `after()` from log/review server actions
- Weekly drift cron — vectors moved > 0.25 since last narrative

**Inputs:**
- Top 8 entries from each vector with `[-1, +1]` scores
- Length preference distribution
- 5 most-recent rated-high (≥ 7) games + 3 most-recent dropped-or-rated-low games
- Tier hint (`sparse / sharpening / full`) — adjusts confidence voice
- Style guide: 2–3 sentences, playful and specific, no emoji, no quoted titles, no hedging

**Outputs:**
```ts
type NarrativeResult = {
  text: string;
  modelVersion: string;       // e.g. "cerebras-qwen3-480b/narrative-v1"
  generatedAt: Date;
  inputTokens: number;
  outputTokens: number;
};
```

Writes `narrative_summary`, `narrative_model_version`, `narrative_generated_at`, `narrative_snapshot_vectors` atomically.

**Cost:** ~2k input + 100 output tokens ≈ $0.001/call. With 1000 active users × 2 regens/month = $2/month total.

**Latency:** 3–5s p50, 8s p99. Acceptable as button-spinner UX.

### Call 2 — Rec rerank

**Trigger paths:**
- User opens `/play-next` with `(moods, time, platforms)` combo that has no cache OR cache is stale (log/rating change since)
- User clicks "Show me more like these →"

**Inputs:**
- 50-game candidate pool (title, genres/themes/mechanics, `playtime_avg_hours`, one-line description)
- User's narrative summary + vector top-8
- Filter context: `{ moods: ["chill"], time: "1hr", platforms: ["steam"] }`
- Last 20 dismissed games as negative context
- Last 5 currently-playing logs (prevents recommending in-progress games)

**Outputs:**
```ts
type RerankResult = {
  recs: Array<{
    gameId: number;
    score: number;       // [0, 1]
    reason: string;      // explicitly references filter
    cacheKey: string;
  }>;
  modelVersion: string;
  generatedAt: Date;
};
```

AI is instructed to: pick 5, score them, and write a reason that **explicitly references the filter** (e.g., for `chill / 30min`: "Quick puzzle loops with no fail state — fits your half-hour window."). This is the rec engine's selling point.

**Storage:** Delete existing non-dismissed rows for `cacheKey`, insert 5 new rows. Dismissed rows persist regardless (separate purpose).

**Cost:** ~6k input + 500 output tokens ≈ $0.003/call. 5 cache slots/user/month × 1000 users = $15/month.

**Latency:** 5–10s p50. Mascot animates `thinking` — latency is *part of the UX*.

### Error handling & fallbacks

**Narrative:** all providers fail → keep old `narrative_summary` and `narrative_generated_at`. Return error → toast "Couldn't refresh your fingerprint right now. Try again in a few minutes." Vectors are still updated (saved BEFORE the AI call).

**Rec rerank:** all providers fail → fall back to **metadata-only ordering** of the candidate pool, sort by similarity, apply hard filter constraints, return top 5 with templated reasons. UI marks these as `algorithm = 'similarity'` and shows a banner "AI ranking unavailable — basic matching shown."

### Model version tracking

`modelVersion: "<provider>-<model>/{prompt-tag}-v{N}"` — e.g. `"cerebras-qwen3-480b/narrative-v1"`. Both prompt iterations and model swaps produce distinguishable version strings, enabling rollback / A/B / quality drift measurement.

---

## UI surfaces

### `/u/[username]/taste` — tier-aware fingerprint page

One route, four tier renderings, shared layout shell.

**Tier `empty` (0 logs).** Owner-only view (404 for non-owners). Mascot `excited` pose, "Find a game to log →" CTA, no charts, no narrative.

**Tier `sparse` (1–9 logs).** Mascot `helpful` pose, speech bubble "I need about {10 - logCount} more logs before I can write you a proper taste read." Charts visible at reduced opacity. Refresh / Share buttons disabled.

**Tier `sharpening` (10–29 logs).** Full layout. Mascot `narrating` pose, narrative summary in speech bubble. Charts at 100% opacity. Subtle dismissible banner: "Your taste is still sharpening — log more for refinement." Refresh + Share enabled. `What should I play next? →` CTA at bottom.

**Tier `full` (30+ logs).** Same as sharpening, sharpening banner removed. Narrative voice has more confident prompt tuning (W2 polish).

**Pixel-art chart components.** `<ScoreBar>` with 8 cells. Negative scores render greyed with `−` indicator (visible but distinguishable from "no signal").

**Mascot pose-per-tier:** `excited` / `helpful` / `narrating` / `narrating` (with `thinking` overlay during refresh).

### `/play-next` — mascot-driven flow

Three sequential filter steps then results. State held in URL search params (deep-linkable).

**Step 1: TIME.** Mascot `helpful`. "How long do you have?" → `[15 min] [1 hour] [3+ hours] [multi-session]`.

**Step 2: MOOD.** After time selection. Mascot moves closer. "Mood? (pick up to 2)" → `[chill] [challenged] [story-driven] [mindless] [multiplayer]`. `Continue →` enabled after selection.

**Step 3: PLATFORM.** After mood. Mascot. "Platform?" → chips populated from user's connected platforms (defaults all-checked). `Show me what to play →`.

**Results.** Mascot `thinking` (5–10s) then `narrating`. Editable filter pill row at top. 5 rec cards rendered:
- Poster (16:24 portrait per recent posterUrl work)
- Title + year
- AI reasoning (1–2 sentences)
- `[Play this] [Save for later] [Not for me]`
- "Show me more like these →" button at bottom of grid (triggers fresh rerank for current filter)

**Action button semantics:**
- **Play this** → if `connectedPlatforms ∩ recCard.platforms` non-empty → confirm dialog "Mark as playing on {platform}?" → yes → create `log(status='playing', platforms=[platform])` + dismiss card. Else → redirect to `/games/[slug]`.
- **Save for later** → create `log(status='backlog')` via `ON CONFLICT DO NOTHING` + dismiss card + toast "Added to your backlog."
- **Not for me** → `recommendations.dismissed=true` + slide-out animation. Remaining 4 stay. "Show me more like these →" CTA at bottom appears.

**Sparse tier degradation.** Server-side: if `tier === 'sparse'`, skip AI rerank, return metadata-only ordering with templated reasoning. Banner: "Your taste is still sharpening — these picks use genre matching only."

### `/api/og/taste/[username]` — trading-card share

Vercel OG, Edge runtime, 1200×630.

```
╔═══════════════════════════════════════════════════════════╗
║   ┌─────────────────────────────────────────────────┐    ║
║   │           ┌─────────────────────┐                │    ║
║   │           │  [Pixel mascot,     │                │    ║
║   │           │   pose matches      │                │    ║
║   │           │   dominant taste]   │                │    ║
║   │           └─────────────────────┘                │    ║
║   │              @username                            │    ║
║   │   ┌───────────────────────────────────────┐     │    ║
║   │   │  TOP GENRE     ROGUELIKE              │     │    ║
║   │   │  PLAYSTYLE     TACTICIAN              │     │    ║
║   │   │  SWEET SPOT    10–30 HRS              │     │    ║
║   │   └───────────────────────────────────────┘     │    ║
║   │  "[3-line narrative summary excerpt]"            │    ║
║   │                                  [App logo]      │    ║
║   └─────────────────────────────────────────────────┘    ║
╚═══════════════════════════════════════════════════════════╝
```

**Pose mapping (`lib/og/dominant-pose.ts`):**

```ts
function dominantPose(vectors: Vectors): MascotPose {
  // Pick dominant cluster across all 3 vectors. Map to pose:
  //   tactics/strategy → 'tactician' (sword-down, focused)
  //   narrative/story  → 'lantern'   (lantern up, gazing)
  //   chill/cozy       → 'cozy'      (with a cup)
  //   action/shooter   → 'ready'     (sprinting)
  //   horror/dark      → 'wary'      (looking over shoulder)
  //   default          → 'narrating' (neutral)
}
```

12–15 mappings cover ~95% of users.

**Playstyle string (`lib/taste/playstyle.ts`).** Derived from dominant mechanic (Turn-based → "Tactician", Real-time strategy → "Commander", Permadeath → "Survivor", Puzzle → "Solver", etc.).

**Privacy & caching.** 404 when `users.is_public=false`. Cache header: `Cache-Control: public, s-maxage=604800, stale-while-revalidate=86400`. Cache-busted by including `narrativeGeneratedAt` in URL query.

**Share modal** on `/me/taste`: `[Tweet] [Copy link] [Download image]` with live preview.

---

## Triggers, feedback loop, privacy

### Trigger matrix

| Trigger | Vectors | Narrative | Rec cache |
|---|---|---|---|
| Log create / update / delete | live | only if milestone | invalidate (delete non-dismissed) |
| Review publish | live (review bonus) | only if milestone | invalidate |
| Rating add / change | live (sign + intensity) | only if milestone | invalidate |
| Milestone crossed (10/25/50/100/250) | already updated | regenerate | invalidate |
| User clicks "Refresh fingerprint" | recompute | regenerate | invalidate |
| Daily drift cron (drift > 0.25, last narr > 7d) | already updated | regenerate | (no — narrative change doesn't invalidate recs) |
| User clicks "Not for me" | n/a | n/a | mark **this one row** dismissed; remaining 4 stay served; gameId enters next rerank's negative context |
| User clicks "Show me more like these →" | n/a | n/a | delete the 4 remaining non-dismissed rows for this cache key + fresh rerank |
| User clicks "Save for later" | live (new backlog log) | only if milestone | invalidate all keys (via `triggerOnLogWrite`) |
| User clicks "Play this" | live (new playing log) | only if milestone | invalidate all keys (via `triggerOnLogWrite`) |

**Invariant:** vectors are deterministic. Narrative is eventual. Recs are lazy.

### `triggerOnLogWrite` (called from log/review server-action transactions)

```ts
// lib/taste/triggers.ts
export async function triggerOnLogWrite(userId: string, sql: postgres.Sql) {
  // Always: invalidate non-dismissed recs
  await sql`
    DELETE FROM recommendations
    WHERE user_id = ${userId} AND dismissed = false
  `;

  // Sometimes: milestone narrative regen
  const [{ count }] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM logs WHERE user_id = ${userId}
  `;
  const MILESTONES = [10, 25, 50, 100, 250];
  if (MILESTONES.includes(count)) {
    const triggerPromise = fetch(`${functionsUrl}/refresh-fingerprint`, {
      method: "POST",
      headers: { apikey: serviceRoleKey, "Content-Type": "application/json" },
      body: JSON.stringify({ userId, reason: "milestone", logCount: count }),
    }).catch((err) =>
      console.error("refresh-fingerprint milestone trigger failed:", userId, err),
    );
    if (typeof after !== "undefined") after(() => triggerPromise);
    else await triggerPromise;
  }
}
```

Same `after()` pattern as Phase 3's `triggerImport`.

### Refresh button

Server action `refreshFingerprint()`:
1. Auth: signed-in only
2. Rate limit: 3/24h via `enforceRateLimit` (key: `taste:refresh:${userId}`)
3. Tier check: `empty` → fast-fail
4. Always run vector aggregation (~50ms)
5. Narrative path: `sparse` skips AI; `sharpening|full` invokes Edge Function
6. Cache invalidation: delete non-dismissed recs
7. Returns `{ tier, fingerprint, generatedAt }`

UI states: idle / pending (spinner) / rate-limited (toast with hours-remaining) / AI failure (toast — vectors still saved).

### Drift cron

Supabase pg_cron daily at 03:00 UTC. Edge Function:

```ts
// supabase/functions/taste-drift-cron/index.ts
// 1. SELECT users with narrative_generated_at < NOW() - 7d
// 2. Compute drift per user (max across genre/theme/mechanic cosine dist)
// 3. If drift > 0.25, enqueue refresh-fingerprint via EdgeRuntime.waitUntil
// 4. Concurrency cap = 10 (matches Phase 3 daily-sync)
// 5. Return { drifted: N, scheduled: N }
```

Auth: `requireServiceRole` from `_shared/auth.ts`.

**Cost ceiling:** ~$3/month for 1k users.

### Feedback loop server actions

```ts
// lib/recs/server-actions.ts

async function dismissRec(recId: string) {
  // Owner-only; set recommendations.dismissed=true on this single row.
  // The remaining 4 rows in the cache stay served on subsequent visits.
  // The dismissed gameId is picked up by buildRerankPrompt's negative-
  // context payload on the NEXT rerank invocation (whenever that happens).
  // No cache invalidation here.
}

async function refillRecs(filterParams: FilterParams) {
  // Owner-only; powers the "Show me more like these →" CTA.
  // 1. Compute the cache key from filterParams (same hash as getRecs)
  // 2. DELETE from recommendations WHERE user_id=$1 AND cache_key=$2 AND dismissed=false
  // 3. Trigger rerank-recs Edge Function with current filter context
  //    (dismissed games from the deleted rows + all other dismissed history
  //    are picked up in the negative-context payload of the new rerank)
  // 4. Return the 5 new recs.
  // This is the ONLY way the user gets a fresh rerank for an already-cached
  // filter combo without changing log signal (otherwise cache reuse wins).
}

async function saveRecForLater(recId: string) {
  // 1. log(user_id, game_id, status='backlog') ON CONFLICT DO NOTHING
  // 2. Mark rec dismissed=true
  // 3. Fire triggerOnLogWrite (might cross milestone, invalidates cache)
  // Toast: "Added to your backlog."
}

async function playRec(recId: string, platform?: PlatformKind) {
  // If platform provided AND connected:
  //   1. log(status='playing', platforms=[platform]) ON CONFLICT UPDATE
  //   2. Mark rec dismissed=true
  //   3. triggerOnLogWrite
  //   Toast: "Marked as playing on {platform}"
  // Else: redirect to /games/[slug]
}
```

### Privacy matrix

| Surface | Owner | Public viewer + `is_public=true` | Public viewer + `is_public=false` |
|---|---|---|---|
| `/me/taste` | Full | (redirect to `/u/{name}/taste`) | (still own) |
| `/u/{name}/taste` | Full | Full | 404 |
| `/api/og/taste/{name}` | renders | renders | 404 |
| Share button | enabled | enabled | **disabled** with tooltip "Make your profile public to share your taste card." Links to settings. |
| `taste_fingerprints` row | exists | exists | exists |
| Private logs | feed aggregation | feed aggregation | feed aggregation |

**Sub-rule:** narrative is *generated text*, not a verbatim copy of any log/review. The prompt receives game titles, ratings, and stats — NOT review text. Even private reviews never leak into the (public-when-profile-is-public) narrative.

### Cost controls

| Surface | Rate limit | Worst case @ 1k users / month |
|---|---|---|
| Refresh button | 3/24h per user | ~$90 (everyone hits limit daily — never happens) |
| Milestone triggers | 5 lifetime per user | ~$5 one-time per cohort |
| Drift cron | bounded by 0.25 threshold | ~$3/month |
| Rec rerank | bounded by cache misses | ~$15/month |

**Realistic monthly bill: ~$25/month.** Host-paid, no BYOK.

---

## Verification gate

### 8 criteria

| # | Criterion | Auto | Manual |
|---|---|---|---|
| 1 | Tier system (empty/sparse/sharpening/full) renders correctly per log count; transitions via real log writes | ✓ | + visual pass |
| 2 | Vector aggregation matches Q1 weighted blend (backlog 0.2 / engaged 0.6 / rated 1.0, sign from rating, review bonus) | ✓ | — |
| 3 | AI narrative generates, persists `narrative_model_version`, non-trivial at 30+ logs | ✓ (shape) | + quality read |
| 4 | Refresh button rate-limits at 4th call/24h; drift cron triggers regen when drift > 0.25 | ✓ | — |
| 5 | Hybrid rec engine: 5 recs with per-game reasons that explicitly reference filter context | ✓ (shape) | + quality read |
| 6 | 3-button feedback: Play → `log(playing)`, Save → `log(backlog)`, Not for me → `dismissed=true` + next rerank negative context | ✓ | — |
| 7 | Trading-card share endpoint renders public profile, 404s private; Twitter/Discord previews look right | ✓ (status) | + visual pass |
| 8 | Privacy: `/u/{name}/taste` and `/api/og/taste/{name}` 404 when `users.is_public=false` | ✓ | — |

### `scripts/verify-phase-4.ts` (~39 automated checks across 9 groups)

**Group A — Schema sanity (5).** Column additions/renames + new partial indexes exist.

**Group B — Edge function deploy + auth (6).** All 3 deployed; all 3 reject without/with-bad apikey; all 3 accept service_role.

**Group C — Vector aggregation smoke (4).** Synthetic logs → expected vectors; weighted blend math holds; sign flips negative on rating-2.

**Group D — Tier + drift functions (4).** `tierForUser` boundaries; `drift` identity / orthogonality / scaling.

**Group E — Rec engine smoke (5).** Candidate-pool returns 50 distinct; rerank schema valid; dismissed → negative-context; sparse tier skips AI; cache hit avoids AI call.

**Group F — Server action auth + behavior (5).** Auth required; rate-limit shape; owner-only dismiss; save creates backlog log; play creates playing log.

**Group G — Privacy + OG (4).** Public 200; private 404 for both page + OG.

**Group H — Prompt builders + mood allowlist (3).** Templates non-empty + interpolate; mood zod allows valid combos / rejects invalid + over-cap.

**Group I — Delegated smokes (3).** `aggregate.smoke`, `drift.smoke`, `cache.smoke`.

### Manual items (4)

**M1 — Narrative quality at 30 logs.** Real test account, narrative reads coherent, references ≥ 2 concrete genres/themes from the real library, confident voice (no hedging).

**M2 — Rec reasoning references filter context.** `/play-next` with `chill / 1hr / steam`. Each of 5 reasons mentions chill / time-budget-fit / specific feature mapping to filter. Generic "matches your top genre" = fail.

**M3 — Share card preview.** Click "Share" on `/me/taste`. Modal renders. Twitter intent works. Image pasted into a real Discord channel previews correctly with trading-card visible.

**M4 — Mascot pose mapping.** Three synthetic accounts (strategy / narrative / chill dominant). Each OG card pulls the correct pose.

### Exit ceremony

When 39/39 automated + 4/4 manual pass:
1. Commit verify script
2. `git tag phase-4-complete`
3. Write `memory/phase_4_complete.md` documenting 8-criterion closure + Phase 4 deliverables + pre-Phase-5 housekeeping
4. Update `MEMORY.md` index

Same shape as Phase 3 closure.

---

## Build sequence (Strategy C — Spiral, 6 weeks)

Each week ships something testable. One feature branch per week (`phase-4-w1-vectors`, `phase-4-w2-narrative`, …). Merge to main only when end-of-week demo passes.

### W1 — Vector foundation (no AI)

- Migration 0006: 3 columns, 1 rename, 2 indexes
- `lib/taste/aggregate.ts` (Section 2 math)
- `lib/taste/tier.ts`, `lib/taste/vectors.ts`
- `lib/taste/server-actions.ts` stub (`getFingerprint` reads vectors only)
- `/me/taste` + `/u/{name}/taste` — chart-only render, sharpening tier only
- `<ScoreBar>` component
- Smoke: 12-case aggregation truth table; drift cosine edge cases

**Demo:** real synthetic 15-log account → real charts on `/me/taste` with sharpening UI.
**Risk:** aggregation correctness. Truth table is safety net.

### W2 — AI narrative + all tier states

- `lib/taste/prompts.ts` — `buildNarrativePrompt`
- `supabase/functions/refresh-fingerprint/index.ts`
- `refreshFingerprint()` server action with auth + rate limit + tier gating
- Refresh button UI (spinner / disabled / toast)
- Empty / sparse / sharpening / full tier renders (all 4)
- Milestone trigger wired into log/review server actions via `after()`
- Rate-limit unit test

**Demo:** synthetic 10-log account crosses milestone → narrative auto-generates → full UX renders.
**Risk:** prompt quality. Reserve ~1.5 days mid-week for prompt iteration.

### W3 — `/play-next` (metadata recs, no AI rerank)

- `lib/recs/moods.ts`, `lib/recs/candidate-pool.ts`, `lib/recs/cache.ts`
- `getRecs(filters)` stub returns metadata-only with templated reasoning
- `/play-next` page — 3-step flow + results
- Filter chips, MascotPrompt, RecCard
- URL state via search params
- Sparse tier degradation
- Smoke: cache key collisions, candidate-pool ordering

**Demo:** real metadata-only recs, full filter flow works end-to-end.
**Risk:** candidate-pool quality. Test 3 synthetic taste clusters.

### W4 — AI rec rerank with filter context

- `buildRerankPrompt` (filter + negative context)
- `supabase/functions/rerank-recs/index.ts`
- `lib/recs/rerank.ts` orchestrator
- `getRecs(filters)` complete: cache check + rerank + persist
- Mascot `thinking` during 5–10s rerank
- Per-card AI reasoning rendered
- Editable filter pills
- Graceful AI-failure fallback (metadata-only with banner)
- Smoke: cache hit avoids AI

**Demo:** full `/play-next` AI rerank with filter-context reasoning; sparse tier still works; AI failure degrades gracefully.
**Risk:** rerank prompt latency / quality balance. Reserve 1 day for tuning.

### W5 — Feedback loop

- "Not for me" → `dismissRec` (marks single row, no cache invalidation) + slide-out animation
- "Show me more like these →" → `refillRecs(filterParams)` (deletes 4 non-dismissed + fresh rerank with cumulative dismissed history in negative context)
- "Save for later" → `saveRecForLater` (creates backlog log via `ON CONFLICT DO NOTHING`) + toast
- "Play this" → `playRec` (smart platform routing — confirm dialog if connected, else redirect to game detail)
- Cache invalidation on save/play (via `triggerOnLogWrite`)
- Dismissed → next rerank negative context (verify via prompt-builder smoke test)

**Demo:** full feedback loop. Dismiss / save / play all observable in `/library`. Next rerank reflects dismissed signal.
**Risk:** smart routing edge cases (no platforms, multi-platform overlap). Reserve 1 day.

### W6 — Share card + drift cron + verify + polish + gate

- `lib/og/dominant-pose.ts`, `lib/og/taste-card.tsx`, `app/api/og/taste/[username]/route.ts`
- Share modal on `/me/taste` (Tweet / Copy link / Download)
- Share button disabled state for private profiles
- `supabase/functions/taste-drift-cron/index.ts` + pg_cron schedule
- Cockpit cards on `/home` (`Your taste` + `What should I play?`)
- Profile dropdown link
- First-fingerprint milestone celebration toast
- `scripts/verify-phase-4.ts` (39 checks)
- All 4 manual items
- Polish backlog from W1–5
- **Gate closure ceremony** (tag + memory + index)

**Risk:** polish pile-up. Mitigation: maintain `polish.md` backlog file across W1–5.

---

## Open questions / future work

- **Difficulty preference** — deferred to Phase 6 polish (needs review-text mining + Metacritic ratio derivation).
- **10k-log scale** — current TS-side aggregation is fast enough for Phase 4; push to Postgres `jsonb_object_agg` if/when needed.
- **Streaming narrative** — Phase 4 ships batch (button + spinner). Phase 6 polish candidate if it feels slow in practice.
- **Three card variants for share** — Phase 4 ships one (trading card). Phase 6 (Year-in-Review) naturally adds more variants.
- **Activity feed integration** — Phase 5 (Social) will surface fingerprint changes in followed users' feeds. Phase 4 ensures the route exists; Phase 5 wires the consumer.

---

## References

- Master plan: `~/.claude/plans/smooth-herding-flame.md` (Phase 4 — line 243)
- Phase 3 closure (predecessor): `memory/phase_3_complete.md`, tag `phase-3-complete`, commit `0be6fa7`
- Phase 3 spec (shape precedent): `docs/superpowers/specs/2026-05-11-phase3-library-imports-design.md`
- Phase 3 verify script (pattern precedent): `scripts/verify-phase-3.ts`
- Provider router (reused): Phase 2 deliverable, see `lib/ai/router.ts`
- Rate limit helper (reused): `lib/security/rate-limit.ts` (audit-fixes 2026-05-12)
- Shared Edge Function auth (reused): `supabase/functions/_shared/auth.ts` (Phase 3)
