// supabase/functions/_shared/ai-router.ts
// Edge mirror of lib/ai/router.ts (Next-side). The Next side streams via the
// Vercel AI SDK; here we use non-streaming completions because narrative
// summaries are short (~200 tokens) with no UX benefit from streaming.
//
// Provider parity (Codex audit #16): all four providers are wired here to
// match the Next-side fallback order. Cerebras, Groq, Cloudflare, DeepSeek
// all speak OpenAI Chat Completions on the endpoints below.
//
// Telemetry parity (Codex audit #17): when the caller passes
// `telemetry: { sql, userId }` we write to ai_calls just like
// lib/ai/telemetry.ts does on the Next side.
//
// Timeout (Codex audit #15): each fetch carries AbortSignal.timeout(30_000)
// so a stalled provider falls through to the next one rather than hanging
// the function for the Edge wall-clock cap.

import type postgres from "npm:postgres@3.4.9";

export type EdgeAIFeature =
  | "fingerprint"
  | "recommendation"
  | "review_draft"
  | "year_in_review"
  | "interview_question";

type EdgeProviderName = "cerebras" | "groq" | "cloudflare" | "deepseek";

export type CallRouterInput = {
  feature: EdgeAIFeature;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  /**
   * Optional telemetry context. When provided, a row is written to
   * `ai_calls` after every attempt (success and failure). Required for
   * Phase 4 cost-tracking parity with the Next-side router — Edge calls
   * were previously invisible to the cost dashboard.
   */
  telemetry?: {
    sql: ReturnType<typeof postgres>;
    userId: string;
  };
};

export type CallRouterResult = {
  text: string;
  provider: EdgeProviderName;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

type ProviderConfig = {
  name: EdgeProviderName;
  // Either a static endpoint or a function that derives one from env.
  endpoint: string | (() => string | null);
  apiKeyEnv: string;
  model: string;
};

// Order matches lib/ai/router.ts's PROVIDERS array exactly.
const PROVIDERS: readonly ProviderConfig[] = [
  {
    name: "cerebras",
    endpoint: "https://api.cerebras.ai/v1/chat/completions",
    apiKeyEnv: "CEREBRAS_API_KEY",
    model: "llama3.1-8b",
  },
  {
    name: "groq",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    apiKeyEnv: "GROQ_API_KEY",
    model: "llama-3.3-70b-versatile",
  },
  {
    name: "cloudflare",
    // Cloudflare's OpenAI-compatible endpoint is per-account. Returns null if
    // CLOUDFLARE_ACCOUNT_ID is unset so the caller treats this as
    // "not configured" instead of building a malformed URL.
    endpoint: () => {
      const acct = Deno.env.get("CLOUDFLARE_ACCOUNT_ID");
      return acct
        ? `https://api.cloudflare.com/client/v4/accounts/${acct}/ai/v1/chat/completions`
        : null;
    },
    apiKeyEnv: "CLOUDFLARE_API_TOKEN",
    model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  },
  {
    name: "deepseek",
    endpoint: "https://api.deepseek.com/v1/chat/completions",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    model: "deepseek-chat",
  },
];

// Mirror of lib/ai/cost.ts. Keep numbers in sync. Free tiers are 0.
const PROVIDER_COST: Record<EdgeProviderName, { input: number; output: number }> = {
  cerebras: { input: 0, output: 0 },
  groq: { input: 0, output: 0 },
  cloudflare: { input: 0, output: 0 },
  deepseek: { input: 0.14, output: 0.28 },
};

function computeCostUsd(
  provider: EdgeProviderName,
  inputTokens: number,
  outputTokens: number,
): number {
  const rate = PROVIDER_COST[provider];
  const input = (inputTokens / 1_000_000) * rate.input;
  const output = (outputTokens / 1_000_000) * rate.output;
  // Round to 6 decimals to match numeric(10, 6) in ai_calls.cost_usd.
  return Math.round((input + output) * 1_000_000) / 1_000_000;
}

// 30s matches PROVIDER_TIMEOUT_MS in lib/ai/router.ts.
const PROVIDER_TIMEOUT_MS = 30_000;

export class AIProvidersExhaustedError extends Error {
  constructor(public readonly attempts: Array<{ provider: string; error: string }>) {
    super(
      `All AI providers failed: ${attempts.map((a) => `${a.provider}: ${a.error}`).join("; ")}`,
    );
    this.name = "AIProvidersExhaustedError";
  }
}

/**
 * Best-effort ai_calls write. Telemetry failures never propagate — a
 * broken cost dashboard is preferable to a broken AI call.
 */
async function recordCall(
  sql: ReturnType<typeof postgres>,
  args: {
    userId: string;
    feature: EdgeAIFeature;
    provider: EdgeProviderName;
    model: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    success: boolean;
    errorMessage?: string;
  },
): Promise<void> {
  try {
    const costUsd = computeCostUsd(args.provider, args.inputTokens, args.outputTokens);
    await sql`
      INSERT INTO ai_calls (
        user_id, feature, provider, model,
        input_tokens, output_tokens, cost_usd, latency_ms,
        success, error_message
      ) VALUES (
        ${args.userId}, ${args.feature}, ${args.provider}, ${args.model},
        ${args.inputTokens}, ${args.outputTokens}, ${costUsd.toFixed(6)}, ${args.latencyMs},
        ${args.success}, ${args.errorMessage ?? null}
      )
    `;
  } catch (err) {
    console.error("ai_calls write failed", err);
  }
}

export async function callRouter(input: CallRouterInput): Promise<CallRouterResult> {
  const attempts: Array<{ provider: string; error: string }> = [];

  for (const provider of PROVIDERS) {
    const apiKey = Deno.env.get(provider.apiKeyEnv);
    if (!apiKey) {
      attempts.push({ provider: provider.name, error: "not configured" });
      continue;
    }
    const endpoint =
      typeof provider.endpoint === "function" ? provider.endpoint() : provider.endpoint;
    if (!endpoint) {
      attempts.push({ provider: provider.name, error: "endpoint not configured" });
      continue;
    }

    const start = Date.now();
    try {
      const body = {
        model: provider.model,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
        max_tokens: input.maxTokens ?? 200,
        temperature: input.temperature ?? 0.7,
      };

      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });

      if (!resp.ok) {
        // Log the full provider response body for debugging, but don't
        // include it in the error chain — provider responses occasionally
        // echo request shape, and that error eventually serializes via
        // AIProvidersExhaustedError.message which could surface to logs
        // or telemetry. Defense-in-depth: keep the user-visible chain to
        // {provider, status only}; full body lives in console.error.
        const errText = await resp.text().catch(() => "<unreadable>");
        console.error(
          `ai-router: ${provider.name} returned HTTP ${resp.status}: ${errText.slice(0, 500)}`,
        );
        attempts.push({
          provider: provider.name,
          error: `HTTP ${resp.status}`,
        });
        if (input.telemetry) {
          await recordCall(input.telemetry.sql, {
            userId: input.telemetry.userId,
            feature: input.feature,
            provider: provider.name,
            model: provider.model,
            inputTokens: 0,
            outputTokens: 0,
            latencyMs: Date.now() - start,
            success: false,
            errorMessage: `HTTP ${resp.status}`,
          });
        }
        // 4xx is a config error (bad model, bad key, bad request shape).
        // 5xx is a provider problem — fall through to next provider.
        // Either way, try the next one; bailing on 4xx is more brittle
        // than just trying everything since key issues vary per provider.
        continue;
      }

      const json = (await resp.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const text = json.choices?.[0]?.message?.content?.trim();
      const inputTokens = json.usage?.prompt_tokens ?? 0;
      const outputTokens = json.usage?.completion_tokens ?? 0;

      if (!text) {
        attempts.push({
          provider: provider.name,
          error: "empty response (no choices[0].message.content)",
        });
        if (input.telemetry) {
          await recordCall(input.telemetry.sql, {
            userId: input.telemetry.userId,
            feature: input.feature,
            provider: provider.name,
            model: provider.model,
            inputTokens,
            outputTokens,
            latencyMs: Date.now() - start,
            success: false,
            errorMessage: "empty response",
          });
        }
        continue;
      }

      if (input.telemetry) {
        await recordCall(input.telemetry.sql, {
          userId: input.telemetry.userId,
          feature: input.feature,
          provider: provider.name,
          model: provider.model,
          inputTokens,
          outputTokens,
          latencyMs: Date.now() - start,
          success: true,
        });
      }

      return {
        text,
        provider: provider.name,
        model: provider.model,
        inputTokens,
        outputTokens,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      attempts.push({ provider: provider.name, error: message });
      if (input.telemetry) {
        await recordCall(input.telemetry.sql, {
          userId: input.telemetry.userId,
          feature: input.feature,
          provider: provider.name,
          model: provider.model,
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: Date.now() - start,
          success: false,
          errorMessage: message,
        });
      }
      continue;
    }
  }

  throw new AIProvidersExhaustedError(attempts);
}
