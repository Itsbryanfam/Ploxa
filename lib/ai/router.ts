import "server-only";
import { cerebras } from "./providers/cerebras";
import { groq } from "./providers/groq";
import { cloudflare } from "./providers/cloudflare";
import { deepseek } from "./providers/deepseek";
import type { Provider } from "./providers/types";
import {
  releaseProviderDaily,
  releaseProviderMinute,
  reserveProviderDaily,
  reserveProviderMinute,
} from "./rate-limit";
import { recordCall } from "./telemetry";
import { AIProvidersExhaustedError } from "./errors";
import type { aiFeatureEnum } from "@/lib/db/schema";

type AIFeature = (typeof aiFeatureEnum.enumValues)[number];

const PROVIDERS: readonly Provider[] = [cerebras, groq, cloudflare, deepseek];

// Hard timeout per provider attempt. Streaming features expect responses
// to begin within seconds; provider stalls beyond this should fall through.
const PROVIDER_TIMEOUT_MS = 30_000;

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
    // Atomic reserve: counter is incremented up-front, not after success.
    // If the cap is hit by a concurrent burst, reservation fails and we
    // move on. Daily is checked first so a daily-cap miss doesn't burn
    // a minute slot. Failure path releases whichever reservations we
    // claimed before bailing.
    if (!(await reserveProviderDaily(provider.name))) {
      attempts.push({ provider: provider.name, error: "daily cap" });
      continue;
    }
    if (!(await reserveProviderMinute(provider.name))) {
      await releaseProviderDaily(provider.name);
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
        // Hard timeout. AbortSignal.timeout() is supported in Node 18+ and
        // Vercel AI SDK forwards abortSignal to the underlying fetch.
        abortSignal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });

      // Peek the first chunk eagerly. The Vercel AI SDK's streamText()
      // call returns synchronously (no API request yet); the real fetch
      // happens lazily when textStream is read. A 4xx/5xx response from
      // the provider surfaces here as a throw — *not* on the original
      // streamText() call. By awaiting the first iterator step inside
      // this try/catch, mid-stream failures correctly fall through to
      // the next provider instead of escaping as unhandled rejections.
      const iter = textStream[Symbol.asyncIterator]();
      const first = await iter.next();
      if (first.done) {
        throw new Error(`${provider.name} returned an empty stream`);
      }

      // Provider committed. Build a combined stream that yields the
      // already-fetched first chunk plus the remainder of the iterator.
      const committedStream = combineStream(first.value, iter);

      // Wrap the stream so we can write telemetry on completion without
      // forcing the caller to await usage themselves. Reservations were
      // claimed up-front, so no post-stream increment is needed here.
      const wrapped = wrapStream(committedStream, async () => {
        try {
          // Usage promise may reject if the provider errors mid-stream. We
          // still want a telemetry row for the call so the cost dashboard
          // sees it happened — fall back to zero tokens in that case.
          let u: { inputTokens: number; outputTokens: number };
          try {
            u = await usage;
          } catch {
            u = { inputTokens: 0, outputTokens: 0 };
          }
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
      // Release reservations: a failed call shouldn't count against the
      // cap (it didn't actually produce tokens). Release order doesn't
      // matter — they're independent counters.
      await releaseProviderDaily(provider.name).catch(() => undefined);
      await releaseProviderMinute(provider.name).catch(() => undefined);
      // Fire-and-forget failure telemetry with explicit rejection logger
      // (recordCall itself is best-effort but `.catch()` here is resilient
      // to future changes that might let it reject).
      recordCall({
        userId: args.userId,
        feature: args.feature,
        provider: provider.name,
        model: provider.model,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: Date.now() - start,
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      }).catch((telemetryErr) =>
        console.error("router failure telemetry write failed", telemetryErr),
      );
      continue;
    }
  }

  throw new AIProvidersExhaustedError(attempts);
}

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

/**
 * Prepend a previously-peeked chunk back onto an iterator and re-expose
 * it as an AsyncIterable. Used by the router to commit to a provider
 * after eagerly verifying its first chunk arrived without error.
 */
async function* combineStream(
  firstChunk: string,
  rest: AsyncIterator<string>,
): AsyncIterable<string> {
  yield firstChunk;
  while (true) {
    const next = await rest.next();
    if (next.done) return;
    yield next.value;
  }
}
