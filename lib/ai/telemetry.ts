import "server-only";
import { db, schema } from "@/lib/db";
import { computeCostUsd, type ProviderName } from "./cost";
import type { aiFeatureEnum } from "@/lib/db/schema";

type AIFeature = (typeof aiFeatureEnum.enumValues)[number];

export interface RecordCallArgs {
  userId: string | null;
  feature: AIFeature;
  provider: ProviderName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  success: boolean;
  errorMessage?: string;
}

/**
 * Best-effort write to ai_calls. Telemetry failures NEVER propagate —
 * a broken cost dashboard is preferable to a broken review flow.
 */
export async function recordCall(args: RecordCallArgs): Promise<void> {
  try {
    await db.insert(schema.aiCalls).values({
      userId: args.userId,
      feature: args.feature,
      provider: args.provider,
      model: args.model,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      costUsd: String(computeCostUsd(args.provider, args.inputTokens, args.outputTokens)),
      latencyMs: args.latencyMs,
      success: args.success,
      errorMessage: args.errorMessage ?? null,
    });
  } catch (err) {
    console.error("ai_calls write failed", err);
  }
}
