import "server-only";

/**
 * USD cost per million tokens, per (provider, model). Numbers reflect
 * published rates at brainstorm time (2026-05-11). Update when providers
 * change pricing. Free tiers report 0 for budget tracking — actual cost
 * is zero up to the daily quota.
 */
export const PROVIDER_COST = {
  cerebras: { input: 0, output: 0 },
  groq: { input: 0, output: 0 },
  cloudflare: { input: 0, output: 0 },
  deepseek: { input: 0.14, output: 0.28 },
} as const satisfies Record<string, { input: number; output: number }>;

export type ProviderName = keyof typeof PROVIDER_COST;

export function computeCostUsd(
  provider: ProviderName,
  inputTokens: number,
  outputTokens: number,
): number {
  const rate = PROVIDER_COST[provider];
  const input = (inputTokens / 1_000_000) * rate.input;
  const output = (outputTokens / 1_000_000) * rate.output;
  // Round to 6 decimals to match numeric(10, 6) in ai_calls.cost_usd.
  return Math.round((input + output) * 1_000_000) / 1_000_000;
}
