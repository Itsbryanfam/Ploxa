import { describe, expect, it } from "vitest";

import type { ScoredCandidate } from "@/lib/recs/buckets";
import type { MMRItem } from "@/lib/recs/diversity-mmr";
import {
  assembleRefinedFresh,
  refinementEdgeCandidateIds,
} from "@/lib/recs/refinement-grid";

/**
 * Refinement-path owned-game flood (prod 2026-05-17, follow-up to PR #20).
 *
 * With active refinements the user reported /play-next showing ALL owned
 * games. Two compounding defects, each captured by one helper here:
 *
 *  #1 `refinementEdgeCandidateIds` — the Edge candidate pool was
 *     `applyMMR(mmrInput, topN:40)` over ALL scored candidates (discovery ∪
 *     backlog). For a heavy-backlog user the owned games dominate composite
 *     (they ARE the taste vector + libraryBonus) so that pool is mostly
 *     owned and the AI is forced to pick owned. The pool must be
 *     discovery-dominated, with only a bounded backlog tail so the Backlog
 *     slot stays fillable.
 *
 *  #2 `assembleRefinedFresh` — the refinement path rendered EVERY Edge pick
 *     via `picked.map(p => ({...p, slot: slotByFinalPick.get(p.gameId) ??
 *     p.slot}))`. The fixed assignBuckets correctly REFUSES to place an
 *     owned game in comfort/friends/wildcard, but `?? p.slot` then rendered
 *     those refused picks anyway under the schema-default 'comfort'. The
 *     grid must be exactly what assignBuckets placed — drop refused picks,
 *     never default-render them.
 */

const sc = (
  gameId: number,
  composite: number,
  inLibrary: boolean,
): ScoredCandidate => ({
  gameId,
  composite,
  inLibrary,
  socialScore: 0,
  genres: ["rpg"],
});

// A trivial deterministic similarity so applyMMR is fully predictable in the
// pool test: orthogonal unit vectors → cosine 0 for distinct ids.
const ortho = (n: number) => (i: number): number[] => {
  const v = new Array<number>(n).fill(0);
  v[i] = 1;
  return v;
};
const zeroSim = (_a: number[], _b: number[]): number => 0;

describe("refinementEdgeCandidateIds (#1 — discovery-dominated Edge pool)", () => {
  it("never returns an owned-dominated pool: discovery fully represented, owned bounded to the backlog tail", () => {
    // 20 owned candidates with the HIGHEST composites (the prod flood
    // driver) + 10 discovery candidates with lower composites.
    const scoredById = new Map<number, ScoredCandidate>();
    const mmrInput: MMRItem<number>[] = [];
    const emb = ortho(30);
    for (let i = 0; i < 20; i++) {
      const id = i + 1; // 1..20 owned
      scoredById.set(id, sc(id, 0.9 - i * 0.01, true));
      mmrInput.push({ id, score: 0.9 - i * 0.01, embedding: emb(i) });
    }
    for (let i = 0; i < 10; i++) {
      const id = 100 + i; // 100..109 discovery
      scoredById.set(id, sc(id, 0.5 - i * 0.01, false));
      mmrInput.push({ id, score: 0.5 - i * 0.01, embedding: emb(20 + i) });
    }

    const out = refinementEdgeCandidateIds(mmrInput, scoredById, zeroSim, {
      discoveryTopN: 40,
      backlogTopK: 6,
    });

    const ownedInOut = out.filter((id) => scoredById.get(id)?.inLibrary);
    const discoveryInOut = out.filter(
      (id) => scoredById.get(id) && !scoredById.get(id)!.inLibrary,
    );

    // Owned ids are bounded by backlogTopK — the Edge can no longer be
    // handed an owned-dominated set. Pre-fix (applyMMR over the full
    // mmrInput) this would be ~20.
    expect(ownedInOut.length).toBeLessThanOrEqual(6);
    // Every discovery candidate is represented (10 ≤ discoveryTopN).
    expect(discoveryInOut.length).toBe(10);
    // Discovery must DOMINATE the pool — never owned-heavy.
    expect(discoveryInOut.length).toBeGreaterThan(ownedInOut.length);
    // The bounded owned ids are all genuine library candidates.
    for (const id of ownedInOut) {
      expect(scoredById.get(id)?.inLibrary).toBe(true);
    }

    // Discriminator vs the pre-fix logic: the OLD pool (MMR over the FULL
    // mmrInput) contains ALL 20 owned — model it and prove the contract
    // it violates is exactly the one the helper now satisfies.
    const preFixPool = mmrInput.map((m) => m.id); // applyMMR keeps membership; topN≥30
    const ownedPreFix = preFixPool.filter(
      (id) => scoredById.get(id)?.inLibrary,
    );
    expect(ownedPreFix.length).toBe(20); // pre-fix: owned-flooded
    expect(ownedInOut.length).toBeLessThan(ownedPreFix.length); // fixed: bounded
  });

  it("keeps the Backlog slot fillable: owned tail present even when discovery is plentiful", () => {
    const scoredById = new Map<number, ScoredCandidate>();
    const mmrInput: MMRItem<number>[] = [];
    const emb = ortho(50);
    for (let i = 0; i < 40; i++) {
      const id = 100 + i;
      scoredById.set(id, sc(id, 0.6 - i * 0.001, false));
      mmrInput.push({ id, score: 0.6 - i * 0.001, embedding: emb(i) });
    }
    for (let i = 0; i < 3; i++) {
      const id = i + 1;
      scoredById.set(id, sc(id, 0.95 - i * 0.01, true));
      mmrInput.push({ id, score: 0.95 - i * 0.01, embedding: emb(40 + i) });
    }
    const out = refinementEdgeCandidateIds(mmrInput, scoredById, zeroSim);
    const owned = out.filter((id) => scoredById.get(id)?.inLibrary);
    // At least one owned candidate survives so assignBuckets' Backlog slot
    // (inLibrary-only) is reachable on the refinement path.
    expect(owned.length).toBeGreaterThanOrEqual(1);
    expect(owned.length).toBeLessThanOrEqual(3);
  });
});

describe("assembleRefinedFresh (#2 — assignBuckets placement is authoritative)", () => {
  type Row = {
    id: string;
    gameId: number;
    score: string;
    reason: string | null;
    algorithm: "ai";
    slot: "comfort" | "backlog" | "friends" | "wildcard";
  };
  const row = (gameId: number): Row => ({
    id: `rec-${gameId}`,
    gameId,
    score: (0.9 - gameId * 0.05).toFixed(4),
    reason: `Pick ${gameId}`,
    algorithm: "ai",
    slot: "comfort", // schema default — the pre-fix fallback value
  });

  it("drops Edge picks assignBuckets refused (owned) — never default-renders them as comfort", () => {
    // The Edge returned 6 OWNED picks (the #1 pool defect upstream). The
    // fixed assignBuckets, fed 6 owned ScoredCandidates, places exactly ONE
    // (Backlog) and refuses the rest (comfort/friends/wildcard are
    // discovery-only). assembleRefinedFresh must yield EXACTLY that one row.
    const picked: Row[] = [1, 2, 3, 4, 5, 6].map(row);
    const finalBucketed = [{ gameId: 1, slot: "backlog" as const }];

    const fresh = assembleRefinedFresh(picked, finalBucketed);

    expect(fresh).toHaveLength(1);
    expect(fresh[0].gameId).toBe(1);
    expect(fresh[0].slot).toBe("backlog");
    // No game absent from finalBucketed may appear.
    for (const f of fresh) {
      expect(finalBucketed.some((b) => b.gameId === f.gameId)).toBe(true);
    }

    // Discriminator vs the pre-fix inline expression: model it and prove it
    // produced the buggy all-6 grid (1 backlog + 5 default-'comfort') that
    // the user saw, while the helper produces 1.
    const slotByFinalPick = new Map(
      finalBucketed.map((b) => [b.gameId, b.slot]),
    );
    const preFix = picked.map((p) => ({
      ...p,
      slot: slotByFinalPick.get(p.gameId) ?? p.slot,
    }));
    expect(preFix).toHaveLength(6); // pre-fix: 6 rendered
    expect(preFix.filter((r) => r.slot === "comfort")).toHaveLength(5); // 5 owned shown as comfort
    expect(fresh.length).toBeLessThan(preFix.length); // fixed: refused picks dropped
  });

  it("preserves picked (score-desc) order and applies the canonical slot for placed games", () => {
    const picked: Row[] = [10, 20, 30, 40, 50, 60].map(row);
    const finalBucketed = [
      { gameId: 40, slot: "backlog" as const },
      { gameId: 10, slot: "comfort" as const },
      { gameId: 20, slot: "friends" as const },
      { gameId: 30, slot: "comfort" as const },
      { gameId: 60, slot: "wildcard" as const },
      { gameId: 50, slot: "comfort" as const },
    ];
    const fresh = assembleRefinedFresh(picked, finalBucketed);
    // All 6 placed → all 6 kept, in picked order (10,20,30,40,50,60).
    expect(fresh.map((f) => f.gameId)).toEqual([10, 20, 30, 40, 50, 60]);
    // Canonical slots applied.
    expect(fresh.find((f) => f.gameId === 40)?.slot).toBe("backlog");
    expect(fresh.find((f) => f.gameId === 20)?.slot).toBe("friends");
    expect(fresh.find((f) => f.gameId === 60)?.slot).toBe("wildcard");
    // Non-slot fields preserved by the spread.
    expect(fresh.find((f) => f.gameId === 10)?.id).toBe("rec-10");
  });

  it("returns an empty grid (not owned-padding) when assignBuckets placed nothing", () => {
    const picked: Row[] = [1, 2, 3].map(row);
    const fresh = assembleRefinedFresh(picked, []);
    expect(fresh).toHaveLength(0);
  });
});
