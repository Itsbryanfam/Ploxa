import "server-only";
import type { Provider } from "./types";
import { streamOpenAICompat } from "./_openai-compat";

const MODEL = "deepseek-chat";

export const deepseek: Provider = {
  name: "deepseek",
  model: MODEL,
  isConfigured: () => Boolean(process.env.DEEPSEEK_API_KEY),
  async streamText(args) {
    return streamOpenAICompat(
      {
        sdkName: "deepseek",
        baseURL: "https://api.deepseek.com/v1",
        apiKey: process.env.DEEPSEEK_API_KEY!,
        model: MODEL,
      },
      args,
    );
  },
};
