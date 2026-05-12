// supabase/functions/_shared/ai-router.ts
// Minimal Deno-side AI router. Cerebras primary, Groq fallback.
// Both providers speak OpenAI Chat Completions API at /v1/chat/completions,
// so one fetch wrapper handles both.
//
// This is the Edge mirror of lib/ai/router.ts (Next-side). The Next side
// streams via the Vercel AI SDK; here we use non-streaming completions
// because narrative summaries are short (~200 tokens) with no UX benefit
// from streaming.

// TODO(phase-4-follow-up): write a row to `ai_calls` for cost tracking parity
// with Phase 2's lib/ai/telemetry.ts. Out of scope for T4 — the success path
// here only ensures the AI call returns; telemetry writes will come in a
// dedicated cleanup task once Edge-side telemetry mirror exists.

export type CallRouterInput = {
  feature: "fingerprint" | "recommendation" | "review_draft" | "year_in_review" | "interview_question";
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
};

export type CallRouterResult = {
  text: string;
  provider: "cerebras" | "groq";
  model: string;
  inputTokens: number;
  outputTokens: number;
};

type ProviderConfig = {
  name: "cerebras" | "groq";
  endpoint: string;
  apiKeyEnv: string;
  model: string;
};

// Order matters: first configured + responsive wins.
// Models match the Next-side lib/ai/providers/{cerebras,groq}.ts.
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
];

export class AIProvidersExhaustedError extends Error {
  constructor(public readonly attempts: Array<{ provider: string; error: string }>) {
    super(
      `All AI providers failed: ${attempts.map((a) => `${a.provider}: ${a.error}`).join("; ")}`,
    );
    this.name = "AIProvidersExhaustedError";
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

      const resp = await fetch(provider.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "<unreadable>");
        attempts.push({
          provider: provider.name,
          error: `HTTP ${resp.status}: ${errText.slice(0, 200)}`,
        });
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
      if (!text) {
        attempts.push({
          provider: provider.name,
          error: "empty response (no choices[0].message.content)",
        });
        continue;
      }

      return {
        text,
        provider: provider.name,
        model: provider.model,
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      };
    } catch (err) {
      attempts.push({
        provider: provider.name,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
  }

  throw new AIProvidersExhaustedError(attempts);
}
