import type { ScoredCandidate } from "@/lib/recs/buckets";
import { applyMMR, type MMRItem } from "@/lib/recs/diversity-mmr";

/**
 * Refinement-path Edge candidate pool + final-grid assembly.
 *
 * Both functions exist because the refinement path bypassed the
 * Backlog-only-owned partition (`buckets.ts` INVARIANT) two ways, flooding
 * heavy-backlog users' refined grids with games they already own (prod
 * 2026-05-17, follow-up to PR #20):
 *
 *  - `refinementEdgeCandidateIds`: the Edge pool was an MMR over ALL scored
 *    candidates. Owned games dominate `composite` (they ARE the taste vector
 *    + the live libraryBonus), so the pool — and thus the AI's picks — were
 *    owned-heavy. This builds a discovery-DOMINATED pool with only a bounded
 *    owned tail so the Backlog slot stays fillable.
 *
 *  - `assembleRefinedFresh`: the path rendered every Edge pick, defaulting
 *    assignBuckets-refused picks to schema slot 'comfort'. This makes
 *    assignBuckets' placement authoritative — refused (owned) picks are
 *    dropped, never default-rendered.
 */

const REFINEMENT_DISCOVERY_TOP_N = 40;
// Enough owned candidates that the AI has a real Backlog choice, small
// enough that they can't dominate a ≥discoveryTopN discovery pool.
const REFINEMENT_BACKLOG_TOP_K = 6;

export function refinementEdgeCandidateIds(
  mmrInput: MMRItem<number>[],
  scoredById: Map<number, ScoredCandidate>,
  similarity: (a: number[], b: number[]) => number,
  opts?: { discoveryTopN?: number; backlogTopK?: number },
): number[] {
  const discoveryTopN = opts?.discoveryTopN ?? REFINEMENT_DISCOVERY_TOP_N;
  const backlogTopK = opts?.backlogTopK ?? REFINEMENT_BACKLOG_TOP_K;

  const discoveryInput = mmrInput.filter(
    (m) => !scoredById.get(m.id)?.inLibrary,
  );
  const discoveryIds = applyMMR(discoveryInput, {
    lambda: 0.7,
    topN: discoveryTopN,
    similarity,
  }).map((m) => m.id);

  // The discovery pool can never satisfy assignBuckets' inLibrary-only
  // Backlog slot, so append the top-K owned candidates by composite. Bounded
  // so the Edge can't be handed an owned-dominated set (the refinement
  // flood). Deterministic: composite desc, gameId asc tiebreak.
  const backlogIds = [...scoredById.values()]
    .filter((s) => s.inLibrary)
    .sort((a, b) =>
      b.composite !== a.composite
        ? b.composite - a.composite
        : a.gameId - b.gameId,
    )
    .slice(0, backlogTopK)
    .map((s) => s.gameId);

  return [...discoveryIds, ...backlogIds];
}

/**
 * Build the refined grid from assignBuckets' authoritative placement.
 * Iterates `picked` so the served order stays the Edge's score-desc order;
 * only games assignBuckets actually placed are kept, each carrying the
 * canonical slot. A pick assignBuckets refused (an owned game it would not
 * put in comfort/friends/wildcard) is DROPPED — never default-rendered. If
 * that yields <6 the grid is legitimately thin (accepted thin-pool
 * degradation), never padded with owned games.
 */
export function assembleRefinedFresh<
  TRow extends {
    gameId: number;
    slot: "comfort" | "backlog" | "friends" | "wildcard";
  },
>(
  picked: TRow[],
  finalBucketed: ReadonlyArray<{ gameId: number; slot: TRow["slot"] }>,
): TRow[] {
  const slotByGameId = new Map(
    finalBucketed.map((b) => [b.gameId, b.slot]),
  );
  const out: TRow[] = [];
  for (const p of picked) {
    const slot = slotByGameId.get(p.gameId);
    if (slot !== undefined) out.push({ ...p, slot });
  }
  return out;
}
