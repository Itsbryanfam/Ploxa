import "server-only";
import type { Provider } from "./types";
import { streamOpenAICompat } from "./_openai-compat";

const MODEL = "llama-3.3-70b";

export const cerebras: Provider = {
  name: "cerebras",
  model: MODEL,
  isConfigured: () => Boolean(process.env.CEREBRAS_API_KEY),
  async streamText(args) {
    return streamOpenAICompat(
      {
        sdkName: "cerebras",
        baseURL: "https://api.cerebras.ai/v1",
        apiKey: process.env.CEREBRAS_API_KEY!,
        model: MODEL,
      },
      args,
    );
  },
};
