# Phase 2 — AI Reviews — Design Spec

| Field | Value |
|---|---|
| **Date** | 2026-05-11 |
| **Phase** | 2 of 7 |
| **Status** | Approved |
| **Goal** | First AI magic moment — end of phase = soft launch to friends |
| **Verification gate** | A full interview → sectioned draft → publish → share works end-to-end with provider failover and the daily cap, and a friend can read the public review with an OG card |
| **Plan reference** | `~/.claude/plans/smooth-herding-flame.md` |
| **Companion HTML** | `docs/phase2-design.html` (rendered later) |

---

## Context

Phase 1 + Phase 1.5 shipped a real personal game tracker: search, log, library shelf/list/stacks, profile, settings, PFP upload, username editing. The perf audit (`tag perf-audit-2026-05-11`) settled the foundation. Phase 0's Drizzle schema already includes `reviews`, `review_questions`, `ai_calls`, and `likes` — Phase 2 doesn't migrate; it fills them in.

Phase 2 introduces the first AI surface in the product. The differentiator vs every existing competitor (Backloggd, IGN Playlist, GameTrack, Gamery, etc.) is a *conversational* review experience hosted by the mascot, not a blank textarea. By the end of this phase the developer is dogfooding the full review loop and the staging URL is ready to share with ~5 friends as the **soft-launch milestone**.

This spec was produced via brainstorming on 2026-05-11. Decisions are recorded inline with their rationale; pushback was explicitly invited at each choice and the user trusted the recommendation in every case.

---

## Locked Design Principles (apply throughout)

1. **Mascot voice = sardonic insider.** Short sentences. Knowledgeable. No exclamation-mark energy. Never breaks character to mention being an AI. The voice is consistent with the locked aesthetic — Raycast polish + premium pixel art + AI-as-character (not AI-as-tool).
2. **Voice fidelity via interview, not paraphrase.** The user's actual words from the Q&A are the spine of every section. The AI's job is to organize and stitch, not to invent.
3. **AI calls are server-side only.** All four providers are accessed via Server Actions; no client-side keys; the router is the only public surface.
4. **Failure is in-character.** When all providers fail, the mascot says "Let me catch my breath," not "500 Internal Server Error."
5. **Free tier with margin.** 10 reviews/user/day is the hard cap. Math shows even saturated, we stay on Cerebras for hundreds of users before any failover fires. DeepSeek paid overflow is provisioned but realistically untouched in Phase 2.
6. **Phase 2 is reviews-only.** No comments, no feed, no avatars-on-likers — those are Phase 5.

---

## Information Architecture

### Routes

| Route | Purpose | Render strategy |
|---|---|---|
| `/games/[slug]` *(existing)* | Existing detail page; gains "Write with mascot" CTA on logged games + own-review card if reviewed | RSC + client island for the CTA |
| `/games/[slug]` *(intercepted, existing)* | Same as above in the parallel-route slide-over | Same |
| `/games/[slug]/review` | The interview + sectioned-draft editor, full route. Mounted as both a standalone route (refresh-safe, shareable mid-draft URL) and as a slide-over from any "Write with mascot" entry point. Interview state lives in Upstash; editor state lives in `reviews` row | Server-rendered shell + client island for the conversation + sectioned editor |
| `/u/[username]/reviews` | List of a user's public reviews — chronological, with cover thumb, rating, hook excerpt | RSC + TanStack Query for pagination if needed |
| `/u/[username]/reviews/[slug]` | **Canonical review URL.** Hero (cover + title + rating + mascot), body (prose render of joined sections), footer (heart count + edit/delete on own) | RSC for static content + client island for like button |
| `/og/review/[id]` | Vercel OG endpoint generating the 1200×630 share card | Edge runtime |

### Entry points for the review flow

1. **Toast on Completed transition.** When a user changes any log to `completed`, a toast appears with mascot in `celebrating` mood: *"Nice. Want me to help you write this up?"* CTA opens `/games/[slug]/review` as a slide-over from the current route.
2. **Permanent button on log cards.** Every log card (any status) has a "Write with mascot" affordance — small icon + label, low emphasis. Opens the same review route.
3. **Game detail panel.** For a game you've logged, the panel has a "Write with mascot" CTA replacing the placeholder "Reviews coming in Phase 2" copy. If you've already reviewed, this slot renders your review card (Hook excerpt + rating + "Read full →") instead.
4. **Empty-state CTA** on `/u/[username]/reviews` when the user has no reviews yet.

---

## Architecture

### AI provider router

```
generate({ prompt, feature, userId, stream })
  → Cerebras       (Llama 3.3 70B, 1M tok/day free, ~500 tok/s)
  → on 429/5xx → Groq          (Llama 3.3 70B, 14.4K RPD free, ~200 tok/s)
  → on 429/5xx → Cloudflare WAI (Llama variant, 10K Neurons/day free)
  → on 429/5xx → DeepSeek V3   (paid overflow, ~$0.14/$0.28 per M tokens)
  → all fail → throw `AIProvidersExhaustedError` with last-attempted info
```

- **Preemption:** before calling a provider, check `ai:tier:{provider}:{YYYYMMDD}` in Upstash. If counter is within 5% of the published daily cap, skip and try the next tier. This avoids using the last calls of a provider's daily quota on us and triggering 429s mid-stream.
- **Token-bucket per provider per minute** in Upstash (`ai:tier:{provider}:rpm:{YYYYMMDDhhmm}`) to soak short-burst spikes (e.g. 5 users all hitting publish at once).
- **Per-user daily cap** (`ai:user:{uid}:reviews:{YYYYMMDD}`) checked at `startInterview()` — increment is committed only after a successful Q1 generation to avoid penalizing users for our failures.
- **Telemetry write is best-effort.** A failed `ai_calls` insert never fails the user-facing request; we log to the server console and move on.

### Streaming

Vercel AI SDK provides the streaming primitives. Each provider implementation exposes `streamText(...)` returning a token-async-iterable. The router's `generate()` wraps the chosen provider's stream and emits two side-channel events:

- `onStart` — captures provider chosen, prompt size
- `onFinish` — captures total tokens, latency, computes `cost_usd` from provider's rate card, writes `ai_calls`

Server Actions return Vercel AI SDK's `streamUI` / `streamText` results directly so the App Router boundary handles the SSE plumbing.

### File layout (new code)

```
lib/ai/
├─ router.ts            generate() — orchestrates fallback + telemetry
├─ rate-limit.ts        Upstash helpers for provider + user counters
├─ telemetry.ts         ai_calls writer
├─ cost.ts              token → USD per provider (rate card constants)
├─ errors.ts            AIProvidersExhaustedError, RateLimitExceededError
└─ providers/
   ├─ cerebras.ts       OpenAI-compat via @ai-sdk/openai-compatible
   ├─ groq.ts           @ai-sdk/groq (first-party)
   ├─ cloudflare.ts     @ai-sdk/openai-compatible against CF Workers AI gateway
   └─ deepseek.ts       @ai-sdk/openai-compatible against DeepSeek API

lib/reviews/
├─ server-actions.ts    startInterview, submitAnswer, generateDraft,
│                        regenerateSection, saveDraft, publishReview,
│                        updateReview, deleteReview, likeReview, unlikeReview
├─ session.ts           Upstash interview-session helpers (1h TTL)
├─ prompts.ts           system prompt + per-section templates + voice rules
└─ select.ts            shared Drizzle projection for review rows

components/reviews/
├─ review-interview.tsx     Conversation UI + mascot states + streaming turns
├─ review-editor.tsx        Sectioned editor (4 cards w/ edit + regenerate)
├─ review-card.tsx          Hero + body for canonical review page
├─ review-list-card.tsx     Compact card for /u/{username}/reviews lists
├─ like-button.tsx          Heart icon + count + optimistic toggle
└─ section-card.tsx         One section block (Hook/Highs/Lows/Verdict)

app/(app)/games/[slug]/review/
├─ page.tsx                 Full route — interview + editor
└─ loading.tsx

app/(app)/u/[username]/reviews/
├─ page.tsx                 List of user's public reviews
└─ [slug]/
   └─ page.tsx              Canonical review page

app/og/review/[id]/route.tsx   Vercel OG card endpoint
```

### Configuration / environment

New environment variables (slots already in `.env.example`):

```
CEREBRAS_API_KEY=...
GROQ_API_KEY=...
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...
DEEPSEEK_API_KEY=...        # NEW — add to .env.example in this phase
```

All five provider keys are optional at boot — the router skips providers without credentials and proceeds to the next tier. If *no* providers are configured, `generate()` throws immediately on first call with a developer-facing error (not user-facing — the UI is gated behind a successful `startInterview()`).

---

## Data Flow

### Interview → draft → publish

```
[User clicks "Write with mascot" on Hades]
         ↓
[Server action: startInterview({ logId })]
         ↓
   Check user daily cap (10/day) — fail fast if exceeded
         ↓
   Create Upstash session: { interviewId, userId, gameId, logId, answers: [] }
   TTL = 1h. Return { interviewId, q1 } where q1 is the fixed opener templated
   with the game title.
         ↓
[Client renders Q1, mascot = idle, user types and submits]
         ↓
[Server action: submitAnswer({ interviewId, turn: 1, text })]
         ↓
   Append to session.answers. Compose Q2 prompt from system prompt +
   game context + Q1 answer + "ask the user about the highs of the game,
   referencing their answer." Call generate() — stream Q2 tokens back.
         ↓
[Client renders Q2 streaming, mascot = thinking during gen, idle when stream ends]
         ↓
... repeats for Q3 (Lows), Q4 (Verdict). User can "Skip the rest" after Q1.
         ↓
[Server action: generateDraft({ interviewId })]
         ↓
   Compose draft prompt with all 4 Q&A pairs + section directive
   (4 sections, joined with \n\n). Stream tokens.
         ↓
   On first token: insert `reviews` row with `body = ''`, `published_at = NULL`,
   return reviewId. Insert 4 `review_questions` rows from the Q&A.
         ↓
   As tokens stream, accumulate in-memory; on stream end, write final body
   to `reviews.body`. (Streaming UI shows tokens; persistence is final-only.)
         ↓
[Client renders 4 section cards with the draft, mascot = idle]
         ↓
[User edits sections inline or regenerates one]
         ↓
[Server action: publishReview({ reviewId, rating, isPublic })]
         ↓
   UPDATE reviews SET published_at = now(), rating = ?, is_public = ?.
   The public URL uses games.slug directly (already unique in the catalog),
   so no per-review slug is stored or computed. With one-review-per-game
   cardinality, /u/{username}/reviews/{games.slug} is unambiguous.
   revalidatePath('/u/{username}/reviews'),
   revalidatePath('/u/{username}/reviews/{games.slug}'),
   revalidatePath('/games/{games.slug}').
         ↓
[Client redirects to /u/{username}/reviews/{games.slug}, mascot = celebrating ~1.5s]
```

### Section storage

Sections are joined with `\n\n` into `reviews.body`. The editor splits on `\n\n` when re-opening to reconstruct the 4 cards. Trade-off accepted: a manual edit that removes a section break collapses two sections in the editor on next open — but the body itself remains valid prose and renders correctly on the public page. We don't store sections as separate rows because the canonical reader experience is flowing prose, not labeled chunks.

### Like toggle

```
[Client click on heart → optimistic increment in TanStack Query cache]
         ↓
[Server action: likeReview(reviewId) or unlikeReview(reviewId)]
         ↓
   INSERT ... ON CONFLICT DO NOTHING (likes is composite PK (user_id, review_id))
   or DELETE.
         ↓
   revalidatePath('/u/{username}/reviews/{slug}') — count comes from
   COUNT(*) on the public page. (For high-traffic, Phase 5 may denormalize.)
```

---

## Components

### `ReviewInterview` (client)

State machine: `idle → asking → answering → submitting → asking → … → drafting → done`.

- Renders a vertical stack of Q&A cards. Each card has the question text (typewriter-streamed on first appearance, static thereafter) and the answer area.
- Active answer area is a focused textarea; submitted answer renders as a chip with an "Edit" affordance. Editing an earlier answer discards downstream Q&A and re-asks from that point.
- The mascot component sits in a fixed slot above the conversation; its `mood` is bound to the current state.
- "Skip the rest" button visible from Q2 onward; pressed → calls `generateDraft` directly with however many answers exist.

### `ReviewEditor` (client)

Four `SectionCard` instances stacked vertically. Each section card:

- Default view: rendered text with a hover-visible toolbar (Edit ✏️, Regenerate ↻)
- Edit mode: inline textarea (autosizes), Save / Cancel
- Regenerate: replaces the card's text with a streamed regeneration; while streaming, the card shows a subtle "Mascot is rewriting…" caption and the regenerate button becomes a stop button
- A small "From your answer:" tooltip on hover surfaces the original Q&A pair that fed this section

Above the cards: rating slider (existing heart UI from Phase 1.5), privacy toggle, Cancel (saves draft), Publish (primary CTA).

### `ReviewCard` (RSC)

Canonical review page rendering. Two columns on desktop: left = game cover (~280px) + mascot small + meta (date, rating), right = body prose + footer (heart, edit/delete). Single column on mobile, cover renders as banner.

Body: the four-section join (`\n\n`-separated) rendered as paragraphs. Section labels are not shown on the public page — they're editor-only.

### `LikeButton` (client)

Heart icon (reuses `HeartFull` from Phase 1.5's heart components), count label, optimistic toggle via TanStack Query. Heart is `HeartFull` when liked, `HeartHalf` outline otherwise. Unauthenticated → click prompts login.

### `OGReviewCard` (`app/og/review/[id]/route.tsx`)

ImageResponse at 1200×630, Vercel OG runtime:

- Background: subtle pixel-grid texture matching the app's dark theme
- Top-left: mascot in `idle` (small, ~80px equivalent)
- Top-right: game cover (~200×300)
- Center: game title (large), star rating in hearts, "by {username}"
- Bottom: first 2 lines of the Hook section in quote marks
- Footer mark: app logo small

Cached for 1 day at the edge. Re-generated on review edit via `revalidateTag(`review-og-${id}`)`.

---

## Database

**No schema migration in Phase 2.** All required tables and columns are already live:

- `reviews(id, user_id, game_id, log_id, body, rating, is_ai_assisted, published_at, is_public, created_at, updated_at)`
- `review_questions(id, review_id, position, question, answer)`
- `ai_calls(id, user_id, feature, provider, model, input_tokens, output_tokens, cost_usd, latency_ms, success, error_message, created_at)`
- `likes(user_id, review_id, created_at)` composite PK

**Indexes to consider** (deferred until Phase 5 unless verified slow):

- `reviews(user_id, published_at DESC)` for `/u/{username}/reviews`
- `reviews(game_id, published_at DESC)` for future "all reviews of *Hades*"
- `likes(review_id)` for count queries

**RLS** is already in place from Phase 0. Confirm in implementation that:
- `reviews` insert/update/delete is restricted to `user_id = auth.uid()`
- `reviews` select allows public reads only when `is_public = TRUE AND published_at IS NOT NULL`
- `likes` insert/delete restricted to `user_id = auth.uid()`; select is public
- `review_questions` select allows public reads only via join through a public+published review

---

## Errors & Failure States

| Trigger | UX |
|---|---|
| Mid-interview, provider 1 fails (429/5xx) | Silent fallback to next provider; user sees normal streaming continue |
| Mid-interview, all 4 providers fail | Mascot → `confused`, message: *"Let me catch my breath — your answers are saved. Try again?"* Session persists in Upstash for 1h. "Try again" button retries the failed call. |
| Daily cap reached (11th review-start in 24h) | "Write with mascot" button shows tooltip: *"I need a nap — back at midnight UTC."* CTA is disabled but the page itself is not. |
| `localStorage` partial answers but Upstash session gone (>1h TTL or eviction) | On open: *"Resume your draft of Hades?"* — re-creates Upstash session from stored answers; AI re-asks from the next missing turn. |
| RAWG game lookup misses on the draft prompt | Prompt falls back to title-only context; the AI produces a competent draft using only the title + user's Q&A. |
| User saves an edit with an empty section | Save button is disabled if any of the 4 sections is empty; explanatory tooltip on hover. |
| Network drop mid-stream | Stream consumption is wrapped; on detected disconnect the partial output is discarded for that turn and the mascot shows the retry UI. (No automatic resume — re-running the prompt is cheap and avoids inconsistent state.) |
| User publishes with no rating | Publish button disabled until rating slider is set (lock-step with the existing log-rating UX from Phase 1.5). |
| User attempts to publish a second review for the same game | Server action `publishReview` checks for existing `reviews` row by `(userId, gameId)` and returns 409 with a friendly message; UI navigates to the existing review's edit view. (One-per-game cardinality is enforced in app code; no DB-level unique index added in Phase 2.) |
| Public review URL hit while review is private | Returns 404 (not 403 — don't leak existence). |
| Public review URL hit on deleted review | Returns 404. |

---

## Out of Scope (explicitly deferred)

- **Reviews on game detail from other users** → Phase 5 (needs follows + feed)
- **Comments on reviews** → Phase 5
- **Avatar cluster on likers** → Phase 5
- **Plain (non-interview) review writing** → Phase 5 if explicitly requested
- **Rich-text formatting** (bold, italic, links) → Phase 5+
- **Multiple reviews per game (replay reviews)** → Phase 5 with richer profile UI
- **AI-edited questions** — the user cannot edit AI-generated questions, only their own answers (editing an earlier answer regenerates the rest of the questions)
- **AI re-ranking of sections after manual edits** → no, the user's edits are sacred
- **A dedicated drafts list page** → drafts persist in DB but no `/drafts` page; resuming happens via the same "Write with mascot" entry surfaces
- **Year-in-review of AI reviews** → Phase 6
- **AI cost dashboard for the user** → Phase 7 if needed; Phase 2 only writes telemetry
- **Streaming the OG image** — OG is static at edge cache TTL
- **Localization** — English only

---

## Verification Gate

A Phase 2 run is "shipped" only when **all of these pass** on staging:

1. From a completed log of *Hades*, click **Write with mascot** → routes to `/games/hades/review`
2. See Q1 *"What pulled you into Hades?"* with mascot `idle`; type a 2–3-sentence answer
3. Submit → mascot `thinking` for <2s; Q2 streams in token-by-token referencing your Q1 answer
4. Repeat through Q3 (Lows) and Q4 (Verdict)
5. After Q4 submit, mascot says *"Drafting your review…"* and the 4 sections stream in one after another
6. Click **Regenerate** on the *Lows* card → only that block changes; *Hook*, *Highs*, *Verdict* untouched
7. Click **Edit** on *Hook*, change a sentence, save → new text persists
8. Set rating slider to 9, leave Public on, click **Publish** → mascot `celebrating` ~1.5s
9. Redirect to `/u/bryan/reviews/hades` → prose renders, share button opens native sheet
10. Share URL to Discord → OG card renders with mascot + cover + first 2 lines + rating
11. Visit `/games/hades` while logged in as Bryan → see own-review card with "Read full →"
12. Log in as a second test user → visit `/u/bryan/reviews/hades` → review reads correctly; click heart → count increments to 1
13. Force Cerebras failure (env-var flip) → restart interview → silently lands on Groq, completes normally; `ai_calls` table shows Cerebras failure rows + Groq success rows
14. Hit 10 reviews in one day as one user → 11th attempt shows *"I need a nap — back at midnight UTC."* tooltip and the CTA is disabled
15. Edit a published review → save → public page shows updated body
16. Delete the review → 404 on public URL, gone from `/u/bryan/reviews`
17. `pnpm typecheck && pnpm lint && pnpm build` clean
18. Lighthouse ≥85 on `/u/{username}/reviews/{slug}` on desktop

**Soft launch milestone:** when verification passes, deploy to staging, send the URL to ~5 friends, ask each to write 1 review of a recent game. Screenshot their published reviews. Evaluate: did the magic-moment land?

---

## Risk Mitigations

| Risk | Mitigation |
|---|---|
| Cerebras API drops Llama 3.3 70B | Router uses model alias in code; swap to next available Llama on Cerebras with one constant change |
| Groq/CF/DeepSeek all simultaneously fail | Friendly mascot error + session persistence; user retries; this is acceptable because users aren't blocked from non-AI features |
| Cost spike from a buggy retry loop | Token-bucket per provider per minute + per-user daily cap; rate-limit errors visible in `ai_calls.error_message` |
| AI generates harmful or off-tone content | System prompt explicitly forbids hate / harassment / sexual content / harm; Phase 2 reviews are author-edited (user reviews the draft before publish) which adds a human-in-the-loop check; Phase 5 will add report-content UI |
| Sectioned editor's `\n\n` split breaks on user manual edits | The body remains valid; on next open the editor reconstructs as many sections as it finds and concatenates leftovers into the last section |
| OG card rendering fails | Falls back to no-OG-image link share; logged for debug; non-blocking |
| Provider returns malformed stream | Wrap stream consumption in try/catch; mid-stream error is treated as provider-fail-fallback to next tier |
| User loses internet mid-interview | `localStorage` shadow of answers; resume on reconnect |
| `games.slug` is also used by the existing `/games/[slug]` route — collision in semantics | None — the segment is a different position in the URL (`/u/{u}/reviews/{game.slug}` vs `/games/{game.slug}`); using the same slug is the *right* call because it's already canonical-for-this-game |
| AI hallucinates plot details about the game | Prompts instruct the AI to never invent — only stitch and polish the user's words; if a section comes back with hallucinations, regenerate-this-section handles it cleanly |
| Race condition: user double-clicks Publish | Server action is idempotent — re-publishing a published review is a no-op (returns the same URL) |

---

## References

- Master plan: `~/.claude/plans/smooth-herding-flame.md` (Phase 2 section)
- Phase 1 spec: `docs/superpowers/specs/2026-05-10-phase1-core-logging-design.md`
- Phase 1.5 spec: `docs/superpowers/specs/2026-05-10-phase1.5-polish-design.md`
- Perf audit spec: `docs/superpowers/specs/2026-05-10-perf-audit-design.md`
- Vercel AI SDK docs: https://sdk.vercel.ai
- Cerebras API: https://cloud.cerebras.ai
- Groq API: https://console.groq.com
- Cloudflare Workers AI: https://developers.cloudflare.com/workers-ai
- DeepSeek API: https://platform.deepseek.com
