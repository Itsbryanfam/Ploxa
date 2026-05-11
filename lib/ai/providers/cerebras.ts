import "server-only";
import type { Provider } from "./types";
import { streamOpenAICompat } from "./_openai-compat";

// Cerebras account doesn't expose Llama 3.3 70B; gpt-oss-120b is the
// strongest model in our catalog and matches the model family we use on
// Groq + Cloudflare so prompts behave consistently across all three
// free-tier providers.
const MODEL = "gpt-oss-120b";

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
