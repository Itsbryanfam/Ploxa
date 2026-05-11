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
