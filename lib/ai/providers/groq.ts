import "server-only";
import { createGroq } from "@ai-sdk/groq";
import { streamText } from "ai";
import type { Provider } from "./types";
import { suppressUnhandledRejections } from "./_openai-compat";

// Verified in Groq's /v1/models. Llama 3.3 70B is too large to share with
// Cerebras (which is gated to llama3.1-8b on our key) but each provider
// uses what its account supports — prompts are model-agnostic enough.
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
      maxOutputTokens: maxTokens,
      temperature,
    });
    suppressUnhandledRejections(result);
    return {
      textStream: result.textStream,
      usage: Promise.resolve(result.usage).then((u) => ({
        inputTokens: u.inputTokens ?? 0,
        outputTokens: u.outputTokens ?? 0,
      })),
    };
  },
};
