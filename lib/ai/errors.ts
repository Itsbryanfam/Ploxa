/**
 * Named errors thrown by the AI router. Catchers can branch on the type
 * to distinguish "all providers exhausted" from "rate limit hit" from
 * "individual provider failure (already silently fell through)".
 */

export class AIRouterError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "AIRouterError";
  }
}

export class AIProvidersExhaustedError extends AIRouterError {
  constructor(public readonly attempts: Array<{ provider: string; error: unknown }>) {
    super(`All ${attempts.length} AI providers failed`);
    this.name = "AIProvidersExhaustedError";
  }
}

export class RateLimitExceededError extends AIRouterError {
  constructor(public readonly limitKind: "user-daily" | "provider-daily" | "provider-minute") {
    super(`Rate limit exceeded: ${limitKind}`);
    this.name = "RateLimitExceededError";
  }
}
