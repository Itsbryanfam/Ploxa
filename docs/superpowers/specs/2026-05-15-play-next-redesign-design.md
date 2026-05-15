# Play-Next Redesign — Design Spec

| Field | Value |
|---|---|
| **Date** | 2026-05-15 |
| **Status** | Approved (brainstormed 2026-05-15) |
| **Goal** | Turn `/play-next` from a thin AI-rerank wrapper into a *robust* recommendation surface. Better picks (composite scoring across taste/mood/time/social/library, MMR diversity, wildcard slot), better cards (3×2 grid with full reasoning, slot labels, qualitative confidence), and a conversational refinement layer ("less grindy", "more story") that re-ranks the existing shortlist without a second retrieve. Reuses the existing free-tier-first `lib/ai/router.ts` chain (Cerebras → Groq → Cloudflare → DeepSeek) — no new provider plumbing. Stratified buckets (3 Comfort + 1 Backlog + 1 Friends + 1 Wildcard) replace the flat ranked list — picks become self-explanatory by category. |
| **Verification gate** | Grid always renders 6 cards in a stable 3×2 layout for any user with ≥1 candidate; full reasoning text shows without clip; filter chips edit in-place without wizard re-entry; refinement input appends to URL state and re-runs in <2s p95; wildcard slot is genuinely OOD (genre cluster user has never logged from); all three AI providers in the chain are exercised under simulated failure; soft-negative dismissal decay verified via a forced-stale fixture; rate limits enforced (10 refinement/min/user); feature flag kill-switch returns the page to the existing implementation in one toggle. 12 automated + 4 manual criteria, see verify-gate table at end. |
| **Plan reference** | New scope, not on the original 7-phase plan. Slotted as a `/play-next` quality sweep between Phase 6 (Recaps) and Phase 7 (Polish). |
| **Companion HTML** | None — pure code change, no companion artifact needed. |

---

## Context

`/play-next` ("What should I play next?") was built in Phase 4 (Taste Fingerprint + Recommendations) and has been touched twice since:
- 2026-05-13 outage fixes (3 stacked bugs: Edge Functions never deployed, bulk import wrote bare rows, mechanics column empty) — see [taste_page_outage_2026_05_13.md](../../memory/taste_page_outage_2026_05_13.md)
- 2026-05-14 platform-mapping bug (commit `cde7dbd`) — see [feedback_rawg_vs_platform_kind.md](../../memory/feedback_rawg_vs_platform_kind.md)
- 2026-05-14 fingerprint dual-path fix (commit `c4fa727`) — see [feedback_taste_fingerprints_dual_path.md](../../memory/feedback_taste_fingerprints_dual_path.md)

Each fix kept it *functional*. None made it *good*. Operator's blunt assessment 2026-05-15: "It's the most underbaked feature right now."

**Two underbaked layers:**

1. **Picker quality.** Candidate pool ranks purely on taste-vector similarity. Mood is prompt-only context, not a scoring axis. Time-budget windows are absurdly loose (`1hr → [0, 12]` hours — a 6-hour game qualifies). No social signal despite Phase 5 having shipped the follow/log/like graph. No diversity enforcement. Library-owned-but-unplayed games are mixed with catalog discoveries with no surfaced distinction. Composite score is computed (`∈ [0,1]`) but never shown.

2. **Card UI.** 5-across grid at ~178px wide. `line-clamp-3` clips the "why this pick" reasoning — exactly what makes the rec valuable. "AI PICK" badge is purely decorative. Action row is a 3-button stack eating a third of card height. Mascot row says "5 picks for you" — pure dead weight. Filters above are display-only; tweaking requires the wizard.

Brainstorm research (2026-05-15) pulled patterns from Spotify Discover Weekly, Netflix taste-communities, Steam Discovery Queue, Letterboxd Nanocrowd, HowLongToBeat, Last.fm, plus LLM-era hybrid-recsys papers (Pinecone, Voyage, Eugene Yan, Microsoft RecAI). Strongest convergent ideas: stratified buckets (Spotify Daily Mix), MMR diversity (Qdrant), wildcard slot (Netflix "Play Something"), soft-negative time decay (Shaped.ai), qualitative confidence over numeric % (Netflix is *backing away* from % match), refinement re-ranks shortlist not re-retrieves (Microsoft RecAI).

**Scope this spec:** Phase A only — the hero ship described below. Fast-follows are documented at the end of the spec but explicitly out of scope for this implementation. The "Today's Pick daily card" homepage feature is the strongest fast-follow (Wordle-style retention rhythm from research) but lives on a different surface and gets its own spec.

**Out of scope this phase:** Auto-generated thematic clusters (Nanogenre-style). Taste-twins surface. Popular ↔ Hidden Gem slider. Double-thumbs feedback. bge-reranker swap. Decision-tree onboarding (fingerprint feature, not /play-next). Editorial weekly pick. Homepage redesign of any kind.

---

## Locked Design Principles (apply throughout)

1. **Stratified > Flat Ranked.** The 6 cards are *labeled slots*, not positions on a monotonic score list: 3 Comfort + 1 Backlog + 1 Friends + 1 Wildcard. When a source is empty (no friends, no library matches), the slot demotes to an extra Comfort match — never blanks. The slot label is part of the card's "why this pick" story.

2. **Filters change the candidate pool. Refinements only re-rank the shortlist.** Hard separation. Filters (time/mood/platform) are structured, persistent in URL, and feed the deterministic composite score. Refinements (free text — "less grindy", "more story") are session-only, AI-only, and *do not* trigger a second retrieve. Re-ranking the existing top-15 with refinement context is cheaper, faster, and behaviorally cleaner.

3. **Qualitative confidence, not numeric %.** Netflix is publicly backing away from "% Match" because users misread it as quality. Confidence shows as one of three pills: *Strong match*, *Good match*, *Worth a try*. The numeric composite score still exists internally for sorting and telemetry — it just doesn't reach the user.

4. **Reasoning grounds in the user's library when possible.** AI prompt is told to cite specific games the user has logged that resemble the pick. "Like Stardew Valley, this is..." beats "matches your love of strategy." When no library reference is honest, fall back to taste-vector traits.

5. **Wildcard is genuinely out-of-distribution, and labeled as such.** The wildcard slot draws from a genre cluster the user has *never logged from*, with a lower confidence threshold. The card explicitly says "Wildcard — you've never tried a [genre] game." Sets the right expectation; turns potential "this pick feels off" into "ah, that's the wildcard."

6. **Soft negatives, not blacklists.** Dismissed games are time-decayed (14-day half-life) instead of hard-excluded. A game dismissed once may re-surface in ~30 days. *Never again* is a separate action that does hard-exclude. *Snooze 30 days* is the explicit short-term option. Users get three distinct exit valves on the X button.

7. **Reuse the existing AI provider chain.** Rerank calls go through the existing `lib/ai/router.ts` (Cerebras → Groq → Cloudflare → DeepSeek) and its `supabase/functions/_shared/` mirror — no new provider implementations. The router already handles per-provider rate limits, telemetry, and fall-through. If all configured providers are exhausted/down, the rerank call throws `AIProvidersExhaustedError`, which we catch and fall through to metadata-only templated reasoning — the deterministic scoring/buckets/chips still render. Page never blanks because of provider noise.

8. **All new behavior behind a feature flag during rollout.** Single kill-switch (`recsv2`) returns the page to the existing implementation in one toggle. Once stable in production, the flag is removed in a follow-up cleanup.

9. **No fingerprint or vector pipeline changes.** This spec is downstream of the fingerprint. The candidate pool function (`candidatePool`) gets its TOP-N parameter widened and gains a deterministic seed for reproducibility, but the vector math is unchanged.

10. **Mascot stays a visual anchor, not a chat agent.** The refinement row uses the mascot illustration as a visual cue ("tell Cortez what to try") but it is a one-shot text input, not a conversation. No multi-turn UX, no persistent chat thread. Sticks the project's "AI as a tool, not a colleague" tone.

---

## Decision Log

Six decisions made during the 2026-05-15 brainstorm. Each table entry: question · options considered · choice + rationale.

| Q | Question | Options | Choice |
|---|---|---|---|
| 1 | Scope direction | (A) Cards only · (B) Picker only · (C) Both + conversational · (C-lite) Both, defer conversational | **C — Both + conversational.** "Most underbaked feature" warrants the ambitious option. Bones (vectors, fingerprint, rerank-recs Edge Function) are already in place; the cost is wiring, not infrastructure. |
| 2 | Card count | (A) 5 (current) · (B) 6 in 3×2 grid | **B — 6 in 3×2 grid.** Even grid, more breathing room per card, gives the stratified bucket model an extra slot for a wildcard pick. |
| 3 | Mood treatment | (A) Stay prompt-context only · (B) Convert to scoring axis via affinity table | **B — Scoring axis.** The original "mood doesn't filter" gap is the largest single picker-quality complaint. Fixed lookup table (`lib/recs/mood-affinity.ts`) — no learned weights, easy to tune. |
| 4 | Diversity enforcement | (A) Simple ≤2-per-genre rule · (B) MMR (λ=0.7) · (C) DPP | **B — MMR.** Research convergent recommendation. ~30 lines of code. DPP deferred until MMR is measurably inadequate. |
| 5 | Confidence presentation | (A) Numeric % match · (B) Qualitative tiers only · (C) Both | **B — Qualitative tiers only.** Netflix is backing away from % match for user-misread reasons. Three pills (Strong / Good / Worth a try). |
| 6 | AI provider | (A) Build new Gemini chain · (B) Reuse existing `lib/ai/router.ts` chain · (C) Swap to bge-reranker | **B — Reuse existing chain.** Cerebras (1M tokens/day free) → Groq (14,400 RPD free) → Cloudflare (10K neurons/day free) → DeepSeek (paid) is already implemented, rate-limited, and telemetered. Building a parallel Gemini chain for one feature is unnecessary engineering. Gemini key reserved in `.env` for future use. bge-reranker swap deferred until existing chain telemetry justifies a change. |

---

## Architecture — module layout

**New modules:**

| Path | Purpose |
|---|---|
| `lib/recs/scoring.ts` | `composeScore(candidate, ctx) → number` — combines taste/mood/time/social/library axes with locked weights. Weights exported as constants for easy tuning. Pure function, unit-testable in isolation. |
| `lib/recs/mood-affinity.ts` | Fixed lookup table mapping each `Mood` ∈ {chill, challenged, story-driven, mindless, multiplayer} to `{boostGenres: string[], boostMechanics: string[], penalizeMechanics: string[]}`. Used by `scoring.ts` for the mood axis. Hand-maintained; no ML. |
| `lib/recs/time-fit.ts` | `timeFitScore(gameHours, budget) → number` — Gaussian centered on each budget's sweet spot (15min: peak 0.25h σ=0.17; 1hr: peak 1h σ=0.5; 3hr+: peak 5h σ=2; multi-session: peak 20h σ=10). Hard excludes extremes (15min cannot include >2h games; 1hr cannot include >8h). |
| `lib/recs/social-score.ts` | `socialScore(gameId, userId) → number` — sigmoid over follow-graph activity. `sigmoid(0.3·friendsPlayed + 0.5·friendsLiked)`. Uses Phase 5 `follows` + `logs` tables. Returns 0 if no followed users. |
| `lib/recs/diversity-mmr.ts` | `applyMMR(ranked, λ=0.7) → ranked` — Maximal Marginal Relevance pass. Penalizes cosine similarity to already-selected items. Replaces the simple per-genre cap from the current code. |
| `lib/recs/wildcard.ts` | `pickWildcard(userId, candidates, exploredClusters) → Candidate \| null` — constrained random sampling from genre clusters the user has never logged from. Falls back to least-explored cluster if all touched. Lower confidence threshold (0.4 vs. 0.6 for comfort). |
| `lib/recs/buckets.ts` | `assignBuckets(scoredCandidates, userId) → BucketedRecs` — stratifies into Comfort/Backlog/Friends/Wildcard. Graceful demotion: empty slots become extra Comfort. |
| `lib/recs/soft-negative.ts` | `softNegativePenalty(gameId, userId) → number` — multiplier `1 - exp(-daysSinceDismiss/14)` for time-decayed dismissals. Returns 1.0 (no penalty) for `snoozed_until > now` it returns 0 (hard exclude); `never_again` returns 0 (hard exclude). |
| `components/recs/refinement-input.tsx` | Refinement text input + quick-chip suggestions + active-refinement pills. 140-char input cap, max 5 active stack, URL state sync. |
| `components/recs/slot-badge.tsx` | Slot-label chip ("Comfort", "Backlog", "Friend pick", "Wildcard") shown on each card. Wildcard gets distinct visual treatment. |
| `components/recs/confidence-pill.tsx` | Three-tier qualitative pill (Strong/Good/Worth a try) replacing the score display. |
| `components/recs/filter-chip-popover.tsx` | Interactive filter chip — current state shows as a chip; click opens an inline popover with the same options as the wizard step, allowing in-place change without route navigation. |

**Modified modules:**

| Path | Change |
|---|---|
| `lib/recs/server-actions.ts` | `getRecs()` orchestration — calls expanded `candidatePool()`, applies new scoring + buckets + MMR + wildcard. Adds `refinements: string[]` parameter routed straight to the Edge Function. New cache key includes filter combo only (refinements bypass cache). |
| `lib/recs/candidate-pool.ts` | `candidatePool()` top-N widens from 50 to 100. Adds optional `seed` parameter for deterministic test runs. Vector math unchanged. |
| `supabase/functions/rerank-recs/index.ts` | Adds `mode: "full" \| "rerank-only"` switch. In rerank-only mode, skips re-retrieve and just re-orders the supplied shortlist. Adds `userRefinements: string[]` field to prompt input. AI call uses the existing `_shared/ai-router.ts` chain (Cerebras → Groq → Cloudflare → DeepSeek) unchanged. |
| `supabase/functions/_shared/prompts.ts` | `buildRerankPrompt()` adds: (1) `userRefinements` rendered as `ADDITIONAL USER REQUESTS:` block, (2) instruction to cite library titles in reasoning when honest, (3) `RERANK_PROMPT_VERSION` bumps to invalidate cached recs. |
| `components/recs/rec-card.tsx` | Full rewrite to new layout. Cover with library overlay + confidence pill overlay, title, full reasoning (no clamp), fit chip row + slot badge, condensed action row (primary CTA + 2 icon buttons), Snooze/Never-again split on dismiss. |
| `app/(app)/play-next/_client.tsx` | Filter chips swap to `<FilterChipPopover>`. Mascot row swaps to `<RefinementInput>`. Grid swaps to 3×2 (CSS grid `grid-cols-3` on `md+`, `grid-cols-1` on mobile). "Show 6 more" pagination button below grid. |
| `app/(app)/play-next/page.tsx` | Server component reads URL state for filters + refinements, passes to `getRecs()`. No wizard route required — if filters absent, default to (1hr, [chill], [all connected platforms]) and show grid immediately. The wizard becomes opt-in via a "Customize" button, not the entry path. |
| `lib/db/schema.ts` | Adds 4 columns to `recommendations`: `slot` (enum `'comfort'|'backlog'|'friends'|'wildcard'`), `dismissed_at` (timestamptz, nullable), `snoozed_until` (timestamptz, nullable), `never_again` (boolean, default false). |

**Removed modules:**
- None. Existing files like `metadataOnlyRecs()` (sparse-tier fallback in `lib/recs/server-actions.ts`) stay — they're the all-providers-fail safety net.

---

## Composite Scoring Model

Per-axis details and weights. All axes normalize to `[0, 1]`.

```
final_score = 0.35 * taste
            + 0.25 * mood
            + 0.20 * timeFit
            + 0.10 * social
            + 0.10 * libraryBonus
```

After composite score, multiply by `softNegativePenalty(gameId, userId)` (0 for never-again or active snooze; `1 - exp(-daysSinceDismiss/14)` for past dismissals; 1.0 for never-dismissed).

### Taste axis (weight 0.35)

Unchanged from current implementation: GIN-overlap on top-8 genre/theme/mechanic vectors, then JS dot-product. Falls back to RAWG rating (normalized to `[0,1]`) for cold-start users with empty fingerprint.

### Mood axis (weight 0.25)

For each user-selected mood, score the candidate as:

```
moodMatch(m, c) = 
    (boostGenresHits(m, c) + boostMechanicsHits(m, c) - penalizeMechanicsHits(m, c))
    / boostBudget(m)
```

Clamped to `[0, 1]`. Averaged across selected moods (mood filter allows multi-select up to 2 — already enforced by `moodArraySchema`).

**Fixed affinity table** (`lib/recs/mood-affinity.ts`):

| Mood | Boost genres | Boost mechanics | Penalize mechanics |
|---|---|---|---|
| **chill** | puzzle, life-sim, casual, indie | exploration, no-pressure, low-stakes, cozy | competitive, twitch, time-pressure, permadeath |
| **challenged** | roguelike, soulslike, strategy, fighting | skill-based, difficult, competitive, permadeath | casual, story-only, no-fail |
| **story-driven** | rpg, adventure, narrative, visual-novel | choices-matter, branching-narrative, voice-acted | pvp-only, sandbox-no-narrative, multiplayer-only |
| **mindless** | clicker, casual, runner | idle, repetitive, low-stakes, auto-play | complex-systems, deep-strategy, permadeath |
| **multiplayer** | competitive, party, fighting, mmo | pvp, co-op, online-multiplayer | single-player-only, narrative-only |

Initial vocab will be reconciled against actual IGDB mechanic/genre values during implementation — the table above is the *shape*, not the final canonical list. The exact strings get pinned in T2 of the writing-plans output.

### Time-fit axis (weight 0.20)

Gaussian centered on a sweet spot per budget. `score = exp(-((gameHours - peak)² / (2 · σ²)))`. Game-length data comes from `games.playtimeAvgHours` (HowLongToBeat-sourced).

| Budget | Peak (h) | σ (h) | Hard upper cap (h) |
|---|---|---|---|
| 15min | 0.25 | 0.17 | 2.0 |
| 1hr | 1.0 | 0.5 | 8.0 |
| 3hr+ | 5.0 | 2.0 | (none — ≥2.0 lower) |
| multi-session | 20.0 | 10.0 | (none — ≥4.0 lower) |

Hard caps exclude before scoring. Games with NULL `playtimeAvgHours` get `timeFitScore = 0.5` (neutral) — better than blanket-exclude for indie titles without HLTB data.

### Social axis (weight 0.10)

```
friendsPlayed = count(distinct user_id) FROM logs 
  WHERE user_id IN (followed users)
  AND game_id = candidate.gameId
  AND status IN ('playing', 'completed')

friendsLiked = count(distinct user_id) FROM logs 
  WHERE user_id IN (followed users)
  AND game_id = candidate.gameId
  AND liked = true

socialScore = sigmoid(0.3 * friendsPlayed + 0.5 * friendsLiked)
```

Returns 0 when followed-users set is empty (no penalty, just no boost). The friends-count value is surfaced on the card as a fit chip when ≥1.

**Caching:** social aggregates are computed per `(userId, candidateGameId)` per recs run. For a user following 50 people with 50 candidates, that's 2500 lookups — cheap with the right index (`logs_user_game_idx` already exists from Phase 5).

### Library bonus axis (weight 0.10) + bucket guarantee

`libraryBonus = 1.0` if game is in user's library AND status is not `'played'` / `'dropped'`; else 0.

Plus a **bucket-level guarantee** (separate from the score): when assigning the 6 slots, the Backlog slot pulls from owned-but-unplayed candidates *first*, even if their composite score is slightly lower than catalog candidates. This ensures the Backlog slot is genuinely from your library, not just "highest-scored owned game which is rare anyway."

### Soft-negative decay

After composite scoring:

```
penalty(gameId, userId) =
  if recommendations.never_again -> 0   (hard exclude)
  elif recommendations.snoozed_until > now -> 0   (hard exclude for now)
  elif recommendations.dismissed_at NOT NULL -> 1 - exp(-daysSinceDismiss / 14)
  else 1.0

adjusted_score = final_score * penalty
```

After 30 days (penalty ≈ 0.88), the dismissal effectively dissolves. The user sees nothing — but the algo lets the game back in if it's a strong match.

---

## Stratified Buckets

Slot assignment runs *after* composite scoring + soft-negative decay + MMR diversity pass.

| Slot | Source | Confidence threshold | Fallback if empty |
|---|---|---|---|
| Comfort #1 | Highest adjusted score | none (always pop) | (never empty) |
| Comfort #2 | Next highest after MMR diversity step | none | (never empty) |
| Comfort #3 | Next highest after MMR diversity step | none | (never empty) |
| Backlog | Owned-but-unplayed candidate with highest adjusted score | ≥ 0.5 | Promote a 4th Comfort match |
| Friends | Candidate with `socialScore > 0` and highest adjusted score | ≥ 0.5 | Promote a 4th Comfort match |
| Wildcard | Random sample from genre cluster user has never logged from | ≥ 0.4 | If no candidates from unexplored clusters, sample from RAWG popularity rank 50–200 and label as "Discovery" |

**Fill order:** Comfort first (always), then Backlog/Friends in parallel (pick from top remaining for each criterion, don't double-count), then Wildcard last. If MMR diversity step would reject a Comfort pick, it's swapped out from a longer ranked list.

**Bucket-aware caching:** `recommendations` table gets a `slot` column. When the cache is refilled (user clicks "Show 6 more" or refresh), the next set respects the same slot distribution and excludes the previous run's IDs.

---

## Card Design

3 cards across at `md+` (≥768px), 1-up on mobile. Each card vertical structure:

```
┌──────────────────────────────────────┐
│  ┌────────────────────────────────┐  │
│  │ [LIBRARY badge]                │  │  ← top-left, optional overlay
│  │                                │  │
│  │        [COVER 2:3]             │  │
│  │                                │  │
│  │                  [Strong match]│  │  ← top-right, confidence pill
│  └────────────────────────────────┘  │
│                                      │
│  Title '14                           │
│                                      │
│  Full AI-written reasoning text,     │
│  no clip, grounds in library refs    │
│  when honest. "Like Stardew Valley,  │
│  this is a cozy management sim..."   │
│                                      │
│  ┌──────────────┐ ┌──────┐ ┌──────┐ │
│  │ ⏱ Fits 1hr  │ │Comfort│ │👥 3  │  │  ← fit chip row + slot badge
│  └──────────────┘ └──────┘ └──────┘ │
│                                      │
│  ┌──────────────────┐ ┌──┐ ┌──┐     │
│  │ Play this →      │ │⊕│ │✕│       │  ← actions
│  └──────────────────┘ └──┘ └──┘     │
└──────────────────────────────────────┘
```

*(All icons are custom SVG / pixel-art per the project's no-emojis rule. The Unicode glyphs above are placeholders for spec readability.)*

**Element specs:**

| Element | Spec |
|---|---|
| Cover | 2:3 aspect, full card width. Hover scale 1.02. Click anywhere on cover = same as primary CTA. |
| Library badge (top-left overlay) | Only on Backlog-bucket cards (and any other card where the game is in the user's library). Brand-purple low-opacity pill, "In your library". |
| Confidence pill (top-right overlay) | One of: `Strong match` (solid brand purple, score ≥0.85), `Good match` (outlined brand purple, score 0.65–0.85), `Worth a try` (outlined muted, score <0.65). Wildcard cards skip the confidence pill — confidence is misleading on intentional OOD picks. |
| Title + year | One line. Year in `'YY` short form. |
| Reasoning | Full text, no `line-clamp`. AI-written (or templated on fallback). Hard cap 280 chars at Edge Function level so cards stay visually balanced. |
| Fit chip row | 1–3 chips depending on context. `⏱ Fits 1hr` always shown when time filter set, color reflects fit quality (full color = peak, muted = loose). `Mood-name` chips (1–2) when mood matches. `👥 N played` only when `friendsPlayed > 0`. Chips are status, non-interactive. |
| Slot badge | Single inline chip in the fit row, distinct from fit chips. Labels: `Comfort`, `Backlog`, `Friend pick`, `Wildcard`. Wildcard gets a distinct color/icon — visually flags "this is the left-turn pick." |
| Action row | Primary: `Play this →` (full label, brand purple). Secondary: bookmark icon (Save) + X icon. Tooltips on hover for icon-only buttons. |
| Dismiss split | Click X opens a small dropdown: `Not for me` (30-day snooze, soft signal) / `Never show this again` (hard exclude, never_again flag). One click commits — no second confirmation. |

**Loading state:** 6 skeleton cards with matching dimensions so grid doesn't shift on result arrival.

**Empty state:** Replaces grid with centered prompt — *"No picks match — try widening your filters or removing a refinement."* + Reset link.

**Forward-compatible hooks** (designed but not built in Phase A):
- Card body click could open an inline detail panel beneath the card row. Markup leaves room.
- Confidence pill could become a hoverable tooltip showing per-axis breakdown. Data exists.

---

## Conversational Refinement

The mascot region becomes a free-text "tell Cortez what to try" input that re-ranks the existing top-15 candidates with refinement context. Filters change the candidate pool; refinements change only how the AI orders them.

### Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ ┌──────────┐  Not landing? Tell Cortez what to try:                 │
│ │ [Mascot] │                                                         │
│ │ pixel    │  ┌──────────────────────────────────────┐ ┌─────────┐  │
│ │ art      │  │ e.g. "less grindy"                   │ │ Try → │    │
│ └──────────┘  └──────────────────────────────────────┘ └─────────┘  │
│                                                                      │
│              Quick: [Less grindy] [More story] [Solo only]           │
│                     [Newer]       [Shorter]    [Surprise me]         │
│                                                                      │
│  Active refinements: [× less grindy]  [× shorter]   Clear all       │
└─────────────────────────────────────────────────────────────────────┘
```

### Mechanics

| Concern | Decision |
|---|---|
| **Input cap** | 140 chars hard limit; single line; `\n` stripped server-side. |
| **Stack size** | Max 5 active refinements; adding a 6th auto-pops the oldest. |
| **Quick chips** | One-tap commits directly. Curated: *Less grindy, More story, Solo only, Newer, Shorter, Something cozy, Surprise me*. (Surprise me = pinning the wildcard slot weight higher this run.) |
| **Persistence** | URL state via `?refine=less-grindy,shorter`. Survives back/forward and shares cleanly. Resets on clean `/play-next` visit — refinements are "right now," not preferences. |
| **Cache** | Base-filter results cached in `recommendations` table as today. Refined results session-only, not persisted. Save/dismiss/play actions on a refined pick still write that one rec row. |
| **Rate limit** | 10 refinement runs/min/user via existing `lib/security/rate-limit.ts` helper. |
| **Sanitization** | Strip newlines, clamp length, pass to AI as a structured field (not concatenated into the prompt template). Limits prompt-injection surface. |

### Prompt integration

The `rerank-recs` Edge Function gains a `mode` parameter and a `userRefinements` field:

```typescript
type RerankInput = {
  mode: "full" | "rerank-only";
  shortlist: Candidate[];      // top-15 from candidate pool
  filterContext: { time, moods, platforms };
  userRefinements?: string[];
  fingerprint: { vectors, narrative };
  dismissedContext: GameTitle[];
  playingContext: GameTitle[];
};
```

In `rerank-only` mode, the prompt skips the re-retrieve hint and the model gets the additional block:

```
ADDITIONAL USER REQUESTS:
- less grindy
- shorter

Apply these when selecting picks AND when writing reasoning.
If a request conflicts with a hard filter, the filter wins.
Reference the request explicitly in the reason when relevant.
```

The model still picks 6, still writes one-sentence reasons, still returns scores. The diff is *which* 6 from the 15-candidate shortlist.

### Failure handling

| Failure | Behavior |
|---|---|
| AI rerank fails on refinement run | Keep base picks visible (don't blank grid). Inline banner near input: *"Couldn't apply 'less grindy' right now — try simpler wording or refresh."* Refinement chip stays in active list for retry. |
| Rate limit hit (>10/min) | Inline message at input: *"Take a breath — try again in 30 seconds."* Doesn't block grid. |
| Refinement conflicts with filter | Filter wins silently. AI is told to ignore conflicting refinements. No user-facing warning unless this becomes a real-world confusion point. |

---

## AI Provider Chain + Cost Posture

**Decision: reuse the existing `lib/ai/router.ts` provider chain unchanged.** No new provider implementations.

The existing chain is already tiered free → paid and is the same chain that powers Phase 2 AI Reviews and Phase 4 rerank:

| Tier | Provider | Free-tier limit | Notes |
|---|---|---|---|
| 1 | Cerebras | 1M tokens/day free | Llama 3.x; sub-second latency typical |
| 2 | Groq | 14,400 req/day free | Llama 3.x; sub-second latency typical |
| 3 | Cloudflare Workers AI | 10K neurons/day free | Smaller models — fallback quality |
| 4 | DeepSeek V3 | Paid (~$0.14/$0.28 per M tokens) | Overflow only — should rarely engage |

The router already handles: per-provider rate-limit reservation (atomic, fail-forward on cap miss), 30s per-attempt timeout, telemetry to the `ai_calls` table, configurable-via-env (skips unconfigured providers).

**What this spec adds to the AI surface:**
1. New `mode: "rerank-only"` parameter on the rerank-recs Edge Function — when set, skips re-retrieve and just re-orders the supplied shortlist.
2. New `userRefinements: string[]` field in the prompt input (sanitized + clamped).
3. Prompt update to cite specific library titles in reasoning when honest (`buildRerankPrompt()` in `_shared/prompts.ts`).
4. `RERANK_PROMPT_VERSION` bump so old cached recs invalidate cleanly.

**What this spec does NOT change:**
- Provider list, ordering, or rate limits
- Per-provider timeouts
- `lib/ai/router.ts` orchestration logic
- AI features other than rerank-recs

**Gemini key in `.env`:** A `GEMINI_API_KEY` slot was added 2026-05-15 reserved for possible future use. No code in this spec reads it; introducing Gemini as a 5th-tier provider is a separate change, separate spec.

**Telemetry already in place:** every rerank call writes `provider`, `latency_ms`, `tokens_in`, `tokens_out` to `ai_calls`. After 2-4 weeks of `/play-next` v2 traffic, audit which tier actually serves most calls. If DeepSeek paid-tier engagement >5% of runs, that's the signal to either add Gemini or audit upstream quality.

**Expected cost trajectory:** $0/month at current scale. Cerebras alone has ~50x headroom for the recommendation feature at observed traffic. If Cerebras hits its 1M-token cap on a big day, Groq's 14,400 req/day picks up. DeepSeek paid only engages on simultaneous Cerebras + Groq + Cloudflare exhaustion — measured in hours/year if at all.

**When to revisit:** if telemetry shows DeepSeek hitting >5% of rerank calls, or if quality-eval shows the chain producing bad rankings, then revisit (add Gemini, swap to bge-reranker, or audit the prompt).

---

## Cold-Start & Failure Modes

### Cold-start matrix

| User state | What populates each slot | Banner |
|---|---|---|
| New user, no fingerprint, <3 logs | Composite picks lean entirely on mood/time/popularity (taste axis becomes neutral 0.5 constant); backlog/friends slots demote to Comfort; wildcard from RAWG popularity tail labeled "Discovery" | *"Building your taste profile — log a few games for richer picks."* |
| Fingerprint OK, no follows | Friends slot demotes to Comfort silently | (no banner) |
| Fingerprint OK, empty library | Backlog slot demotes to Comfort silently | (no banner) |
| All sources mature | Native 3+1+1+1 stratification | (no banner) |
| All AI providers down | Composite scoring + buckets + chips still render; reasoning becomes templated via `metadataOnlyRecs()` | *"AI ranking unavailable — basic matching shown."* (existing pattern) |

### Failure modes

| Failure | Behavior |
|---|---|
| Single AI provider 429/5xx/timeout | Fall through to next provider in chain immediately (no per-provider retry). |
| All three providers fail | Fall back to `metadataOnlyRecs()` — same composite scoring + buckets + chips, templated reasoning. Banner above grid. |
| Edge Function timeout (>8s wall-clock budget) | Return cached recs for the filter combo if any; banner: *"Took too long — showing your last set."* Refresh button visible. |
| No candidates pass hard filters | Empty state from Card Design section. Wildcard NOT shown in empty state (it requires a baseline to deviate from). |
| Composite score collapses (all candidates score 0 — should be impossible after cold-start fallbacks) | Defensive: sort by RAWG rating, show banner *"Showing popular picks for your filters."* |
| Dismissed-everything pool shrink (<6 candidates after soft-neg penalty) | Expand pool to top-200, ignore soft-neg penalty for this run, banner: *"Loosening filters — you've ruled out a lot."* |
| Rate limit on refinements (>10/min) | Inline input message only; grid unaffected. |

### Cache invalidation

- Base-filter results in `recommendations` table valid until next fingerprint refresh (existing pattern).
- Refinement results never cached.
- Wildcard regenerates on filter change OR explicit refresh — NOT on every visit (would feel chaotic).
- Feature-flag flip (`recsv2` on/off) invalidates everything (algorithm changed).

---

## Phasing & Scope

### Phase A — this spec (single feature branch)

The hero ship. All of the following in one branch:

- Composite scoring across 5 axes with locked weights
- Mood-affinity table + time-fit Gaussian + social score + library bonus
- MMR diversity pass (λ=0.7)
- Stratified bucket assignment (3 Comfort + 1 Backlog + 1 Friends + 1 Wildcard)
- Wildcard via unexplored-cluster random sampling
- Soft-negative dismissal decay (14-day half-life)
- Snooze 30d / Never-again split on dismiss action
- `rerank-only` mode in Edge Function (reuses existing `lib/ai/router.ts` chain — no new provider plumbing)
- Conversational refinement input + quick chips + URL state
- Library-citing reasoning prompt update
- New rec card UI (3×2 grid, full reasoning, slot badges, fit chips, confidence pill, condensed actions)
- Interactive filter chip popovers (in-place edit, no wizard re-entry)
- Feature flag `recsv2` for kill-switch rollout
- Telemetry: provider tier used, refinement count per session, slot fill rates

### Phase B — fast-follows (separate specs, near-term)

| Idea | Effort | Notes |
|---|---|---|
| **Today's Pick daily card on homepage** | 1–2 days | Strongest research-validated retention pattern. Nightly cron precomputes one deterministic pick per user. Tap reveals 2 alternates. Homepage placement decision happens in its own spec. |
| **Per-card "More like this"** | 0.5 day | Re-runs picker with target game's vectors pinned. Plumb-through atop the rerank-only mode. |
| **Inline detail expand panel** | 1 day | Card body click expands a row beneath the card showing full reasoning, per-axis breakdown, friends' reviews. Hooks already designed into Phase A markup. |
| **Confidence-pill axis tooltip** | 2 hours | Hover reveals `Taste 0.78 · Mood 0.91 · Time 0.95 · Social 0.20`. Data exists; just surface it. |

### Phase C — deferred (separate phases, real engineering or measurement-gated)

- Auto-generated thematic clusters (Nanogenre-style) — offline LLM pipeline, big lift
- Taste-twins surface — new page, social-graph queries
- Popular ↔ Hidden Gem slider — 4th filter axis; unjustified until cold-start measurably bland
- Double-thumbs feedback — schema change to logs, fingerprint reprocess
- bge-reranker-v2-m3 swap — premature optimization until free-tier telemetry collected
- Decision-tree onboarding (max-info-gain quiz) — fingerprint feature, not /play-next
- Editorial "Cortez's pick of the week" — ongoing operational burden; low value vs. effort

### Scope guardrails

- All new picker behavior gated behind feature flag `recsv2` (single env var or DB-backed flag — TBD by writing-plans)
- `RERANK_PROMPT_VERSION` bumps so old cached recs don't cross-contaminate
- Wildcard logic isolated to a dedicated function — unit-testable, disable-able via inner flag without rolling back the whole feature
- Composite-score weights live as top-of-file constants; no admin UI, no DB config
- Mood affinity table is hand-maintained — no learning

### Explicit out-of-scope

- Migration to a different vector DB or rerank library
- Building editorial weekly-pick infrastructure
- Any change to the taste-fingerprint pipeline
- Any homepage redesign

---

## Verification gate

### Automated (12 criteria)

1. `lib/recs/scoring.test.ts` — composite score sums weight-correctly; bounded `[0,1]`; soft-neg penalty applied last
2. `lib/recs/mood-affinity.test.ts` — every mood enum value covered; no genre/mechanic appears in both boost + penalize for the same mood
3. `lib/recs/time-fit.test.ts` — Gaussian peaks at expected sweet spot; hard caps reject extremes; NULL playtime returns 0.5
4. `lib/recs/social-score.test.ts` — sigmoid output bounded; zero followed users returns 0
5. `lib/recs/diversity-mmr.test.ts` — MMR with λ=0.7 produces measurably more diverse output than λ=1.0
6. `lib/recs/wildcard.test.ts` — wildcard pick is from a cluster the test user has never logged from
7. `lib/recs/soft-negative.test.ts` — dismissed-yesterday penalty <0.1, dismissed-15-days-ago penalty >0.65, never-again returns 0
8. `lib/recs/buckets.test.ts` — empty source slots demote to Comfort, never blank the grid
9. `getRecs()` integration test (Vitest) — full pipeline returns 6 BucketedRecs for a fixture user
10. `rerank-recs` Edge Function test — provider-chain simulation (using the existing router's `isConfigured()` skip): Cerebras unconfigured → Groq serves; Cerebras + Groq unconfigured → Cloudflare serves; all four providers unconfigured → `AIProvidersExhaustedError` caught → metadata fallback renders
11. Playwright `/play-next` end-to-end — filter chip popover edits in-place; refinement input commits via URL state; wildcard card visually distinct
12. `RERANK_PROMPT_VERSION` bump verified — old cached recs invalidated correctly

### Manual (4 criteria)

1. Visual review against current screenshot: 3×2 grid renders, reasoning text shows in full (no clip), confidence pill renders, slot badges render, all action buttons render
2. Refinement input UX: "less grindy" → grid changes meaningfully in <2s; refinement pill appears in active row; clearing the pill restores base picks
3. Wildcard sanity check (3 users with different play histories): wildcard pick is genuinely surprising in each case, not just the next-ranked candidate
4. Provider-failover smoke: temporarily yank `CEREBRAS_API_KEY` in dev env, verify page still renders via Groq fallback within 2× normal latency. Then yank Groq too — verify Cloudflare picks up. Then verify the all-providers-exhausted path renders metadata-only reasoning with the banner.

---

## Open questions for plan/writing phase

These are calls writing-plans should make explicit rather than the spec pre-deciding:

1. **DB migration ordering** — `recommendations` table gets 4 new columns. Migration number TBD (next sequential after current head). Should the columns be NULL-default or backfilled with defaults?
2. **Feature flag mechanism** — env var, DB-backed flag, or PostHog feature flag? Pick one consistent with existing patterns.
3. **Wildcard "unexplored cluster" definition** — IGDB genres? RAWG genres? Mechanic clusters? Pick the one with the cleanest available data.
4. **Filter chip popover library** — reuse the existing dropdown component or new one? Audit `components/ui` first.
5. **Mobile breakpoint specifics** — 3-up at `md+` (≥768px) vs. `lg+` (≥1024px)? Match the existing app convention.

---

## References

- Brainstorm research (2026-05-15): Spotify Discover Weekly, Netflix taste-communities, Steam Discovery Queue, Letterboxd Nanocrowd, HowLongToBeat, Last.fm patterns
- LLM-era recsys papers: Pinecone two-stage retrieval, Voyage AI "case against LLM rerankers", Eugene Yan "Improving Recsys in the Age of LLMs", Microsoft RecAI, Shaped.ai explore-exploit
- Existing app context:
  - `lib/recs/server-actions.ts` — current `getRecs` orchestration
  - `lib/recs/candidate-pool.ts` — current candidate pool (top-50)
  - `supabase/functions/rerank-recs/index.ts` — current AI rerank
  - `components/recs/rec-card.tsx` — current card
  - Memory: [feedback_taste_fingerprints_dual_path.md](../../memory/feedback_taste_fingerprints_dual_path.md), [feedback_rawg_vs_platform_kind.md](../../memory/feedback_rawg_vs_platform_kind.md), [taste_page_outage_2026_05_13.md](../../memory/taste_page_outage_2026_05_13.md)
