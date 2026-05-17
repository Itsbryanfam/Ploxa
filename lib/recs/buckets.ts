import { pickWildcard, type WildcardCandidate } from "@/lib/recs/wildcard";

export type ScoredCandidate = {
  gameId: number;
  composite: number;
  inLibrary: boolean;
  socialScore: number; // 0..1
  genres: string[];
};

export type BucketedCandidate = ScoredCandidate & {
  slot: "comfort" | "backlog" | "friends" | "wildcard";
};

// PRECONDITION: `exploredGenres` members and `genreFrequency` keys MUST be
// lowercased by the caller — forwarded as-is into pickWildcard, which
// lowercases candidate genres for comparison. games.genres is mixed-case
// (RAWG/IGDB); a mixed-case Set/Map silently breaks the wildcard slot.
type AssignOpts = {
  exploredGenres: Set<string>;
  genreFrequency?: Map<string, number>;
  seed?: number;
  minBackingThreshold?: number; // floor for backlog/friends slots
};

const SLOT_TARGETS = { comfort: 3, backlog: 1, friends: 1, wildcard: 1 } as const;
// Derive the grid size from SLOT_TARGETS so a re-tune can't silently desync
// the demotion cap from the slot budget (cf. the SCORE_WEIGHTS sum guard).
export const GRID_SIZE =
  SLOT_TARGETS.comfort + SLOT_TARGETS.backlog + SLOT_TARGETS.friends + SLOT_TARGETS.wildcard;
const BACKING_FLOOR = 0.5;

/**
 * Stratifies scored candidates into the 6-card grid (3 Comfort + Backlog +
 * Friends + Wildcard, with graceful demotion). Returned `BucketedCandidate`s
 * shallow-copy the input and SHARE the `genres` array by reference — callers
 * (Task 12) must treat returned candidates as read-only.
 *
 * INVARIANT: the Backlog slot is the ONLY slot that may hold an `inLibrary`
 * candidate. Comfort, Friends, Wildcard, and demotion-fill select from the
 * discovery set (`!inLibrary`) exclusively. This is load-bearing, not
 * cosmetic: for a user whose logs are mostly `backlog`/`wishlist`/`on_hold`,
 * the backlog lane feeds the SAME scored array as discovery, and those owned
 * games dominate `composite` (they ARE the taste vector + the live
 * libraryBonus). Without this guard the top-composite tail floods Comfort +
 * Wildcard with games the user already owns (prod regression 2026-05-17 — a
 * 176-backlog account saw entire 6-card grids of owned games). server-
 * actions.ts documents this contract ("ONLY the Backlog slot consumes
 * inLibrary — no leak into Comfort/Wildcard"); enforce it HERE.
 */
export function assignBuckets(
  candidates: ScoredCandidate[],
  opts: AssignOpts,
): BucketedCandidate[] {
  if (candidates.length === 0) return [];
  const floor = opts.minBackingThreshold ?? BACKING_FLOOR;
  const sorted = [...candidates].sort((a, b) => b.composite - a.composite);
  const used = new Set<number>();
  const out: BucketedCandidate[] = [];

  // 1. Backlog — highest-scored library candidate above floor.
  // Reserved FIRST so a top-composite inLibrary game wins its special slot
  // instead of being consumed by the Comfort tier (Task 4 fix).
  // Backlog before Friends: an inLibrary+social game prefers its Backlog rail.
  const backlog = sorted.find(
    (c) => !used.has(c.gameId) && c.inLibrary && c.composite >= floor,
  );
  if (backlog) {
    out.push({ ...backlog, slot: "backlog" });
    used.add(backlog.gameId);
  }

  // 2. Friends — highest-scored social>0 DISCOVERY candidate above floor.
  // Reserved before Comfort for the same reason (Task 4 fix). `!inLibrary`:
  // an owned game with a friend signal belongs to the Backlog slot, not a
  // second owned card here (see the INVARIANT in the doc comment).
  const friends = sorted.find(
    (c) =>
      !used.has(c.gameId) &&
      !c.inLibrary &&
      c.socialScore > 0 &&
      c.composite >= floor,
  );
  if (friends) {
    out.push({ ...friends, slot: "friends" });
    used.add(friends.gameId);
  }

  // 3. Wildcard — unexplored cluster sample (reserved before Comfort fill).
  // Discovery-only (`!inLibrary`): the wildcard is a "try something new"
  // surprise, which a game already in the user's library can't be.
  const wcInput: WildcardCandidate[] = sorted
    .filter((c) => !used.has(c.gameId) && !c.inLibrary)
    .map((c) => ({ gameId: c.gameId, composite: c.composite, genres: c.genres }));
  const wcPick = pickWildcard(wcInput, {
    exploredGenres: opts.exploredGenres,
    genreFrequency: opts.genreFrequency,
    seed: opts.seed,
  });
  if (wcPick) {
    const full = sorted.find((c) => c.gameId === wcPick.gameId);
    if (full) {
      out.push({ ...full, slot: "wildcard" });
      used.add(full.gameId);
    }
  }

  // 4. Comfort — top remaining DISCOVERY candidates by composite (NOT
  // floor-gated: Comfort is the guaranteed-fill tier for graceful fill even
  // below floor). `!inLibrary`: owned games are confined to the Backlog slot
  // (see the INVARIANT) — skip them here even though they may out-score every
  // discovery row.
  let comfortCount = 0;
  for (const c of sorted) {
    if (comfortCount >= SLOT_TARGETS.comfort) break;
    if (used.has(c.gameId)) continue;
    if (c.inLibrary) continue;
    out.push({ ...c, slot: "comfort" });
    used.add(c.gameId);
    comfortCount++;
  }

  // 5. Demote empty slots to extra Comfort (fires when a special is absent).
  // Still discovery-only — demotion must not become an inLibrary backdoor
  // (that is exactly how the 2026-05-17 flood filled the grid). If discovery
  // is exhausted the grid legitimately returns <6 (by-design thin-pool
  // degradation) rather than padding with owned games.
  while (out.length < GRID_SIZE) {
    const next = sorted.find((c) => !used.has(c.gameId) && !c.inLibrary);
    if (!next) break;
    out.push({ ...next, slot: "comfort" });
    used.add(next.gameId);
  }

  return out;
}
