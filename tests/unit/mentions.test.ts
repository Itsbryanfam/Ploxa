import { describe, expect, it, vi } from "vitest";

// parseMentions is a pure function, but mentions.ts also exports
// resolveMentionedUserIds which imports @/lib/db at module level.
// Mock db so the module loads cleanly in the Vitest (plain Node) environment.
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
  },
  schema: {
    profiles: {
      userId: { name: "user_id" },
      username: { name: "username" },
    },
  },
}));

const { parseMentions } = await import("@/lib/social/comments/mentions");

describe("parseMentions", () => {
  it("extracts simple mentions", () => {
    expect(parseMentions("hey @alice and @bob")).toEqual(["alice", "bob"]);
  });

  it("dedupes repeated mentions", () => {
    expect(parseMentions("@alice @alice @alice")).toEqual(["alice"]);
  });

  it("ignores mentions inside code fences", () => {
    expect(parseMentions("```\n@alice\n``` outside @bob")).toEqual(["bob"]);
  });

  it("ignores escaped \\@ mentions", () => {
    expect(parseMentions("\\@alice and @bob")).toEqual(["bob"]);
  });

  it("lowercases extracted usernames", () => {
    expect(parseMentions("@Alice")).toEqual(["alice"]);
  });

  it("returns empty array when no mentions", () => {
    expect(parseMentions("no mentions here")).toEqual([]);
  });

  it("requires at least 3 chars in mention", () => {
    expect(parseMentions("@ab is too short, @abc is fine")).toEqual(["abc"]);
  });

  it("caps mention length at 20 chars (matches username constraint)", () => {
    const long = "a".repeat(21);
    expect(parseMentions(`@${long}`)).toEqual([]);
    const exact = "a".repeat(20);
    expect(parseMentions(`@${exact}`)).toEqual([exact]);
  });

  it("does not match email-local-part domains", () => {
    expect(parseMentions("reach me at user@gmail.com")).toEqual([]);
    expect(parseMentions("@alice is at alice@example.net")).toEqual(["alice"]);
    expect(parseMentions("fake@bob real @charlie")).toEqual(["charlie"]);
  });

  it("does not match mention immediately after backslash that isn't an escape", () => {
    // Path-like edge case: \\@user should still match (it's an escape).
    // But @user inside a URL fragment like //path/@user — the leading `/`
    // is not a word char or @, so it SHOULD match. Pin that:
    expect(parseMentions("see /path/@alice for more")).toEqual(["alice"]);
  });
});
