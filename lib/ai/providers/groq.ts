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
