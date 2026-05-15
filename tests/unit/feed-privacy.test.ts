import { describe, expect, it, beforeEach, vi } from "vitest";

/**
 * F-006: the feed UNION only required `deleted_at IS NULL` on the actor's
 * profile — not `is_public = true`. So when a followed user flips their
 * profile private, their non-private log events / public reviews / public
 * lists kept streaming to existing followers, even though their profile,
 * library and recap correctly 404 for non-owners. This pins the contract:
 * every feed branch requires the actor's profile to be public.
 *
 * `@/lib/db` is mocked so db.execute returns no rows; drizzle-orm is left
 * real so the emitted SQL skeleton is introspectable (same technique as
 * tests/unit/recaps/aggregate.test.ts).
 */

vi.mock("@/lib/db", () => ({ db: { execute: vi.fn() }, schema: {} }));
vi.mock("@/lib/social/_shared/visibility", () => ({
  getBlockedPairs: vi.fn(async () => new Set<string>()),
}));

import { db } from "@/lib/db";
import { buildFeedQuery } from "@/lib/social/feed/queries";

const mockExecute = vi.mocked(db.execute);

function sqlText(arg: unknown): string {
  const chunks = (arg as { queryChunks?: unknown[] })?.queryChunks ?? [];
  let out = "";
  for (const c of chunks) {
    const v = (c as { value?: unknown }).value;
    if (Array.isArray(v)) out += v.join(" ");
    else if (typeof v === "string") out += v;
  }
  return out.replace(/\s+/g, " ");
}

beforeEach(() => {
  mockExecute.mockReset();
  mockExecute.mockResolvedValue([] as never);
});

describe("buildFeedQuery — profile privacy (F-006)", () => {
  it("requires is_public = true in all three UNION branches", async () => {
    await buildFeedQuery({
      viewerId: "v1",
      followeeIds: ["f1", "f2"],
      cursor: null,
    });

    expect(mockExecute).toHaveBeenCalledTimes(1);
    const sql = sqlText(mockExecute.mock.calls[0][0]);

    // One per UNION branch (logs / reviews / lists).
    const count = (sql.match(/is_public = true/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it("short-circuits to [] with no query when there are no followees", async () => {
    const rows = await buildFeedQuery({
      viewerId: "v1",
      followeeIds: [],
      cursor: null,
    });
    expect(rows).toEqual([]);
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
