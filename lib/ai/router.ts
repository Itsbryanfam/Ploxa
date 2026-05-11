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
