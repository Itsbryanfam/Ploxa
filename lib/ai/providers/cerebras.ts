import "server-only";
import type { Provider } from "./types";
import { streamOpenAICompat } from "./_openai-compat";

// Verified against /v1/chat/completions on our key: llama3.1-8b is the only
// model that consistently returns 200. gpt-oss-120b and zai-glm-4.7 are
// listed by /v1/models but return 404 on inference for this account.
// qwen-3-235b is queue-gated. Smaller model but Cerebras's speed advantage
// still makes it a useful tier-1.
const MODEL = "llama3.1-8b";

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
