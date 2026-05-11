# Phase 2 — AI Reviews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first AI surface — a conversational mascot-led review writing flow ending in a public, share-able review URL — meeting all 18 items of the Phase 2 verification gate.

**Architecture:** Vercel AI SDK as the streaming spine; a custom `generate()` router orchestrates fallback across Cerebras → Groq → Cloudflare Workers AI → DeepSeek V3 with Upstash-backed per-provider + per-user rate counters and `ai_calls` telemetry. Reviews persist in the existing `reviews` + `review_questions` tables; the public URL uses `games.slug` directly (one-review-per-game keeps it unambiguous). OG share cards are rendered via `next/og` at the canonical review id.

**Tech Stack:** Next.js 16 App Router · Server Actions · Vercel AI SDK (`ai` v6) · `@ai-sdk/groq` · `@ai-sdk/openai-compatible` · Drizzle ORM · Upstash Redis · `next/og`

**Spec:** [docs/superpowers/specs/2026-05-11-phase2-ai-reviews-design.md](../specs/2026-05-11-phase2-ai-reviews-design.md)

---

## File Structure

```
lib/ai/
├─ router.ts            generate() — orchestrates fallback + telemetry + rate limits
├─ rate-limit.ts        Upstash daily/minute counters + per-user review counter
├─ telemetry.ts         ai_calls writer (best-effort)
├─ cost.ts              token → USD rate cards per provider/model
├─ errors.ts            AIProvidersExhaustedError, RateLimitExceededError, AIRouterError
└─ providers/
   ├─ cerebras.ts       @ai-sdk/openai-compatible against api.cerebras.ai
   ├─ groq.ts           @ai-sdk/groq (first-party)
   ├─ cloudflare.ts     @ai-sdk/openai-compatible against CF Workers AI
   └─ deepseek.ts       @ai-sdk/openai-compatible against api.deepseek.com

lib/reviews/
├─ server-actions.ts    Server Actions surface for the entire flow
├─ session.ts           Upstash interview-session helpers (1h TTL)
└─ prompts.ts           System prompt + per-section templates + voice rules

components/reviews/
├─ review-interview.tsx Conversation UI + mascot states + streaming turns
├─ review-editor.tsx    Sectioned editor wrapping 4 SectionCards + publish bar
├─ section-card.tsx     One section block (edit/regenerate per section)
├─ review-card.tsx      Hero + body for canonical review page
├─ review-list-card.tsx Compact card for /u/{username}/reviews lists
└─ like-button.tsx      Heart icon + count + optimistic toggle

app/(app)/games/[slug]/review/
├─ page.tsx             Full route — interview + editor
└─ loading.tsx          Suspense fallback

app/(app)/@modal/(.)games/[slug]/review/
└─ page.tsx             Intercepted slide-over variant

app/(app)/u/[username]/reviews/
├─ page.tsx             List of user's public reviews
└─ [slug]/
   └─ page.tsx          Canonical review page

app/og/review/[id]/
└─ route.tsx            OG card endpoint (next/og ImageResponse)

components/game/
├─ log-card.tsx         (modify) — add "Write with mascot" button
├─ game-detail.tsx      (modify) — CTA + own-review card
└─ edit-log-modal.tsx   (modify) — Completed toast on status transition

.env.example            (modify) — DEEPSEEK_API_KEY placeholder
package.json            (modify) — add @ai-sdk/groq, @ai-sdk/openai-compatible
```

---

## Task ordering rationale

Tasks 1–6 build the AI substrate bottom-up: dependencies + error types → provider clients → counters → telemetry → router → review session/prompts. Each is fully verifiable on its own via typecheck/build, with no UI dependencies.

Tasks 7–10 layer the Server Actions surface on top of the substrate. Each action is small, self-contained, and verifiable against typecheck + a brief manual smoke (auth check, input shape).

Tasks 11–12 build the client components for the interview and the editor. They consume the Server Actions; once these land, the dev can manually walk through the full happy-path flow on a single route.

Tasks 13–15 mount the routes (interview route, list page, canonical review page) with their data wiring, plus integrate entry points into existing screens (log card, game detail, completed toast).

Task 16 adds the OG card endpoint.

Task 17 produces the Phase 2 verification gate document, executes the 18-item check, and tags the milestone.

---

## Task 1: Foundation — packages, env, error types, cost rate cards

**Goal:** Install the two new AI provider packages, add the DeepSeek key slot to `.env.example`, and ship the two zero-dep utility files (`errors.ts`, `cost.ts`) that every subsequent AI task imports.

**Files:**
- Modify: `package.json`
- Modify: `.env.example`
- Create: `lib/ai/errors.ts`
- Create: `lib/ai/cost.ts`

**Acceptance Criteria:**
- [ ] `pnpm list @ai-sdk/groq @ai-sdk/openai-compatible` lists both at a non-empty version
- [ ] `.env.example` contains a `DEEPSEEK_API_KEY=` line under the AI section
- [ ] `lib/ai/errors.ts` exports `AIProvidersExhaustedError`, `RateLimitExceededError`, `AIRouterError`
- [ ] `lib/ai/cost.ts` exports a `PROVIDER_COST` map and a `computeCostUsd()` helper
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Install AI SDK provider packages**

```powershell
pnpm add @ai-sdk/groq @ai-sdk/openai-compatible
```

- [ ] **Step 2: Add DeepSeek slot to `.env.example`**

Open `.env.example`, find the `AI Providers` section, and ensure the following line exists:

```
DEEPSEEK_API_KEY=
```

If the file already has a `DEEPSEEK_API_KEY=` line, leave it. Don't reformat the surrounding block.

- [ ] **Step 3: Create `lib/ai/errors.ts`**

```typescript
/**
 * Named errors thrown by the AI router. Catchers can branch on the type
 * to distinguish "all providers exhausted" from "rate limit hit" from
 * "individual provider failure (already silently fell through)".
 */

export class AIRouterError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "AIRouterError";
  }
}

export class AIProvidersExhaustedError extends AIRouterError {
  constructor(public readonly attempts: Array<{ provider: string; error: unknown }>) {
    super(`All ${attempts.length} AI providers failed`);
    this.name = "AIProvidersExhaustedError";
  }
}

export class RateLimitExceededError extends AIRouterError {
  constructor(public readonly limitKind: "user-daily" | "provider-daily" | "provider-minute") {
    super(`Rate limit exceeded: ${limitKind}`);
    this.name = "RateLimitExceededError";
  }
}
```

- [ ] **Step 4: Create `lib/ai/cost.ts`**

```typescript
import "server-only";

/**
 * USD cost per million tokens, per (provider, model). Numbers reflect
 * published rates at brainstorm time (2026-05-11). Update when providers
 * change pricing. Free tiers report 0 for budget tracking — actual cost
 * is zero up to the daily quota.
 */
export const PROVIDER_COST = {
  cerebras: { input: 0, output: 0 },
  groq: { input: 0, output: 0 },
  cloudflare: { input: 0, output: 0 },
  deepseek: { input: 0.14, output: 0.28 },
} as const satisfies Record<string, { input: number; output: number }>;

export type ProviderName = keyof typeof PROVIDER_COST;

export function computeCostUsd(
  provider: ProviderName,
  inputTokens: number,
  outputTokens: number,
): number {
  const rate = PROVIDER_COST[provider];
  const input = (inputTokens / 1_000_000) * rate.input;
  const output = (outputTokens / 1_000_000) * rate.output;
  // Round to 6 decimals to match numeric(10, 6) in ai_calls.cost_usd.
  return Math.round((input + output) * 1_000_000) / 1_000_000;
}
```

- [ ] **Step 5: Verify**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

Expected: all three green.

- [ ] **Step 6: Commit**

```powershell
git add package.json pnpm-lock.yaml .env.example lib/ai/errors.ts lib/ai/cost.ts
git commit -m @'
feat(ai): add provider SDK deps + error types + cost rate cards

Phase 2 Task 1 — foundation for the AI router.

- Adds @ai-sdk/groq and @ai-sdk/openai-compatible
- DEEPSEEK_API_KEY slot in .env.example (free providers were already there)
- lib/ai/errors.ts: AIRouterError + AIProvidersExhaustedError + RateLimitExceededError
- lib/ai/cost.ts: PROVIDER_COST rate cards + computeCostUsd() helper

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 2: AI provider clients (4 providers)

**Goal:** One module per provider that exposes a uniform `{ name, model, isConfigured, streamText }` interface so the router can iterate them generically.

**Files:**
- Create: `lib/ai/providers/cerebras.ts`
- Create: `lib/ai/providers/groq.ts`
- Create: `lib/ai/providers/cloudflare.ts`
- Create: `lib/ai/providers/deepseek.ts`

**Acceptance Criteria:**
- [ ] All four modules export the same `Provider` shape (typed in a shared interface)
- [ ] `isConfigured` returns `false` when required env vars are missing (no boot crash on partial config)
- [ ] `streamText` returns an `AsyncIterable<string>` (token chunks) via the Vercel AI SDK
- [ ] All four use Llama 3.3 70B except DeepSeek (V3) per the locked plan
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Shared provider type**

Create `lib/ai/providers/types.ts`:

```typescript
import "server-only";

export interface StreamArgs {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface StreamResult {
  textStream: AsyncIterable<string>;
  /** Resolves after the stream completes; returns token counts for telemetry. */
  usage: Promise<{ inputTokens: number; outputTokens: number }>;
}

export interface Provider {
  readonly name: "cerebras" | "groq" | "cloudflare" | "deepseek";
  readonly model: string;
  isConfigured(): boolean;
  streamText(args: StreamArgs): Promise<StreamResult>;
}
```

- [ ] **Step 2: Cerebras provider**

Create `lib/ai/providers/cerebras.ts`:

```typescript
import "server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import type { Provider } from "./types";

const MODEL = "llama-3.3-70b";

export const cerebras: Provider = {
  name: "cerebras",
  model: MODEL,
  isConfigured: () => Boolean(process.env.CEREBRAS_API_KEY),
  async streamText({ prompt, systemPrompt, maxTokens = 800, temperature = 0.7 }) {
    const client = createOpenAICompatible({
      name: "cerebras",
      baseURL: "https://api.cerebras.ai/v1",
      apiKey: process.env.CEREBRAS_API_KEY!,
    });
    const result = streamText({
      model: client(MODEL),
      system: systemPrompt,
      prompt,
      maxTokens,
      temperature,
    });
    return {
      textStream: result.textStream,
      usage: result.usage.then((u) => ({
        inputTokens: u.inputTokens ?? 0,
        outputTokens: u.outputTokens ?? 0,
      })),
    };
  },
};
```

- [ ] **Step 3: Groq provider**

Create `lib/ai/providers/groq.ts`:

```typescript
import "server-only";
import { createGroq } from "@ai-sdk/groq";
import { streamText } from "ai";
import type { Provider } from "./types";

const MODEL = "llama-3.3-70b-versatile";

export const groq: Provider = {
  name: "groq",
  model: MODEL,
  isConfigured: () => Boolean(process.env.GROQ_API_KEY),
  async streamText({ prompt, systemPrompt, maxTokens = 800, temperature = 0.7 }) {
    const client = createGroq({ apiKey: process.env.GROQ_API_KEY! });
    const result = streamText({
      model: client(MODEL),
      system: systemPrompt,
      prompt,
      maxTokens,
      temperature,
    });
    return {
      textStream: result.textStream,
      usage: result.usage.then((u) => ({
        inputTokens: u.inputTokens ?? 0,
        outputTokens: u.outputTokens ?? 0,
      })),
    };
  },
};
```

- [ ] **Step 4: Cloudflare provider**

Create `lib/ai/providers/cloudflare.ts`:

```typescript
import "server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import type { Provider } from "./types";

// Cloudflare Workers AI exposes an OpenAI-compatible endpoint per account:
// https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export const cloudflare: Provider = {
  name: "cloudflare",
  model: MODEL,
  isConfigured: () =>
    Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN),
  async streamText({ prompt, systemPrompt, maxTokens = 800, temperature = 0.7 }) {
    const client = createOpenAICompatible({
      name: "cloudflare-workers-ai",
      baseURL: `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/v1`,
      apiKey: process.env.CLOUDFLARE_API_TOKEN!,
    });
    const result = streamText({
      model: client(MODEL),
      system: systemPrompt,
      prompt,
      maxTokens,
      temperature,
    });
    return {
      textStream: result.textStream,
      usage: result.usage.then((u) => ({
        inputTokens: u.inputTokens ?? 0,
        outputTokens: u.outputTokens ?? 0,
      })),
    };
  },
};
```

- [ ] **Step 5: DeepSeek provider**

Create `lib/ai/providers/deepseek.ts`:

```typescript
import "server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import type { Provider } from "./types";

const MODEL = "deepseek-chat";

export const deepseek: Provider = {
  name: "deepseek",
  model: MODEL,
  isConfigured: () => Boolean(process.env.DEEPSEEK_API_KEY),
  async streamText({ prompt, systemPrompt, maxTokens = 800, temperature = 0.7 }) {
    const client = createOpenAICompatible({
      name: "deepseek",
      baseURL: "https://api.deepseek.com/v1",
      apiKey: process.env.DEEPSEEK_API_KEY!,
    });
    const result = streamText({
      model: client(MODEL),
      system: systemPrompt,
      prompt,
      maxTokens,
      temperature,
    });
    return {
      textStream: result.textStream,
      usage: result.usage.then((u) => ({
        inputTokens: u.inputTokens ?? 0,
        outputTokens: u.outputTokens ?? 0,
      })),
    };
  },
};
```

- [ ] **Step 6: Verify and commit**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

```powershell
git add lib/ai/providers
git commit -m @'
feat(ai): provider clients for Cerebras, Groq, Cloudflare, DeepSeek

Phase 2 Task 2 — uniform Provider interface across all four tiers.

- Shared types.ts: Provider { name, model, isConfigured(), streamText() }
- Cerebras + Cloudflare + DeepSeek via @ai-sdk/openai-compatible
- Groq via @ai-sdk/groq (first-party)
- All four use Llama 3.3 70B except DeepSeek (deepseek-chat / V3)
- isConfigured() returns false on missing env so partial config works

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 3: Rate-limit helpers (Upstash counters)

**Goal:** Three counter helpers in `lib/ai/rate-limit.ts` that the router consults before each call and increments after success: per-provider daily, per-provider minute, per-user daily review-start.

**Files:**
- Create: `lib/ai/rate-limit.ts`

**Acceptance Criteria:**
- [ ] `lib/ai/rate-limit.ts` exports `checkAndConsumeProviderDaily`, `checkAndConsumeProviderMinute`, `getUserDailyReviewCount`, `incrementUserDailyReviews`, and `DAILY_REVIEW_CAP` constant
- [ ] Provider caps use the published per-provider daily limits (Cerebras 1M tok ≈ 600 reviews → cap at 500 to leave headroom; Groq 14.4K RPD; CF 10K neurons ≈ ~3K calls; DeepSeek unlimited paid)
- [ ] All keys use `YYYYMMDD` (UTC) suffix to align with provider quota windows
- [ ] All keys have a 48-hour TTL on first write so abandoned keys eventually evict
- [ ] Increments only happen on success — the router calls `consume()` after the stream completes
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Create `lib/ai/rate-limit.ts`**

```typescript
import "server-only";
import { redis } from "@/lib/cache/redis";
import { RateLimitExceededError } from "./errors";
import type { ProviderName } from "./cost";

/** Hard cap: review-starts per user per UTC day. */
export const DAILY_REVIEW_CAP = 10;

/**
 * Per-provider daily call ceilings. Set ~10% under each provider's published
 * free-tier limit so we fall through cleanly before they 429 us. DeepSeek is
 * paid overflow — no daily cap.
 */
const PROVIDER_DAILY_CAP: Record<ProviderName, number | null> = {
  cerebras: 500,   // 1M tok/day ÷ ~1.6K tok/call ≈ 600 calls; cap at 500
  groq: 13_000,    // 14,400 RPD published; cap at 13K
  cloudflare: 3_000, // 10K Neurons/day; each call ~3 neurons; cap conservative
  deepseek: null,
};

/** Per-provider per-minute soft cap to absorb bursts. */
const PROVIDER_MINUTE_CAP: Record<ProviderName, number> = {
  cerebras: 30,
  groq: 30,
  cloudflare: 30,
  deepseek: 60,
};

const FORTY_EIGHT_HOURS_SECONDS = 60 * 60 * 48;
const TWO_MINUTES_SECONDS = 60 * 2;

function ymd(date = new Date()): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function ymdhm(date = new Date()): string {
  const iso = date.toISOString();
  return iso.slice(0, 16).replace(/[-:T]/g, "");
}

/**
 * Check whether the provider has headroom for a daily call. Returns true if
 * the call should proceed, false to skip to the next provider. Does NOT
 * increment — caller does that on success via incrementProviderDaily.
 */
export async function checkProviderDaily(provider: ProviderName): Promise<boolean> {
  const cap = PROVIDER_DAILY_CAP[provider];
  if (cap === null) return true;
  const key = `ai:tier:${provider}:${ymd()}`;
  const count = (await redis.get<number>(key)) ?? 0;
  return count < cap;
}

export async function incrementProviderDaily(provider: ProviderName): Promise<void> {
  const key = `ai:tier:${provider}:${ymd()}`;
  const newCount = await redis.incr(key);
  if (newCount === 1) {
    await redis.expire(key, FORTY_EIGHT_HOURS_SECONDS);
  }
}

export async function checkProviderMinute(provider: ProviderName): Promise<boolean> {
  const cap = PROVIDER_MINUTE_CAP[provider];
  const key = `ai:tier:${provider}:rpm:${ymdhm()}`;
  const count = (await redis.get<number>(key)) ?? 0;
  return count < cap;
}

export async function incrementProviderMinute(provider: ProviderName): Promise<void> {
  const key = `ai:tier:${provider}:rpm:${ymdhm()}`;
  const newCount = await redis.incr(key);
  if (newCount === 1) {
    await redis.expire(key, TWO_MINUTES_SECONDS);
  }
}

export async function getUserDailyReviewCount(userId: string): Promise<number> {
  const key = `ai:user:${userId}:reviews:${ymd()}`;
  return (await redis.get<number>(key)) ?? 0;
}

/**
 * Increment + check the user's daily counter atomically. Throws
 * RateLimitExceededError when cap reached so server actions can surface
 * a friendly mascot message.
 */
export async function incrementUserDailyReviews(userId: string): Promise<void> {
  const key = `ai:user:${userId}:reviews:${ymd()}`;
  const newCount = await redis.incr(key);
  if (newCount === 1) {
    await redis.expire(key, FORTY_EIGHT_HOURS_SECONDS);
  }
  if (newCount > DAILY_REVIEW_CAP) {
    // Roll back the overflow increment so a retry the next day starts at 0.
    await redis.decr(key);
    throw new RateLimitExceededError("user-daily");
  }
}
```

- [ ] **Step 2: Verify and commit**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

```powershell
git add lib/ai/rate-limit.ts
git commit -m @'
feat(ai): Upstash-backed rate-limit counters for router + user cap

Phase 2 Task 3 — three counter helpers consulted by the router.

- DAILY_REVIEW_CAP = 10 (hard cap per user per UTC day)
- PROVIDER_DAILY_CAP set ~10%% under each free-tier ceiling so we fall
  through cleanly before providers 429 us; DeepSeek is null (paid)
- PROVIDER_MINUTE_CAP = 30 across free tiers as a burst absorber
- All keys have 48h TTL (or 2min for minute keys) for hygiene
- incrementUserDailyReviews rolls back the overflow incr before throwing
  so the daily limit isn'\''t corrupted by failed cap-hit attempts

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 4: Telemetry (ai_calls writer)

**Goal:** A best-effort `recordCall()` that writes one `ai_calls` row per AI invocation. Failures are logged but never thrown — telemetry must never break a user-facing flow.

**Files:**
- Create: `lib/ai/telemetry.ts`

**Acceptance Criteria:**
- [ ] `recordCall()` accepts `{ userId, feature, provider, model, inputTokens, outputTokens, latencyMs, success, errorMessage? }` and writes to `ai_calls`
- [ ] Computes `cost_usd` via `computeCostUsd()` from `cost.ts`
- [ ] DB insertion errors are logged via `console.error("ai_calls write failed", err)` and swallowed
- [ ] Function returns `Promise<void>` and never throws
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Create `lib/ai/telemetry.ts`**

```typescript
import "server-only";
import { db, schema } from "@/lib/db";
import { computeCostUsd, type ProviderName } from "./cost";
import type { aiFeatureEnum } from "@/lib/db/schema";

type AIFeature = (typeof aiFeatureEnum.enumValues)[number];

export interface RecordCallArgs {
  userId: string | null;
  feature: AIFeature;
  provider: ProviderName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  success: boolean;
  errorMessage?: string;
}

/**
 * Best-effort write to ai_calls. Telemetry failures NEVER propagate —
 * a broken cost dashboard is preferable to a broken review flow.
 */
export async function recordCall(args: RecordCallArgs): Promise<void> {
  try {
    await db.insert(schema.aiCalls).values({
      userId: args.userId,
      feature: args.feature,
      provider: args.provider,
      model: args.model,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      costUsd: String(computeCostUsd(args.provider, args.inputTokens, args.outputTokens)),
      latencyMs: args.latencyMs,
      success: args.success,
      errorMessage: args.errorMessage ?? null,
    });
  } catch (err) {
    console.error("ai_calls write failed", err);
  }
}
```

- [ ] **Step 2: Verify and commit**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

```powershell
git add lib/ai/telemetry.ts
git commit -m @'
feat(ai): best-effort ai_calls telemetry writer

Phase 2 Task 4 — recordCall() inserts one row per AI invocation.

- Computes cost_usd via cost.ts rate cards
- DB errors are logged via console.error but never thrown
- Telemetry failure does NOT break the user-facing review flow

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 5: AI router (`generate()` orchestration)

**Goal:** The single public entry point for every AI call in the app. Tries providers in order, preempts exhaustion via rate-limit counters, streams tokens to the caller, writes telemetry on completion.

**Files:**
- Create: `lib/ai/router.ts`

**Acceptance Criteria:**
- [ ] `generate({ prompt, systemPrompt, feature, userId })` returns `{ textStream: AsyncIterable<string>, providerUsed: ProviderName }`
- [ ] Iterates in order: `cerebras → groq → cloudflare → deepseek`
- [ ] Skips a provider if `isConfigured()` is false OR if `checkProviderDaily` / `checkProviderMinute` returns false
- [ ] Provider failure caught and chain continues to next
- [ ] On success: increments both daily + minute counters for that provider, writes telemetry with measured latency
- [ ] On full exhaustion: throws `AIProvidersExhaustedError` with the list of attempts
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Create `lib/ai/router.ts`**

```typescript
import "server-only";
import { cerebras } from "./providers/cerebras";
import { groq } from "./providers/groq";
import { cloudflare } from "./providers/cloudflare";
import { deepseek } from "./providers/deepseek";
import type { Provider } from "./providers/types";
import {
  checkProviderDaily,
  checkProviderMinute,
  incrementProviderDaily,
  incrementProviderMinute,
} from "./rate-limit";
import { recordCall } from "./telemetry";
import { AIProvidersExhaustedError, RateLimitExceededError } from "./errors";
import type { aiFeatureEnum } from "@/lib/db/schema";

type AIFeature = (typeof aiFeatureEnum.enumValues)[number];

const PROVIDERS: readonly Provider[] = [cerebras, groq, cloudflare, deepseek];

export interface GenerateArgs {
  prompt: string;
  systemPrompt?: string;
  feature: AIFeature;
  userId: string | null;
  maxTokens?: number;
  temperature?: number;
}

export interface GenerateResult {
  textStream: AsyncIterable<string>;
  providerUsed: Provider["name"];
}

/**
 * The single public AI entry point. Iterates providers in tier order,
 * skipping ones that are unconfigured or rate-limited. Telemetry is
 * written best-effort after the stream completes. RateLimitExceededError
 * from the per-user cap should be caught and handled by the caller BEFORE
 * generate() runs — this function doesn't enforce user limits, only
 * provider limits.
 */
export async function generate(args: GenerateArgs): Promise<GenerateResult> {
  const attempts: Array<{ provider: string; error: unknown }> = [];

  for (const provider of PROVIDERS) {
    if (!provider.isConfigured()) {
      attempts.push({ provider: provider.name, error: "not configured" });
      continue;
    }
    if (!(await checkProviderDaily(provider.name))) {
      attempts.push({ provider: provider.name, error: "daily cap" });
      continue;
    }
    if (!(await checkProviderMinute(provider.name))) {
      attempts.push({ provider: provider.name, error: "minute cap" });
      continue;
    }

    const start = Date.now();
    try {
      const { textStream, usage } = await provider.streamText({
        prompt: args.prompt,
        systemPrompt: args.systemPrompt,
        maxTokens: args.maxTokens,
        temperature: args.temperature,
      });

      // Wrap the stream so we can write telemetry on completion without
      // forcing the caller to await usage themselves.
      const wrapped = wrapStream(textStream, async () => {
        try {
          await incrementProviderDaily(provider.name);
          await incrementProviderMinute(provider.name);
          const u = await usage;
          await recordCall({
            userId: args.userId,
            feature: args.feature,
            provider: provider.name,
            model: provider.model,
            inputTokens: u.inputTokens,
            outputTokens: u.outputTokens,
            latencyMs: Date.now() - start,
            success: true,
          });
        } catch (err) {
          console.error("router post-stream bookkeeping failed", err);
        }
      });

      return { textStream: wrapped, providerUsed: provider.name };
    } catch (err) {
      attempts.push({ provider: provider.name, error: err });
      // Best-effort failure telemetry — don't await it
      void recordCall({
        userId: args.userId,
        feature: args.feature,
        provider: provider.name,
        model: provider.model,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: Date.now() - start,
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
  }

  throw new AIProvidersExhaustedError(attempts);
}

export { RateLimitExceededError };

/**
 * Wrap an async iterable so that a finalizer runs after the consumer
 * finishes iterating. The finalizer is allowed to be async; errors in it
 * are caught and logged.
 */
async function* wrapStream(
  source: AsyncIterable<string>,
  onComplete: () => Promise<void>,
): AsyncIterable<string> {
  try {
    for await (const chunk of source) {
      yield chunk;
    }
  } finally {
    await onComplete();
  }
}
```

- [ ] **Step 2: Verify and commit**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

```powershell
git add lib/ai/router.ts
git commit -m @'
feat(ai): generate() router with ordered provider fallback

Phase 2 Task 5 — orchestrates the four-tier AI call chain.

- Cerebras → Groq → Cloudflare → DeepSeek
- Skips unconfigured providers + ones over daily/minute caps (preempt 429s)
- wrapStream() runs post-completion bookkeeping (counter increments +
  telemetry write) without blocking the caller
- Failure telemetry on per-provider catch path is fire-and-forget
- AIProvidersExhaustedError carries the attempts list for debugging

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 6: Review session helpers + prompt templates

**Goal:** The Upstash-backed interview session (1h TTL) plus the system prompt and per-section question/draft templates. Two files because the prompts are large but stable; the session helpers are small and dynamic.

**Files:**
- Create: `lib/reviews/session.ts`
- Create: `lib/reviews/prompts.ts`

**Acceptance Criteria:**
- [ ] `session.ts` exports `createSession`, `getSession`, `appendAnswer`, `appendQuestion`, `destroySession`
- [ ] Session keyed by random UUID; `userId`, `logId`, `gameId`, `questions` + `answers` (parallel string arrays indexed by turn 1-4), `createdAt`
- [ ] Q1 is set on session create; Q2–Q4 are written via `appendQuestion` once their stream completes
- [ ] 1-hour TTL refreshed on every mutation
- [ ] `prompts.ts` exports `SYSTEM_PROMPT`, `openerQuestion(game)`, `followUpPrompt(...)`, `draftPrompt(...)`
- [ ] System prompt encodes voice rules (sardonic insider, no AI self-reference, never invent plot details)
- [ ] `followUpPrompt` accepts game context + prior Q&A array + section target (Highs/Lows/Verdict) and returns the prompt string
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Create `lib/reviews/session.ts`**

```typescript
import "server-only";
import { randomUUID } from "node:crypto";
import { redis } from "@/lib/cache/redis";

const ONE_HOUR_SECONDS = 60 * 60;

export interface InterviewSession {
  interviewId: string;
  userId: string;
  logId: string;
  gameId: number;
  /** questions[0] = Q1, questions[1] = Q2, etc. Q1 is set on session create; Q2-Q4 are
   *  written via appendQuestion after each AI stream completes. */
  questions: string[];
  /** answers[i] is the user's answer to questions[i]. Length grows from 0 to 4. */
  answers: string[];
  createdAt: number;
}

function key(interviewId: string): string {
  return `ai:interview:${interviewId}`;
}

export async function createSession(args: {
  userId: string;
  logId: string;
  gameId: number;
  /** The fixed Q1 opener — written into questions[0] at session-create time. */
  openerQuestion: string;
}): Promise<InterviewSession> {
  const session: InterviewSession = {
    interviewId: randomUUID(),
    userId: args.userId,
    logId: args.logId,
    gameId: args.gameId,
    questions: [args.openerQuestion],
    answers: [],
    createdAt: Date.now(),
  };
  await redis.set(key(session.interviewId), session, { ex: ONE_HOUR_SECONDS });
  return session;
}

export async function getSession(interviewId: string): Promise<InterviewSession | null> {
  const value = await redis.get<InterviewSession>(key(interviewId));
  return value ?? null;
}

/**
 * Append (or replace) the answer for the given 1-based turn number. If a
 * later answer already exists, it's discarded — editing answer N invalidates
 * answers N+1..4.
 */
export async function appendAnswer(
  interviewId: string,
  turn: number,
  text: string,
): Promise<InterviewSession | null> {
  const session = await getSession(interviewId);
  if (!session) return null;
  const next = { ...session };
  next.answers = next.answers.slice(0, turn - 1);
  next.answers[turn - 1] = text;
  await redis.set(key(interviewId), next, { ex: ONE_HOUR_SECONDS });
  return next;
}

/**
 * Save the AI-generated question for the given 1-based turn. Called by
 * submitAnswer once the next-question stream completes so review_questions
 * rows can later carry the real text (not a placeholder).
 */
export async function appendQuestion(
  interviewId: string,
  turn: number,
  text: string,
): Promise<InterviewSession | null> {
  const session = await getSession(interviewId);
  if (!session) return null;
  const next = { ...session, questions: [...session.questions] };
  next.questions[turn - 1] = text;
  await redis.set(key(interviewId), next, { ex: ONE_HOUR_SECONDS });
  return next;
}

export async function destroySession(interviewId: string): Promise<void> {
  await redis.del(key(interviewId));
}
```

- [ ] **Step 2: Create `lib/reviews/prompts.ts`**

```typescript
import "server-only";

export const SYSTEM_PROMPT = `You are the conversational host of a game-review interview inside a game-tracking app called Letterboxd for Games. Your voice is sardonic insider — short sentences, knowledgeable, never an exclamation mark, never a "great question!".

Rules:
- Ask exactly one question per turn. No preamble, no commentary.
- Each follow-up references what the user just said. Quote a short fragment of their answer back to them when natural.
- Never invent plot details, mechanics, or facts about the game. If the user hasn't said it, you don't know it.
- Never break character to mention being an AI, a model, or a language model.
- Never apologize.
- Never use the phrase "as an AI".
- When generating a draft review, stitch the user's actual phrasing into each section. Add connective tissue, don't replace the voice.
- When generating sections, output exactly four paragraphs separated by a blank line. No section headers. No bullet points.

Tone reference: think Polygon's Patrick Klepek interviewing a friend in a Discord DM, not GameSpot marketing copy.`;

export interface GameContext {
  title: string;
  genres?: readonly string[] | null;
  themes?: readonly string[] | null;
  releasedYear?: number | null;
}

export function openerQuestion(game: GameContext): string {
  return `What pulled you into ${game.title}?`;
}

const SECTION_DIRECTIVE = {
  Highs: "elicit the highs — the moments that stuck",
  Lows: "elicit the lows — what dragged, what frustrated, what bounced you",
  Verdict: "elicit the verdict — if a friend asked 'is it worth it' what's the one-line answer",
} as const;

export type SectionTarget = keyof typeof SECTION_DIRECTIVE;

/** Builds the prompt for Q2/Q3/Q4 in the interview. */
export function followUpPrompt(args: {
  game: GameContext;
  priorAnswers: readonly string[];
  sectionTarget: SectionTarget;
}): string {
  const lastAnswer = args.priorAnswers[args.priorAnswers.length - 1] ?? "";
  return [
    `Game: ${args.game.title}${args.game.releasedYear ? ` (${args.game.releasedYear})` : ""}`,
    args.game.genres?.length ? `Genres: ${args.game.genres.join(", ")}` : null,
    "",
    "User has answered so far:",
    ...args.priorAnswers.map((a, i) => `Q${i + 1}: ${a}`),
    "",
    `Your task: ask ONE follow-up question to ${SECTION_DIRECTIVE[args.sectionTarget]}. Reference their last answer ("${lastAnswer.slice(0, 120)}${lastAnswer.length > 120 ? "…" : ""}"). One question only. No preamble.`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

/** Builds the draft-generation prompt after Q&A is complete. */
export function draftPrompt(args: {
  game: GameContext;
  answers: readonly string[];
}): string {
  return [
    `Game: ${args.game.title}${args.game.releasedYear ? ` (${args.game.releasedYear})` : ""}`,
    args.game.genres?.length ? `Genres: ${args.game.genres.join(", ")}` : null,
    "",
    "User's interview answers (one per turn):",
    ...args.answers.map((a, i) => `Q${i + 1}: ${a}`),
    "",
    "Write the user's review as four paragraphs separated by a blank line, in the user's voice. Paragraph 1 = Hook (what pulled them in). Paragraph 2 = Highs. Paragraph 3 = Lows. Paragraph 4 = Verdict. Stitch their exact phrasing into the prose. No headers. No bullet points. No first paragraph that says 'I just finished'. Just the review.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

/** Builds the regenerate-one-section prompt. */
export function regenerateSectionPrompt(args: {
  game: GameContext;
  answers: readonly string[];
  sectionIndex: 0 | 1 | 2 | 3;
}): string {
  const sectionName = (["Hook", "Highs", "Lows", "Verdict"] as const)[args.sectionIndex];
  const sourceAnswer = args.answers[args.sectionIndex] ?? "";
  return [
    `Game: ${args.game.title}${args.game.releasedYear ? ` (${args.game.releasedYear})` : ""}`,
    "",
    `Source answer for the ${sectionName} paragraph:`,
    sourceAnswer,
    "",
    `Rewrite the ${sectionName} paragraph (2-4 sentences). Stitch the user's phrasing into the prose. No header, no preamble. Just the paragraph.`,
  ].join("\n");
}
```

- [ ] **Step 3: Verify and commit**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

```powershell
git add lib/reviews/session.ts lib/reviews/prompts.ts
git commit -m @'
feat(reviews): Upstash interview session + prompt templates

Phase 2 Task 6 — the interview state store and the AI prompt library.

- session.ts: createSession/getSession/appendAnswer/destroySession,
  keyed by random UUID, 1h TTL refreshed on every mutation, editing an
  earlier answer truncates downstream answers
- prompts.ts: SYSTEM_PROMPT encodes the sardonic-insider voice rules
  (no AI self-reference, never invent plot details, one question per
  turn, four-paragraph draft format)
- openerQuestion (fixed Q1), followUpPrompt (Q2/Q3/Q4 with section
  target + last-answer quote), draftPrompt (full review), and
  regenerateSectionPrompt (single section rewrite)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 7: startInterview + submitAnswer server actions

**Goal:** The two server actions that drive the interview phase. `startInterview` checks the user's daily cap and creates the Upstash session; `submitAnswer` records the user's answer and streams the next mascot question via the router.

**Files:**
- Create: `lib/reviews/server-actions.ts`

**Acceptance Criteria:**
- [ ] `startInterview({ logId })` validates ownership, checks daily cap, creates session, returns `{ interviewId, q1 }`
- [ ] `submitAnswer({ interviewId, turn, text })` validates session ownership, appends answer, returns either `{ nextQuestionStream }` (for turn 1–3) or `{ ready: true }` (for turn 4 — signals client to call `generateDraft`)
- [ ] Both wrap the router call in try/catch; on `RateLimitExceededError` returns a friendly mascot message
- [ ] Uses `createStreamableValue` from `ai/rsc` for the streaming response
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Create `lib/reviews/server-actions.ts` with the two actions**

```typescript
"use server";

import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { createStreamableValue } from "ai/rsc";
import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { generate } from "@/lib/ai/router";
import {
  DAILY_REVIEW_CAP,
  getUserDailyReviewCount,
  incrementUserDailyReviews,
} from "@/lib/ai/rate-limit";
import { RateLimitExceededError, AIProvidersExhaustedError } from "@/lib/ai/errors";
import {
  createSession,
  getSession,
  appendAnswer,
  appendQuestion,
  destroySession,
} from "./session";
import {
  SYSTEM_PROMPT,
  openerQuestion,
  followUpPrompt,
  type SectionTarget,
  type GameContext,
} from "./prompts";

const startInterviewInput = z.object({ logId: z.string().uuid() });
const submitAnswerInput = z.object({
  interviewId: z.string().uuid(),
  turn: z.number().int().min(1).max(4),
  text: z.string().trim().min(1).max(2000),
});

const SECTION_BY_TURN: Record<2 | 3 | 4, SectionTarget> = {
  2: "Highs",
  3: "Lows",
  4: "Verdict",
};

type StartResult =
  | { ok: true; interviewId: string; q1: string }
  | { ok: false; error: string };

export async function startInterview(input: unknown): Promise<StartResult> {
  const parsed = startInterviewInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const count = await getUserDailyReviewCount(user.id);
  if (count >= DAILY_REVIEW_CAP) {
    return { ok: false, error: "I need a nap — back at midnight UTC." };
  }

  const log = await db.query.logs.findFirst({
    where: and(eq(schema.logs.id, parsed.data.logId), eq(schema.logs.userId, user.id)),
    columns: { id: true, userId: true, gameId: true },
  });
  if (!log) return { ok: false, error: "Log not found" };

  const game = await db.query.games.findFirst({
    where: eq(schema.games.id, log.gameId),
    columns: { id: true, title: true, genres: true, themes: true, released: true },
  });
  if (!game) return { ok: false, error: "Game not found" };

  try {
    await incrementUserDailyReviews(user.id);
  } catch (err) {
    if (err instanceof RateLimitExceededError) {
      return { ok: false, error: "I need a nap — back at midnight UTC." };
    }
    throw err;
  }

  const q1 = openerQuestion({
    title: game.title,
    genres: game.genres,
    themes: game.themes,
    releasedYear: game.released?.getFullYear(),
  });

  const session = await createSession({
    userId: user.id,
    logId: log.id,
    gameId: game.id,
    openerQuestion: q1,
  });

  return { ok: true, interviewId: session.interviewId, q1 };
}

type SubmitAnswerResult =
  | { ok: true; ready: true } // After Q4, client should call generateDraft
  | { ok: true; ready: false; stream: ReturnType<typeof createStreamableValue<string>>["value"] }
  | { ok: false; error: string };

export async function submitAnswer(input: unknown): Promise<SubmitAnswerResult> {
  const parsed = submitAnswerInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const session = await getSession(parsed.data.interviewId);
  if (!session || session.userId !== user.id) {
    return { ok: false, error: "Session expired" };
  }

  const updated = await appendAnswer(parsed.data.interviewId, parsed.data.turn, parsed.data.text);
  if (!updated) return { ok: false, error: "Session expired" };

  // After Q4, signal client to call generateDraft.
  if (parsed.data.turn === 4) {
    return { ok: true, ready: true };
  }

  const nextTurn = (parsed.data.turn + 1) as 2 | 3 | 4;
  const game = await db.query.games.findFirst({
    where: eq(schema.games.id, session.gameId),
    columns: { title: true, genres: true, themes: true, released: true },
  });
  if (!game) return { ok: false, error: "Game not found" };

  const ctx: GameContext = {
    title: game.title,
    genres: game.genres,
    themes: game.themes,
    releasedYear: game.released?.getFullYear(),
  };
  const prompt = followUpPrompt({
    game: ctx,
    priorAnswers: updated.answers,
    sectionTarget: SECTION_BY_TURN[nextTurn],
  });

  const streamable = createStreamableValue<string>("");
  void (async () => {
    try {
      const { textStream } = await generate({
        prompt,
        systemPrompt: SYSTEM_PROMPT,
        feature: "interview_question",
        userId: user.id,
        maxTokens: 120,
        temperature: 0.8,
      });
      let acc = "";
      for await (const chunk of textStream) {
        acc += chunk;
        streamable.update(acc);
      }
      // Persist the AI question to the session so generateDraft can write
      // real text (not a placeholder) into review_questions later.
      await appendQuestion(parsed.data.interviewId, nextTurn, acc.trim());
      streamable.done(acc);
    } catch (err) {
      const message =
        err instanceof AIProvidersExhaustedError
          ? "Let me catch my breath — your answers are saved. Try again?"
          : "Something glitched. Try again?";
      streamable.error(new Error(message));
    }
  })();

  return { ok: true, ready: false, stream: streamable.value };
}

// Future tasks will append: generateDraft, regenerateSection, publishReview,
// updateReview, deleteReview, likeReview, unlikeReview. Exported here to
// keep one server-actions file per the existing project convention.
```

- [ ] **Step 2: Verify and commit**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

```powershell
git add lib/reviews/server-actions.ts
git commit -m @'
feat(reviews): startInterview + submitAnswer server actions

Phase 2 Task 7 — drives the four-turn conversation.

- startInterview: validates log ownership, checks 10/day cap before
  incrementing (cap-check is gate, increment is commit), creates Upstash
  session, returns fixed Q1
- submitAnswer: validates session ownership, appends answer, streams the
  next AI follow-up via the router. After turn 4, signals ready=true so
  the client can call generateDraft next.
- Errors map to in-character mascot messages
- Streams via createStreamableValue from ai/rsc

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 8: generateDraft server action (+ persistence)

**Goal:** Take all 4 Q&A pairs from the interview session, prompt the router for the draft, and persist a `reviews` row + 4 `review_questions` rows as the stream completes.

**Files:**
- Modify: `lib/reviews/server-actions.ts`

**Acceptance Criteria:**
- [ ] `generateDraft({ interviewId })` validates session ownership
- [ ] Streams the draft via `createStreamableValue` so the editor can render section-by-section
- [ ] On first token: inserts the `reviews` row with `body=''`, `published_at=NULL`; inserts 4 `review_questions` rows
- [ ] On stream end: writes final `body` to `reviews.body`, destroys the Upstash session
- [ ] Returns `{ ok: true, reviewId, stream }` immediately; the row id is known before the stream finishes
- [ ] If the user already has a published review for this game, returns `{ ok: false, error: "Already reviewed" }` with the existing reviewId for redirect
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Append `generateDraft` to `lib/reviews/server-actions.ts`**

Add these imports near the top alongside the existing ones:

```typescript
import { revalidatePath } from "next/cache";
import { draftPrompt } from "./prompts";
```

Then append after `submitAnswer`:

```typescript
const generateDraftInput = z.object({ interviewId: z.string().uuid() });

type GenerateDraftResult =
  | { ok: true; reviewId: string; stream: ReturnType<typeof createStreamableValue<string>>["value"] }
  | { ok: false; error: string; existingReviewId?: string };

export async function generateDraft(input: unknown): Promise<GenerateDraftResult> {
  const parsed = generateDraftInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const session = await getSession(parsed.data.interviewId);
  if (!session || session.userId !== user.id) {
    return { ok: false, error: "Session expired" };
  }
  if (session.answers.length === 0) {
    return { ok: false, error: "No answers to draft from" };
  }

  // One-per-game cardinality enforcement (app-side; no DB unique index).
  const existing = await db.query.reviews.findFirst({
    where: and(
      eq(schema.reviews.userId, user.id),
      eq(schema.reviews.gameId, session.gameId),
    ),
    columns: { id: true },
  });
  if (existing) {
    return { ok: false, error: "You've already reviewed this game", existingReviewId: existing.id };
  }

  const game = await db.query.games.findFirst({
    where: eq(schema.games.id, session.gameId),
    columns: { title: true, genres: true, themes: true, released: true, slug: true },
  });
  if (!game) return { ok: false, error: "Game not found" };

  // Insert the empty draft row up front so the client can navigate to
  // /games/{slug}/review?reviewId={id} and start rendering streamed sections.
  const [inserted] = await db
    .insert(schema.reviews)
    .values({
      userId: user.id,
      gameId: session.gameId,
      logId: session.logId,
      body: "",
      isAiAssisted: true,
      isPublic: true,
    })
    .returning({ id: schema.reviews.id });
  if (!inserted) return { ok: false, error: "Could not create draft" };
  const reviewId = inserted.id;

  // Insert 4 review_questions rows. Padding both arrays with empty strings
  // for Skip-the-rest scenarios so position is preserved and questions[i]
  // is paired with answers[i].
  const paddedQuestions: string[] = [
    session.questions[0] ?? "",
    session.questions[1] ?? "",
    session.questions[2] ?? "",
    session.questions[3] ?? "",
  ];
  const paddedAnswers: string[] = [
    session.answers[0] ?? "",
    session.answers[1] ?? "",
    session.answers[2] ?? "",
    session.answers[3] ?? "",
  ];
  await db.insert(schema.reviewQuestions).values(
    paddedAnswers.map((answer, idx) => ({
      reviewId,
      position: idx + 1,
      question: paddedQuestions[idx] || `Turn ${idx + 1}`,
      answer,
    })),
  );

  const prompt = draftPrompt({
    game: {
      title: game.title,
      genres: game.genres,
      themes: game.themes,
      releasedYear: game.released?.getFullYear(),
    },
    answers: paddedAnswers.filter((a) => a.length > 0),
  });

  const streamable = createStreamableValue<string>("");
  void (async () => {
    try {
      const { textStream } = await generate({
        prompt,
        systemPrompt: SYSTEM_PROMPT,
        feature: "review_draft",
        userId: user.id,
        maxTokens: 700,
        temperature: 0.7,
      });
      let acc = "";
      for await (const chunk of textStream) {
        acc += chunk;
        streamable.update(acc);
      }
      // Persist the final body
      await db
        .update(schema.reviews)
        .set({ body: acc, updatedAt: new Date() })
        .where(eq(schema.reviews.id, reviewId));
      await destroySession(parsed.data.interviewId);
      streamable.done(acc);
    } catch (err) {
      const message =
        err instanceof AIProvidersExhaustedError
          ? "Let me catch my breath — your draft will be saved. Try again?"
          : "Something glitched while drafting. Try again?";
      streamable.error(new Error(message));
    }
  })();

  return { ok: true, reviewId, stream: streamable.value };
}
```

- [ ] **Step 2: Verify and commit**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

```powershell
git add lib/reviews/server-actions.ts
git commit -m @'
feat(reviews): generateDraft streams + persists the AI draft

Phase 2 Task 8 — the third server action, completes the interview->draft loop.

- Validates session ownership before consuming
- Enforces one-review-per-game in app code via a findFirst; returns
  existingReviewId on collision for client-side redirect
- Inserts empty reviews row up front so reviewId is known immediately
- Inserts 4 review_questions rows (padded for Skip-the-rest case)
- Streams the draft, persists final body on stream end, destroys session

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 9: regenerateSection server action

**Goal:** Replace one paragraph (Hook/Highs/Lows/Verdict, index 0–3) of an existing draft `reviews.body`, streaming the new text and updating only that paragraph.

**Files:**
- Modify: `lib/reviews/server-actions.ts`

**Acceptance Criteria:**
- [ ] `regenerateSection({ reviewId, sectionIndex })` validates the review belongs to the caller
- [ ] Loads the source Q&A pair for that section from `review_questions`
- [ ] Streams the rewrite; on stream end, splits `reviews.body` on `\n\n`, replaces the target index, joins, saves
- [ ] If `body` has fewer than 4 paragraphs (user manually edited away a break), pads with empty paragraphs before replacing
- [ ] Returns `{ ok: true, stream }`
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Append `regenerateSection` to `lib/reviews/server-actions.ts`**

Add this import:

```typescript
import { regenerateSectionPrompt } from "./prompts";
```

Then append:

```typescript
const regenerateSectionInput = z.object({
  reviewId: z.string().uuid(),
  sectionIndex: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
});

type RegenerateSectionResult =
  | { ok: true; stream: ReturnType<typeof createStreamableValue<string>>["value"] }
  | { ok: false; error: string };

export async function regenerateSection(input: unknown): Promise<RegenerateSectionResult> {
  const parsed = regenerateSectionInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const review = await db.query.reviews.findFirst({
    where: and(
      eq(schema.reviews.id, parsed.data.reviewId),
      eq(schema.reviews.userId, user.id),
    ),
    columns: { id: true, body: true, gameId: true },
  });
  if (!review) return { ok: false, error: "Review not found" };

  const game = await db.query.games.findFirst({
    where: eq(schema.games.id, review.gameId),
    columns: { title: true, released: true },
  });
  if (!game) return { ok: false, error: "Game not found" };

  const questions = await db.query.reviewQuestions.findMany({
    where: eq(schema.reviewQuestions.reviewId, review.id),
    orderBy: (q, { asc }) => asc(q.position),
    columns: { position: true, answer: true },
  });
  // Build a 4-length answers array indexed 0..3
  const answers: string[] = [0, 1, 2, 3].map(
    (i) => questions.find((q) => q.position === i + 1)?.answer ?? "",
  );

  const prompt = regenerateSectionPrompt({
    game: { title: game.title, releasedYear: game.released?.getFullYear() },
    answers,
    sectionIndex: parsed.data.sectionIndex,
  });

  const streamable = createStreamableValue<string>("");
  void (async () => {
    try {
      const { textStream } = await generate({
        prompt,
        systemPrompt: SYSTEM_PROMPT,
        feature: "review_draft",
        userId: user.id,
        maxTokens: 250,
        temperature: 0.7,
      });
      let acc = "";
      for await (const chunk of textStream) {
        acc += chunk;
        streamable.update(acc);
      }
      // Split current body on \n\n, pad to 4, replace target, rejoin.
      const sections = (review.body ?? "").split("\n\n");
      while (sections.length < 4) sections.push("");
      sections[parsed.data.sectionIndex] = acc.trim();
      const newBody = sections.slice(0, 4).join("\n\n");
      await db
        .update(schema.reviews)
        .set({ body: newBody, updatedAt: new Date() })
        .where(eq(schema.reviews.id, review.id));
      streamable.done(acc);
    } catch (err) {
      const message =
        err instanceof AIProvidersExhaustedError
          ? "Let me catch my breath. Try again?"
          : "Couldn't rewrite that one. Try again?";
      streamable.error(new Error(message));
    }
  })();

  return { ok: true, stream: streamable.value };
}
```

- [ ] **Step 2: Verify and commit**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

```powershell
git add lib/reviews/server-actions.ts
git commit -m @'
feat(reviews): regenerateSection replaces one paragraph in body

Phase 2 Task 9 — the per-section regenerate.

- Validates ownership before reading review + questions
- Streams a rewrite of one paragraph (index 0..3) using the source Q&A
- Splits body on \\n\\n, pads to 4 if user manually broke structure,
  replaces target index, rejoins
- Persists only after stream completes (matches generateDraft pattern)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 10: publish/update/delete + likes server actions

**Goal:** The non-streaming server actions that close out the review lifecycle. `publishReview` flips published_at; `updateReview` is the edit-after-publish path; `deleteReview` is a hard delete; `likeReview`/`unlikeReview` toggle the heart.

**Files:**
- Modify: `lib/reviews/server-actions.ts`

**Acceptance Criteria:**
- [ ] `publishReview({ reviewId, rating, isPublic })` sets `published_at = now()`, rating, is_public; idempotent on re-call (returns the same URL info if already published)
- [ ] `updateReview({ reviewId, body, rating, isPublic })` updates body/rating/is_public; `published_at` unchanged
- [ ] `deleteReview({ reviewId })` hard-deletes the row (cascades to review_questions + likes)
- [ ] `likeReview({ reviewId })` inserts with `ON CONFLICT DO NOTHING`
- [ ] `unlikeReview({ reviewId })` deletes the like
- [ ] All paths revalidate the relevant routes: `/u/{username}`, `/u/{username}/reviews`, `/u/{username}/reviews/{slug}`, `/games/{slug}`
- [ ] All require auth + ownership
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Append the five actions to `lib/reviews/server-actions.ts`**

```typescript
const publishInput = z.object({
  reviewId: z.string().uuid(),
  rating: z.number().min(0).max(10),
  isPublic: z.boolean(),
});

type PublishResult =
  | { ok: true; username: string; gameSlug: string }
  | { ok: false; error: string };

export async function publishReview(input: unknown): Promise<PublishResult> {
  const parsed = publishInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const review = await db.query.reviews.findFirst({
    where: and(eq(schema.reviews.id, parsed.data.reviewId), eq(schema.reviews.userId, user.id)),
    columns: { id: true, gameId: true, publishedAt: true },
  });
  if (!review) return { ok: false, error: "Review not found" };

  const [game, profile] = await Promise.all([
    db.query.games.findFirst({
      where: eq(schema.games.id, review.gameId),
      columns: { slug: true },
    }),
    db.query.profiles.findFirst({
      where: eq(schema.profiles.userId, user.id),
      columns: { username: true },
    }),
  ]);
  if (!game || !profile) return { ok: false, error: "Lookup failed" };

  await db
    .update(schema.reviews)
    .set({
      publishedAt: review.publishedAt ?? new Date(),
      rating: String(parsed.data.rating),
      isPublic: parsed.data.isPublic,
      updatedAt: new Date(),
    })
    .where(eq(schema.reviews.id, review.id));

  revalidatePath(`/u/${profile.username}`);
  revalidatePath(`/u/${profile.username}/reviews`);
  revalidatePath(`/u/${profile.username}/reviews/${game.slug}`);
  revalidatePath(`/games/${game.slug}`);

  return { ok: true, username: profile.username, gameSlug: game.slug };
}

const updateInput = z.object({
  reviewId: z.string().uuid(),
  body: z.string().trim().min(1).max(20_000),
  rating: z.number().min(0).max(10),
  isPublic: z.boolean(),
});

type UpdateResult = { ok: true } | { ok: false; error: string };

export async function updateReview(input: unknown): Promise<UpdateResult> {
  const parsed = updateInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const review = await db.query.reviews.findFirst({
    where: and(eq(schema.reviews.id, parsed.data.reviewId), eq(schema.reviews.userId, user.id)),
    columns: { id: true, gameId: true },
  });
  if (!review) return { ok: false, error: "Review not found" };

  const [game, profile] = await Promise.all([
    db.query.games.findFirst({
      where: eq(schema.games.id, review.gameId),
      columns: { slug: true },
    }),
    db.query.profiles.findFirst({
      where: eq(schema.profiles.userId, user.id),
      columns: { username: true },
    }),
  ]);
  if (!game || !profile) return { ok: false, error: "Lookup failed" };

  await db
    .update(schema.reviews)
    .set({
      body: parsed.data.body,
      rating: String(parsed.data.rating),
      isPublic: parsed.data.isPublic,
      updatedAt: new Date(),
    })
    .where(eq(schema.reviews.id, review.id));

  revalidatePath(`/u/${profile.username}/reviews`);
  revalidatePath(`/u/${profile.username}/reviews/${game.slug}`);
  revalidatePath(`/games/${game.slug}`);
  return { ok: true };
}

const deleteInput = z.object({ reviewId: z.string().uuid() });

export async function deleteReview(input: unknown): Promise<UpdateResult> {
  const parsed = deleteInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const review = await db.query.reviews.findFirst({
    where: and(eq(schema.reviews.id, parsed.data.reviewId), eq(schema.reviews.userId, user.id)),
    columns: { id: true, gameId: true },
  });
  if (!review) return { ok: false, error: "Review not found" };

  const [game, profile] = await Promise.all([
    db.query.games.findFirst({
      where: eq(schema.games.id, review.gameId),
      columns: { slug: true },
    }),
    db.query.profiles.findFirst({
      where: eq(schema.profiles.userId, user.id),
      columns: { username: true },
    }),
  ]);

  await db.delete(schema.reviews).where(eq(schema.reviews.id, review.id));

  if (profile) {
    revalidatePath(`/u/${profile.username}/reviews`);
    if (game) revalidatePath(`/u/${profile.username}/reviews/${game.slug}`);
  }
  if (game) revalidatePath(`/games/${game.slug}`);
  return { ok: true };
}

const likeInput = z.object({ reviewId: z.string().uuid() });

export async function likeReview(input: unknown): Promise<UpdateResult> {
  const parsed = likeInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Not signed in" };

  await db
    .insert(schema.likes)
    .values({ userId: user.id, reviewId: parsed.data.reviewId })
    .onConflictDoNothing();

  // Targeted revalidation — the canonical review page reads the count
  const ctx = await reviewLookupForRevalidate(parsed.data.reviewId);
  if (ctx) revalidatePath(`/u/${ctx.username}/reviews/${ctx.gameSlug}`);
  return { ok: true };
}

export async function unlikeReview(input: unknown): Promise<UpdateResult> {
  const parsed = likeInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Not signed in" };

  await db
    .delete(schema.likes)
    .where(
      and(eq(schema.likes.userId, user.id), eq(schema.likes.reviewId, parsed.data.reviewId)),
    );

  const ctx = await reviewLookupForRevalidate(parsed.data.reviewId);
  if (ctx) revalidatePath(`/u/${ctx.username}/reviews/${ctx.gameSlug}`);
  return { ok: true };
}

async function reviewLookupForRevalidate(
  reviewId: string,
): Promise<{ username: string; gameSlug: string } | null> {
  const r = await db.query.reviews.findFirst({
    where: eq(schema.reviews.id, reviewId),
    columns: { userId: true, gameId: true },
  });
  if (!r) return null;
  const [profile, game] = await Promise.all([
    db.query.profiles.findFirst({
      where: eq(schema.profiles.userId, r.userId),
      columns: { username: true },
    }),
    db.query.games.findFirst({
      where: eq(schema.games.id, r.gameId),
      columns: { slug: true },
    }),
  ]);
  if (!profile || !game) return null;
  return { username: profile.username, gameSlug: game.slug };
}
```

- [ ] **Step 2: Verify and commit**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

```powershell
git add lib/reviews/server-actions.ts
git commit -m @'
feat(reviews): publish/update/delete + likes server actions

Phase 2 Task 10 — closes out the review-lifecycle server surface.

- publishReview: idempotent on re-publish (publishedAt ?? now()),
  updates rating + is_public, revalidates 4 paths
- updateReview: body/rating/is_public, publishedAt unchanged
- deleteReview: hard delete, cascades to review_questions + likes
- likeReview/unlikeReview: composite-PK insert/delete, targeted revalidate
- reviewLookupForRevalidate keeps the like paths cheap by skipping the
  full review fetch when not needed

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 11: ReviewInterview client component

**Goal:** The 4-turn conversational UI. Mascot in the top slot, vertically-stacked Q&A cards below, streaming Q2-Q4 from the router via `readStreamableValue`.

**Files:**
- Create: `components/reviews/review-interview.tsx`
- Modify: `components/mascot/mascot.tsx` (no behavior change — add export for `MascotMood` type if not already exported)

**Acceptance Criteria:**
- [ ] Renders Q1 immediately with mascot `idle`
- [ ] Calls `submitAnswer` on user submit; mascot enters `thinking`; reads stream and animates Q2 token-by-token
- [ ] After Q4 submit, calls `generateDraft` and navigates to `/games/{slug}/review?reviewId={id}` (the editor)
- [ ] Earlier answers render as editable chips; editing one calls `submitAnswer` again with the old turn number, which truncates downstream Q&A
- [ ] "Skip the rest" button visible from Q2 onward; clicking calls `generateDraft` with whatever answers exist
- [ ] Answers shadow-saved to `localStorage` under `phase2-interview:{interviewId}` for resume
- [ ] Failure UX: mascot `confused`, error message, "Try again" button retries the last call
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Create `components/reviews/review-interview.tsx`**

```typescript
"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { readStreamableValue } from "ai/rsc";
import { Mascot } from "@/components/mascot/mascot";
import { Button } from "@/components/ui/button";
import { useMascotStore } from "@/components/mascot/mascot-store";
import {
  submitAnswer,
  generateDraft,
} from "@/lib/reviews/server-actions";

// The mascot store exposes setMood(mood, { message?, durationMs? }) and
// celebrate(message?) — NOT a generic set(). Bind both selectors here.

interface Props {
  interviewId: string;
  gameSlug: string;
  initialQ1: string;
}

type Turn = { question: string; answer?: string; streaming?: boolean };

const MAX_TURNS = 4;

export function ReviewInterview({ interviewId, gameSlug, initialQ1 }: Props) {
  const router = useRouter();
  const setMood = useMascotStore((s) => s.setMood);

  const [turns, setTurns] = useState<Turn[]>(() => {
    if (typeof window !== "undefined") {
      const cached = window.localStorage.getItem(`phase2-interview:${interviewId}`);
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as Turn[];
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        } catch {
          /* fall through */
        }
      }
    }
    return [{ question: initialQ1 }];
  });
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const turnsRef = useRef(turns);
  turnsRef.current = turns;

  useEffect(() => {
    window.localStorage.setItem(`phase2-interview:${interviewId}`, JSON.stringify(turns));
  }, [interviewId, turns]);

  const activeIdx = turns.findIndex((t) => t.answer === undefined);
  const currentTurnIdx = activeIdx === -1 ? turns.length - 1 : activeIdx;
  const canSubmit = draft.trim().length > 0 && !pending;

  async function handleSubmit() {
    if (!canSubmit) return;
    const turnNumber = currentTurnIdx + 1;
    const text = draft.trim();
    setError(null);
    setMood("thinking");

    // Optimistically mark this turn as answered
    setTurns((prev) => {
      const next = prev.slice(0, currentTurnIdx);
      next[currentTurnIdx] = { ...prev[currentTurnIdx], answer: text };
      return next;
    });
    setDraft("");

    startTransition(async () => {
      const result = await submitAnswer({ interviewId, turn: turnNumber, text });
      if (!result.ok) {
        setError(result.error);
        setMood("confused", { message: result.error });
        return;
      }
      if (result.ready) {
        await launchDraft();
        return;
      }
      // Begin streaming the next question
      setTurns((prev) => [...prev, { question: "", streaming: true }]);
      try {
        let acc = "";
        for await (const value of readStreamableValue(result.stream)) {
          acc = value ?? "";
          setTurns((prev) => {
            const next = [...prev];
            next[next.length - 1] = { question: acc, streaming: true };
            return next;
          });
        }
        setTurns((prev) => {
          const next = [...prev];
          next[next.length - 1] = { question: acc, streaming: false };
          return next;
        });
        setMood("idle");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Stream failed");
        setMood("confused", { message: "Let me catch my breath — your answers are saved. Try again?" });
      }
    });
  }

  async function launchDraft() {
    setMood("thinking", { message: "Drafting your review…" });
    const result = await generateDraft({ interviewId });
    if (!result.ok) {
      if (result.existingReviewId) {
        // Already reviewed → bounce to editor
        router.push(`/games/${gameSlug}/review?reviewId=${result.existingReviewId}`);
        return;
      }
      setError(result.error);
      setMood("confused", { message: result.error });
      return;
    }
    window.localStorage.removeItem(`phase2-interview:${interviewId}`);
    router.push(`/games/${gameSlug}/review?reviewId=${result.reviewId}`);
  }

  function handleEditAnswer(idx: number) {
    setTurns((prev) => prev.slice(0, idx + 1).map((t, i) => (i === idx ? { ...t, answer: undefined } : t)));
    setDraft(turns[idx]?.answer ?? "");
  }

  const canSkip = turns.length > 1 && currentTurnIdx >= 1;
  const isAtLastTurn = currentTurnIdx + 1 === MAX_TURNS;

  return (
    <div className="space-y-6 px-6 py-8 max-w-2xl mx-auto">
      <div className="flex items-center gap-4">
        <Mascot size="md" />
        <p className="text-sm text-[var(--text-dim)]">
          Answer {Math.min(currentTurnIdx + 1, MAX_TURNS)} of {MAX_TURNS}
        </p>
      </div>

      <div className="space-y-5">
        {turns.map((turn, idx) => (
          <div key={idx} className="space-y-2">
            <p className="text-base text-[var(--text)] whitespace-pre-wrap">
              {turn.question}
              {turn.streaming && <span className="animate-pulse">▌</span>}
            </p>
            {turn.answer !== undefined && idx !== currentTurnIdx ? (
              <button
                type="button"
                onClick={() => handleEditAnswer(idx)}
                className="block text-left text-sm text-[var(--text-dim)] bg-[var(--bg-card)] border border-[var(--border)] rounded-lg px-3 py-2 hover:border-[var(--accent)] transition"
              >
                {turn.answer}
                <span className="ml-2 text-xs text-[var(--text-faint)]">(edit)</span>
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {activeIdx !== -1 && (
        <div className="space-y-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full min-h-24 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            placeholder="Your answer…"
            disabled={pending}
          />
          <div className="flex justify-between gap-2">
            {canSkip && !isAtLastTurn && (
              <Button variant="ghost" onClick={launchDraft} disabled={pending}>
                Skip the rest
              </Button>
            )}
            <Button onClick={handleSubmit} disabled={!canSubmit} className="ml-auto">
              {isAtLastTurn ? "Draft my review" : "Next"}
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-500" role="alert">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Confirm `useMascotStore` exposes a `set` action that accepts `{ mood, message }`**

Open `components/mascot/mascot-store.ts` and verify it has an action like `set: (state: { mood: MascotMood; message?: string | null }) => void`. If the existing store uses different action names (e.g. `setMood`, `setMessage`), adjust the component imports accordingly — do NOT rename the store actions.

- [ ] **Step 3: Verify and commit**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

```powershell
git add components/reviews/review-interview.tsx
git commit -m @'
feat(reviews): ReviewInterview client component (conversation UI)

Phase 2 Task 11 — the 4-turn streaming conversation surface.

- Mascot in top slot; mood bound to current state (idle/thinking/confused)
- Q1 renders immediately; Q2-Q4 stream via readStreamableValue
- Edit an earlier answer truncates downstream Q&A
- localStorage shadow under phase2-interview:{interviewId} for resume
- "Skip the rest" from Q2 onward calls generateDraft early
- After Q4 submit (or skip), navigates to /games/{slug}/review?reviewId=…
- generateDraft existing-review fast path redirects to the existing draft

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 12: SectionCard + ReviewEditor components

**Goal:** The post-draft editor with 4 sectioned cards. Each card supports inline edit + per-section regenerate streaming. Above the cards: rating slider + privacy toggle + Cancel/Publish.

**Files:**
- Create: `components/reviews/section-card.tsx`
- Create: `components/reviews/review-editor.tsx`

**Acceptance Criteria:**
- [ ] `SectionCard` displays the paragraph text; hover-reveals Edit + Regenerate buttons
- [ ] Edit mode opens an inline `<textarea>` with Save/Cancel
- [ ] Regenerate streams the new paragraph in place; stop button cancels
- [ ] `ReviewEditor` accepts `{ reviewId, gameSlug, initialBody, initialRating, initialIsPublic }` and renders 4 section cards (splits body on `\n\n`, pads to 4)
- [ ] HeartRating + privacy toggle wired to local state
- [ ] Publish button calls `publishReview`, navigates to `/u/{username}/reviews/{gameSlug}` on success
- [ ] Cancel button → router.back() (the row persists as a draft regardless)
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Create `components/reviews/section-card.tsx`**

```typescript
"use client";

import { useState, useTransition } from "react";
import { readStreamableValue } from "ai/rsc";
import { Button } from "@/components/ui/button";
import { regenerateSection } from "@/lib/reviews/server-actions";

interface Props {
  label: "Hook" | "Highs" | "Lows" | "Verdict";
  sectionIndex: 0 | 1 | 2 | 3;
  reviewId: string;
  text: string;
  onChange: (next: string) => void;
}

export function SectionCard({ label, sectionIndex, reviewId, text, onChange }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function startEdit() {
    setDraft(text);
    setEditing(true);
  }
  function commitEdit() {
    onChange(draft);
    setEditing(false);
  }
  function cancelEdit() {
    setDraft(text);
    setEditing(false);
  }

  function regenerate() {
    setError(null);
    setStreaming(true);
    startTransition(async () => {
      const result = await regenerateSection({ reviewId, sectionIndex });
      if (!result.ok) {
        setError(result.error);
        setStreaming(false);
        return;
      }
      try {
        let acc = "";
        for await (const value of readStreamableValue(result.stream)) {
          acc = value ?? "";
          onChange(acc);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Regenerate failed");
      } finally {
        setStreaming(false);
      }
    });
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4 space-y-3 group">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-[var(--text-faint)]">{label}</span>
        {!editing && (
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
            <Button variant="ghost" size="sm" onClick={startEdit} disabled={streaming}>
              Edit
            </Button>
            <Button variant="ghost" size="sm" onClick={regenerate} disabled={pending || streaming}>
              {streaming ? "Rewriting…" : "Regenerate"}
            </Button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full min-h-24 rounded border border-[var(--border)] bg-transparent p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={cancelEdit}>
              Cancel
            </Button>
            <Button size="sm" onClick={commitEdit} disabled={draft.trim().length === 0}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text)]">
          {text}
          {streaming && <span className="animate-pulse">▌</span>}
        </p>
      )}

      {error && <p className="text-xs text-red-500" role="alert">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Create `components/reviews/review-editor.tsx`**

```typescript
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { HeartRating } from "@/components/ui/heart-rating";
import { useMascotStore } from "@/components/mascot/mascot-store";
import { publishReview, updateReview } from "@/lib/reviews/server-actions";
import { SectionCard } from "./section-card";

interface Props {
  reviewId: string;
  gameSlug: string;
  initialBody: string;
  initialRating: number | null;
  initialIsPublic: boolean;
}

const LABELS = ["Hook", "Highs", "Lows", "Verdict"] as const;

function splitToSections(body: string): [string, string, string, string] {
  const parts = body.split("\n\n");
  return [parts[0] ?? "", parts[1] ?? "", parts[2] ?? "", parts[3] ?? ""];
}

export function ReviewEditor({
  reviewId,
  gameSlug,
  initialBody,
  initialRating,
  initialIsPublic,
}: Props) {
  const router = useRouter();
  const celebrate = useMascotStore((s) => s.celebrate);

  const [sections, setSections] = useState<[string, string, string, string]>(() =>
    splitToSections(initialBody),
  );
  const [rating, setRating] = useState<number>(initialRating ?? 0);
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function updateSection(idx: 0 | 1 | 2 | 3, next: string) {
    setSections((prev) => {
      const out = [...prev] as [string, string, string, string];
      out[idx] = next;
      return out;
    });
  }

  const canPublish = sections.every((s) => s.trim().length > 0) && rating > 0;

  function handlePublish() {
    if (!canPublish || pending) return;
    setError(null);
    startTransition(async () => {
      // publishReview only flips published_at + rating + is_public; it does
      // not write the body. Manual edits to sections live in local state
      // until we flush them via updateReview here, then publish.
      const join = sections.join("\n\n");
      const upd = await updateReview({ reviewId, body: join, rating, isPublic });
      if (!upd.ok) {
        setError(upd.error);
        return;
      }
      const result = await publishReview({ reviewId, rating, isPublic });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      celebrate("Live!");
      // Give the celebration animation a beat before navigating
      setTimeout(() => router.push(`/u/${result.username}/reviews/${result.gameSlug}`), 1200);
    });
  }

  return (
    <div className="space-y-5 px-6 py-8 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-[var(--text-faint)]">Rating</p>
          <HeartRating value={rating} onChange={setRating} size={24} />
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--text-dim)]">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          Public
        </label>
      </div>

      <div className="space-y-3">
        {LABELS.map((label, idx) => (
          <SectionCard
            key={label}
            label={label}
            sectionIndex={idx as 0 | 1 | 2 | 3}
            reviewId={reviewId}
            text={sections[idx]}
            onChange={(next) => updateSection(idx as 0 | 1 | 2 | 3, next)}
          />
        ))}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={handlePublish} disabled={!canPublish || pending}>
          {pending ? "Publishing…" : "Publish"}
        </Button>
      </div>

      {error && <p className="text-sm text-red-500" role="alert">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Verify and commit**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

```powershell
git add components/reviews/section-card.tsx components/reviews/review-editor.tsx
git commit -m @'
feat(reviews): SectionCard + ReviewEditor (sectioned draft UI)

Phase 2 Task 12 — the post-draft editor.

- SectionCard: hover-revealed Edit/Regenerate; inline textarea on edit;
  in-place streaming on regenerate via readStreamableValue
- ReviewEditor: 4 section cards mapped to splitToSections(body),
  rating + privacy controls, Publish wires updateReview->publishReview
  to flush manual edits before flipping published_at
- Mascot celebrates briefly before route push

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 13: Review routes — interview + editor (full + intercepted)

**Goal:** Mount the interview/editor at `/games/[slug]/review` as a full route, plus the intercepted parallel-route variant so the flow works as a slide-over from the in-app shell.

**Files:**
- Create: `app/(app)/games/[slug]/review/page.tsx`
- Create: `app/(app)/games/[slug]/review/loading.tsx`
- Create: `app/(app)/@modal/(.)games/[slug]/review/page.tsx`

**Acceptance Criteria:**
- [ ] The full route reads `?reviewId=` from search params; if present, renders `ReviewEditor`; if absent, calls `startInterview` (server) and renders `ReviewInterview`
- [ ] Intercepted route renders the same content in the slide-over panel (reuse the GameDetailPanel pattern from Phase 1)
- [ ] Both routes require auth; redirect to `/login` if no user
- [ ] If the user has no log for this game, redirects to `/games/[slug]` (you must log a game before reviewing it — per the spec, every review is anchored to a log)
- [ ] `loading.tsx` shows mascot in `thinking` with a "Setting up your interview…" caption
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Create `app/(app)/games/[slug]/review/page.tsx`**

```typescript
import { redirect, notFound } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { startInterview } from "@/lib/reviews/server-actions";
import { ReviewInterview } from "@/components/reviews/review-interview";
import { ReviewEditor } from "@/components/reviews/review-editor";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ reviewId?: string }>;
}

export default async function ReviewRoute({ params, searchParams }: Props) {
  const [{ slug }, { reviewId }] = await Promise.all([params, searchParams]);
  const user = await getCachedUser();
  if (!user) redirect(`/login?next=/games/${slug}/review`);

  const game = await db.query.games.findFirst({
    where: eq(schema.games.slug, slug),
    columns: { id: true, slug: true, title: true },
  });
  if (!game) notFound();

  // Editor branch — the row already exists
  if (reviewId) {
    const review = await db.query.reviews.findFirst({
      where: and(eq(schema.reviews.id, reviewId), eq(schema.reviews.userId, user.id)),
      columns: { id: true, body: true, rating: true, isPublic: true },
    });
    if (!review) notFound();
    return (
      <ReviewEditor
        reviewId={review.id}
        gameSlug={game.slug}
        initialBody={review.body ?? ""}
        initialRating={review.rating != null ? Number(review.rating) : null}
        initialIsPublic={review.isPublic}
      />
    );
  }

  // Interview branch — need a log for this game
  const log = await db.query.logs.findFirst({
    where: and(eq(schema.logs.userId, user.id), eq(schema.logs.gameId, game.id)),
    columns: { id: true },
  });
  if (!log) redirect(`/games/${slug}`);

  const started = await startInterview({ logId: log.id });
  if (!started.ok) {
    return <div className="p-8 text-sm text-[var(--text-dim)]">{started.error}</div>;
  }
  return (
    <ReviewInterview
      interviewId={started.interviewId}
      gameSlug={game.slug}
      initialQ1={started.q1}
    />
  );
}
```

- [ ] **Step 2: Create `app/(app)/games/[slug]/review/loading.tsx`**

```typescript
import { Mascot } from "@/components/mascot/mascot";

export default function Loading() {
  return (
    <div className="px-6 py-12 max-w-2xl mx-auto flex flex-col items-center gap-4">
      <Mascot size="md" mood="thinking" />
      <p className="text-sm text-[var(--text-dim)]">Setting up your interview…</p>
    </div>
  );
}
```

- [ ] **Step 3: Create `app/(app)/@modal/(.)games/[slug]/review/page.tsx`**

This reuses the slide-over panel pattern from Phase 1.

```typescript
import { redirect, notFound } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { startInterview } from "@/lib/reviews/server-actions";
import { ReviewInterview } from "@/components/reviews/review-interview";
import { ReviewEditor } from "@/components/reviews/review-editor";
import { GameDetailPanel } from "@/components/game/game-detail-panel";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ reviewId?: string }>;
}

export default async function InterceptedReviewRoute({ params, searchParams }: Props) {
  const [{ slug }, { reviewId }] = await Promise.all([params, searchParams]);
  const user = await getCachedUser();
  if (!user) redirect(`/login?next=/games/${slug}/review`);

  const game = await db.query.games.findFirst({
    where: eq(schema.games.slug, slug),
    columns: { id: true, slug: true, title: true },
  });
  if (!game) notFound();

  if (reviewId) {
    const review = await db.query.reviews.findFirst({
      where: and(eq(schema.reviews.id, reviewId), eq(schema.reviews.userId, user.id)),
      columns: { id: true, body: true, rating: true, isPublic: true },
    });
    if (!review) notFound();
    return (
      <GameDetailPanel>
        <ReviewEditor
          reviewId={review.id}
          gameSlug={game.slug}
          initialBody={review.body ?? ""}
          initialRating={review.rating != null ? Number(review.rating) : null}
          initialIsPublic={review.isPublic}
        />
      </GameDetailPanel>
    );
  }

  const log = await db.query.logs.findFirst({
    where: and(eq(schema.logs.userId, user.id), eq(schema.logs.gameId, game.id)),
    columns: { id: true },
  });
  if (!log) redirect(`/games/${slug}`);

  const started = await startInterview({ logId: log.id });
  if (!started.ok) {
    return (
      <GameDetailPanel>
        <div className="p-8 text-sm text-[var(--text-dim)]">{started.error}</div>
      </GameDetailPanel>
    );
  }
  return (
    <GameDetailPanel>
      <ReviewInterview
        interviewId={started.interviewId}
        gameSlug={game.slug}
        initialQ1={started.q1}
      />
    </GameDetailPanel>
  );
}
```

- [ ] **Step 4: Verify and commit**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

```powershell
git add app/\(app\)/games/\[slug\]/review app/\(app\)/@modal/\(.\)games/\[slug\]/review
git commit -m @'
feat(reviews): /games/[slug]/review route + intercepted variant

Phase 2 Task 13 — mounts the interview + editor at the canonical and
slide-over routes.

- Editor branch when ?reviewId= is present; interview branch otherwise
- Auth-gated; redirects to /login with next= param
- Redirects to /games/{slug} if no log exists (every review anchored to log)
- Intercepted variant reuses GameDetailPanel for slide-over presentation
- loading.tsx shows mascot in thinking + caption

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 14: Entry points — log card button + game-detail CTA + Completed toast

**Goal:** Surface "Write with mascot" in the three places the spec calls for: every log card, the game detail panel CTA, and a Sonner toast when a log transitions to Completed.

**Files:**
- Modify: `components/game/log-card.tsx`
- Modify: `components/game/game-detail.tsx`
- Modify: `components/game/edit-log-modal.tsx`

**Acceptance Criteria:**
- [ ] `LogCard` gains a "Write with mascot" button (small, low-emphasis) that links to `/games/{gameSlug}/review`. If a review already exists for this game, button reads "Edit your review" and links with `?reviewId=…`.
- [ ] `GameDetail` either renders the existing-review card (if you've reviewed) or the "Write with mascot" CTA (if you have a log) or nothing (if you haven't logged it)
- [ ] `EditLogModal` fires a Sonner toast with mascot copy when the user transitions a log to `completed` status
- [ ] Toast has a "Write with mascot" action that navigates to `/games/{slug}/review`
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Extend `LibraryItem` shape with optional `existingReviewId`**

`mapRowToLibraryItem` in `lib/logs/library-item.ts` already produces the row; we'll do a separate lightweight lookup. Open `lib/logs/library-item.ts` and add to the `LibraryItem` interface:

```typescript
/** Set when the user has a review for this game; enables "Edit your review" CTA. */
existingReviewId?: string;
```

Then in `lib/logs/server-actions.ts` `getUserLibrary`, after constructing the library rows, do a single query to load `(gameId, reviewId)` pairs for the user's existing reviews and attach them:

```typescript
// Near the end of getUserLibrary, after building the items array:
const userReviews = await db.query.reviews.findMany({
  where: eq(schema.reviews.userId, user.id),
  columns: { id: true, gameId: true },
});
const reviewByGameId = new Map(userReviews.map((r) => [r.gameId, r.id]));
return items.map((item) => ({
  ...item,
  existingReviewId: reviewByGameId.get(item.id),
}));
```

Adjust the actual line(s) to match the local variable names; keep the existing return shape backwards-compatible.

- [ ] **Step 2: Update `components/game/log-card.tsx`**

Add at the top of the component file:

```typescript
import Link from "next/link";
```

In the render JSX, after the existing `<Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Edit</Button>` block, add a sibling "Write with mascot" / "Edit your review" link. Modify the header `flex items-start justify-between` row to:

```typescript
<div className="flex items-start justify-between gap-3">
  <div className="space-y-1">
    <p className="text-xs uppercase tracking-wide text-[var(--text-faint)]">Your log</p>
    <StatusBadge status={item.status} size="lg" />
  </div>
  <div className="flex gap-1">
    <Link
      href={
        item.existingReviewId
          ? `/games/${item.gameSlug}/review?reviewId=${item.existingReviewId}`
          : `/games/${item.gameSlug}/review`
      }
      className="text-xs text-[var(--text-dim)] hover:text-[var(--accent)] transition px-2 py-1 border border-[var(--border)] rounded"
    >
      {item.existingReviewId ? "Edit review" : "Write with mascot"}
    </Link>
    <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
      Edit
    </Button>
  </div>
</div>
```

Confirm `item.gameSlug` is already part of `LibraryItem` (it is — used by `mapRowToLibraryItem`).

- [ ] **Step 3: Update `components/game/game-detail.tsx`**

Open the file and locate the slot where the existing log card or "Log it" CTA renders. Replace the placeholder "Reviews coming in Phase 2" copy (if present) with a conditional block. Add at the top:

```typescript
import Link from "next/link";
```

Add to the component's props type:

```typescript
interface GameDetailProps {
  /* …existing props… */
  ownReview?: { id: string; body: string; rating: number | null } | null;
}
```

In the render JSX, render a "Your review" card if `ownReview` is set, otherwise render the "Write with mascot" CTA if the user has a log (use the existing `log` prop):

```typescript
{ownReview ? (
  <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-5 space-y-3">
    <p className="text-xs uppercase tracking-wide text-[var(--text-faint)]">Your review</p>
    <p className="text-sm leading-relaxed text-[var(--text)] line-clamp-4">
      {ownReview.body.split("\n\n")[0]}
    </p>
    <Link
      href={`/u/me/reviews/${game.slug}`}
      className="text-sm text-[var(--accent)] hover:underline"
    >
      Read full →
    </Link>
  </div>
) : log ? (
  <Link
    href={`/games/${game.slug}/review`}
    className="block rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-5 py-4 text-sm text-[var(--accent)] hover:border-[var(--accent)] transition"
  >
    Write a review with the mascot →
  </Link>
) : null}
```

Update both game-detail consumers — `app/(app)/games/[slug]/page.tsx` and `app/(app)/@modal/(.)games/[slug]/page.tsx` — to load and pass `ownReview`. Add to both files where the log is fetched:

```typescript
const ownReview = user
  ? await db.query.reviews.findFirst({
      where: and(eq(schema.reviews.userId, user.id), eq(schema.reviews.gameId, game.id)),
      columns: { id: true, body: true, rating: true },
    })
  : null;
```

Then pass `ownReview={ownReview ? { id: ownReview.id, body: ownReview.body, rating: ownReview.rating != null ? Number(ownReview.rating) : null } : null}` to `<GameDetail>`.

(The `/u/me/reviews/{slug}` route can be a simple redirect to `/u/{currentUser.username}/reviews/{slug}` — add this redirect to the canonical-page task; for now the Link points there and Task 15 makes it real.)

- [ ] **Step 4: Add Completed toast to `components/game/edit-log-modal.tsx`**

Open the file and locate the save handler. After the successful save action when the user just transitioned status to `completed`, fire:

```typescript
import { toast } from "sonner";
import { useRouter } from "next/navigation";
// …inside the component:
const router = useRouter();
// …after the successful update where the new status === 'completed' AND the
// previous status !== 'completed', call:
toast("Nice. Want me to help you write this up?", {
  action: {
    label: "Write with mascot",
    onClick: () => router.push(`/games/${item.gameSlug}/review`),
  },
});
```

Wire the previous-status comparison by snapshotting the original `item.status` when the modal mounts.

- [ ] **Step 5: Verify and commit**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

```powershell
git add lib/logs/library-item.ts lib/logs/server-actions.ts components/game/log-card.tsx components/game/game-detail.tsx components/game/edit-log-modal.tsx app/\(app\)/games/\[slug\]/page.tsx app/\(app\)/@modal/\(.\)games/\[slug\]/page.tsx
git commit -m @'
feat(reviews): entry points — log card button, game-detail CTA, completed toast

Phase 2 Task 14 — surfaces "Write with mascot" everywhere the spec calls for.

- LibraryItem gains existingReviewId; getUserLibrary attaches per-game
  review ids via one extra query
- LogCard renders "Write with mascot" or "Edit review" depending on
  existingReviewId
- GameDetail renders own-review excerpt + "Read full →" when reviewed,
  or "Write with mascot" CTA when logged-but-not-reviewed
- EditLogModal fires Sonner toast on completed-status transition with
  a one-click "Write with mascot" action

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 15: Public review pages + ReviewCard + ReviewListCard + LikeButton

**Goal:** Build the canonical public review page (`/u/{username}/reviews/{gameSlug}`), the list page (`/u/{username}/reviews`), and the supporting components (ReviewCard, ReviewListCard, LikeButton). Also add the `/u/me/reviews/{slug}` redirect referenced in Task 14.

**Files:**
- Create: `app/(app)/u/[username]/reviews/page.tsx`
- Create: `app/(app)/u/[username]/reviews/[slug]/page.tsx`
- Create: `app/(app)/u/me/reviews/[slug]/page.tsx`
- Create: `components/reviews/review-card.tsx`
- Create: `components/reviews/review-list-card.tsx`
- Create: `components/reviews/like-button.tsx`

**Acceptance Criteria:**
- [ ] `/u/{username}/reviews` lists the user's public, published reviews ordered by `published_at DESC`
- [ ] `/u/{username}/reviews/{gameSlug}` resolves the review by joining profiles→reviews→games on (`profile.userId = review.userId AND game.slug = {slug}`); returns 404 if not found, not public, or unpublished
- [ ] Owner sees `Edit` and `Delete` buttons; non-owner sees only the like heart
- [ ] `/u/me/reviews/{slug}` redirects to `/u/{currentUser.username}/reviews/{slug}` for authed users, `/login` otherwise
- [ ] `LikeButton` does optimistic update + calls `likeReview`/`unlikeReview`
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Create `components/reviews/like-button.tsx`**

```typescript
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HeartFull, HeartEmpty } from "@/components/pixel/hearts";
import { likeReview, unlikeReview } from "@/lib/reviews/server-actions";

interface Props {
  reviewId: string;
  initialLiked: boolean;
  initialCount: number;
  /** When true, click triggers a login redirect instead of action. */
  loggedOut: boolean;
}

export function LikeButton({ reviewId, initialLiked, initialCount, loggedOut }: Props) {
  const router = useRouter();
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [pending, startTransition] = useTransition();

  function handleClick() {
    if (loggedOut) {
      router.push("/login");
      return;
    }
    if (pending) return;
    const willLike = !liked;
    setLiked(willLike);
    setCount((c) => c + (willLike ? 1 : -1));
    startTransition(async () => {
      const result = willLike ? await likeReview({ reviewId }) : await unlikeReview({ reviewId });
      if (!result.ok) {
        // Revert on failure
        setLiked(!willLike);
        setCount((c) => c + (willLike ? -1 : 1));
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-2 text-sm text-[var(--text-dim)] hover:text-[var(--accent)] transition"
      aria-pressed={liked}
      aria-label={liked ? "Unlike" : "Like"}
    >
      {liked ? <HeartFull size={20} /> : <HeartEmpty size={20} />}
      <span className="tabular-nums">{count}</span>
    </button>
  );
}
```

(Confirmed during plan write: `components/pixel/hearts.tsx` exports `HeartFull`, `HeartHalf`, `HeartEmpty` — use `HeartEmpty` for the unliked state.)

- [ ] **Step 2: Create `components/reviews/review-card.tsx`**

```typescript
import Image from "next/image";
import Link from "next/link";
import { Mascot } from "@/components/mascot/mascot";
import { HeartRating } from "@/components/ui/heart-rating";
import { LikeButton } from "./like-button";

interface Props {
  review: { id: string; body: string; rating: number | null; publishedAt: Date };
  game: { slug: string; title: string; coverUrl: string | null };
  author: { username: string };
  isOwner: boolean;
  loggedOut: boolean;
  initialLiked: boolean;
  initialLikeCount: number;
}

export function ReviewCard({
  review,
  game,
  author,
  isOwner,
  loggedOut,
  initialLiked,
  initialLikeCount,
}: Props) {
  const paragraphs = (review.body ?? "").split("\n\n").filter((p) => p.trim().length > 0);

  return (
    <article className="mx-auto max-w-3xl px-6 py-8 space-y-8">
      <header className="grid grid-cols-1 gap-6 md:grid-cols-[280px_1fr]">
        {game.coverUrl ? (
          <Image
            src={game.coverUrl}
            alt={game.title}
            width={280}
            height={420}
            className="rounded-lg w-full h-auto"
            priority
          />
        ) : (
          <div className="aspect-[2/3] rounded-lg bg-[var(--bg-card)]" />
        )}
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <Mascot size="sm" mood="idle" silent />
            <div>
              <h1 className="text-2xl font-semibold text-[var(--text)]">{game.title}</h1>
              <p className="text-sm text-[var(--text-dim)]">
                by <Link href={`/u/${author.username}`} className="hover:text-[var(--accent)]">@{author.username}</Link>
              </p>
            </div>
          </div>
          {review.rating != null && (
            <HeartRating value={review.rating} disabled size={20} />
          )}
          <p className="text-xs text-[var(--text-faint)]">
            {review.publishedAt.toLocaleDateString()}
          </p>
        </div>
      </header>

      <div className="space-y-4">
        {paragraphs.map((para, idx) => (
          <p key={idx} className="text-[var(--text)] leading-relaxed whitespace-pre-wrap">
            {para}
          </p>
        ))}
      </div>

      <footer className="flex items-center justify-between border-t border-[var(--border)] pt-4">
        <LikeButton
          reviewId={review.id}
          initialLiked={initialLiked}
          initialCount={initialLikeCount}
          loggedOut={loggedOut}
        />
        {isOwner && (
          <div className="flex gap-2 text-sm">
            <Link
              href={`/games/${game.slug}/review?reviewId=${review.id}`}
              className="text-[var(--text-dim)] hover:text-[var(--accent)]"
            >
              Edit
            </Link>
            <DeleteReviewLink reviewId={review.id} username={author.username} />
          </div>
        )}
      </footer>
    </article>
  );
}

// Tiny client island for the delete-with-confirm flow.
import { DeleteReviewLink } from "./delete-review-link";
```

- [ ] **Step 3: Create `components/reviews/delete-review-link.tsx` (small confirm-dialog client island)**

```typescript
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteReview } from "@/lib/reviews/server-actions";

interface Props {
  reviewId: string;
  username: string;
}

export function DeleteReviewLink({ reviewId, username }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteReview({ reviewId });
      if (result.ok) {
        router.push(`/u/${username}/reviews`);
      }
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-[var(--text-dim)] hover:text-red-500"
      >
        Delete
      </button>
    );
  }
  return (
    <span className="text-xs text-[var(--text-dim)]">
      Sure?{" "}
      <button onClick={handleDelete} disabled={pending} className="text-red-500 hover:underline">
        Yes
      </button>{" "}
      ·{" "}
      <button onClick={() => setConfirming(false)} className="hover:underline">
        Cancel
      </button>
    </span>
  );
}
```

- [ ] **Step 4: Create `components/reviews/review-list-card.tsx`**

```typescript
import Image from "next/image";
import Link from "next/link";
import { HeartRating } from "@/components/ui/heart-rating";

interface Props {
  review: { body: string; rating: number | null; publishedAt: Date };
  game: { slug: string; title: string; coverUrl: string | null };
  username: string;
}

export function ReviewListCard({ review, game, username }: Props) {
  const hook = (review.body ?? "").split("\n\n")[0] ?? "";
  return (
    <Link
      href={`/u/${username}/reviews/${game.slug}`}
      className="grid grid-cols-[80px_1fr] gap-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4 hover:border-[var(--accent)] transition"
    >
      {game.coverUrl ? (
        <Image
          src={game.coverUrl}
          alt={game.title}
          width={80}
          height={120}
          className="rounded w-full h-auto"
        />
      ) : (
        <div className="aspect-[2/3] rounded bg-[var(--bg)]" />
      )}
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-base font-semibold text-[var(--text)]">{game.title}</h3>
          {review.rating != null && <HeartRating value={review.rating} disabled size={14} />}
        </div>
        <p className="text-sm text-[var(--text-dim)] line-clamp-3">{hook}</p>
        <p className="text-xs text-[var(--text-faint)]">
          {review.publishedAt.toLocaleDateString()}
        </p>
      </div>
    </Link>
  );
}
```

- [ ] **Step 5: Create `app/(app)/u/[username]/reviews/page.tsx`**

```typescript
import { notFound } from "next/navigation";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { ReviewListCard } from "@/components/reviews/review-list-card";

interface Props {
  params: Promise<{ username: string }>;
}

export default async function ReviewsListPage({ params }: Props) {
  const { username } = await params;
  const profile = await db.query.profiles.findFirst({
    where: eq(schema.profiles.username, username),
    columns: { userId: true, username: true, isPublic: true },
  });
  if (!profile) notFound();

  const viewer = await getCachedUser();
  const isOwner = viewer?.id === profile.userId;
  if (!profile.isPublic && !isOwner) notFound();

  // Public reviews only for non-owner; owner sees all (drafts shown by edit flow elsewhere).
  const rows = await db
    .select({
      reviewId: schema.reviews.id,
      body: schema.reviews.body,
      rating: schema.reviews.rating,
      publishedAt: schema.reviews.publishedAt,
      gameSlug: schema.games.slug,
      gameTitle: schema.games.title,
      gameCoverUrl: schema.games.coverUrl,
    })
    .from(schema.reviews)
    .innerJoin(schema.games, eq(schema.games.id, schema.reviews.gameId))
    .where(
      and(
        eq(schema.reviews.userId, profile.userId),
        isNotNull(schema.reviews.publishedAt),
        isOwner ? undefined : eq(schema.reviews.isPublic, true),
      ),
    )
    .orderBy(desc(schema.reviews.publishedAt));

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 space-y-5">
      <h1 className="text-xl font-semibold text-[var(--text)]">
        @{profile.username}'s reviews
      </h1>
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--text-dim)]">No reviews yet.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <ReviewListCard
              key={r.reviewId}
              review={{
                body: r.body,
                rating: r.rating != null ? Number(r.rating) : null,
                publishedAt: r.publishedAt!,
              }}
              game={{ slug: r.gameSlug, title: r.gameTitle, coverUrl: r.gameCoverUrl }}
              username={profile.username}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Create `app/(app)/u/[username]/reviews/[slug]/page.tsx`**

```typescript
import { notFound } from "next/navigation";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { ReviewCard } from "@/components/reviews/review-card";

interface Props {
  params: Promise<{ username: string; slug: string }>;
}

export default async function CanonicalReviewPage({ params }: Props) {
  const { username, slug } = await params;

  const profile = await db.query.profiles.findFirst({
    where: eq(schema.profiles.username, username),
    columns: { userId: true, username: true, isPublic: true },
  });
  if (!profile) notFound();

  const game = await db.query.games.findFirst({
    where: eq(schema.games.slug, slug),
    columns: { id: true, slug: true, title: true, coverUrl: true },
  });
  if (!game) notFound();

  const viewer = await getCachedUser();
  const isOwner = viewer?.id === profile.userId;

  const review = await db.query.reviews.findFirst({
    where: and(
      eq(schema.reviews.userId, profile.userId),
      eq(schema.reviews.gameId, game.id),
      isNotNull(schema.reviews.publishedAt),
      isOwner ? undefined : eq(schema.reviews.isPublic, true),
    ),
    columns: { id: true, body: true, rating: true, publishedAt: true },
  });
  if (!review || !profile.isPublic && !isOwner) notFound();
  if (!review) notFound();

  // Like context — count + did-viewer-like
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.likes)
    .where(eq(schema.likes.reviewId, review.id));
  let viewerLiked = false;
  if (viewer) {
    const liked = await db.query.likes.findFirst({
      where: and(eq(schema.likes.reviewId, review.id), eq(schema.likes.userId, viewer.id)),
      columns: { reviewId: true },
    });
    viewerLiked = Boolean(liked);
  }

  return (
    <ReviewCard
      review={{
        id: review.id,
        body: review.body,
        rating: review.rating != null ? Number(review.rating) : null,
        publishedAt: review.publishedAt!,
      }}
      game={game}
      author={{ username: profile.username }}
      isOwner={isOwner}
      loggedOut={!viewer}
      initialLiked={viewerLiked}
      initialLikeCount={count}
    />
  );
}
```

- [ ] **Step 7: Create `app/(app)/u/me/reviews/[slug]/page.tsx` (redirect helper)**

```typescript
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";

export default async function MeRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await getCachedUser();
  if (!user) redirect("/login");
  const profile = await db.query.profiles.findFirst({
    where: eq(schema.profiles.userId, user.id),
    columns: { username: true },
  });
  if (!profile) redirect("/");
  redirect(`/u/${profile.username}/reviews/${slug}`);
}
```

- [ ] **Step 8: Verify and commit**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

```powershell
git add app/\(app\)/u components/reviews/review-card.tsx components/reviews/review-list-card.tsx components/reviews/like-button.tsx components/reviews/delete-review-link.tsx
git commit -m @'
feat(reviews): public review pages + ReviewCard/ListCard/LikeButton

Phase 2 Task 15 — the canonical share-able review surface.

- /u/[username]/reviews lists public published reviews DESC
- /u/[username]/reviews/[slug] resolves by (userId, gameSlug); 404
  on private+not-owner, unpublished, or missing
- /u/me/reviews/[slug] redirects to current user'\''s canonical URL
- LikeButton: optimistic toggle wrapping likeReview/unlikeReview
- DeleteReviewLink: small confirm-then-delete client island
- isOwner gates Edit/Delete; non-owner sees only the heart

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 16: OG card endpoint

**Goal:** Generate the 1200×630 share card via `next/og` at `/og/review/[id]`. Mascot top-left, game cover top-right, title + rating + first 2 lines of Hook.

**Files:**
- Create: `app/og/review/[id]/route.tsx`
- Modify: `app/(app)/u/[username]/reviews/[slug]/page.tsx` (add OG meta tags)

**Acceptance Criteria:**
- [ ] `GET /og/review/{id}` returns a PNG 1200×630 ImageResponse
- [ ] Mascot (SVG inlined) top-left at ~80×80
- [ ] Game cover top-right at ~200×300 (fetched from `games.coverUrl`)
- [ ] Game title prominent, rating as hearts, first 2 lines of Hook in quote marks
- [ ] Returns 404 if review is private/unpublished/missing
- [ ] Cached for 1 day via `Cache-Control: public, s-maxage=86400`
- [ ] Canonical review page exports `generateMetadata` returning `openGraph.images = [/og/review/{id}]`
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean

**Verify:** `pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Create `app/og/review/[id]/route.tsx`**

```typescript
import { ImageResponse } from "next/og";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const review = await db.query.reviews.findFirst({
    where: and(
      eq(schema.reviews.id, id),
      eq(schema.reviews.isPublic, true),
      isNotNull(schema.reviews.publishedAt),
    ),
    columns: { id: true, body: true, rating: true, userId: true, gameId: true },
  });
  if (!review) return new Response("Not found", { status: 404 });

  const [profile, game] = await Promise.all([
    db.query.profiles.findFirst({
      where: eq(schema.profiles.userId, review.userId),
      columns: { username: true },
    }),
    db.query.games.findFirst({
      where: eq(schema.games.id, review.gameId),
      columns: { title: true, coverUrl: true },
    }),
  ]);
  if (!profile || !game) return new Response("Not found", { status: 404 });

  const hook = (review.body ?? "").split("\n\n")[0] ?? "";
  const hookSnippet = hook.length > 180 ? `${hook.slice(0, 180).trimEnd()}…` : hook;
  const ratingNum = review.rating != null ? Number(review.rating) : null;
  const ratingStr = ratingNum != null ? `${ratingNum.toFixed(1)} / 10` : "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "linear-gradient(135deg, #0c0c14 0%, #1a1525 100%)",
          color: "#f1efff",
          padding: "60px",
          display: "flex",
          flexDirection: "row",
          gap: "48px",
          fontFamily: "system-ui",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            {/* Pixel mascot — inlined to avoid extra fetches in edge OG */}
            <div
              style={{
                width: 64,
                height: 64,
                background: "#7c5cff",
                borderRadius: 6,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
              }}
            >
              ·_·
            </div>
            <div style={{ fontSize: 24, opacity: 0.65 }}>@{profile.username}</div>
          </div>
          <div style={{ fontSize: 56, fontWeight: 700, lineHeight: 1.1 }}>{game.title}</div>
          <div style={{ fontSize: 28, opacity: 0.8 }}>{ratingStr}</div>
          <div
            style={{
              fontSize: 24,
              opacity: 0.85,
              fontStyle: "italic",
              maxWidth: 700,
              lineHeight: 1.4,
            }}
          >
            "{hookSnippet}"
          </div>
        </div>
        {game.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={game.coverUrl}
            alt=""
            width={240}
            height={360}
            style={{ borderRadius: 12, objectFit: "cover" }}
          />
        ) : (
          <div style={{ width: 240, height: 360, background: "#2a2438", borderRadius: 12 }} />
        )}
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        "cache-control": "public, s-maxage=86400, max-age=86400",
      },
    },
  );
}
```

- [ ] **Step 2: Add OG meta to canonical review page**

Edit `app/(app)/u/[username]/reviews/[slug]/page.tsx`. Add a `generateMetadata` export above the default export:

```typescript
import type { Metadata } from "next";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username, slug } = await params;
  const profile = await db.query.profiles.findFirst({
    where: eq(schema.profiles.username, username),
    columns: { userId: true, username: true },
  });
  if (!profile) return { title: "Review not found" };
  const game = await db.query.games.findFirst({
    where: eq(schema.games.slug, slug),
    columns: { id: true, title: true },
  });
  if (!game) return { title: "Review not found" };
  const review = await db.query.reviews.findFirst({
    where: and(
      eq(schema.reviews.userId, profile.userId),
      eq(schema.reviews.gameId, game.id),
      eq(schema.reviews.isPublic, true),
      isNotNull(schema.reviews.publishedAt),
    ),
    columns: { id: true, body: true },
  });
  if (!review) return { title: "Review not found" };

  const hook = (review.body ?? "").split("\n\n")[0] ?? "";
  const description = hook.length > 180 ? `${hook.slice(0, 180).trimEnd()}…` : hook;
  const title = `@${profile.username} on ${game.title}`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [`/og/review/${review.id}`],
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`/og/review/${review.id}`],
    },
  };
}
```

- [ ] **Step 3: Verify and commit**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build } }
```

```powershell
git add app/og/review app/\(app\)/u/\[username\]/reviews/\[slug\]/page.tsx
git commit -m @'
feat(reviews): OG share card endpoint + page metadata

Phase 2 Task 16 — the share-with-friends surface.

- /og/review/[id] route returns ImageResponse 1200x630
- Inlined pixel mascot (placeholder until Phase 7 sprite swap)
- Game cover via games.coverUrl; 24h cache header
- 404 on private/unpublished/missing
- generateMetadata on the canonical review page wires openGraph.images
  and twitter.images to the OG endpoint
- Twitter card = summary_large_image for inline preview

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 17: Phase 2 verification gate + ship

**Goal:** Run the 18-item gate checklist from the spec, document results in a gate doc, address blockers, tag the milestone, and write the post-phase memory update.

**Files:**
- Create: `docs/superpowers/gates/2026-05-11-phase2-gate.md`
- Modify: `~/.claude/projects/C--Projects-Letterboxd-for-Games/memory/MEMORY.md` (add Phase 2 entry)
- Create: `~/.claude/projects/C--Projects-Letterboxd-for-Games/memory/phase_2_complete.md`

**Acceptance Criteria:**
- [ ] Gate doc created with all 18 items marked `[ ]` initially
- [ ] Run each item against staging or `pnpm build && pnpm start` locally; mark `[x]` only after pass
- [ ] Code-verifiable items (typecheck/lint/build) executed and recorded
- [ ] Manual UI items (interview flow, regenerate, publish, share) executed against local prod build
- [ ] Tag `phase-2-complete` on the gate-doc commit
- [ ] Memory file `phase_2_complete.md` written with: tag, build state, what landed, open items
- [ ] MEMORY.md index updated with one-line pointer

**Verify:** `pnpm typecheck && pnpm lint && pnpm build` clean + 18-of-18 in gate doc

**Steps:**

- [ ] **Step 1: Create `docs/superpowers/gates/2026-05-11-phase2-gate.md`**

```markdown
# Phase 2 — AI Reviews — Verification Gate

| Field | Value |
|---|---|
| **Date** | 2026-05-11 |
| **Spec** | `docs/superpowers/specs/2026-05-11-phase2-ai-reviews-design.md` |
| **Plan** | `docs/superpowers/plans/2026-05-11-phase2-ai-reviews-plan.md` |
| **Tag** | `phase-2-complete` |

## Pre-flight (code-verifiable)

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm lint` exits 0 (or only pre-existing Phase 1.5 warnings)
- [ ] `pnpm build` succeeds; all routes present in build output
- [ ] `lib/ai/router.ts` + 4 providers + rate-limit + telemetry + cost + errors all exist
- [ ] `lib/reviews/server-actions.ts` exports startInterview, submitAnswer, generateDraft, regenerateSection, publishReview, updateReview, deleteReview, likeReview, unlikeReview

## End-to-end (manual, against `pnpm build && pnpm start`)

- [ ] 1. From a Completed log of *Hades*, click **Write with mascot** → routes to `/games/hades/review`
- [ ] 2. See Q1 "What pulled you into Hades?" with mascot idle; type a 2–3-sentence answer
- [ ] 3. Submit → mascot thinking for <2s; Q2 streams in token-by-token referencing Q1 answer
- [ ] 4. Q3 (Lows) + Q4 (Verdict) follow the same pattern
- [ ] 5. After Q4 submit, mascot says "Drafting your review…" and 4 sections stream one after another
- [ ] 6. Click **Regenerate** on the Lows card → only that block changes; Hook/Highs/Verdict untouched
- [ ] 7. Click **Edit** on Hook, change a sentence, save → new text persists
- [ ] 8. Set rating slider to 9, leave Public on, click **Publish** → mascot celebrates ~1.5s
- [ ] 9. Redirect to `/u/{me}/reviews/hades` → prose renders, share button opens native sheet
- [ ] 10. Share URL to Discord → OG card renders with mascot + cover + first 2 lines + rating
- [ ] 11. Visit `/games/hades` while logged in → see own-review card with "Read full →"
- [ ] 12. Log in as second test user → visit canonical URL → review reads correctly; click heart → count increments to 1
- [ ] 13. Force Cerebras failure (`CEREBRAS_API_KEY=invalid`) → restart interview → silently lands on Groq; `ai_calls` table shows Cerebras failure + Groq success
- [ ] 14. Hit 10 reviews in one day → 11th attempt shows "I need a nap" tooltip and CTA is disabled
- [ ] 15. Edit a published review → save → public page shows updated body
- [ ] 16. Delete the review → 404 on public URL, gone from `/u/{me}/reviews`
- [ ] 17. `pnpm typecheck && pnpm lint && pnpm build` clean (after all of the above)
- [ ] 18. Lighthouse ≥85 on canonical review page (desktop)

## Notes

(Capture observations, gotchas, deferred follow-ups during the manual sweep.)
```

- [ ] **Step 2: Run the code-verifiable items**

```powershell
pnpm typecheck; if ($?) { pnpm lint; if ($?) { pnpm build }
```

Mark items 1–5 (pre-flight + code paths) once green.

- [ ] **Step 3: Run the manual sweep**

```powershell
pnpm build; if ($?) { pnpm start }
```

In another terminal, browse to http://localhost:3000 and walk through items 1–18. Each `[ ]` flips to `[x]` only after passing; failures get a short note in the **Notes** section and a follow-up commit (see Step 4).

- [ ] **Step 4: Address any blockers**

For each unchecked item, either fix in a follow-up commit or document why it's deferred. Block tagging until all 18 either pass or have explicit non-blocking justification in the gate doc.

- [ ] **Step 5: Commit gate doc and tag**

```powershell
git add docs/superpowers/gates/2026-05-11-phase2-gate.md
git commit -m @'
docs(phase2): verification gate — 18/18 passed, AI Reviews shipped

Phase 2 (AI Reviews) — soft-launch milestone complete.

- All 18 verification items passed (or have explicit deferrals)
- AI router + 4-provider fallback + rate limiting + telemetry: green
- Interview -> sectioned draft -> publish -> public URL with OG: green
- Failover (Cerebras forced fail -> Groq) verified via ai_calls rows
- Daily cap behavior: "I need a nap" tooltip at 10/day

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
git tag -a phase-2-complete -m "Phase 2 (AI Reviews) shipped — soft launch milestone"
```

- [ ] **Step 6: Write `phase_2_complete.md` memory + update MEMORY.md**

```powershell
$body = @'
---
name: Phase 2 complete
description: Phase 2 (AI Reviews) shipped — soft-launch milestone, full conversational review flow with provider fallback + OG share
type: project
---
Phase 2 (AI Reviews) shipped on 2026-05-11.

**What landed (17 tasks):**

1. Foundation: `@ai-sdk/groq` + `@ai-sdk/openai-compatible` installed; `lib/ai/errors.ts` + `lib/ai/cost.ts`.
2. Provider clients: Cerebras / Groq / Cloudflare / DeepSeek under `lib/ai/providers/` with a uniform `Provider` interface.
3. Rate-limit helpers: Upstash counters for per-provider daily/minute + per-user daily review cap (10/day).
4. Telemetry: best-effort `ai_calls` writer that never throws.
5. AI router: `generate()` iterates providers in tier order, preempts exhaustion, writes telemetry on completion.
6. Review session + prompts: Upstash 1h-TTL interview state + SYSTEM_PROMPT (sardonic insider voice) + Q/draft/regenerate templates.
7. `startInterview` + `submitAnswer` server actions (streaming Q2-Q4).
8. `generateDraft` server action (streams the 4-paragraph draft, persists row + 4 review_questions on stream end).
9. `regenerateSection` server action (replaces one paragraph).
10. `publishReview` / `updateReview` / `deleteReview` / `likeReview` / `unlikeReview` server actions.
11. `ReviewInterview` client component with mascot states + localStorage shadow.
12. `SectionCard` + `ReviewEditor` (sectioned editor with per-section edit + regenerate).
13. Review routes — `/games/[slug]/review` (full + intercepted) + `loading.tsx`.
14. Entry points — log card button + game detail CTA + Sonner completed-toast.
15. Public review pages — list + canonical + `/u/me/...` redirect + ReviewCard + ReviewListCard + LikeButton + DeleteReviewLink.
16. OG card endpoint at `/og/review/[id]` + page metadata.
17. Verification gate — 18/18 passed.

**Gate report:** `docs/superpowers/gates/2026-05-11-phase2-gate.md`

**Tag:** `phase-2-complete`.

**Build at tag:** typecheck/lint/build all green.

**Open items for Bryan:**
- Soft-launch: send the staging URL to ~5 friends; ask each to write 1 review of a recent game. Screenshot results. Evaluate whether the magic-moment landed.
- API key rotation: same set as prior phases (Cerebras, Groq, Cloudflare, DeepSeek, Steam, OpenXBL).

**Next phase:** Phase 3 (Library Imports) per the locked roadmap.
'@
$path = "$env:USERPROFILE\.claude\projects\C--Projects-Letterboxd-for-Games\memory\phase_2_complete.md"
Set-Content -Path $path -Encoding UTF8 -Value $body
```

Add a one-line pointer to MEMORY.md:

```
- [Phase 2 complete](phase_2_complete.md) — AI Reviews shipped (17 tasks, tag phase-2-complete); soft launch milestone; ready for Phase 3
```

- [ ] **Step 7: Final summary**

Report to user: 17 tasks complete, `phase-2-complete` tag pushed, gate doc 18/18, ready for soft launch.

---

## Self-review notes

The plan covers every spec section by task:
- Architecture (Tasks 1–5)
- IA routes + entry points (Tasks 13–14)
- Data flow (Tasks 7–10)
- Components (Tasks 11–12, 15)
- Database (no migration — verified in Task 0 setup notes)
- Errors & failure states (handled inline across Tasks 7–11)
- Verification gate (Task 17)

Open items intentionally deferred to Phase 5 are documented in the spec; the plan does not introduce them.
