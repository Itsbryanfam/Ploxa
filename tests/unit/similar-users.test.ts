import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * getSimilarUsers payload pins (T08 of audit-fixes-2026-05-14).
 *
 * Before this fix, SimilarUsersRow always rendered "Follow" because the
 * discovery query both hard-excluded already-followed users AND the
 * component hardcoded `initialIsFollowing={false}`. The audit removes the
 * SQL exclusion (so already-followed users CAN appear in the candidate
 * pool, e.g. for "people whose taste lines up with yours" — useful even
 * for accounts you already follow) and pipes a real `viewerFollows`
 * boolean through the row payload via a single batched lookup.
 *
 * `getSimilarUsers` issues raw `db.execute(sql\`...\`)` queries through
 * postgres-js. We mock `db.execute` directly and stub `drift` so the
 * scoring math is deterministic.
 */

// Three execute calls happen in order:
//   1. viewer fingerprint lookup
//   2. candidate pool SELECT
//   3. batched follows lookup (the new one, viewerFollows)
const executeMock = vi.fn();

vi.mock("@/lib/db", () => ({
  db: { execute: executeMock },
}));

// `drift` returns 0 for two identical bundles and 1 for maximally
// dissimilar; stub so similarity = 1 for u2 (returned first) and
// similarity = 0 for u3 (returned second). This pins ordering for the
// test that checks viewerFollows is preserved through sort.
vi.mock("@/lib/taste/vectors", () => ({
  drift: vi.fn((_a: unknown, _b: unknown) => 0),
}));

describe("getSimilarUsers — viewerFollows", () => {
  beforeEach(() => {
    executeMock.mockReset();
    vi.resetModules();
  });

  it("stamps viewerFollows=true on rows where viewer follows the candidate, false otherwise", async () => {
    // Call 1: viewer fingerprint (sparse-or-better tier so we don't short-circuit).
    executeMock.mockResolvedValueOnce([
      {
        genre_vector: { rpg: 1 },
        theme_vector: { fantasy: 1 },
        mechanic_vector: { turn_based: 1 },
        total_logs_at_generation: 25,
      },
    ]);
    // Call 2: candidate pool — u2 + u3, both eligible.
    executeMock.mockResolvedValueOnce([
      {
        user_id: "u2",
        username: "alice",
        display_name: "Alice",
        profile_picture_url: null,
        genre_vector: {},
        theme_vector: {},
        mechanic_vector: {},
        total_logs_at_generation: 20,
      },
      {
        user_id: "u3",
        username: "bob",
        display_name: "Bob",
        profile_picture_url: null,
        genre_vector: {},
        theme_vector: {},
        mechanic_vector: {},
        total_logs_at_generation: 15,
      },
    ]);
    // Call 3: batched follows lookup — viewer (u1) follows u2 only.
    executeMock.mockResolvedValueOnce([{ followed_id: "u2" }]);

    const { getSimilarUsers } = await import(
      "@/lib/social/discovery/similar-users"
    );
    const rows = await getSimilarUsers("u1", 12);
    expect(rows).toHaveLength(2);

    const byId = new Map(rows.map((r) => [r.userId, r]));
    expect(byId.get("u2")?.viewerFollows).toBe(true);
    expect(byId.get("u3")?.viewerFollows).toBe(false);
  });

  it("issues exactly one batched follows query (not N per candidate)", async () => {
    executeMock.mockResolvedValueOnce([
      {
        genre_vector: {},
        theme_vector: {},
        mechanic_vector: {},
        total_logs_at_generation: 25,
      },
    ]);
    executeMock.mockResolvedValueOnce([
      {
        user_id: "u2",
        username: "a",
        display_name: null,
        profile_picture_url: null,
        genre_vector: {},
        theme_vector: {},
        mechanic_vector: {},
        total_logs_at_generation: 20,
      },
      {
        user_id: "u3",
        username: "b",
        display_name: null,
        profile_picture_url: null,
        genre_vector: {},
        theme_vector: {},
        mechanic_vector: {},
        total_logs_at_generation: 20,
      },
      {
        user_id: "u4",
        username: "c",
        display_name: null,
        profile_picture_url: null,
        genre_vector: {},
        theme_vector: {},
        mechanic_vector: {},
        total_logs_at_generation: 20,
      },
    ]);
    executeMock.mockResolvedValueOnce([]); // viewer follows none of them

    const { getSimilarUsers } = await import(
      "@/lib/social/discovery/similar-users"
    );
    await getSimilarUsers("u1", 12);

    // 3 calls total: viewer-fp + candidates + ONE batched follows lookup.
    // If a regression turned this into per-row lookups we'd see 3 + N.
    expect(executeMock).toHaveBeenCalledTimes(3);
  });

  it("skips the follows lookup entirely when there are no candidates", async () => {
    executeMock.mockResolvedValueOnce([
      {
        genre_vector: {},
        theme_vector: {},
        mechanic_vector: {},
        total_logs_at_generation: 25,
      },
    ]);
    executeMock.mockResolvedValueOnce([]); // empty candidate pool

    const { getSimilarUsers } = await import(
      "@/lib/social/discovery/similar-users"
    );
    const rows = await getSimilarUsers("u1", 12);
    expect(rows).toEqual([]);
    // Viewer-fp + candidates = 2 — no third roundtrip when there's
    // nothing to look up.
    expect(executeMock).toHaveBeenCalledTimes(2);
  });

  it("returns [] without firing follows lookup when viewer fingerprint is empty-tier", async () => {
    // Viewer has 0 logs → tierForUser returns "empty" → short-circuit.
    executeMock.mockResolvedValueOnce([
      {
        genre_vector: {},
        theme_vector: {},
        mechanic_vector: {},
        total_logs_at_generation: 0,
      },
    ]);

    const { getSimilarUsers } = await import(
      "@/lib/social/discovery/similar-users"
    );
    const rows = await getSimilarUsers("u1", 12);
    expect(rows).toEqual([]);
    // Only the viewer-fp call fired.
    expect(executeMock).toHaveBeenCalledTimes(1);
  });
});
