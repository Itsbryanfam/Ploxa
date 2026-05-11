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
  },
};
