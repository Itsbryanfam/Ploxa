import { describe, expect, it } from "vitest";
import { checkSpamRules } from "@/lib/social/moderation/rules";

describe("checkSpamRules — link density rule (threshold = 3 URLs)", () => {
  it("0 URLs is clean", () => {
    expect(checkSpamRules("Just a normal comment.").isFlagged).toBe(false);
  });

  it("2 URLs is clean (under threshold)", () => {
    const body = "Check https://example.com and https://example.org too.";
    expect(checkSpamRules(body).reasons).not.toContain("link_density");
  });

  it("3 URLs trips the rule", () => {
    const body = "https://a.com https://b.com https://c.com";
    expect(checkSpamRules(body).reasons).toContain("link_density");
  });

  it("www.-prefixed URLs count", () => {
    const body = "www.a.com www.b.com www.c.com";
    expect(checkSpamRules(body).reasons).toContain("link_density");
  });
});

describe("checkSpamRules — all-caps rule (>=30 chars and strictly >70% caps)", () => {
  it("body of length 29 does NOT trigger (below min length)", () => {
    const body = "X".repeat(29);
    expect(checkSpamRules(body).reasons).not.toContain("all_caps");
  });

  it("body of length 30 with 100% caps DOES trigger", () => {
    const body = "X".repeat(30);
    expect(checkSpamRules(body).reasons).toContain("all_caps");
  });

  it("exactly 70% caps does NOT trigger (threshold is strict >)", () => {
    // 21 caps, 9 lowercase out of 30 letters = exactly 70%
    const body = "X".repeat(21) + "y".repeat(9);
    expect(checkSpamRules(body).reasons).not.toContain("all_caps");
  });

  it("71% caps (25/35) DOES trigger", () => {
    // 25 caps, 10 lowercase out of 35 = ~71.4%
    const body = "X".repeat(25) + "y".repeat(10);
    expect(checkSpamRules(body).reasons).toContain("all_caps");
  });

  it("body with no letters does NOT trigger (avoid div-by-zero)", () => {
    const body = "1234567890".repeat(5);
    expect(checkSpamRules(body).reasons).not.toContain("all_caps");
  });
});

describe("checkSpamRules — repeat-chars rule (threshold = 7 same in a row)", () => {
  it("6 in a row does NOT trigger", () => {
    // "Wo" + 6 w's = "Wowwwwww"
    const body = "Wo" + "w".repeat(6) + " nice";
    expect(checkSpamRules(body).reasons).not.toContain("repeat_chars");
  });

  it("7 in a row DOES trigger", () => {
    // "Wo" + 7 w's = "Wowwwwwww"
    const body = "Wo" + "w".repeat(7) + " nice";
    expect(checkSpamRules(body).reasons).toContain("repeat_chars");
  });

  it("triggers on non-letter chars too (7 exclamation marks)", () => {
    // 7 exclamations satisfies the (.)\1{6,} pattern
    const body = "Cool" + "!".repeat(7);
    expect(checkSpamRules(body).reasons).toContain("repeat_chars");
  });

  it("6 non-letter chars does NOT trigger", () => {
    const body = "Cool" + "!".repeat(6);
    expect(checkSpamRules(body).reasons).not.toContain("repeat_chars");
  });
});

describe("checkSpamRules — blocklist phrases", () => {
  it("'free v-bucks' trips the blocklist", () => {
    expect(checkSpamRules("get free v-bucks here").reasons).toContain("blocklist");
  });

  it("matches case-insensitively", () => {
    expect(checkSpamRules("CLICK HERE FOR a deal").reasons).toContain("blocklist");
  });

  it("clean body returns no blocklist flag", () => {
    expect(checkSpamRules("Hades is fantastic.").reasons).not.toContain("blocklist");
  });
});

describe("checkSpamRules — composite + clean cases", () => {
  it("multiple rules can fire together", () => {
    const body =
      "BUY FOLLOWERS" + "!".repeat(7) + " https://a.com https://b.com https://c.com WORKING NOW";
    const result = checkSpamRules(body);
    expect(result.isFlagged).toBe(true);
    expect(result.reasons).toContain("link_density");
    expect(result.reasons).toContain("blocklist");
    expect(result.reasons).toContain("repeat_chars");
  });

  it("a realistic harsh review is NOT flagged", () => {
    const body = "This game is terrible. I hated every second of it.";
    expect(checkSpamRules(body).isFlagged).toBe(false);
  });

  it("a celebratory caps reaction under 30 chars is clean", () => {
    expect(checkSpamRules("AMAZING GAME").isFlagged).toBe(false);
  });

  it("clean empty-ish body returns isFlagged false", () => {
    expect(checkSpamRules("ok").isFlagged).toBe(false);
  });
});
