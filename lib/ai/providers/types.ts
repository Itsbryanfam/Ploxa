import "server-only";

export interface StreamArgs {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface StreamResult {
  textStream: AsyncIterable<string>;
  /** Resolves after the stream completes; returns token counts for telemetry. */
  usage: Promise<{ inputTokens: number; outputTokens: number }>;
}

export interface Provider {
  readonly name: "cerebras" | "groq" | "cloudflare" | "deepseek";
  readonly model: string;
  isConfigured(): boolean;
  streamText(args: StreamArgs): Promise<StreamResult>;
}
