import { describe, expect, it } from "vitest";
import { computeCostUsd, PROVIDER_COST } from "@/lib/ai/cost";

describe("computeCostUsd", () => {
  it("returns 0 for free-tier providers regardless of token count", () => {
    expect(computeCostUsd("cerebras", 1_000_000, 1_000_000)).toBe(0);
    expect(computeCostUsd("groq", 5_000_000, 5_000_000)).toBe(0);
    expect(computeCostUsd("cloudflare", 10_000_000, 10_000_000)).toBe(0);
  });

  it("computes DeepSeek cost at the published rate (input + output)", () => {
    // 1M input × $0.14 + 1M output × $0.28 = $0.42
    const cost = computeCostUsd("deepseek", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(0.42, 6);
  });

  it("scales linearly with token count", () => {
    const small = computeCostUsd("deepseek", 100_000, 100_000);
    const large = computeCostUsd("deepseek", 1_000_000, 1_000_000);
    expect(large).toBeCloseTo(small * 10, 6);
  });

  it("rounds to 6 decimals to match the numeric(10, 6) DB column", () => {
    // Tiny token counts produce sub-microdollar values; the round avoids
    // pg numeric overflow on the cost_usd insert.
    const cost = computeCostUsd("deepseek", 7, 13);
    const decimals = (cost.toString().split(".")[1] ?? "").length;
    expect(decimals).toBeLessThanOrEqual(6);
  });

  it("PROVIDER_COST covers every provider name the cost table references", () => {
    // Catches drift if a new provider is added to the router but cost isn't
    // updated — the type system already enforces it but a runtime check is
    // a cheap second line.
    const names = Object.keys(PROVIDER_COST);
    expect(names).toEqual(
      expect.arrayContaining(["cerebras", "groq", "cloudflare", "deepseek"]),
    );
  });
});
