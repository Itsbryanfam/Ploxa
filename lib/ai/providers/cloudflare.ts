import "server-only";
import type { Provider } from "./types";
import { streamOpenAICompat } from "./_openai-compat";

// Cloudflare Workers AI exposes an OpenAI-compatible endpoint per account:
// https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1
// gpt-oss-120b matches the model family used on Cerebras + Groq so prompts
// behave consistently across all three free-tier providers.
const MODEL = "@cf/openai/gpt-oss-120b";

export const cloudflare: Provider = {
  name: "cloudflare",
  model: MODEL,
  isConfigured: () =>
    Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN),
  async streamText(args) {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    if (!accountId || !apiToken) {
      throw new Error("Cloudflare provider not configured");
    }
    return streamOpenAICompat(
      {
        sdkName: "cloudflare-workers-ai",
        baseURL: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`,
        apiKey: apiToken,
        model: MODEL,
      },
      args,
    );
  },
};
