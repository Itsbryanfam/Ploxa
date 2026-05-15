import { describe, expect, it, vi, beforeEach } from "vitest";

describe("isRecsV2Enabled", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("true when global RECS_V2_ENABLED=true", async () => {
    vi.stubEnv("RECS_V2_ENABLED", "true");
    vi.stubEnv("RECS_V2_USERS", "");
    const { isRecsV2Enabled } = await import("@/lib/recs/feature-flag");
    expect(isRecsV2Enabled("user-1")).toBe(true);
  });

  it("false when global=false and user not canary (prod)", async () => {
    vi.stubEnv("RECS_V2_ENABLED", "false");
    vi.stubEnv("RECS_V2_USERS", "");
    vi.stubEnv("NODE_ENV", "production");
    const { isRecsV2Enabled } = await import("@/lib/recs/feature-flag");
    expect(isRecsV2Enabled("user-1")).toBe(false);
  });

  it("true for a canary user even when global=false in prod", async () => {
    vi.stubEnv("RECS_V2_ENABLED", "false");
    vi.stubEnv("RECS_V2_USERS", "user-canary, user-2");
    vi.stubEnv("NODE_ENV", "production");
    const { isRecsV2Enabled } = await import("@/lib/recs/feature-flag");
    expect(isRecsV2Enabled("user-canary")).toBe(true);
    expect(isRecsV2Enabled("user-2")).toBe(true); // trims whitespace
    expect(isRecsV2Enabled("user-other")).toBe(false);
  });

  it("unset RECS_V2_ENABLED → dev/test default true off-prod, false in prod", async () => {
    vi.stubEnv("RECS_V2_USERS", "");
    // RECS_V2_ENABLED intentionally NOT stubbed (undefined)
    vi.stubEnv("NODE_ENV", "test");
    const m1 = await import("@/lib/recs/feature-flag");
    expect(m1.isRecsV2Enabled("u")).toBe(true);
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    const m2 = await import("@/lib/recs/feature-flag");
    expect(m2.isRecsV2Enabled("u")).toBe(false);
  });
});
