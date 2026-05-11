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
  { prompt, systemPrompt, maxTokens = 800, temperature = 0.7 }: StreamArgs,
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
  });
  return {
    textStream: result.textStream,
    usage: Promise.resolve(result.usage).then((u) => ({
      inputTokens: u.inputTokens ?? 0,
      outputTokens: u.outputTokens ?? 0,
    })),
  };
}
