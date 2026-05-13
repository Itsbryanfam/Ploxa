import "server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import type { StreamArgs, StreamResult } from "./types";

interface OpenAICompatConfig {
  sdkName: string;
  baseURL: string;
  apiKey: string;
  model: string;
}

/**
 * Shared streamText implementation for OpenAI-compatible providers
 * (Cerebras, Cloudflare Workers AI, DeepSeek). Maps our public
 * StreamArgs.maxTokens to the AI SDK v6 `maxOutputTokens` field
 * and normalizes the PromiseLike usage to a real Promise.
 */
export async function streamOpenAICompat(
  config: OpenAICompatConfig,
  { prompt, systemPrompt, maxTokens = 800, temperature = 0.7, abortSignal }: StreamArgs,
): Promise<StreamResult> {
  const client = createOpenAICompatible({
    name: config.sdkName,
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  });
  const result = streamText({
    model: client(config.model),
    system: systemPrompt,
    prompt,
    maxOutputTokens: maxTokens,
    temperature,
    abortSignal,
  });
  suppressUnhandledRejections(result);
  return {
    textStream: result.textStream,
    usage: Promise.resolve(result.usage).then((u) => ({
      inputTokens: u.inputTokens ?? 0,
      outputTokens: u.outputTokens ?? 0,
    })),
  };
}

/**
 * The Vercel AI SDK's streamText() returns a result object with several
 * promise-shaped properties (usage, text, finishReason, providerMetadata,
 * response, …). When the underlying API errors mid-stream, each of those
 * promises rejects. If the consumer only reads textStream/usage and the
 * router abandons the provider before awaiting them, the unawaited
 * rejections escape as `unhandledRejection: AI_NoOutputGeneratedError`.
 *
 * This helper pre-attaches a no-op catch handler to every thenable on the
 * result so rejections are always considered handled. Awaiting any of
 * them downstream still sees the rejection as expected (attaching .catch
 * doesn't consume the rejection from later .then chains).
 */
export function suppressUnhandledRejections(result: object): void {
  for (const value of Object.values(result)) {
    if (value && typeof (value as { then?: unknown }).then === "function") {
      (value as PromiseLike<unknown>).then(
        () => undefined,
        () => undefined,
      );
    }
  }
}
