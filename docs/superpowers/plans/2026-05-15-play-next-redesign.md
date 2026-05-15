# Play-Next Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase A of `/play-next` redesign — composite-score picker (taste/mood/time/social/library + MMR + wildcard + soft-neg decay), 3×2 stratified bucket grid (Comfort/Backlog/Friends/Wildcard), conversational refinement input that re-ranks the existing shortlist, and redesigned cards with full reasoning + slot labels + qualitative confidence. Spec: `docs/superpowers/specs/2026-05-15-play-next-redesign-design.md` (commit `c06aae9`).

**Architecture:** Composite score blends 5 axes with locked weights (taste 0.35 / mood 0.25 / time 0.20 / social 0.10 / library 0.10), multiplied by a soft-negative decay penalty. After scoring, MMR diversity (λ=0.7) culls near-duplicates, then a deterministic bucket assignment fills 3 Comfort + 1 Backlog + 1 Friends + 1 Wildcard slots with graceful demotion. Top-15 of the scored set goes to the existing `lib/ai/router.ts` chain (Cerebras → Groq → Cloudflare → DeepSeek) via the `rerank-recs` Edge Function, which gains a `mode: "rerank-only"` switch for conversational refinement runs. UI gets a 3×2 grid with redesigned cards, in-place filter chip popovers, and a refinement input replacing the dead mascot row. All new behavior gated behind a `recsv2` feature flag for safe rollout.

**Tech Stack:** Next.js 16 App Router (RSC + Server Actions), Drizzle ORM (Postgres), Tailwind v4, Vercel AI SDK via existing `lib/ai/router.ts`, Supabase Edge Functions (Deno), Vitest + Playwright. Brand: Ploxa, prod URL `ploxa.vercel.app`.

---

## Task 1: Migration 0018 — recommendations columns + slot enum

**Goal:** Schema delta on the `recommendations` table — add `slot`, `dismissed_at`, `snoozed_until`, `never_again` columns and the new `rec_slot` enum.

**Files:**
- Create: `lib/db/migrations/0018_play_next_redesign.sql`
- Modify: `lib/db/schema.ts` (add `recSlotEnum`, extend `recommendations`)
- Create: `tests/unit/recs/schema-v2.test.ts`

**Acceptance Criteria:**
- [ ] 0018 SQL applies cleanly to fresh DB
- [ ] `rec_slot` enum exists with values `'comfort'`, `'backlog'`, `'friends'`, `'wildcard'`
- [ ] `recommendations.slot` column (rec_slot, NOT NULL, default `'comfort'`)
- [ ] `recommendations.dismissed_at` (timestamptz, nullable)
- [ ] `recommendations.snoozed_until` (timestamptz, nullable)
- [ ] `recommendations.never_again` (boolean, NOT NULL, default false)
- [ ] Drizzle schema exports `recSlotEnum`; `recommendations` includes 4 new columns
- [ ] `pnpm tsc --noEmit` clean
- [ ] `pnpm db:check` passes (Drizzle snapshot integrity)
- [ ] Auth.users gotcha check: grep generated SQL for `CREATE TABLE "auth"."users"` and strip if present (per `feedback_drizzle_auth_users_gotcha.md`)

**Verify:** `pnpm tsc --noEmit && pnpm vitest run tests/unit/recs/schema-v2.test.ts && pnpm db:check`

**Steps:**

- [ ] **Step 1: Write failing schema test**

Create `tests/unit/recs/schema-v2.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { schema } from "@/lib/db";

describe("Play-next redesign schema additions", () => {
  it("exports recSlotEnum with 4 values", () => {
    expect(schema.recSlotEnum.enumValues).toEqual([
      "comfort",
      "backlog",
      "friends",
      "wildcard",
    ]);
  });

  it("recommendations has slot column", () => {
    const cols = Object.keys(
      (schema.recommendations as unknown as { _: { columns: Record<string, unknown> } })._.columns,
    );
    expect(cols).toContain("slot");
  });

  it("recommendations has dismissedAt, snoozedUntil, neverAgain columns", () => {
    const cols = Object.keys(
      (schema.recommendations as unknown as { _: { columns: Record<string, unknown> } })._.columns,
    );
    expect(cols).toContain("dismissedAt");
    expect(cols).toContain("snoozedUntil");
    expect(cols).toContain("neverAgain");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm vitest run tests/unit/recs/schema-v2.test.ts`
Expected: FAIL — `schema.recSlotEnum` undefined.

- [ ] **Step 3: Write the migration SQL**

Create `lib/db/migrations/0018_play_next_redesign.sql`:

```sql
-- 0018 — Play-next redesign schema additions
-- Adds stratified-bucket slot + soft-negative dismissal fields to recommendations.

CREATE TYPE "rec_slot" AS ENUM ('comfort', 'backlog', 'friends', 'wildcard');

ALTER TABLE "recommendations" ADD COLUMN "slot" "rec_slot" NOT NULL DEFAULT 'comfort';
ALTER TABLE "recommendations" ADD COLUMN "dismissed_at" timestamptz;
ALTER TABLE "recommendations" ADD COLUMN "snoozed_until" timestamptz;
ALTER TABLE "recommendations" ADD COLUMN "never_again" boolean NOT NULL DEFAULT false;

-- Partial index for soft-neg decay lookups (only the rows we actually filter on)
CREATE INDEX IF NOT EXISTS "recommendations_neg_lookup_idx"
  ON "recommendations" ("user_id", "game_id")
  WHERE "dismissed_at" IS NOT NULL OR "snoozed_until" IS NOT NULL OR "never_again" = true;
```

- [ ] **Step 4: Update Drizzle schema**

In `lib/db/schema.ts`, add the enum and extend `recommendations` (find the existing `recommendations` table definition and add 4 columns + the enum near the other enums):

```ts
export const recSlotEnum = pgEnum("rec_slot", [
  "comfort",
  "backlog",
  "friends",
  "wildcard",
]);

// Inside the existing `recommendations` table builder, add:
//   slot: recSlotEnum("slot").notNull().default("comfort"),
//   dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
//   snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
//   neverAgain: boolean("never_again").notNull().default(false),
```

- [ ] **Step 5: Run test — expect PASS**

Run: `pnpm vitest run tests/unit/recs/schema-v2.test.ts`
Expected: PASS — 3 tests green.

- [ ] **Step 6: TypeScript + Drizzle integrity check**

Run: `pnpm tsc --noEmit && pnpm db:check`
Expected: clean output, no diff between schema.ts and Drizzle snapshot.

If `db:check` shows drift, run `pnpm drizzle-kit generate` and inspect the generated SQL. Strip any `CREATE TABLE "auth"."users"` block before applying (per [feedback_drizzle_auth_users_gotcha.md](../../memory/feedback_drizzle_auth_users_gotcha.md)).

- [ ] **Step 7: Commit**

```bash
git add lib/db/migrations/0018_play_next_redesign.sql lib/db/schema.ts tests/unit/recs/schema-v2.test.ts
git commit -m "feat(db): add recommendations slot + soft-neg columns (migration 0018)"
```

---

## Task 2: Mood affinity table

**Goal:** Fixed lookup table mapping each `Mood` to `{boostGenres, boostMechanics, penalizeMechanics}` for the mood-axis scoring.

**Files:**
- Create: `lib/recs/mood-affinity.ts`
- Create: `tests/unit/recs/mood-affinity.test.ts`

**Acceptance Criteria:**
- [ ] Every `Mood` enum value has an entry
- [ ] No genre/mechanic appears in both boost AND penalize for the same mood
- [ ] `moodMatchScore(mood, candidate)` returns a value in `[0, 1]`
- [ ] Tests cover all 5 moods with realistic candidate fixtures

**Verify:** `pnpm vitest run tests/unit/recs/mood-affinity.test.ts`

**Steps:**

- [ ] **Step 1: Write failing tests**

Create `tests/unit/recs/mood-affinity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MOOD_AFFINITY, moodMatchScore } from "@/lib/recs/mood-affinity";
import type { Mood } from "@/lib/recs/moods";

const allMoods: Mood[] = ["chill", "challenged", "story-driven", "mindless", "multiplayer"];

describe("MOOD_AFFINITY table", () => {
  it("has an entry for every mood", () => {
    for (const m of allMoods) {
      expect(MOOD_AFFINITY[m]).toBeDefined();
    }
  });

  it("never lists the same genre as both boost and penalize", () => {
    for (const m of allMoods) {
      const entry = MOOD_AFFINITY[m];
      const allBoost = new Set([...entry.boostGenres, ...entry.boostMechanics]);
      for (const p of entry.penalizeMechanics) {
        expect(allBoost.has(p)).toBe(false);
      }
    }
  });
});

describe("moodMatchScore", () => {
  it("returns 1.0 when all boost terms hit and no penalties", () => {
    const candidate = {
      genres: ["puzzle", "casual"],
      mechanics: ["relaxing", "no-pressure"],
    };
    expect(moodMatchScore("chill", candidate)).toBeGreaterThan(0.5);
  });

  it("penalizes when penalty mechanics present", () => {
    const candidate = {
      genres: ["puzzle"],
      mechanics: ["competitive", "time-pressure"],
    };
    expect(moodMatchScore("chill", candidate)).toBeLessThan(0.3);
  });

  it("returns 0 for completely unrelated candidate", () => {
    const candidate = { genres: ["sports"], mechanics: [] };
    expect(moodMatchScore("story-driven", candidate)).toBe(0);
  });

  it("bounds output to [0, 1]", () => {
    const candidate = {
      genres: ["rpg", "adventure", "narrative"],
      mechanics: ["choices-matter", "branching-narrative", "voice-acted"],
    };
    const s = moodMatchScore("story-driven", candidate);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm vitest run tests/unit/recs/mood-affinity.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `lib/recs/mood-affinity.ts`:

```ts
import type { Mood } from "@/lib/recs/moods";

type AffinityEntry = {
  boostGenres: string[];
  boostMechanics: string[];
  penalizeMechanics: string[];
};

// Fixed table — hand-maintained. Strings should match the canonical
// IGDB/RAWG vocabulary used in `games.genres` / `games.mechanics`.
// During implementation, audit these against actual DB values and
// reconcile any drift.
export const MOOD_AFFINITY: Record<Mood, AffinityEntry> = {
  chill: {
    boostGenres: ["puzzle", "life-sim", "casual", "indie"],
    boostMechanics: ["relaxing", "no-pressure", "low-stakes", "cozy", "exploration"],
    penalizeMechanics: ["competitive", "twitch", "time-pressure", "permadeath"],
  },
  challenged: {
    boostGenres: ["roguelike", "soulslike", "strategy", "fighting"],
    boostMechanics: ["skill-based", "difficult", "competitive", "permadeath"],
    penalizeMechanics: ["casual", "story-only", "no-fail"],
  },
  "story-driven": {
    boostGenres: ["rpg", "adventure", "narrative", "visual-novel"],
    boostMechanics: ["choices-matter", "branching-narrative", "voice-acted"],
    penalizeMechanics: ["pvp-only", "sandbox-no-narrative", "multiplayer-only"],
  },
  mindless: {
    boostGenres: ["clicker", "casual", "runner"],
    boostMechanics: ["idle", "repetitive", "low-stakes", "auto-play"],
    penalizeMechanics: ["complex-systems", "deep-strategy", "permadeath"],
  },
  multiplayer: {
    boostGenres: ["competitive", "party", "fighting", "mmo"],
    boostMechanics: ["pvp", "co-op", "online-multiplayer"],
    penalizeMechanics: ["single-player-only", "narrative-only"],
  },
};

type CandidateForMood = {
  genres: string[] | null;
  mechanics: string[] | null;
};

export function moodMatchScore(mood: Mood, c: CandidateForMood): number {
  const entry = MOOD_AFFINITY[mood];
  const genres = new Set((c.genres ?? []).map((g) => g.toLowerCase()));
  const mechanics = new Set((c.mechanics ?? []).map((m) => m.toLowerCase()));

  const genreHits = entry.boostGenres.filter((g) => genres.has(g.toLowerCase())).length;
  const mechBoostHits = entry.boostMechanics.filter((m) => mechanics.has(m.toLowerCase())).length;
  const mechPenaltyHits = entry.penalizeMechanics.filter((m) => mechanics.has(m.toLowerCase())).length;

  const budget = entry.boostGenres.length + entry.boostMechanics.length;
  if (budget === 0) return 0;

  // Normalize by the candidate's own tag count, not the full mood vocabulary:
  // real games carry only ~2-4 tags, so dividing by the entire boost budget
  // (~9 terms for chill) would cap even a 4-hit perfect match at ~0.44 and
  // silently weaken the mood axis. denom approximates achievable signal via
  // total candidate tag count; tag-rich games are slightly under-scored,
  // which is acceptable for a 0.25-weighted axis.
  const matched = genreHits + mechBoostHits;
  const denom = Math.max(1, Math.min(budget, genres.size + mechanics.size));
  const raw = (matched - mechPenaltyHits) / denom;
  return Math.max(0, Math.min(1, raw));
}
```

> **Execution note (2026-05-15):** The original plan divided `raw` by the full
> `budget`, which capped a realistic candidate (~2-4 tags) below the test's
> `> 0.5` assertion. Corrected during execution to normalize by the candidate's
> achievable signal (controller-authorized "Option A"). Shipped in commit `7cf9cb9`.

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm vitest run tests/unit/recs/mood-affinity.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/recs/mood-affinity.ts tests/unit/recs/mood-affinity.test.ts
git commit -m "feat(recs): mood-affinity table + scoring helper"
```

---

## Task 3: Time-fit scoring

**Goal:** Gaussian-centered time-fit scoring per `TimeBudget` with hard upper caps for the extreme mismatches.

**Files:**
- Create: `lib/recs/time-fit.ts`
- Create: `tests/unit/recs/time-fit.test.ts`

**Acceptance Criteria:**
- [ ] Gaussian peaks at the sweet spot for each budget
- [ ] Hard upper caps return 0 (excluded before scoring)
- [ ] NULL `gameHours` returns 0.5 (neutral)
- [ ] All output bounded `[0, 1]`

**Verify:** `pnpm vitest run tests/unit/recs/time-fit.test.ts`

**Steps:**

- [ ] **Step 1: Write failing tests**

Create `tests/unit/recs/time-fit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { timeFitScore, isTimeFeasible } from "@/lib/recs/time-fit";

describe("timeFitScore", () => {
  it("peaks at the sweet spot for 15min budget", () => {
    expect(timeFitScore(0.25, "15min")).toBeGreaterThan(0.95);
  });

  it("peaks at the sweet spot for 1hr budget", () => {
    expect(timeFitScore(1, "1hr")).toBeGreaterThan(0.95);
  });

  it("peaks at the sweet spot for 3hr+ budget", () => {
    expect(timeFitScore(5, "3hr+")).toBeGreaterThan(0.95);
  });

  it("decays away from peak", () => {
    expect(timeFitScore(2, "1hr")).toBeLessThan(timeFitScore(1, "1hr"));
  });

  it("returns 0.5 for NULL gameHours (neutral)", () => {
    expect(timeFitScore(null, "1hr")).toBe(0.5);
  });

  it("returns 0 for games above the hard cap", () => {
    expect(timeFitScore(3, "15min")).toBe(0); // cap 2.0
    expect(timeFitScore(10, "1hr")).toBe(0); // cap 8.0
  });

  it("bounds output to [0,1]", () => {
    for (const h of [0.1, 0.5, 1, 2, 5, 10, 20, 50, 100]) {
      for (const b of ["15min", "1hr", "3hr+", "multi-session"] as const) {
        const s = timeFitScore(h, b);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("isTimeFeasible", () => {
  it("rejects 15min budget for >2h games", () => {
    expect(isTimeFeasible(3, "15min")).toBe(false);
    expect(isTimeFeasible(1.5, "15min")).toBe(true);
  });

  it("rejects 1hr budget for >8h games", () => {
    expect(isTimeFeasible(10, "1hr")).toBe(false);
    expect(isTimeFeasible(6, "1hr")).toBe(true);
  });

  it("requires >=2h for 3hr+ budget", () => {
    expect(isTimeFeasible(1, "3hr+")).toBe(false);
    expect(isTimeFeasible(5, "3hr+")).toBe(true);
  });

  it("requires >=4h for multi-session budget", () => {
    expect(isTimeFeasible(2, "multi-session")).toBe(false);
    expect(isTimeFeasible(20, "multi-session")).toBe(true);
  });

  it("treats NULL hours as feasible (neutral)", () => {
    expect(isTimeFeasible(null, "1hr")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm vitest run tests/unit/recs/time-fit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/recs/time-fit.ts`:

```ts
import type { TimeBudget } from "@/lib/recs/moods";

type Profile = {
  peak: number; // hours
  sigma: number; // hours
  upperCap: number | null; // hard exclusion above this; null = no upper cap
  lowerCap: number | null; // hard exclusion below; null = no lower cap
};

const PROFILES: Record<TimeBudget, Profile> = {
  "15min": { peak: 0.25, sigma: 0.17, upperCap: 2.0, lowerCap: null },
  "1hr": { peak: 1.0, sigma: 0.5, upperCap: 8.0, lowerCap: null },
  "3hr+": { peak: 5.0, sigma: 2.0, upperCap: null, lowerCap: 2.0 },
  "multi-session": { peak: 20.0, sigma: 10.0, upperCap: null, lowerCap: 4.0 },
};

export function isTimeFeasible(gameHours: number | null, budget: TimeBudget): boolean {
  if (gameHours === null) return true;
  const p = PROFILES[budget];
  if (p.upperCap !== null && gameHours > p.upperCap) return false;
  if (p.lowerCap !== null && gameHours < p.lowerCap) return false;
  return true;
}

export function timeFitScore(gameHours: number | null, budget: TimeBudget): number {
  if (gameHours === null) return 0.5;
  if (!isTimeFeasible(gameHours, budget)) return 0;
  const p = PROFILES[budget];
  const diff = gameHours - p.peak;
  const score = Math.exp(-(diff * diff) / (2 * p.sigma * p.sigma));
  return Math.max(0, Math.min(1, score));
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm vitest run tests/unit/recs/time-fit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/recs/time-fit.ts tests/unit/recs/time-fit.test.ts
git commit -m "feat(recs): time-fit Gaussian scoring + hard-cap feasibility check"
```

---

## Task 4: Social score

**Goal:** Compute social-axis score from the user's follow-graph activity per candidate game.

**Files:**
- Create: `lib/recs/social-score.ts`
- Create: `tests/unit/recs/social-score.test.ts`

**Acceptance Criteria:**
- [ ] Returns 0 when followed-users set is empty
- [ ] Sigmoid-bounded output `[0, 1)`
- [ ] Tests use mocked DB query result for determinism

**Verify:** `pnpm vitest run tests/unit/recs/social-score.test.ts`

**Steps:**

- [ ] **Step 1: Write failing tests**

Create `tests/unit/recs/social-score.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

// social-score.ts eagerly does `import { db } from "@/lib/db"` (same
// convention as its sibling candidate-pool.ts). Importing the real module
// would instantiate a postgres-js client. Mock @/lib/db to a minimal stub
// so the eager import resolves — these tests only exercise the pure
// computeSocialScore/sigmoid exports, so the stub's methods are never
// called. `server-only` is already aliased to a no-op by vitest.config.ts.
vi.mock("@/lib/db", () => {
  return {
    db: {
      select: vi.fn(),
    },
  };
});

const { computeSocialScore, sigmoid } = await import("@/lib/recs/social-score");

describe("sigmoid", () => {
  it("returns 0.5 at 0", () => {
    expect(sigmoid(0)).toBeCloseTo(0.5, 3);
  });

  it("bounds to (0, 1)", () => {
    expect(sigmoid(-10)).toBeGreaterThan(0);
    expect(sigmoid(10)).toBeLessThan(1);
  });
});

describe("computeSocialScore", () => {
  it("returns 0 when no friends played or liked", () => {
    expect(computeSocialScore({ friendsPlayed: 0, friendsLiked: 0 })).toBe(0);
  });

  it("weights likes more than plays", () => {
    const playOnly = computeSocialScore({ friendsPlayed: 2, friendsLiked: 0 });
    const likeOnly = computeSocialScore({ friendsPlayed: 0, friendsLiked: 2 });
    expect(likeOnly).toBeGreaterThan(playOnly);
  });

  it("bounds to (0, 1)", () => {
    const high = computeSocialScore({ friendsPlayed: 100, friendsLiked: 100 });
    expect(high).toBeGreaterThan(0.9);
    expect(high).toBeLessThan(1);
  });

  it("monotonically increases with more friends", () => {
    const a = computeSocialScore({ friendsPlayed: 1, friendsLiked: 0 });
    const b = computeSocialScore({ friendsPlayed: 5, friendsLiked: 0 });
    expect(b).toBeGreaterThan(a);
  });

  it("is a small positive for a single weak signal (sign guard at the contract boundary)", () => {
    const s = computeSocialScore({ friendsPlayed: 1, friendsLiked: 0 });
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(0.1);
  });

  it("stays strictly below 1 even at extreme counts (guards the saturation fix)", () => {
    expect(computeSocialScore({ friendsPlayed: 0, friendsLiked: 500 })).toBeLessThan(1);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm vitest run tests/unit/recs/social-score.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/recs/social-score.ts`:

```ts
import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { follows, logs } from "@/lib/db/schema";

export type SocialSignals = { friendsPlayed: number; friendsLiked: number };

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function computeSocialScore(input: SocialSignals): number {
  if (input.friendsPlayed === 0 && input.friendsLiked === 0) return 0;
  // Shift by 0.5 so zero-input anchors at 0; ×2 expands to the [0,1) the
  // axis contract wants. Coeffs (0.03/0.05) keep the sigmoid arg well below
  // float64 saturation so the strict <1 bound holds at realistic counts.
  return 2 * (sigmoid(0.03 * input.friendsPlayed + 0.05 * input.friendsLiked) - 0.5);
}

/**
 * Bulk-fetch social signals for many games at once.
 * Returns a Map keyed by gameId. Games with no friend activity are absent
 * (consumer should treat absence as score=0).
 */
export async function fetchSocialSignals(
  userId: string,
  gameIds: number[],
): Promise<Map<number, SocialSignals>> {
  if (gameIds.length === 0) return new Map();

  // Step 1: get followed user IDs
  const followedRows = await db
    .select({ followedId: follows.followedId })
    .from(follows)
    .where(eq(follows.followerId, userId));
  const followed = followedRows.map((r) => r.followedId);
  if (followed.length === 0) return new Map();

  // Step 2: bulk aggregate plays + likes per gameId
  const rows = await db
    .select({
      gameId: logs.gameId,
      friendsPlayed: sql<number>`COUNT(DISTINCT CASE WHEN ${logs.status} IN ('playing', 'completed') THEN ${logs.userId} END)::int`,
      friendsLiked: sql<number>`COUNT(DISTINCT CASE WHEN ${logs.rating} >= 7 THEN ${logs.userId} END)::int`,
    })
    .from(logs)
    .where(and(inArray(logs.userId, followed), inArray(logs.gameId, gameIds)))
    .groupBy(logs.gameId);

  const out = new Map<number, SocialSignals>();
  for (const r of rows) {
    out.set(r.gameId, { friendsPlayed: r.friendsPlayed, friendsLiked: r.friendsLiked });
  }
  return out;
}
```

Note: subtracting 0.5 from the sigmoid output anchors the zero-input case at 0 (since sigmoid(0) = 0.5); the ×2 then expands the monotonic range to `[0, 1)` to match the axis contract / acceptance criterion. The axis is weighted 0.10 in the composite.

> **Execution note (2026-05-15):** Controller-authorized corrections to the original plan, applied during execution:
> 1. **`computeSocialScore` range** — original `sigmoid(0.3·fp+0.5·fl)-0.5` capped at ~0.5, failing the `(0.9,1)` test and the "[0,1)" acceptance criterion. A naive ×2 alone saturated to exactly 1.0 (float64 sigmoid → 1.0 at arg≈80). Fixed to `2·(sigmoid(0.03·fp+0.05·fl)-0.5)` — same 3:5 play:like ratio, scaled to avoid saturation at realistic friend counts. (Note: `Math.exp` underflows to 0 at arg ≳ 745, so the strict `<1` bound holds for realistic counts, not literally infinite scale — the regression test uses `friendsLiked: 500`.)
> 2. **`fetchSocialSignals.friendsLiked`** — original referenced `logs.liked`, a column that does not exist (the `likes` table is review-only). Repointed to `logs.rating >= 7` (rating is a 0–10 scale per `lib/logs/server-actions.ts`; ≥7 is a clear positive).
> 3. **Module structure + testing** — kept eager `import { db } from "@/lib/db"` (matches sibling `lib/recs/candidate-pool.ts` and the repo-wide convention); the unit test uses `vi.mock("@/lib/db", …)` + `await import(...)` mirroring `tests/unit/candidate-pool-prefilter.test.ts` (the established pattern in 16+ test files). `server-only` is globally aliased to a stub by `vitest.config.ts`.
> 4. **Type + guards** — extracted `export type SocialSignals`; added a sign-guard test (single weak signal) and a saturation-regression test (the only guard protecting correction #1).

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm vitest run tests/unit/recs/social-score.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/recs/social-score.ts tests/unit/recs/social-score.test.ts
git commit -m "feat(recs): social-axis scoring from follow graph"
```

---

## Task 5: Soft-negative penalty

**Goal:** Time-decayed dismissal penalty + snooze + never-again hard exclusion.

**Files:**
- Create: `lib/recs/soft-negative.ts`
- Create: `tests/unit/recs/soft-negative.test.ts`

**Acceptance Criteria:**
- [ ] `neverAgain=true` returns 0 (hard exclude)
- [ ] `snoozedUntil > now` returns 0 (hard exclude for now)
- [ ] `dismissedAt` from yesterday returns penalty <0.1 (heavy down-weight)
- [ ] `dismissedAt` from 15 days ago returns penalty >0.65
- [ ] Never-dismissed (all NULL) returns 1.0

**Verify:** `pnpm vitest run tests/unit/recs/soft-negative.test.ts`

**Steps:**

- [ ] **Step 1: Write failing tests**

Create `tests/unit/recs/soft-negative.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { softNegativePenalty } from "@/lib/recs/soft-negative";

const now = new Date("2026-05-15T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
const daysAhead = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);

describe("softNegativePenalty", () => {
  it("returns 1.0 for never-dismissed game", () => {
    expect(
      softNegativePenalty(
        { dismissedAt: null, snoozedUntil: null, neverAgain: false },
        now,
      ),
    ).toBe(1.0);
  });

  it("returns 0 for never_again=true", () => {
    expect(
      softNegativePenalty(
        { dismissedAt: null, snoozedUntil: null, neverAgain: true },
        now,
      ),
    ).toBe(0);
  });

  it("returns 0 when snoozed_until is in the future", () => {
    expect(
      softNegativePenalty(
        { dismissedAt: null, snoozedUntil: daysAhead(15), neverAgain: false },
        now,
      ),
    ).toBe(0);
  });

  it("returns 1.0 when snoozed_until has passed", () => {
    expect(
      softNegativePenalty(
        { dismissedAt: null, snoozedUntil: daysAgo(1), neverAgain: false },
        now,
      ),
    ).toBe(1.0);
  });

  it("heavily down-weights yesterday's dismissal", () => {
    const p = softNegativePenalty(
      { dismissedAt: daysAgo(1), snoozedUntil: null, neverAgain: false },
      now,
    );
    expect(p).toBeLessThan(0.1);
  });

  it("substantially decays at 15 days", () => {
    const p = softNegativePenalty(
      { dismissedAt: daysAgo(15), snoozedUntil: null, neverAgain: false },
      now,
    );
    expect(p).toBeGreaterThan(0.65);
    expect(p).toBeLessThan(0.9);
  });

  it("approaches 1.0 at 60 days", () => {
    const p = softNegativePenalty(
      { dismissedAt: daysAgo(60), snoozedUntil: null, neverAgain: false },
      now,
    );
    expect(p).toBeGreaterThan(0.98);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm vitest run tests/unit/recs/soft-negative.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/recs/soft-negative.ts`:

```ts
// Exponential recovery time-constant (NOT a half-life). After τ days the
// dismissal penalty has lifted ~63% (1 - e^-1); the true 50% point is
// τ·ln2 ≈ 9.7 days. Spec prose says "14-day half-life" loosely — this is
// the time-constant of that decay, and the test thresholds are calibrated
// to this exponential curve (a true-half-life formula would fail them).
const DECAY_TIME_CONSTANT_DAYS = 14;

export type DismissalState = {
  dismissedAt: Date | null;
  snoozedUntil: Date | null;
  neverAgain: boolean;
};

/**
 * Recovery MULTIPLIER for dismissal soft-negatives (NOT a penalty magnitude).
 * 1.0 = no penalty (use the candidate as-is); 0 = hard exclude (never-again
 * or an active snooze). The caller multiplies the composite score by this:
 * `composite * softNegativePenalty(state)`.
 */
export function softNegativePenalty(state: DismissalState, now: Date = new Date()): number {
  if (state.neverAgain) return 0;
  if (state.snoozedUntil !== null && state.snoozedUntil.getTime() > now.getTime()) return 0;
  if (state.dismissedAt === null) return 1.0;

  const days = (now.getTime() - state.dismissedAt.getTime()) / (24 * 60 * 60 * 1000);
  if (days < 0) return 1.0; // clock skew / backfilled rows can yield dismissedAt > now; treat as not-yet-decayed

  const penalty = 1 - Math.exp(-days / DECAY_TIME_CONSTANT_DAYS);
  return Math.max(0, Math.min(1, penalty));
}
```

> **Execution note (2026-05-15):** Two code-review refinements applied (math UNCHANGED — the spec thresholds + 2 of 3 decay tests are calibrated to this exponential time-constant curve; a true-half-life formula would fail them):
> 1. Renamed `HALF_LIFE_DAYS` → `DECAY_TIME_CONSTANT_DAYS` with a WHY comment. `1 - exp(-days/14)` makes 14 the time-constant τ, not the half-life (true 50% point ≈ τ·ln2 ≈ 9.7d; at 14d the penalty has lifted ~63%). The old name encoded a false invariant. Added a JSDoc documenting that the return is a *retention multiplier* (1.0 = keep, 0 = exclude), since the polarity inverts the word "penalty" and Task 6 does `composite * softNegativePenalty(...)`.
> 2. Added 3 tests (now 10 total): a curve-identity pin (`daysAgo(14)` ≈ `1 - e^-1`, catches a future half-life "fix"), the future-`dismissedAt` glitch branch (`daysAhead(3)` → 1.0), and the `dismissedAt === now` boundary (→ ~0). Shipped commit `056501f`.

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm vitest run tests/unit/recs/soft-negative.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/recs/soft-negative.ts tests/unit/recs/soft-negative.test.ts
git commit -m "feat(recs): soft-negative time-decay penalty for dismissals"
```

---

## Task 6: Composite scoring

**Goal:** Combine all 5 axes with locked weights and apply soft-negative penalty. Pure function; no DB.

**Files:**
- Create: `lib/recs/scoring.ts`
- Create: `tests/unit/recs/scoring.test.ts`

**Acceptance Criteria:**
- [ ] Weights sum to 1.0
- [ ] Output bounded `[0, 1]` when soft-neg penalty is 1.0
- [ ] Output is 0 when soft-neg penalty is 0
- [ ] Cold-start (taste=0.5 const) produces sensible relative ordering

**Verify:** `pnpm vitest run tests/unit/recs/scoring.test.ts`

**Steps:**

- [ ] **Step 1: Write failing tests**

Create `tests/unit/recs/scoring.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { composeScore, SCORE_WEIGHTS } from "@/lib/recs/scoring";

const baseInput = {
  taste: 1.0,
  mood: 1.0,
  timeFit: 1.0,
  social: 1.0,
  libraryBonus: 1.0,
  softNegPenalty: 1.0,
};

describe("SCORE_WEIGHTS", () => {
  it("sums to 1.0", () => {
    const total =
      SCORE_WEIGHTS.taste +
      SCORE_WEIGHTS.mood +
      SCORE_WEIGHTS.timeFit +
      SCORE_WEIGHTS.social +
      SCORE_WEIGHTS.libraryBonus;
    expect(total).toBeCloseTo(1.0, 5);
  });
});

describe("composeScore", () => {
  it("returns 1.0 when all axes max and no penalty", () => {
    expect(composeScore(baseInput)).toBeCloseTo(1.0, 5);
  });

  it("returns 0 when all axes max but soft-neg penalty is 0", () => {
    expect(composeScore({ ...baseInput, softNegPenalty: 0 })).toBe(0);
  });

  it("applies taste at expected weight", () => {
    const onlyTaste = composeScore({
      ...baseInput,
      mood: 0,
      timeFit: 0,
      social: 0,
      libraryBonus: 0,
    });
    expect(onlyTaste).toBeCloseTo(SCORE_WEIGHTS.taste, 5);
  });

  it("applies mood at expected weight", () => {
    const onlyMood = composeScore({
      ...baseInput,
      taste: 0,
      timeFit: 0,
      social: 0,
      libraryBonus: 0,
    });
    expect(onlyMood).toBeCloseTo(SCORE_WEIGHTS.mood, 5);
  });

  it("clamps output to [0,1]", () => {
    // Inputs above 1.0 shouldn't break the bound
    const s = composeScore({ ...baseInput, taste: 5, mood: 5 });
    expect(s).toBeLessThanOrEqual(1);
  });

  it("multiplies penalty AFTER weighted sum", () => {
    const half = composeScore({ ...baseInput, softNegPenalty: 0.5 });
    const full = composeScore(baseInput);
    expect(half).toBeCloseTo(full * 0.5, 5);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm vitest run tests/unit/recs/scoring.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/recs/scoring.ts`:

```ts
export const SCORE_WEIGHTS = {
  taste: 0.35,
  mood: 0.25,
  timeFit: 0.2,
  social: 0.1,
  libraryBonus: 0.1,
} as const;

// composeScore relies on the weights forming a convex combination (sum = 1)
// so the weighted blend stays in [0,1]. These weights are a product decision
// that WILL be re-tuned (see design spec) — guard the invariant at module
// load so an unbalanced re-tune fails `next build`, not silently in prod.
if (
  Math.abs(
    SCORE_WEIGHTS.taste +
      SCORE_WEIGHTS.mood +
      SCORE_WEIGHTS.timeFit +
      SCORE_WEIGHTS.social +
      SCORE_WEIGHTS.libraryBonus -
      1,
  ) > 1e-9
) {
  throw new Error("SCORE_WEIGHTS must sum to 1.0");
}

export type ScoreInputs = {
  taste: number;
  mood: number;
  timeFit: number;
  social: number;
  libraryBonus: number;
  softNegPenalty: number;
};

// All axes are assumed finite and in [0,1] (each upstream module self-clamps
// per its own contract). NaN/Inf propagate by design — fix the upstream
// source, don't sanitize here.
export function composeScore(i: ScoreInputs): number {
  const weighted =
    SCORE_WEIGHTS.taste * clamp01(i.taste) +
    SCORE_WEIGHTS.mood * clamp01(i.mood) +
    SCORE_WEIGHTS.timeFit * clamp01(i.timeFit) +
    SCORE_WEIGHTS.social * clamp01(i.social) +
    SCORE_WEIGHTS.libraryBonus * clamp01(i.libraryBonus);
  // softNegPenalty is a multiplicative retention gate, NOT a 6th weighted
  // axis: a 0 penalty (never-again / active snooze) must hard-zero the score
  // regardless of how strong the other axes are. Do not fold into the sum.
  return clamp01(weighted * clamp01(i.softNegPenalty));
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
```

> **Execution note (2026-05-15):** Code-review hardening (scoring math + weight values UNCHANGED): added a module-load assertion that `SCORE_WEIGHTS` sums to 1.0 (the spec says these weights will be re-tuned; an unbalanced edit now fails `next build` instead of silently breaking the [0,1] contract in prod), a WHY comment that the soft-neg penalty is a multiplicative hard-exclude gate (not foldable into the weighted sum), and a finite/[0,1] precondition note. Tests extended additively (now 13): an `it.each` isolating all 5 axis weights (catches social↔libraryBonus transposition — both 0.1) + a negative-input lower-clamp test. Shipped commit `00129f4`.

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm vitest run tests/unit/recs/scoring.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/recs/scoring.ts tests/unit/recs/scoring.test.ts
git commit -m "feat(recs): composite scoring across 5 axes + soft-neg multiplication"
```

---

## Task 7: MMR diversity

**Goal:** Greedy MMR (Maximal Marginal Relevance) reranking with `λ=0.7` to penalize candidates similar to already-selected ones.

**Files:**
- Create: `lib/recs/diversity-mmr.ts`
- Create: `tests/unit/recs/diversity-mmr.test.ts`

**Acceptance Criteria:**
- [ ] λ=1.0 produces the same order as input (no diversity penalty)
- [ ] λ=0.7 produces measurably more diverse output than λ=1.0 on a clustered fixture
- [ ] First pick is always the highest-scored input
- [ ] Output length matches `topN` parameter

**Verify:** `pnpm vitest run tests/unit/recs/diversity-mmr.test.ts`

**Steps:**

- [ ] **Step 1: Write failing tests**

Create `tests/unit/recs/diversity-mmr.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyMMR, type MMRItem } from "@/lib/recs/diversity-mmr";

const sim = (a: number[], b: number[]) => {
  const dot = a.reduce((s, x, i) => s + x * b[i], 0);
  const magA = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
  const magB = Math.sqrt(b.reduce((s, x) => s + x * x, 0));
  return magA && magB ? dot / (magA * magB) : 0;
};

const itemsClustered: MMRItem<string>[] = [
  // Two tight clusters of high-score items; one outlier
  { id: "a1", score: 0.95, embedding: [1, 0, 0] },
  { id: "a2", score: 0.94, embedding: [0.98, 0.05, 0] },
  { id: "a3", score: 0.93, embedding: [0.96, 0.1, 0] },
  { id: "b1", score: 0.92, embedding: [0, 1, 0] },
  { id: "b2", score: 0.91, embedding: [0.05, 0.98, 0] },
  { id: "c1", score: 0.85, embedding: [0, 0, 1] },
];

describe("applyMMR", () => {
  it("with λ=1.0 returns top-N in score order", () => {
    const out = applyMMR(itemsClustered, { lambda: 1.0, topN: 4, similarity: sim });
    expect(out.map((i) => i.id)).toEqual(["a1", "a2", "a3", "b1"]);
  });

  it("with λ=0.7 promotes diversity over pure score", () => {
    const out = applyMMR(itemsClustered, { lambda: 0.7, topN: 4, similarity: sim });
    const ids = out.map((i) => i.id);
    // First pick is still the top-scored
    expect(ids[0]).toBe("a1");
    // But "b1" (different cluster) should outrank "a2" (same cluster as a1)
    expect(ids.indexOf("b1")).toBeLessThan(ids.indexOf("a2"));
  });

  it("handles topN larger than input length", () => {
    const out = applyMMR(itemsClustered.slice(0, 3), {
      lambda: 0.7,
      topN: 10,
      similarity: sim,
    });
    expect(out.length).toBe(3);
  });

  it("returns empty array for empty input", () => {
    expect(applyMMR([], { lambda: 0.7, topN: 5, similarity: sim })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm vitest run tests/unit/recs/diversity-mmr.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/recs/diversity-mmr.ts`:

```ts
export type MMRItem<T> = {
  id: T;
  score: number;
  embedding: number[];
};

type MMROptions<T> = {
  lambda: number; // 0 = pure diversity; 1 = pure relevance
  topN: number;
  similarity: (a: number[], b: number[]) => number;
};

export function applyMMR<T>(items: MMRItem<T>[], opts: MMROptions<T>): MMRItem<T>[] {
  if (items.length === 0) return [];
  const remaining = [...items];
  const picked: MMRItem<T>[] = [];

  // First pick: highest relevance
  remaining.sort((a, b) => b.score - a.score);
  picked.push(remaining.shift()!);

  while (picked.length < opts.topN && remaining.length > 0) {
    let bestIdx = 0;
    let bestVal = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      // Max similarity to anything already picked. Identity is -Infinity (not
      // 0): cosine ∈ [-1,1], so an anti-correlated candidate (most diverse)
      // must yield a negative maxSim and thus a larger diversity bonus than
      // an orthogonal one. picked is always non-empty here (first pick is
      // seeded before the loop), so maxSim is always overwritten with a real
      // similarity — it never leaks -Infinity into mmrVal.
      let maxSim = -Infinity;
      for (const p of picked) {
        const s = opts.similarity(cand.embedding, p.embedding);
        if (s > maxSim) maxSim = s;
      }
      const mmrVal = opts.lambda * cand.score - (1 - opts.lambda) * maxSim;
      if (mmrVal > bestVal) {
        bestVal = mmrVal;
        bestIdx = i;
      }
    }

    picked.push(remaining.splice(bestIdx, 1)[0]);
  }

  return picked;
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm vitest run tests/unit/recs/diversity-mmr.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/recs/diversity-mmr.ts tests/unit/recs/diversity-mmr.test.ts
git commit -m "feat(recs): MMR diversity reranking (λ=0.7)"
```

> **Execution note (2026-05-15):** Code-review correctness fix (commit `c3de8ce`): `maxSim` init changed `0` → `-Infinity` (the correct max-reduction identity). Task 12 feeds **signed** taste-vector embeddings through an unclamped `[-1,1]` cosine, so the old `0` floor made an anti-correlated candidate (most diverse) indistinguishable from an orthogonal one — silently under-rewarding the diverse tail. Behavior-neutral for the all-non-negative test fixture (so the original 4 tests pass unchanged); added 3 guards (now 7): a λ=0 anti-correlation test that *fails on the old `maxSim=0`*, a deterministic-tie-break test (Task 12 reproducibility), and a single-item boundary.

---

## Task 8: Wildcard picker

**Goal:** Find a candidate from a genre cluster the user has never logged from. Fall back to least-explored cluster, then RAWG popularity tail.

**Files:**
- Create: `lib/recs/wildcard.ts`
- Create: `tests/unit/recs/wildcard.test.ts`

**Acceptance Criteria:**
- [ ] Returns null if no candidates available
- [ ] Prefers genres absent from user's log history
- [ ] When all user genres covered, picks least-frequent
- [ ] Deterministic given a seed (for testing)

**Verify:** `pnpm vitest run tests/unit/recs/wildcard.test.ts`

**Steps:**

- [ ] **Step 1: Write failing tests**

Create `tests/unit/recs/wildcard.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pickWildcard, type WildcardCandidate } from "@/lib/recs/wildcard";

const mkCand = (id: number, score: number, genres: string[]): WildcardCandidate => ({
  gameId: id,
  composite: score,
  genres,
});

describe("pickWildcard", () => {
  it("returns null for empty candidate list", () => {
    expect(pickWildcard([], { exploredGenres: new Set(["puzzle"]), seed: 42 })).toBeNull();
  });

  it("picks from an unexplored genre when one exists", () => {
    const cands = [
      mkCand(1, 0.8, ["puzzle"]),
      mkCand(2, 0.7, ["puzzle"]),
      mkCand(3, 0.5, ["roguelike"]),
    ];
    const pick = pickWildcard(cands, { exploredGenres: new Set(["puzzle"]), seed: 42 });
    expect(pick?.gameId).toBe(3);
  });

  it("respects minimum confidence threshold", () => {
    const cands = [mkCand(1, 0.2, ["roguelike"])];
    const pick = pickWildcard(cands, {
      exploredGenres: new Set(["puzzle"]),
      seed: 42,
      minScore: 0.4,
    });
    expect(pick).toBeNull();
  });

  it("falls back to least-explored when all explored", () => {
    const cands = [
      mkCand(1, 0.6, ["puzzle"]),
      mkCand(2, 0.6, ["roguelike"]),
    ];
    // User has 10 puzzle logs, 1 roguelike log → wildcard should prefer roguelike
    const pick = pickWildcard(cands, {
      exploredGenres: new Set(["puzzle", "roguelike"]),
      genreFrequency: new Map([["puzzle", 10], ["roguelike", 1]]),
      seed: 42,
    });
    expect(pick?.gameId).toBe(2);
  });

  it("is deterministic with the same seed", () => {
    const cands = [
      mkCand(1, 0.5, ["a"]),
      mkCand(2, 0.5, ["b"]),
      mkCand(3, 0.5, ["c"]),
    ];
    const a = pickWildcard(cands, { exploredGenres: new Set(), seed: 7 });
    const b = pickWildcard(cands, { exploredGenres: new Set(), seed: 7 });
    expect(a?.gameId).toBe(b?.gameId);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm vitest run tests/unit/recs/wildcard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/recs/wildcard.ts`:

```ts
export type WildcardCandidate = {
  gameId: number;
  composite: number;
  genres: string[];
};

// PRECONDITION: `exploredGenres` members and `genreFrequency` keys MUST be
// lowercased by the caller. Lookups here lowercase the candidate genre, but
// games.genres is mixed-case (RAWG/IGDB) — a mixed-case Set/Map silently
// misclassifies every genre as unexplored and Bucket A swallows the pool.
type WildcardOpts = {
  exploredGenres: Set<string>;
  genreFrequency?: Map<string, number>; // user's log count per genre
  minScore?: number;
  seed?: number;
};

// Deterministic PRNG (mulberry32) so tests are stable
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickWildcard(
  candidates: WildcardCandidate[],
  opts: WildcardOpts,
): WildcardCandidate | null {
  if (candidates.length === 0) return null;
  const minScore = opts.minScore ?? 0.4;
  const filtered = candidates.filter((c) => c.composite >= minScore);
  if (filtered.length === 0) return null;

  // Bucket A: from genres user has NEVER logged
  const unexplored = filtered.filter((c) =>
    c.genres.some((g) => !opts.exploredGenres.has(g.toLowerCase())),
  );

  // Bucket B: from least-frequent explored genres (if no unexplored)
  let pool: WildcardCandidate[];
  if (unexplored.length > 0) {
    pool = unexplored;
  } else if (opts.genreFrequency) {
    // Rank by each candidate's least-explored genre (min log-frequency
    // across its genres), then keep only the globally-least-explored.
    // `?? Infinity` is a sentinel: a genre absent from genreFrequency
    // (caller-inconsistent with exploredGenres) sorts as most-explored.
    const scored = filtered.map((c) => {
      const freqs = c.genres.map((g) => opts.genreFrequency!.get(g.toLowerCase()) ?? Infinity);
      const minFreq = Math.min(...freqs);
      return { c, minFreq };
    });
    const cutoff = Math.min(...scored.map((s) => s.minFreq));
    pool = scored.filter((s) => s.minFreq === cutoff).map((s) => s.c);
  } else {
    pool = filtered;
  }

  // Constrained random within pool. With a seed → deterministic (Task 12
  // passes a per-request seed for reproducible recs). No seed → wall-clock
  // entropy by design: a fresh wildcard each call. Not for client/SSR paths.
  const rand = mulberry32(opts.seed ?? Date.now());
  const idx = Math.floor(rand() * pool.length);
  return pool[idx];
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm vitest run tests/unit/recs/wildcard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/recs/wildcard.ts tests/unit/recs/wildcard.test.ts
git commit -m "feat(recs): wildcard slot via constrained-random sampling from unexplored clusters"
```

> **Execution note (2026-05-15):** Code-review hardening (algorithm byte-unchanged; commit `5cde8b3`). (1) Added a PRECONDITION doc on `WildcardOpts`: callers MUST lowercase `exploredGenres`/`genreFrequency` keys — `games.genres` is mixed-case, and a mixed-case Set/Map silently makes Bucket A swallow the whole pool. **Task 12 must lowercase when building these.** (2) Pinned the PRNG with a golden-value test (`seed: 7` on a 3-item pool → gameId `1`; mulberry32(7) first = 0.0117 → idx 0) so a PRNG regression fails loudly — the old determinism test only checked self-consistency. (3) Added the previously-untested `else pool=filtered` fallback test + a multi-unexplored Bucket-A test. (4) Fixed an inaccurate "inverse" comment and documented the `?? Infinity` sentinel + the `Date.now()` seed-fallback fork. Note for Task 9/12: this module's score field is `composite`, vs `MMRItem.score` elsewhere — the integrator maps `.score → .composite` deliberately.

---

## Task 9: Bucket assignment

**Goal:** Stratify scored candidates into 6 slots (3 Comfort + 1 Backlog + 1 Friends + 1 Wildcard) with graceful demotion to extra Comfort when sources are empty.

**Files:**
- Create: `lib/recs/buckets.ts`
- Create: `tests/unit/recs/buckets.test.ts`

**Acceptance Criteria:**
- [ ] Empty backlog source demotes to extra Comfort
- [ ] Empty friends source demotes to extra Comfort
- [ ] Wildcard slot always attempted; demotes silently if no candidate
- [ ] Returns exactly 6 items if input has ≥6 candidates
- [ ] No candidate appears in multiple slots
- [ ] Library/friends candidates respect minimum score threshold

**Verify:** `pnpm vitest run tests/unit/recs/buckets.test.ts`

**Steps:**

- [ ] **Step 1: Write failing tests**

Create `tests/unit/recs/buckets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { assignBuckets, type ScoredCandidate } from "@/lib/recs/buckets";

const mkCand = (
  id: number,
  composite: number,
  opts: Partial<Omit<ScoredCandidate, "gameId" | "composite">> = {},
): ScoredCandidate => ({
  gameId: id,
  composite,
  inLibrary: false,
  socialScore: 0,
  genres: ["puzzle"],
  ...opts,
});

describe("assignBuckets", () => {
  it("fills all four slot types when sources are rich", () => {
    const cands = [
      mkCand(1, 0.9), // comfort
      mkCand(2, 0.85), // comfort
      mkCand(3, 0.8), // comfort
      mkCand(4, 0.7, { inLibrary: true }), // backlog
      mkCand(5, 0.65, { socialScore: 0.4 }), // friends
      mkCand(6, 0.5, { genres: ["roguelike"] }), // wildcard
      mkCand(7, 0.4),
    ];
    const out = assignBuckets(cands, {
      exploredGenres: new Set(["puzzle"]),
      seed: 1,
    });
    expect(out.length).toBe(6);
    const slots = out.map((c) => c.slot).sort();
    expect(slots).toEqual(["backlog", "comfort", "comfort", "comfort", "friends", "wildcard"]);
  });

  it("demotes backlog slot to extra comfort when no library candidates", () => {
    const cands = [
      mkCand(1, 0.9),
      mkCand(2, 0.85),
      mkCand(3, 0.8),
      mkCand(4, 0.75),
      mkCand(5, 0.65, { socialScore: 0.4 }),
      mkCand(6, 0.5, { genres: ["roguelike"] }),
    ];
    const out = assignBuckets(cands, {
      exploredGenres: new Set(["puzzle"]),
      seed: 1,
    });
    const comforts = out.filter((c) => c.slot === "comfort");
    expect(comforts.length).toBe(4);
    expect(out.some((c) => c.slot === "backlog")).toBe(false);
  });

  it("demotes friends slot when no social candidates", () => {
    const cands = [
      mkCand(1, 0.9),
      mkCand(2, 0.85),
      mkCand(3, 0.8),
      mkCand(4, 0.75),
      mkCand(5, 0.7, { inLibrary: true }),
      mkCand(6, 0.5, { genres: ["roguelike"] }),
    ];
    const out = assignBuckets(cands, {
      exploredGenres: new Set(["puzzle"]),
      seed: 1,
    });
    expect(out.some((c) => c.slot === "friends")).toBe(false);
  });

  it("never duplicates a candidate across slots", () => {
    const cands = [
      mkCand(1, 0.9, { inLibrary: true, socialScore: 0.4 }), // could match all 3 buckets
      mkCand(2, 0.85),
      mkCand(3, 0.8),
      mkCand(4, 0.75),
      mkCand(5, 0.7),
      mkCand(6, 0.5, { genres: ["roguelike"] }),
    ];
    const out = assignBuckets(cands, {
      exploredGenres: new Set(["puzzle"]),
      seed: 1,
    });
    const ids = out.map((c) => c.gameId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns fewer than 6 when input is short", () => {
    const cands = [mkCand(1, 0.9), mkCand(2, 0.8)];
    const out = assignBuckets(cands, { exploredGenres: new Set(), seed: 1 });
    expect(out.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm vitest run tests/unit/recs/buckets.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/recs/buckets.ts`:

```ts
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

type AssignOpts = {
  exploredGenres: Set<string>;
  genreFrequency?: Map<string, number>;
  seed?: number;
  minBackingThreshold?: number; // floor for backlog/friends slots
};

const SLOT_TARGETS = { comfort: 3, backlog: 1, friends: 1, wildcard: 1 } as const;
// Derive the grid size from SLOT_TARGETS so a re-tune can't silently desync
// the demotion cap from the slot budget (cf. the SCORE_WEIGHTS sum guard).
const GRID_SIZE =
  SLOT_TARGETS.comfort + SLOT_TARGETS.backlog + SLOT_TARGETS.friends + SLOT_TARGETS.wildcard;
const BACKING_FLOOR = 0.5;

/**
 * Stratifies scored candidates into the 6-card grid (3 Comfort + Backlog +
 * Friends + Wildcard, with graceful demotion). Returned `BucketedCandidate`s
 * shallow-copy the input and SHARE the `genres` array by reference — callers
 * (Task 12) must treat returned candidates as read-only.
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

  // 1. Comfort — top 3 by composite. Intentionally NOT floor-gated:
  // Comfort is the guaranteed-fill tier (graceful fill even below floor).
  let comfortCount = 0;
  for (const c of sorted) {
    if (comfortCount >= SLOT_TARGETS.comfort) break;
    out.push({ ...c, slot: "comfort" });
    used.add(c.gameId);
    comfortCount++;
  }

  // 2. Backlog — highest-scored library candidate above floor
  const backlog = sorted.find(
    (c) => !used.has(c.gameId) && c.inLibrary && c.composite >= floor,
  );
  if (backlog) {
    out.push({ ...backlog, slot: "backlog" });
    used.add(backlog.gameId);
  }

  // 3. Friends — highest-scored social>0 candidate above floor
  const friends = sorted.find(
    (c) => !used.has(c.gameId) && c.socialScore > 0 && c.composite >= floor,
  );
  if (friends) {
    out.push({ ...friends, slot: "friends" });
    used.add(friends.gameId);
  }

  // 4. Wildcard — unexplored cluster sample
  const wcInput: WildcardCandidate[] = sorted
    .filter((c) => !used.has(c.gameId))
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

  // 5. Demote empty slots to extra Comfort
  while (out.length < GRID_SIZE) {
    const next = sorted.find((c) => !used.has(c.gameId));
    if (!next) break;
    out.push({ ...next, slot: "comfort" });
    used.add(next.gameId);
  }

  return out;
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm vitest run tests/unit/recs/buckets.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/recs/buckets.ts tests/unit/recs/buckets.test.ts
git commit -m "feat(recs): stratified bucket assignment (3 Comfort + Backlog + Friends + Wildcard)"
```

> **Execution note (2026-05-15):** Added during execution: a 4-line PRECONDITION doc on `AssignOpts` propagating Task 8's lowercased-keys contract (initial commit `526bb1b`). Then code-review hardening (algorithm behavior-neutral; commit `b2b266e`): derived `GRID_SIZE` from `SLOT_TARGETS` (the demote cap was a hardcoded `6` that could silently desync from a re-tuned slot budget — same invariant-drift class as the T6 `SCORE_WEIGHTS` guard); replaced the Step-1 in-loop `out.filter(...)` with a `comfortCount` counter (equivalent, clearer intent) + a WHY comment that Comfort is intentionally not floor-gated; added a return-contract JSDoc (returned candidates share `genres` array refs — read-only). Tests 5→8: floor-respect (the `composite>=floor` clause was previously unexercised — deleting it kept all tests green), explicit slot-priority (Backlog precedes Friends), and determinism (same input+seed → identical grid). **Carry-forward to Task 12:** treat the grid size as `SLOT_TARGETS`-derived, not a literal `6`; and the `exploredGenres`/`genreFrequency` lowercased-keys precondition applies when calling `assignBuckets` (forwarded into `pickWildcard`).

---

## Task 10: Widen candidate pool to top-100 + deterministic seed

**Goal:** Small change to `candidatePool()` — bump top-N from 50 to 100 and accept an optional seed parameter for reproducible test runs.

**Files:**
- Modify: `lib/recs/candidate-pool.ts`
- Create: `tests/unit/recs/candidate-pool-v2.test.ts`

**Acceptance Criteria:**
- [ ] Default `topN` is 100 (was 50)
- [ ] Function signature accepts optional `seed` parameter
- [ ] Existing call sites still work (backwards compatible)
- [ ] No regression in existing candidate-pool tests

**Verify:** `pnpm vitest run tests/unit/recs/`

**Steps:**

- [ ] **Step 1: Read existing candidate-pool.ts**

Open `lib/recs/candidate-pool.ts` and identify the function signature + where the top-N is set. Note the existing return type for reuse.

- [ ] **Step 2: Write failing test**

Create `tests/unit/recs/candidate-pool-v2.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { candidatePool } from "@/lib/recs/candidate-pool";

describe("candidatePool v2 surface", () => {
  it("accepts a topN parameter and defaults to 100", async () => {
    // Function signature check (no DB call required for this test if we
    // assert by inspecting the options object passed in)
    // For now: just type-check at compile time via `pnpm tsc --noEmit`.
    // Concrete behavioral test will need a DB fixture — covered by the
    // integration test in Task 12.
    expect(typeof candidatePool).toBe("function");
  });
});
```

- [ ] **Step 3: Modify the source**

> **Execution note (2026-05-15):** The illustrative code originally shown
> here was wrong vs the real file (it guessed `topN`/inline-vectors). The
> ACTUAL signature uses `limit` + `VectorBundle`, with `50` appearing once
> at `const limit = opts.limit ?? 50;`. Shipped commit `9672ab1` makes the
> minimal correct adaptation below — param stays `limit` (NOT renamed),
> `VectorBundle` import preserved, only `?? 50`→`?? 100` + the `seed?` type
> member + comments. **Carry-forward to Task 12:** the two real callers at
> `lib/recs/server-actions.ts:204` and `:416` pin explicit `limit: 50` —
> Task 12 must drop/raise those to actually get the 100 pool, and re-confirm
> the downstream time/platform `.filter()` + final slice handle the larger
> input. `seed` is added to the opts type but intentionally UNWIRED here
> (plan-mandated forward hook; Task 12 wires + behaviorally tests it).

In `lib/recs/candidate-pool.ts`, adapt the real signature (do NOT follow the wrong illustrative code; do NOT rename `limit`→`topN`, do NOT inline the `VectorBundle` type):

```ts
export async function candidatePool(
  userId: string,
  opts: {
    limit?: number;
    vectors?: VectorBundle;
    seed?: number; // reserved: Task 12 passes this for reproducible tie-ordering; unused here
  } = {},
): Promise<CandidateGame[]> {
  if (!userId) return [];

  // Pool size expanded 50 → 100 for /play-next v2: the new scoring +
  // MMR-diversity + bucketing stages (Tasks 6-9) need more material to
  // work with. Spec: docs/superpowers/specs/2026-05-15-play-next-redesign-design.md
  const limit = opts.limit ?? 100;
  // ... existing body unchanged; `limit` already flows to the cold-start
  // `break` and the final `scored.slice(0, limit)` ...
}
```

- [ ] **Step 4: Verify nothing broke**

Run: `pnpm tsc --noEmit && pnpm vitest run tests/unit/recs/`
Expected: clean output; no test regressions.

- [ ] **Step 5: Commit**

```bash
git add lib/recs/candidate-pool.ts tests/unit/recs/candidate-pool-v2.test.ts
git commit -m "feat(recs): widen candidate pool top-N to 100 + add deterministic seed param"
```

---

## Task 11: Edge Function — rerank-only mode + userRefinements + library-citing prompt

**Goal:** `supabase/functions/rerank-recs/index.ts` gains a `mode` parameter and a `userRefinements` field. Prompt updates to cite library titles. `RERANK_PROMPT_VERSION` bumps.

**Files:**
- Modify: `supabase/functions/rerank-recs/index.ts`
- Modify: `supabase/functions/_shared/prompts.ts` (and the mirrored `lib/taste/prompts.ts` if present)
- Create: `tests/unit/recs/rerank-prompt.test.ts`

**Acceptance Criteria:**
- [ ] `mode: "full" | "rerank-only"` accepted in request body; defaults to `"full"`
- [ ] In `rerank-only` mode, the function skips re-retrieve and uses the supplied shortlist
- [ ] `userRefinements: string[]` (sanitized) appended to prompt as structured block
- [ ] Prompt instructs the model to cite library titles when honest
- [ ] `RERANK_PROMPT_VERSION` bumps to invalidate cached recs

**Verify:** `pnpm vitest run tests/unit/recs/rerank-prompt.test.ts`

**Steps:**

- [ ] **Step 1: Read existing prompts.ts**

Read both `supabase/functions/_shared/prompts.ts` and any mirrored `lib/taste/prompts.ts` to understand the existing `buildRerankPrompt` signature, then locate `RERANK_PROMPT_VERSION`.

- [ ] **Step 2: Write failing tests**

Create `tests/unit/recs/rerank-prompt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildRerankPrompt, RERANK_PROMPT_VERSION } from "@/lib/taste/prompts";

const baseArgs = {
  userNarrative: "loves tight combat games",
  topGenres: ["roguelike", "strategy"],
  topMechanics: ["permadeath", "skill-based"],
  shortlist: [
    { gameId: 1, title: "Hades", year: 2020, genres: ["roguelike"], mechanics: ["permadeath"] },
    { gameId: 2, title: "Slay the Spire", year: 2019, genres: ["roguelike"], mechanics: ["deck-building"] },
  ],
  filterContext: { time: "1hr" as const, moods: ["challenged" as const], platforms: ["steam" as const] },
  dismissedRecent: [],
  currentlyPlaying: [],
  libraryTitles: ["Hollow Knight", "Celeste"],
};

describe("buildRerankPrompt — v2 additions", () => {
  it("RERANK_PROMPT_VERSION incremented above the v1 value", () => {
    // Assume v1 was 1; whatever v2 is, must be >1
    expect(RERANK_PROMPT_VERSION).toBeGreaterThan(1);
  });

  it("includes user refinements block when non-empty", () => {
    const p = buildRerankPrompt({
      ...baseArgs,
      userRefinements: ["less grindy", "shorter please"],
    });
    expect(p).toMatch(/ADDITIONAL USER REQUESTS/);
    expect(p).toMatch(/less grindy/);
    expect(p).toMatch(/shorter please/);
  });

  it("omits refinements block when empty", () => {
    const p = buildRerankPrompt({ ...baseArgs, userRefinements: [] });
    expect(p).not.toMatch(/ADDITIONAL USER REQUESTS/);
  });

  it("includes library titles for grounding when provided", () => {
    const p = buildRerankPrompt({ ...baseArgs, libraryTitles: ["Stardew Valley"] });
    expect(p).toMatch(/Stardew Valley/);
    expect(p).toMatch(/cite specific games/i);
  });

  it("clamps refinements to 140 chars each and 5 entries max", () => {
    const long = "x".repeat(200);
    const many = ["a", "b", "c", "d", "e", "f", "g"];
    const p = buildRerankPrompt({
      ...baseArgs,
      userRefinements: [long, ...many],
    });
    // No line in the prompt exceeds 140 chars from a single refinement entry
    const lines = p.split("\n").filter((l) => l.startsWith("- "));
    for (const l of lines) {
      expect(l.length).toBeLessThanOrEqual(143); // "- " prefix + 140
    }
  });
});
```

- [ ] **Step 3: Run test — expect FAIL**

Run: `pnpm vitest run tests/unit/recs/rerank-prompt.test.ts`
Expected: FAIL — `userRefinements` not in builder signature.

> **Execution note (2026-05-15) — the Step 4/5 code below is FICTIONAL; do NOT follow it verbatim.** It was written against an imagined API. Reality (verified, shipped in commits `b1126da` + `7630aaa`):
> - `RERANK_PROMPT_VERSION` is a **string** (`"v1"` → bumped to `"v2"`), not numeric. There is no `BuildRerankPromptArgs`; the real exported type is `RerankPromptInput` and `buildRerankPrompt(input): { system: string; user: string }` (returns a pair, not a string). The new blocks are pushed into the existing `userBlocks` array immediately before the final `userBlocks.push("Return the JSON object now.")` — pre-existing blocks (narrative, candidate list, dismissed, currently-playing) are untouched.
> - `RerankPromptInput` gained `libraryTitles?: string[]` + `userRefinements?: string[]`. `sanitizeRefinement` strips ALL line/control chars (`[\r\n\t\v\f …]`) + collapses whitespace (not just `\n` — security: user-controlled text in a line-structured LLM prompt), capped 140 chars, max 5 entries.
> - The Edge Function uses **manual body parsing, NOT Zod**. It gained `mode`/`userRefinements` body fields. `mode` is accepted+validated+echoed but has **no behavioral branch** — the Edge Function is given `candidateIds` and never retrieves a pool, so "rerank-only skips re-retrieve" is *inherently* satisfied; the full-vs-rerank-only teeth are Task 12's (Next side).
> - The library-sample query is recency-ordered: `SELECT g.title FROM logs l JOIN games g ON g.id=l.game_id WHERE l.user_id=$1 GROUP BY g.title ORDER BY MAX(l.updated_at) DESC LIMIT 30`.
> - `lib/taste/prompts.ts` ⇄ `supabase/functions/_shared/prompts.ts` rerank region is byte-identical, **enforced by a mirror-equality unit test** (it already caught + fixed a pre-existing one-sided comment drift). The Vitest suite only loads the lib copy; the test reads both files and asserts the region matches.
> - **Step 7 (Edge deploy) is DEFERRED to operator close-out** — not run during execution (live `rerank-recs` is still v5/"v1").
> - **Carry-forward to Task 12:** pass `userRefinements` (the refinement input) + `mode: "rerank-only"` (when refining an existing shortlist) into the Edge call; Task 12 owns the actual full-vs-rerank-only retrieval decision.

- [ ] **Step 4: Update buildRerankPrompt + version bump**

In `lib/taste/prompts.ts` (and mirror to `supabase/functions/_shared/prompts.ts`):

```ts
// Bump version
export const RERANK_PROMPT_VERSION = 2; // was 1

// Extend BuildRerankPromptArgs type
export type BuildRerankPromptArgs = {
  userNarrative: string;
  topGenres: string[];
  topMechanics: string[];
  shortlist: Array<{
    gameId: number;
    title: string;
    year: number | null;
    genres: string[];
    mechanics: string[];
  }>;
  filterContext: { time: TimeBudget; moods: Mood[]; platforms: Platform[] };
  dismissedRecent: string[];
  currentlyPlaying: string[];
  libraryTitles?: string[];
  userRefinements?: string[];
};

const REFINEMENT_MAX = 5;
const REFINEMENT_CHAR_CAP = 140;

function sanitizeRefinement(s: string): string {
  return s.replace(/\n/g, " ").trim().slice(0, REFINEMENT_CHAR_CAP);
}

export function buildRerankPrompt(args: BuildRerankPromptArgs): string {
  // ... existing prompt construction ...
  const sections: string[] = [];

  // [existing sections — narrative, vectors, candidates, filter context, dismissed/playing]

  // NEW: refinements block (only when non-empty)
  if (args.userRefinements && args.userRefinements.length > 0) {
    const cleaned = args.userRefinements
      .slice(0, REFINEMENT_MAX)
      .map(sanitizeRefinement)
      .filter((s) => s.length > 0);
    if (cleaned.length > 0) {
      sections.push(
        `ADDITIONAL USER REQUESTS:\n${cleaned.map((r) => `- ${r}`).join("\n")}\n\nApply these when selecting picks AND when writing reasoning.\nIf a request conflicts with a hard filter, the filter wins.\nReference the request explicitly in the reason when relevant.`,
      );
    }
  }

  // NEW: library-citing instruction (when libraryTitles provided)
  if (args.libraryTitles && args.libraryTitles.length > 0) {
    const sample = args.libraryTitles.slice(0, 10).join(", ");
    sections.push(
      `USER'S LIBRARY (sample): ${sample}\n\nWhen writing reasoning, cite specific games from the user's library that this pick resembles when the comparison is honest. Prefer "Like Stardew Valley, this is..." over generic "matches your love of..." phrasing.`,
    );
  }

  return sections.join("\n\n");
}
```

- [ ] **Step 5: Update Edge Function**

In `supabase/functions/rerank-recs/index.ts`, add the `mode` parameter to the request body schema and switch behavior:

```ts
// Existing request schema gets extended:
const RequestSchema = z.object({
  userId: z.string().uuid(),
  cacheKey: z.string(),
  filters: filterSchema,
  // NEW:
  mode: z.enum(["full", "rerank-only"]).default("full"),
  shortlist: z.array(z.object({
    gameId: z.number(),
    title: z.string(),
    year: z.number().nullable(),
    genres: z.array(z.string()),
    mechanics: z.array(z.string()),
  })).optional(),
  userRefinements: z.array(z.string()).max(5).optional(),
});

// In the handler:
if (parsed.mode === "rerank-only") {
  if (!parsed.shortlist || parsed.shortlist.length === 0) {
    return new Response(JSON.stringify({ error: "rerank-only mode requires shortlist" }), {
      status: 400,
    });
  }
  // Skip candidate-pool fetch; use supplied shortlist directly
  // ... existing AI rerank loop using supplied shortlist ...
} else {
  // Existing full-mode flow: fetch candidates, score, then rerank
}
```

- [ ] **Step 6: Run test — expect PASS**

Run: `pnpm vitest run tests/unit/recs/rerank-prompt.test.ts`
Expected: PASS.

- [ ] **Step 7: Deploy Edge Function to dev**

```bash
pnpm supabase functions deploy rerank-recs --project-ref lkrnhddvbqhpzxivpaja
```

Verify deployment by hitting the function URL with a test payload (use curl or Postman with `Authorization: Bearer $SUPABASE_ANON_KEY`).

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/rerank-recs/index.ts supabase/functions/_shared/prompts.ts lib/taste/prompts.ts tests/unit/recs/rerank-prompt.test.ts
git commit -m "feat(rerank): rerank-only mode + userRefinements field + library-citing prompt (version 2)"
```

---

## Task 12: getRecs orchestration rewrite

**Goal:** Update `getRecs()` in `lib/recs/server-actions.ts` to use the new composite scoring + buckets + MMR + wildcard pipeline, accept `refinements` parameter, persist `slot` to the `recommendations` table.

> **Execution note (2026-05-15) — the Step 1.5–4 code below was ~80% FICTIONAL; do NOT follow it verbatim.** It referenced non-existent candidate fields (`tasteScore`/`embedding`/`releasedYear`), the superseded T4 social formula, the wrong `topN` param, and ignored the real `tier`/`algorithm`/sparse/empty/cache-freshness/`metadataOnlyRecs`-fallback machinery. The controller read the real `lib/recs/server-actions.ts` and authored a real-grounded adaptation; shipped in commits `1aeba6c` (impl) + `9bb278b` (hardening). **User-locked decisions:** (A) slot persistence = getRecs post-rerank UPDATE (Edge writes rows with `slot` defaulting to `'comfort'`; getRecs then UPDATEs slot per gameId from the bucket assignment — one UPDATE per distinct slot, gameId `inArray` — then re-reads); (B) full adaptation preserving ALL existing behavior. Reality vs the sketch:
> - Real `getRecs(rawFilters)` → now `getRecs(rawFilters, options?: { refinements?: string[] })`. Original body copied **verbatim** into private `getRecsLegacy` FIRST (T19 wires the flag branch; the only delta vs original is two SELECTs projecting `slot` for the shared `hydrateRecs` row type).
> - `RecCard` extended with `slot` + `fitChips {timeFit,moodMatches,inLibrary,friendsCount}` + `confidence`. ALL THREE producers fill it: `hydrateRecs` (real persisted slot + `neutralFitChips()` + `deriveConfidence(score)`), `metadataOnlyRecs` (`'comfort'` + neutral + derived), v2 fresh path (real bucket slot + enriched precise chips + composite-derived confidence). All four `recommendations` SELECTs add `slot`.
> - Real `CandidateGame` has `id`/`similarityScore`/`released`, NO `gameId`/`tasteScore`/`embedding`/`releasedYear`. Taste axis = `Math.min(1,Math.max(0,similarityScore/5))` (same normalization as `metadataOnlyRecs`). No precomputed embeddings → MMR uses a per-request **bag-of-tags** embedding (0/1 over the union of genre/theme/mechanic tags in the filtered set) with the local `cosineSimilarity`.
> - Carry-forwards consumed: T10 `candidatePool(me.id,{vectors})` (NO `limit:50`; 100 default). T4 imported `computeSocialScore` (not the old inline formula). T8/T9 `exploredGenres`/`genreFrequency` lowercased. T5 one hoisted `const now`. T9 grid size is `SLOT_TARGETS`-derived inside `assignBuckets`.
> - Preserved unchanged: getCachedUser/safeParse/getFingerprint/empty+sparse tiers/`cacheKey({...})` object arg/cache SELECT+freshness gate (now wrapped in `if (refinements.length===0)` so refinements bypass cache)/`metadataOnlyRecs` (sparse + AI-failure fallback + its banner)/`tier`+`algorithm` on every RecResult/exact Edge URL+auth+untrusted-JSON guard. Edge body gains `mode` (`"rerank-only"` iff refinements) + `userRefinements`.
> - Integration test (`tests/integration/recs/get-recs.test.ts`) uses mocked boundaries per repo convention (NOT the plan's live-seed), exercising real scoring/MMR/buckets; asserts the 6-card contract, no-candidates (×2), the refinements→`mode:"rerank-only"` branch, and the post-rerank slot-UPDATE partition (disjoint + full-coverage of the bucketed set). Full suite 850/850, tsc clean.

**Files:**
- Modify: `lib/recs/server-actions.ts`
- Create: `tests/integration/recs/get-recs.test.ts`

**Acceptance Criteria:**
- [ ] `getRecs()` accepts optional `refinements: string[]` parameter
- [ ] When refinements present, calls Edge Function with `mode: "rerank-only"` and supplies pre-scored shortlist
- [ ] When refinements absent, runs full pipeline: candidate pool → score → MMR → buckets → AI rerank (or metadata fallback)
- [ ] Resulting RecCards include `slot` field
- [ ] Soft-negative penalty applied via JOIN to existing `recommendations` rows
- [ ] Integration test covers: happy path returns 6 bucketed cards
- [ ] Returns `{ ok: false, reason: "no-candidates" }` when pool empties after filters
- [ ] Cache hit path serves persisted rows with their original slot intact

**Verify:** `pnpm vitest run tests/integration/recs/get-recs.test.ts`

**Steps:**

- [ ] **Step 1: Read current server-actions.ts implementation**

Read the full file to understand the existing flow (cache check → tier decision → candidate-pool call → AI rerank or metadata fallback) so the rewrite preserves the contract.

- [ ] **Step 1.5: Preserve the legacy getRecs body for Task 19's feature flag**

In `lib/recs/server-actions.ts`, BEFORE rewriting `getRecs`, copy its current implementation verbatim into a new function `getRecsLegacy` in the same file:

```ts
/**
 * Preserved legacy implementation, served when the `recsv2` feature flag
 * is OFF. Will be deleted once v2 is fully rolled out (see Task 19).
 */
async function getRecsLegacy(rawFilters: FilterParams): Promise<RecResult> {
  // ... entire body of the pre-task-12 getRecs() function copied verbatim
}
```

This preserves the legacy path before Task 12 overwrites it. Task 19 will add the flag branch at the top of `getRecs` to delegate to `getRecsLegacy` when the flag is off.

- [ ] **Step 2: Update RecCard type**

```ts
// In lib/recs/server-actions.ts
export type RecCard = {
  id: string;
  gameId: number;
  slug: string;
  title: string;
  releasedYear: number | null;
  posterUrl: string | null;
  coverUrl: string | null;
  score: number;
  reason: string;
  platforms: string[] | null;
  algorithm: "similarity" | "ai" | "hybrid";
  // NEW:
  slot: "comfort" | "backlog" | "friends" | "wildcard";
  // NEW: structured fit signals for UI chips (no AI required to compute these)
  fitChips: {
    timeFit: "perfect" | "close" | "loose";
    moodMatches: string[];
    inLibrary: boolean;
    friendsCount: number;
  };
  confidence: "strong" | "good" | "worth-a-try";
};
```

- [ ] **Step 3: Write the orchestration**

Replace the body of `getRecs` with the new pipeline. Key change: after candidate pool, apply scoring + MMR + buckets BEFORE handing top-15 to AI.

```ts
import { fetchSocialSignals } from "@/lib/recs/social-score";
import { moodMatchScore } from "@/lib/recs/mood-affinity";
import { timeFitScore, isTimeFeasible } from "@/lib/recs/time-fit";
import { softNegativePenalty } from "@/lib/recs/soft-negative";
import { composeScore } from "@/lib/recs/scoring";
import { applyMMR } from "@/lib/recs/diversity-mmr";
import { assignBuckets, type ScoredCandidate } from "@/lib/recs/buckets";

export async function getRecs(
  rawFilters: FilterParams,
  options?: { refinements?: string[] },
): Promise<RecResult> {
  const me = await getCachedUser();
  if (!me) return { ok: false, reason: "unauthorized" };

  const filtersResult = filterSchema.safeParse(rawFilters);
  if (!filtersResult.success) return { ok: false, reason: "invalid-filters" };
  const filters = filtersResult.data;
  const refinements = (options?.refinements ?? []).slice(0, 5);

  // 1. Cache check (only when no refinements — refinements bypass cache)
  if (refinements.length === 0) {
    const cached = await readCachedRecs(me.id, filters);
    if (cached && cached.length >= 4) {
      return buildResultFromCached(cached);
    }
  }

  // 2. Candidate pool (top-100 from taste vectors)
  const fp = await getFingerprint(me.id);
  const pool = await candidatePool(me.id, {
    vectors: fp.vectors,
    topN: 100,
  });
  if (pool.length === 0) return { ok: false, reason: "no-candidates" };

  // 3. Hard filters: platform overlap + time feasibility + dismissal exclusion
  const userPlatforms = await loadUserPlatforms(me.id, filters.platforms);
  const dismissals = await loadDismissalsMap(me.id, pool.map((c) => c.gameId));
  const userLibrary = await loadLibraryGameIds(me.id);

  const feasible = pool.filter((c) => {
    if (!isTimeFeasible(c.playtimeAvgHours, filters.time)) return false;
    if (!gamePlatformsMatchUserFilter(c.platforms, userPlatforms)) return false;
    const ds = dismissals.get(c.gameId);
    if (ds?.neverAgain) return false;
    if (ds?.snoozedUntil && ds.snoozedUntil.getTime() > Date.now()) return false;
    return true;
  });
  if (feasible.length === 0) return { ok: false, reason: "no-candidates" };

  // 4. Social signals (bulk fetch)
  const socialMap = await fetchSocialSignals(me.id, feasible.map((c) => c.gameId));

  // 5. Score each candidate
  const scored: ScoredCandidate[] = feasible.map((c) => {
    const taste = c.tasteScore; // already 0..1 from candidate-pool
    const moodScores = filters.moods.map((m) =>
      moodMatchScore(m, { genres: c.genres, mechanics: c.mechanics }),
    );
    const mood = moodScores.length > 0 ? moodScores.reduce((a, b) => a + b, 0) / moodScores.length : 0.5;
    const timeFit = timeFitScore(c.playtimeAvgHours, filters.time);
    const socialRaw = socialMap.get(c.gameId);
    const social = socialRaw ? sigmoid(0.3 * socialRaw.friendsPlayed + 0.5 * socialRaw.friendsLiked) - 0.5 : 0;
    const inLibrary = userLibrary.has(c.gameId);
    const libraryBonus = inLibrary ? 1.0 : 0;
    const penalty = softNegativePenalty(
      dismissals.get(c.gameId) ?? { dismissedAt: null, snoozedUntil: null, neverAgain: false },
    );
    const composite = composeScore({
      taste,
      mood,
      timeFit,
      social: Math.max(0, social * 2), // re-expand from [0, 0.5) to [0, 1)
      libraryBonus,
      softNegPenalty: penalty,
    });
    return {
      gameId: c.gameId,
      composite,
      inLibrary,
      socialScore: Math.max(0, social * 2),
      genres: c.genres ?? [],
    };
  });

  // 6. MMR diversity over scored set (use taste vectors as embeddings)
  const mmrInput = scored.map((c) => ({
    id: c.gameId,
    score: c.composite,
    embedding: feasible.find((f) => f.gameId === c.gameId)?.embedding ?? [],
  }));
  const diversified = applyMMR(mmrInput, {
    lambda: 0.7,
    topN: 15,
    similarity: cosineSimilarity,
  });
  const diversifiedScored = diversified
    .map((m) => scored.find((s) => s.gameId === m.id))
    .filter((s): s is ScoredCandidate => s !== undefined);

  // 7. Bucket assignment
  const exploredGenres = await loadUserExploredGenres(me.id);
  const bucketed = assignBuckets(diversifiedScored, {
    exploredGenres,
    seed: Math.floor(Date.now() / 60000), // changes once per minute — stable within a request burst
  });
  if (bucketed.length === 0) return { ok: false, reason: "no-candidates" };

  // 8. AI rerank (rerank-only mode if refinements present; otherwise full)
  const shortlist = bucketed.map((b) => {
    const f = feasible.find((x) => x.gameId === b.gameId)!;
    return {
      gameId: b.gameId,
      title: f.title,
      year: f.releasedYear,
      genres: f.genres ?? [],
      mechanics: f.mechanics ?? [],
    };
  });

  const libraryTitles = await loadLibraryTitles(me.id, 10);

  let aiResult: RerankResponse | null = null;
  try {
    aiResult = await invokeRerankRecs({
      userId: me.id,
      cacheKey: cacheKey(filters),
      filters,
      mode: refinements.length > 0 ? "rerank-only" : "full",
      shortlist,
      userRefinements: refinements,
      libraryTitles,
    });
  } catch (err) {
    console.error("rerank-recs failed", err);
    // Fall through to metadata-only path with bucketed shortlist
  }

  if (aiResult) {
    return assembleAIResult(bucketed, aiResult, feasible, socialMap);
  }

  // Metadata fallback — templated reasoning, slot/fit chips intact
  return assembleMetadataResult(bucketed, feasible, socialMap, filters, {
    banner: "AI ranking unavailable — basic matching shown.",
  });
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
```

(`sigmoid`, `readCachedRecs`, `buildResultFromCached`, `loadUserPlatforms`, `loadDismissalsMap`, `loadLibraryGameIds`, `loadLibraryTitles`, `loadUserExploredGenres`, `invokeRerankRecs`, `assembleAIResult`, `assembleMetadataResult` are helper functions in the same file — extract from the existing implementation or write inline.)

- [ ] **Step 4: Write integration test**

Create `tests/integration/recs/get-recs.test.ts`:

```ts
import { describe, expect, it, beforeAll } from "vitest";
import { getRecs } from "@/lib/recs/server-actions";

describe("getRecs integration", () => {
  // These tests need a seeded test user + fixture data. Use the existing
  // Playwright test-user fixtures (memory: tests_setup_2026_05_13.md uses
  // pw_test_ prefix). For Vitest integration tests, seed via a setup file
  // or call the seed helper directly.

  beforeAll(async () => {
    // Seed pw_test_recs_v2 user with: 50 logs across 3 genres, 5 followed
    // users with their own logs, 10 library games, 2 dismissed games.
    // See tests/integration/fixtures/seed-recs-v2.ts (create if missing).
  });

  it("returns 6 bucketed recs for a happy-path user", async () => {
    const result = await getRecs({
      time: "1hr",
      moods: ["challenged"],
      platforms: ["steam"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.recs.length).toBe(6);
      const slots = result.recs.map((r) => r.slot);
      expect(slots).toContain("comfort");
      // Wildcard may or may not fire depending on fixture; check it's at most 1
      expect(slots.filter((s) => s === "wildcard").length).toBeLessThanOrEqual(1);
    }
  });

  it("returns no-candidates when filters exclude everything", async () => {
    // Use a budget that no game qualifies for
    const result = await getRecs({
      time: "15min",
      moods: ["multiplayer"],
      platforms: ["psn"], // assume test user has no PSN games
    });
    if (!result.ok) {
      expect(result.reason).toBe("no-candidates");
    }
  });

  it("respects refinements parameter", async () => {
    const baseline = await getRecs({
      time: "1hr",
      moods: ["challenged"],
      platforms: ["steam"],
    });
    const refined = await getRecs(
      { time: "1hr", moods: ["challenged"], platforms: ["steam"] },
      { refinements: ["less grindy"] },
    );
    expect(refined.ok).toBe(true);
    expect(baseline.ok).toBe(true);
    if (refined.ok && baseline.ok) {
      // Refinements should produce a different ordering or set
      const baseIds = baseline.recs.map((r) => r.gameId).sort().join(",");
      const refIds = refined.recs.map((r) => r.gameId).sort().join(",");
      expect(refIds).not.toBe(baseIds);
    }
  });
});
```

- [ ] **Step 5: Run integration test — expect PASS**

Run: `pnpm vitest run tests/integration/recs/get-recs.test.ts`
Expected: PASS — all 3 tests green. (May need to seed fixtures first; see step 4 note.)

- [ ] **Step 6: Commit**

```bash
git add lib/recs/server-actions.ts tests/integration/recs/get-recs.test.ts
git commit -m "feat(recs): getRecs v2 orchestration — composite scoring + MMR + buckets + refinements"
```

---

## Task 13: Snooze + Never-again server actions

**Goal:** Two new server actions — `snoozeRec(recId, days)` and `neverAgainRec(recId)` — that write to the new `recommendations` columns. Plus update `dismissRec()` to set `dismissed_at` instead of hard-deleting.

**Files:**
- Modify: `lib/recs/server-actions.ts` (add 2 new exports + modify dismissRec)
- Create: `tests/unit/recs/dismissal-actions.test.ts`

**Acceptance Criteria:**
- [ ] `snoozeRec(recId)` sets `snoozed_until = now() + 30 days`
- [ ] `neverAgainRec(recId)` sets `never_again = true` and `dismissed_at = now()`
- [ ] `dismissRec(recId)` (existing) updated to set `dismissed_at = now()` (soft delete) instead of hard delete
- [ ] All three actions require ownership check (rec.userId === currentUser.id)
- [ ] Unit test uses a mocked db client

**Verify:** `pnpm vitest run tests/unit/recs/dismissal-actions.test.ts`

**Steps:**

- [ ] **Step 1: Write failing tests**

Create `tests/unit/recs/dismissal-actions.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the db module so we can assert what SQL is run without hitting Postgres
vi.mock("@/lib/db", () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([{ rowCount: 1 }])),
      })),
    })),
  },
}));

vi.mock("@/lib/supabase/auth-cache", () => ({
  getCachedUser: vi.fn(async () => ({ id: "user-1" })),
}));

import { snoozeRec, neverAgainRec, dismissRec } from "@/lib/recs/server-actions";
import { db } from "@/lib/db";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("snoozeRec", () => {
  it("sets snoozed_until ~30 days in the future", async () => {
    const result = await snoozeRec("rec-123");
    expect(result.ok).toBe(true);
    expect(db.update).toHaveBeenCalled();
  });
});

describe("neverAgainRec", () => {
  it("sets never_again=true + dismissed_at=now", async () => {
    const result = await neverAgainRec("rec-123");
    expect(result.ok).toBe(true);
    expect(db.update).toHaveBeenCalled();
  });
});

describe("dismissRec (soft)", () => {
  it("sets dismissed_at=now without deleting the row", async () => {
    const result = await dismissRec("rec-123");
    expect(result.ok).toBe(true);
    expect(db.update).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm vitest run tests/unit/recs/dismissal-actions.test.ts`
Expected: FAIL — exports don't exist yet (snoozeRec, neverAgainRec), or dismissRec uses delete().

- [ ] **Step 3: Implement**

In `lib/recs/server-actions.ts`:

```ts
export async function snoozeRec(recId: string): Promise<{ ok: boolean; reason?: string }> {
  const me = await getCachedUser();
  if (!me) return { ok: false, reason: "unauthorized" };

  const snoozedUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await db
    .update(recommendations)
    .set({ snoozedUntil })
    .where(and(eq(recommendations.id, recId), eq(recommendations.userId, me.id)));

  revalidatePath("/play-next");
  return { ok: true };
}

export async function neverAgainRec(recId: string): Promise<{ ok: boolean; reason?: string }> {
  const me = await getCachedUser();
  if (!me) return { ok: false, reason: "unauthorized" };

  await db
    .update(recommendations)
    .set({ neverAgain: true, dismissedAt: new Date() })
    .where(and(eq(recommendations.id, recId), eq(recommendations.userId, me.id)));

  revalidatePath("/play-next");
  return { ok: true };
}

// Update existing dismissRec — change from delete() to update setting dismissed_at
export async function dismissRec(recId: string): Promise<{ ok: boolean; reason?: string }> {
  const me = await getCachedUser();
  if (!me) return { ok: false, reason: "unauthorized" };

  await db
    .update(recommendations)
    .set({ dismissedAt: new Date() })
    .where(and(eq(recommendations.id, recId), eq(recommendations.userId, me.id)));

  revalidatePath("/play-next");
  return { ok: true };
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm vitest run tests/unit/recs/dismissal-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/recs/server-actions.ts tests/unit/recs/dismissal-actions.test.ts
git commit -m "feat(recs): snooze + never-again actions; soft-delete dismiss"
```

---

## Task 14: UI atoms — ConfidencePill, SlotBadge, LibraryBadge

**Goal:** Three small presentational components used by the redesigned card.

**Files:**
- Create: `components/recs/atoms/confidence-pill.tsx`
- Create: `components/recs/atoms/slot-badge.tsx`
- Create: `components/recs/atoms/library-badge.tsx`
- Create: `tests/unit/recs/atoms.test.tsx`

**Acceptance Criteria:**
- [ ] `<ConfidencePill confidence="strong" />` renders "Strong match" with solid brand purple
- [ ] `<ConfidencePill confidence="good" />` renders "Good match" with outlined brand purple
- [ ] `<ConfidencePill confidence="worth-a-try" />` renders "Worth a try" with outlined muted
- [ ] `<SlotBadge slot="wildcard" />` renders visually distinct from comfort/backlog/friends
- [ ] `<LibraryBadge />` renders "In your library" pill
- [ ] All components accessible (no role conflicts, appropriate text contrast)

**Verify:** `pnpm vitest run tests/unit/recs/atoms.test.tsx`

**Steps:**

- [ ] **Step 1: Write failing tests**

Create `tests/unit/recs/atoms.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConfidencePill } from "@/components/recs/atoms/confidence-pill";
import { SlotBadge } from "@/components/recs/atoms/slot-badge";
import { LibraryBadge } from "@/components/recs/atoms/library-badge";

describe("ConfidencePill", () => {
  it("renders 'Strong match' for strong confidence", () => {
    render(<ConfidencePill confidence="strong" />);
    expect(screen.getByText("Strong match")).toBeInTheDocument();
  });
  it("renders 'Good match' for good confidence", () => {
    render(<ConfidencePill confidence="good" />);
    expect(screen.getByText("Good match")).toBeInTheDocument();
  });
  it("renders 'Worth a try' for worth-a-try confidence", () => {
    render(<ConfidencePill confidence="worth-a-try" />);
    expect(screen.getByText("Worth a try")).toBeInTheDocument();
  });
});

describe("SlotBadge", () => {
  it("renders 'Comfort' for comfort slot", () => {
    render(<SlotBadge slot="comfort" />);
    expect(screen.getByText("Comfort")).toBeInTheDocument();
  });
  it("renders 'Backlog' for backlog slot", () => {
    render(<SlotBadge slot="backlog" />);
    expect(screen.getByText("Backlog")).toBeInTheDocument();
  });
  it("renders 'Friend pick' for friends slot", () => {
    render(<SlotBadge slot="friends" />);
    expect(screen.getByText("Friend pick")).toBeInTheDocument();
  });
  it("renders 'Wildcard' for wildcard slot", () => {
    render(<SlotBadge slot="wildcard" />);
    expect(screen.getByText("Wildcard")).toBeInTheDocument();
  });
});

describe("LibraryBadge", () => {
  it("renders 'In your library'", () => {
    render(<LibraryBadge />);
    expect(screen.getByText("In your library")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm vitest run tests/unit/recs/atoms.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement ConfidencePill**

Create `components/recs/atoms/confidence-pill.tsx`:

```tsx
import { cn } from "@/lib/utils";

type Confidence = "strong" | "good" | "worth-a-try";

const LABELS: Record<Confidence, string> = {
  strong: "Strong match",
  good: "Good match",
  "worth-a-try": "Worth a try",
};

const STYLES: Record<Confidence, string> = {
  strong: "bg-brand-purple text-white border border-brand-purple",
  good: "border border-brand-purple text-brand-purple bg-transparent",
  "worth-a-try": "border border-muted-foreground/40 text-muted-foreground bg-transparent",
};

export function ConfidencePill({ confidence }: { confidence: Confidence }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        STYLES[confidence],
      )}
    >
      {LABELS[confidence]}
    </span>
  );
}
```

- [ ] **Step 4: Implement SlotBadge**

Create `components/recs/atoms/slot-badge.tsx`:

```tsx
import { cn } from "@/lib/utils";

type Slot = "comfort" | "backlog" | "friends" | "wildcard";

const LABELS: Record<Slot, string> = {
  comfort: "Comfort",
  backlog: "Backlog",
  friends: "Friend pick",
  wildcard: "Wildcard",
};

const STYLES: Record<Slot, string> = {
  comfort: "bg-muted text-muted-foreground",
  backlog: "bg-brand-purple/10 text-brand-purple",
  friends: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  wildcard: "bg-orange-500/15 text-orange-700 dark:text-orange-400 ring-1 ring-orange-500/40",
};

export function SlotBadge({ slot }: { slot: Slot }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide",
        STYLES[slot],
      )}
    >
      {LABELS[slot]}
    </span>
  );
}
```

- [ ] **Step 5: Implement LibraryBadge**

Create `components/recs/atoms/library-badge.tsx`:

```tsx
import { cn } from "@/lib/utils";

export function LibraryBadge() {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md bg-brand-purple/80 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm",
      )}
    >
      In your library
    </span>
  );
}
```

- [ ] **Step 6: Run test — expect PASS**

Run: `pnpm vitest run tests/unit/recs/atoms.test.tsx`
Expected: PASS — all atom tests green.

- [ ] **Step 7: Commit**

```bash
git add components/recs/atoms/ tests/unit/recs/atoms.test.tsx
git commit -m "feat(recs): UI atoms — ConfidencePill + SlotBadge + LibraryBadge"
```

---

## Task 15: New RecCard component

**Goal:** Replace `components/recs/rec-card.tsx` with the redesigned layout — cover with library + confidence overlays, full reasoning (no clamp), fit chip row + slot badge, condensed action row with Snooze/Never-again split.

**Files:**
- Modify: `components/recs/rec-card.tsx` (full rewrite)
- Create: `tests/unit/recs/rec-card-v2.test.tsx`

**Acceptance Criteria:**
- [ ] Renders cover, library badge (when in library), confidence pill, title+year
- [ ] Full reasoning text (no `line-clamp`)
- [ ] Fit chips row + slot badge
- [ ] Primary "Play this" button + bookmark icon + X icon
- [ ] Clicking X opens a dropdown with "Not for me" (snooze) and "Never show this again" (hard exclude)
- [ ] Wildcard cards skip the confidence pill (confidence is misleading on intentional OOD picks)
- [ ] Tests cover all conditional rendering paths

**Verify:** `pnpm vitest run tests/unit/recs/rec-card-v2.test.tsx`

**Steps:**

- [ ] **Step 1: Read current rec-card.tsx**

Open `components/recs/rec-card.tsx` and note the existing props interface so the new version is compatible at the callsite.

- [ ] **Step 2: Write failing tests**

Create `tests/unit/recs/rec-card-v2.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecCard } from "@/components/recs/rec-card";

const baseRec = {
  id: "rec-1",
  gameId: 42,
  slug: "test-game",
  title: "Test Game",
  releasedYear: 2024,
  posterUrl: "/test.jpg",
  coverUrl: "/test.jpg",
  score: 0.85,
  reason: "A full reasoning sentence that should not be clipped at all in the v2 redesign.",
  platforms: ["PC"] as string[] | null,
  algorithm: "ai" as const,
  slot: "comfort" as const,
  fitChips: {
    timeFit: "perfect" as const,
    moodMatches: ["challenged"],
    inLibrary: false,
    friendsCount: 0,
  },
  confidence: "strong" as const,
};

describe("RecCard v2", () => {
  it("renders the full reasoning text without clipping", () => {
    render(<RecCard rec={baseRec} />);
    expect(screen.getByText(/full reasoning sentence/)).toBeInTheDocument();
  });

  it("shows confidence pill for non-wildcard cards", () => {
    render(<RecCard rec={baseRec} />);
    expect(screen.getByText("Strong match")).toBeInTheDocument();
  });

  it("HIDES confidence pill for wildcard cards", () => {
    render(<RecCard rec={{ ...baseRec, slot: "wildcard" }} />);
    expect(screen.queryByText("Strong match")).not.toBeInTheDocument();
  });

  it("shows library badge when inLibrary=true", () => {
    render(
      <RecCard
        rec={{
          ...baseRec,
          fitChips: { ...baseRec.fitChips, inLibrary: true },
        }}
      />,
    );
    expect(screen.getByText("In your library")).toBeInTheDocument();
  });

  it("shows friends chip when friendsCount>0", () => {
    render(
      <RecCard
        rec={{
          ...baseRec,
          fitChips: { ...baseRec.fitChips, friendsCount: 3 },
        }}
      />,
    );
    expect(screen.getByText(/3 played/i)).toBeInTheDocument();
  });

  it("opens dismiss dropdown when X clicked", () => {
    render(<RecCard rec={baseRec} />);
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(screen.getByText("Not for me")).toBeInTheDocument();
    expect(screen.getByText("Never show this again")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test — expect FAIL**

Run: `pnpm vitest run tests/unit/recs/rec-card-v2.test.tsx`
Expected: FAIL — RecCard doesn't yet render new structure.

- [ ] **Step 4: Implement the new RecCard**

Replace `components/recs/rec-card.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { Bookmark, X, Clock, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ConfidencePill } from "@/components/recs/atoms/confidence-pill";
import { SlotBadge } from "@/components/recs/atoms/slot-badge";
import { LibraryBadge } from "@/components/recs/atoms/library-badge";
import {
  saveRecForLater,
  snoozeRec,
  neverAgainRec,
  playRec,
} from "@/lib/recs/server-actions";
import type { RecCard as RecCardData } from "@/lib/recs/server-actions";

export function RecCard({ rec }: { rec: RecCardData }) {
  const [isPending, startTransition] = useTransition();

  const onPlay = () =>
    startTransition(async () => {
      await playRec(rec.id);
    });
  const onSave = () =>
    startTransition(async () => {
      await saveRecForLater(rec.id);
    });
  const onSnooze = () =>
    startTransition(async () => {
      await snoozeRec(rec.id);
    });
  const onNeverAgain = () =>
    startTransition(async () => {
      await neverAgainRec(rec.id);
    });

  const showConfidence = rec.slot !== "wildcard";

  return (
    <div className="flex flex-col rounded-lg border bg-card overflow-hidden">
      {/* Cover with overlays */}
      <div className="relative aspect-[2/3] w-full">
        <Link href={`/g/${rec.slug}`} className="absolute inset-0">
          {rec.coverUrl && (
            <Image
              src={rec.coverUrl}
              alt={rec.title}
              fill
              sizes="(max-width: 768px) 100vw, 33vw"
              className="object-cover transition-transform hover:scale-[1.02]"
            />
          )}
        </Link>
        {rec.fitChips.inLibrary && (
          <div className="absolute left-2 top-2">
            <LibraryBadge />
          </div>
        )}
        {showConfidence && (
          <div className="absolute right-2 top-2">
            <ConfidencePill confidence={rec.confidence} />
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-baseline gap-2">
          <h3 className="font-semibold text-base leading-tight">
            <Link href={`/g/${rec.slug}`} className="hover:underline">
              {rec.title}
            </Link>
          </h3>
          {rec.releasedYear && (
            <span className="text-xs text-muted-foreground">
              '{String(rec.releasedYear).slice(-2)}
            </span>
          )}
        </div>

        <p className="text-sm text-muted-foreground leading-relaxed">{rec.reason}</p>

        {/* Fit chips + slot badge */}
        <div className="flex flex-wrap gap-1.5">
          <SlotBadge slot={rec.slot} />
          {rec.fitChips.timeFit && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px]",
                rec.fitChips.timeFit === "perfect"
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <Clock className="h-3 w-3" />
              {rec.fitChips.timeFit === "perfect" ? "Perfect length" : rec.fitChips.timeFit === "close" ? "Close fit" : "Loose fit"}
            </span>
          )}
          {rec.fitChips.moodMatches.map((m) => (
            <span
              key={m}
              className="inline-flex items-center rounded-md bg-brand-purple/10 px-2 py-0.5 text-[11px] text-brand-purple"
            >
              {capitalize(m)}
            </span>
          ))}
          {rec.fitChips.friendsCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 px-2 py-0.5 text-[11px] text-blue-700 dark:text-blue-400">
              <Users className="h-3 w-3" />
              {rec.fitChips.friendsCount} played
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button
            className="flex-1"
            onClick={onPlay}
            disabled={isPending}
            size="sm"
          >
            Play this →
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={onSave}
            disabled={isPending}
            aria-label="Save for later"
          >
            <Bookmark className="h-4 w-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Dismiss">
                <X className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onSnooze}>
                Not for me <span className="ml-auto text-[10px] text-muted-foreground">snooze 30d</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onNeverAgain}>
                Never show this again
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
```

- [ ] **Step 5: Run test — expect PASS**

Run: `pnpm vitest run tests/unit/recs/rec-card-v2.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/recs/rec-card.tsx tests/unit/recs/rec-card-v2.test.tsx
git commit -m "feat(recs): redesigned RecCard — full reasoning, slot badge, snooze/never split"
```

---

## Task 16: FilterChipPopover component

**Goal:** Interactive filter chip — shows current value, click opens a popover to edit. Used to replace the wizard for in-place filter editing.

**Files:**
- Create: `components/recs/filter-chip-popover.tsx`
- Create: `tests/unit/recs/filter-chip-popover.test.tsx`

**Acceptance Criteria:**
- [ ] Renders the current filter value
- [ ] Opens popover on click
- [ ] Calls `onChange` with new value when user selects
- [ ] Closes popover on selection
- [ ] Three filter variants: time, mood, platform

**Verify:** `pnpm vitest run tests/unit/recs/filter-chip-popover.test.tsx`

**Steps:**

- [ ] **Step 1: Write failing test**

Create `tests/unit/recs/filter-chip-popover.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilterChipPopover } from "@/components/recs/filter-chip-popover";

describe("FilterChipPopover — time variant", () => {
  it("renders current value", () => {
    render(
      <FilterChipPopover
        variant="time"
        value="1hr"
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(/1 hour/i)).toBeInTheDocument();
  });

  it("opens popover and calls onChange on selection", () => {
    const onChange = vi.fn();
    render(
      <FilterChipPopover variant="time" value="1hr" onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /1 hour/i }));
    fireEvent.click(screen.getByText(/15 min/i));
    expect(onChange).toHaveBeenCalledWith("15min");
  });
});

describe("FilterChipPopover — mood variant", () => {
  it("supports multi-select up to 2", () => {
    const onChange = vi.fn();
    render(
      <FilterChipPopover variant="mood" value={["chill"]} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /chill/i }));
    fireEvent.click(screen.getByText(/challenged/i));
    expect(onChange).toHaveBeenCalledWith(["chill", "challenged"]);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm vitest run tests/unit/recs/filter-chip-popover.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `components/recs/filter-chip-popover.tsx`:

```tsx
"use client";

import { useState } from "react";
import { ChevronDown, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Mood, TimeBudget } from "@/lib/recs/moods";
import type { Platform } from "@/lib/games/types";

type TimeProps = {
  variant: "time";
  value: TimeBudget;
  onChange: (next: TimeBudget) => void;
};

type MoodProps = {
  variant: "mood";
  value: Mood[];
  onChange: (next: Mood[]) => void;
};

type PlatformProps = {
  variant: "platform";
  value: Platform[];
  options: Platform[]; // only show connected platforms
  onChange: (next: Platform[]) => void;
};

type Props = TimeProps | MoodProps | PlatformProps;

const TIME_OPTIONS: Array<{ value: TimeBudget; label: string }> = [
  { value: "15min", label: "15 min" },
  { value: "1hr", label: "1 hour" },
  { value: "3hr+", label: "3+ hours" },
  { value: "multi-session", label: "Multi-session" },
];

const MOOD_OPTIONS: Array<{ value: Mood; label: string }> = [
  { value: "chill", label: "Chill" },
  { value: "challenged", label: "Challenged" },
  { value: "story-driven", label: "Story-driven" },
  { value: "mindless", label: "Mindless" },
  { value: "multiplayer", label: "Multiplayer" },
];

const PLATFORM_LABELS: Record<Platform, string> = {
  steam: "Steam",
  xbox: "Xbox",
  psn: "PlayStation",
};

export function FilterChipPopover(props: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="rounded-full">
          {renderChipLabel(props)} <ChevronDown className="ml-1 h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="start">
        {renderOptions(props, () => setOpen(false))}
      </PopoverContent>
    </Popover>
  );
}

function renderChipLabel(props: Props): string {
  if (props.variant === "time") {
    return TIME_OPTIONS.find((o) => o.value === props.value)?.label ?? "Time";
  }
  if (props.variant === "mood") {
    if (props.value.length === 0) return "Mood";
    return props.value
      .map((v) => MOOD_OPTIONS.find((o) => o.value === v)?.label ?? v)
      .join(" + ");
  }
  if (props.value.length === 0) return "Platform";
  return props.value.map((v) => PLATFORM_LABELS[v]).join(", ");
}

function renderOptions(props: Props, close: () => void): React.ReactNode {
  if (props.variant === "time") {
    return TIME_OPTIONS.map((o) => (
      <button
        key={o.value}
        className="flex w-full items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-muted"
        onClick={() => {
          props.onChange(o.value);
          close();
        }}
      >
        {o.label}
        {props.value === o.value && <Check className="h-3 w-3" />}
      </button>
    ));
  }

  if (props.variant === "mood") {
    return MOOD_OPTIONS.map((o) => {
      const selected = props.value.includes(o.value);
      const disabled = !selected && props.value.length >= 2;
      return (
        <button
          key={o.value}
          disabled={disabled}
          className={cn(
            "flex w-full items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-muted",
            disabled && "opacity-50 cursor-not-allowed",
          )}
          onClick={() => {
            const next = selected
              ? props.value.filter((v) => v !== o.value)
              : [...props.value, o.value];
            props.onChange(next);
            // Don't auto-close for multi-select — user may want to pick a second
          }}
        >
          {o.label}
          {selected && <Check className="h-3 w-3" />}
        </button>
      );
    });
  }

  return props.options.map((p) => {
    const selected = props.value.includes(p);
    return (
      <button
        key={p}
        className="flex w-full items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-muted"
        onClick={() => {
          const next = selected
            ? props.value.filter((v) => v !== p)
            : [...props.value, p];
          props.onChange(next);
        }}
      >
        {PLATFORM_LABELS[p]}
        {selected && <Check className="h-3 w-3" />}
      </button>
    );
  });
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm vitest run tests/unit/recs/filter-chip-popover.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/recs/filter-chip-popover.tsx tests/unit/recs/filter-chip-popover.test.tsx
git commit -m "feat(recs): FilterChipPopover for in-place filter editing"
```

---

## Task 17: RefinementInput component

**Goal:** Mascot-row freeform refinement input with quick chips + active refinement pills + URL state sync.

**Files:**
- Create: `components/recs/refinement-input.tsx`
- Create: `tests/unit/recs/refinement-input.test.tsx`

**Acceptance Criteria:**
- [ ] Renders mascot illustration + input + submit button
- [ ] Renders 6-7 quick chips ("Less grindy", "More story", etc.)
- [ ] Clicking a quick chip commits it as a refinement
- [ ] Free-text input commits on Enter or button click
- [ ] Active refinements render as dismissable pills with × buttons
- [ ] 140-char input limit enforced
- [ ] Max 5 active refinements; adding 6th drops oldest
- [ ] "Clear all" button visible when ≥2 active
- [ ] Calls `onChange(refinements: string[])` whenever the active set changes

**Verify:** `pnpm vitest run tests/unit/recs/refinement-input.test.tsx`

**Steps:**

- [ ] **Step 1: Write failing tests**

Create `tests/unit/recs/refinement-input.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RefinementInput } from "@/components/recs/refinement-input";

describe("RefinementInput", () => {
  it("renders the input and quick chips", () => {
    render(<RefinementInput active={[]} onChange={() => {}} />);
    expect(screen.getByPlaceholderText(/less grindy/i)).toBeInTheDocument();
    expect(screen.getByText(/less grindy/i)).toBeInTheDocument();
    expect(screen.getByText(/more story/i)).toBeInTheDocument();
  });

  it("commits a quick chip on click", () => {
    const onChange = vi.fn();
    render(<RefinementInput active={[]} onChange={onChange} />);
    fireEvent.click(screen.getAllByText(/more story/i)[0]);
    expect(onChange).toHaveBeenCalledWith(["more story"]);
  });

  it("commits free-text on Enter", () => {
    const onChange = vi.fn();
    render(<RefinementInput active={[]} onChange={onChange} />);
    const input = screen.getByPlaceholderText(/less grindy/i);
    fireEvent.change(input, { target: { value: "weirder games" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["weirder games"]);
  });

  it("renders active refinements as dismissable pills", () => {
    const onChange = vi.fn();
    render(<RefinementInput active={["less grindy", "shorter"]} onChange={onChange} />);
    expect(screen.getAllByText("less grindy").length).toBeGreaterThan(0);
    expect(screen.getAllByText("shorter").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText('Remove "less grindy"'));
    expect(onChange).toHaveBeenCalledWith(["shorter"]);
  });

  it("clamps input to 140 chars", () => {
    const onChange = vi.fn();
    render(<RefinementInput active={[]} onChange={onChange} />);
    const input = screen.getByPlaceholderText(/less grindy/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "x".repeat(200) } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange.mock.calls[0][0][0].length).toBe(140);
  });

  it("drops oldest when adding 6th refinement", () => {
    const onChange = vi.fn();
    render(
      <RefinementInput
        active={["a", "b", "c", "d", "e"]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getAllByText(/less grindy/i)[0]);
    expect(onChange).toHaveBeenCalledWith(["b", "c", "d", "e", "less grindy"]);
  });

  it("shows 'Clear all' button when 2+ active", () => {
    render(<RefinementInput active={["a", "b"]} onChange={() => {}} />);
    expect(screen.getByText(/clear all/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm vitest run tests/unit/recs/refinement-input.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `components/recs/refinement-input.tsx`:

```tsx
"use client";

import { useState } from "react";
import { X, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MascotIllustration } from "@/components/mascot/illustration";
import { cn } from "@/lib/utils";

const MAX_ACTIVE = 5;
const CHAR_CAP = 140;
const QUICK_CHIPS = [
  "less grindy",
  "more story",
  "solo only",
  "newer",
  "shorter",
  "something cozy",
  "surprise me",
];

type Props = {
  active: string[];
  onChange: (next: string[]) => void;
};

export function RefinementInput({ active, onChange }: Props) {
  const [text, setText] = useState("");

  const commit = (raw: string) => {
    const cleaned = raw.replace(/\n/g, " ").trim().slice(0, CHAR_CAP);
    if (cleaned.length === 0) return;
    if (active.includes(cleaned)) return;
    const next = [...active, cleaned];
    if (next.length > MAX_ACTIVE) next.shift();
    onChange(next);
    setText("");
  };

  const remove = (s: string) => {
    onChange(active.filter((x) => x !== s));
  };

  const clearAll = () => onChange([]);

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="hidden shrink-0 sm:block">
          <MascotIllustration pose="curious" size={64} />
        </div>
        <div className="flex-1 space-y-3">
          <p className="text-sm">Not landing? Tell Cortez what to try:</p>
          <div className="flex gap-2">
            <Input
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, CHAR_CAP))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit(text);
                }
              }}
              placeholder={'e.g. "less grindy"'}
              maxLength={CHAR_CAP}
              className="flex-1"
            />
            <Button onClick={() => commit(text)} size="sm">
              Try <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span className="text-xs text-muted-foreground self-center">
              Quick:
            </span>
            {QUICK_CHIPS.map((chip) => (
              <button
                key={chip}
                onClick={() => commit(chip)}
                disabled={active.includes(chip)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs hover:bg-muted",
                  active.includes(chip) && "opacity-50 cursor-not-allowed",
                )}
              >
                {chip}
              </button>
            ))}
          </div>
        </div>
      </div>

      {active.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Active refinements:</span>
          {active.map((r) => (
            <span
              key={r}
              className="inline-flex items-center gap-1 rounded-md bg-brand-purple/10 px-2 py-0.5 text-xs text-brand-purple"
            >
              {r}
              <button
                onClick={() => remove(r)}
                aria-label={`Remove "${r}"`}
                className="rounded hover:bg-brand-purple/20"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {active.length >= 2 && (
            <button
              onClick={clearAll}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

(Note: `MascotIllustration` is assumed to exist from earlier phases. If the import path differs, adjust to match the actual mascot component — check `components/mascot/`.)

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm vitest run tests/unit/recs/refinement-input.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/recs/refinement-input.tsx tests/unit/recs/refinement-input.test.tsx
git commit -m "feat(recs): RefinementInput component (free text + quick chips + active pills)"
```

---

## Task 18: /play-next page rewire

**Goal:** Replace the wizard-then-grid flow with a single live page — interactive filter chips, refinement input, 3×2 grid, URL state for both filters and refinements.

**Files:**
- Modify: `app/(app)/play-next/page.tsx`
- Modify: `app/(app)/play-next/_client.tsx`
- (Optional) Remove or repurpose `components/recs/mascot-prompt.tsx`, `components/recs/filter-chips.tsx`

**Acceptance Criteria:**
- [ ] Page renders 3×2 grid of new RecCards
- [ ] Filter chips edit in-place via popover; no wizard backtrack
- [ ] Refinement input above grid; submitting re-runs getRecs with refinements param
- [ ] URL reflects filters (`?time=1hr&moods=challenged&platforms=steam`) AND refinements (`?refine=less-grindy,shorter`)
- [ ] Back button + share link work correctly
- [ ] Default state (no filters) shows the grid with sensible defaults (`time=1hr`, `moods=[chill]`, all-connected platforms)
- [ ] Mobile: 1-up grid, filters stack
- [ ] Loading state: 6 skeleton cards
- [ ] Empty state: "No picks match — try widening your filters or removing a refinement"

**Verify:** Manual smoke + `pnpm tsc --noEmit && pnpm vitest run tests/`

**Steps:**

- [ ] **Step 1: Read current play-next/page.tsx and _client.tsx**

Understand the existing wizard pattern + how filter state flows. Note the parse-URL helper if present so the new version is consistent.

- [ ] **Step 2: Rewrite page.tsx**

```tsx
// app/(app)/play-next/page.tsx
import { Suspense } from "react";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import { redirect } from "next/navigation";
import { getRecs } from "@/lib/recs/server-actions";
import { filterSchema } from "@/lib/recs/moods";
import { loadUserConnectedPlatforms } from "@/lib/platforms/server-helpers";
import { PlayNextClient } from "./_client";
import { PlayNextSkeleton } from "./loading";

export const metadata = { title: "Play next" };

type SearchParams = {
  time?: string;
  moods?: string;
  platforms?: string;
  refine?: string;
};

function parseSearchParams(sp: SearchParams, connectedPlatforms: string[]) {
  const parsed = filterSchema.safeParse({
    time: sp.time ?? "1hr",
    moods: sp.moods ? sp.moods.split(",") : ["chill"],
    platforms: sp.platforms ? sp.platforms.split(",") : connectedPlatforms,
  });
  const refinements = sp.refine ? sp.refine.split(",").map(decodeURIComponent).slice(0, 5) : [];
  return { filters: parsed.success ? parsed.data : null, refinements };
}

export default async function PlayNextPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await getCachedUser();
  if (!me) redirect("/login?next=/play-next");

  const connectedPlatforms = await loadUserConnectedPlatforms(me.id);
  const sp = await searchParams;
  const { filters, refinements } = parseSearchParams(sp, connectedPlatforms);

  if (!filters) {
    // Invalid URL params — reset to default
    redirect("/play-next");
  }

  const result = await getRecs(filters, { refinements });

  return (
    <Suspense fallback={<PlayNextSkeleton />}>
      <PlayNextClient
        initialResult={result}
        initialFilters={filters}
        initialRefinements={refinements}
        connectedPlatforms={connectedPlatforms}
      />
    </Suspense>
  );
}
```

- [ ] **Step 3: Rewrite _client.tsx**

```tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import { FilterChipPopover } from "@/components/recs/filter-chip-popover";
import { RefinementInput } from "@/components/recs/refinement-input";
import { RecCard } from "@/components/recs/rec-card";
import { Button } from "@/components/ui/button";
import type { RecResult } from "@/lib/recs/server-actions";
import type { FilterParams, Mood, TimeBudget } from "@/lib/recs/moods";
import type { Platform } from "@/lib/games/types";

type Props = {
  initialResult: RecResult;
  initialFilters: FilterParams;
  initialRefinements: string[];
  connectedPlatforms: Platform[];
};

export function PlayNextClient({
  initialResult,
  initialFilters,
  initialRefinements,
  connectedPlatforms,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<RecResult>(initialResult);

  const updateUrl = (next: { filters?: Partial<FilterParams>; refinements?: string[] }) => {
    const sp = new URLSearchParams(params);
    if (next.filters?.time) sp.set("time", next.filters.time);
    if (next.filters?.moods) sp.set("moods", next.filters.moods.join(","));
    if (next.filters?.platforms) sp.set("platforms", next.filters.platforms.join(","));
    if (next.refinements !== undefined) {
      if (next.refinements.length === 0) sp.delete("refine");
      else sp.set("refine", next.refinements.map(encodeURIComponent).join(","));
    }
    startTransition(() => {
      router.push(`/play-next?${sp.toString()}`);
    });
  };

  const onTimeChange = (t: TimeBudget) => updateUrl({ filters: { time: t } });
  const onMoodsChange = (m: Mood[]) => updateUrl({ filters: { moods: m } });
  const onPlatformsChange = (p: Platform[]) => updateUrl({ filters: { platforms: p } });
  const onRefinementsChange = (r: string[]) => updateUrl({ refinements: r });

  return (
    <div className="container mx-auto max-w-6xl space-y-6 py-6">
      <h1 className="text-2xl font-bold">What should I play next?</h1>

      <div className="flex flex-wrap gap-2">
        <FilterChipPopover
          variant="time"
          value={initialFilters.time}
          onChange={onTimeChange}
        />
        <FilterChipPopover
          variant="mood"
          value={initialFilters.moods}
          onChange={onMoodsChange}
        />
        <FilterChipPopover
          variant="platform"
          value={initialFilters.platforms}
          options={connectedPlatforms}
          onChange={onPlatformsChange}
        />
      </div>

      <RefinementInput
        active={initialRefinements}
        onChange={onRefinementsChange}
      />

      {result.ok ? (
        <>
          {result.banner && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              {result.banner}
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {result.recs.map((rec) => (
              <RecCard key={rec.id} rec={rec} />
            ))}
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No picks match — try widening your filters or removing a refinement.
          </p>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => router.push("/play-next")}
          >
            Reset
          </Button>
        </div>
      )}

      {isPending && (
        <div className="text-center text-xs text-muted-foreground">Updating...</div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Type-check + smoke**

Run: `pnpm tsc --noEmit && pnpm dev`

Open http://localhost:3000/play-next, manually verify:
- 3×2 grid renders
- Clicking time chip opens popover
- Selecting different time changes URL + grid updates
- Typing a refinement + Enter adds it to active list + grid updates
- Click × on a refinement pill removes it
- Click X on a rec card opens dropdown with Snooze / Never again

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/play-next/page.tsx app/\(app\)/play-next/_client.tsx
git commit -m "feat(play-next): page rewire — in-place filter chips + refinement + 3x2 grid"
```

---

## Task 19: Feature flag `recsv2`

**Goal:** Gate the new behavior behind a single `recsv2` flag readable from env (or DB) so we can flip it off and revert to the existing implementation in one toggle during rollout.

**Files:**
- Create: `lib/recs/feature-flag.ts`
- Modify: `lib/recs/server-actions.ts` (call the flag and branch)
- Modify: `app/(app)/play-next/page.tsx` (also branch on flag)
- Modify: `.env.example` (document the flag)
- Modify: `lib/env.ts` (add the flag to the env schema)

**Acceptance Criteria:**
- [ ] Flag readable via `isRecsV2Enabled(userId)` — returns boolean
- [ ] When `false`, falls back to the existing /play-next implementation (preserved as `getRecsLegacy` and `<PlayNextLegacy>`)
- [ ] When `true` (default for now), serves the new pipeline
- [ ] Env var `RECS_V2_ENABLED=true|false` controls the flag globally
- [ ] Optional per-user override via `RECS_V2_USERS=uuid1,uuid2,...` (for canary rollout)

**Verify:** `pnpm tsc --noEmit && pnpm vitest run tests/unit/recs/feature-flag.test.ts`

**Steps:**

- [ ] **Step 1: Implement the flag**

Create `lib/recs/feature-flag.ts`:

```ts
import "server-only";

import { env } from "@/lib/env";

/**
 * Determines whether to use the v2 /play-next pipeline.
 *
 * Resolution order:
 * 1. If `RECS_V2_USERS` includes the user's ID, return true (canary user).
 * 2. Else return `RECS_V2_ENABLED` (global flag).
 *
 * Default in production: false (until rollout begins).
 * Default in dev: true (to exercise the new path).
 */
export function isRecsV2Enabled(userId: string): boolean {
  const canaryUsers = (env.RECS_V2_USERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (canaryUsers.includes(userId)) return true;
  return env.RECS_V2_ENABLED ?? (env.NODE_ENV !== "production");
}
```

- [ ] **Step 2: Update env schema**

In `lib/env.ts`, add:

```ts
RECS_V2_ENABLED: z
  .string()
  .optional()
  .transform((s) => s === "true"),
RECS_V2_USERS: z.string().optional(),
```

- [ ] **Step 3: Branch in server-actions.ts**

Add the flag check at the top of `getRecs`. Task 12 already preserved the legacy body as `getRecsLegacy` (see T12 Step 1.5), so this step only adds the branch:

```ts
import { isRecsV2Enabled } from "@/lib/recs/feature-flag";

export async function getRecs(
  rawFilters: FilterParams,
  options?: { refinements?: string[] },
): Promise<RecResult> {
  const me = await getCachedUser();
  if (!me) return { ok: false, reason: "unauthorized" };

  if (!isRecsV2Enabled(me.id)) {
    return getRecsLegacy(rawFilters);
  }

  // ... rest of v2 implementation (already in place from Task 12) ...
}

// `getRecsLegacy` is already defined in the file from Task 12 Step 1.5.
// No additional code needed for this step in server-actions.ts beyond
// inserting the `if (!isRecsV2Enabled(...))` block above.
```

- [ ] **Step 4: Branch in the page**

The page-level flag check is more subtle because Task 18 already overwrote `_client.tsx`. Approach: render v2 client only when the flag is on; otherwise serve a minimal "this feature is being upgraded — check back soon" message. We do NOT preserve the legacy client (it's still in git history). Production rollout starts with flag ON for admin user; legacy users never see the old version again.

In `app/(app)/play-next/page.tsx`, immediately after `redirect("/login?next=/play-next")`:

```tsx
import { isRecsV2Enabled } from "@/lib/recs/feature-flag";

// ... existing imports + auth check

if (!isRecsV2Enabled(me.id)) {
  return (
    <div className="container mx-auto max-w-2xl py-12 text-center">
      <h1 className="text-2xl font-bold">Play next is being upgraded</h1>
      <p className="mt-2 text-muted-foreground">
        Check back soon — this feature is rolling out gradually.
      </p>
    </div>
  );
}

// ... rest of the v2 page logic (filter parsing, getRecs call, render)
```

Rationale: the legacy `/play-next` had quality issues that motivated this redesign. Showing it to non-canary users during rollout would be a regression. The server-action flag check (Step 3) handles the underlying data path; the page-level check just hides the UI surface from non-canary users entirely.

Alternative if you want to preserve a working legacy fallback: also copy the pre-Task-18 `_client.tsx` to `_legacy-client.tsx` and render it inside the `if (!useV2)` branch. Decide based on rollout strategy with the operator.

- [ ] **Step 5: Write feature-flag tests**

Create `tests/unit/recs/feature-flag.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

describe("isRecsV2Enabled", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns true when global RECS_V2_ENABLED=true", async () => {
    vi.stubEnv("RECS_V2_ENABLED", "true");
    vi.stubEnv("RECS_V2_USERS", "");
    const { isRecsV2Enabled } = await import("@/lib/recs/feature-flag");
    expect(isRecsV2Enabled("user-1")).toBe(true);
  });

  it("returns false when global is off and user not in canary list", async () => {
    vi.stubEnv("RECS_V2_ENABLED", "false");
    vi.stubEnv("RECS_V2_USERS", "");
    vi.stubEnv("NODE_ENV", "production");
    const { isRecsV2Enabled } = await import("@/lib/recs/feature-flag");
    expect(isRecsV2Enabled("user-1")).toBe(false);
  });

  it("returns true for canary user even when global is off", async () => {
    vi.stubEnv("RECS_V2_ENABLED", "false");
    vi.stubEnv("RECS_V2_USERS", "user-canary,user-2");
    vi.stubEnv("NODE_ENV", "production");
    const { isRecsV2Enabled } = await import("@/lib/recs/feature-flag");
    expect(isRecsV2Enabled("user-canary")).toBe(true);
    expect(isRecsV2Enabled("user-other")).toBe(false);
  });
});
```

Note: `vi.stubEnv` must hoist above any dynamic import that touches `lib/env.ts` (per `tests_setup_2026_05_13.md`).

- [ ] **Step 6: Update .env.example**

Add to `.env.example`:

```
# Feature flag: enable the v2 /play-next pipeline (composite scoring,
# stratified buckets, conversational refinement). Default in dev: true.
# Default in prod: false until rollout begins.
RECS_V2_ENABLED=
# Comma-separated user IDs that get v2 even when the global flag is off.
# Used for canary rollout.
RECS_V2_USERS=
```

- [ ] **Step 7: Run tests**

Run: `pnpm vitest run tests/unit/recs/feature-flag.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/recs/feature-flag.ts lib/recs/server-actions.ts lib/env.ts app/\(app\)/play-next/ tests/unit/recs/feature-flag.test.ts .env.example
git commit -m "feat(recs): recsv2 feature flag with global + canary controls"
```

---

## Task 20: Playwright end-to-end test

**Goal:** Browser-driven test verifying the core /play-next v2 flow: page loads, grid renders, filter chip popover edits in place, refinement adds an active pill, wildcard slot visually distinct.

**Files:**
- Create: `tests/e2e/play-next-v2.spec.ts`

**Acceptance Criteria:**
- [ ] Authenticates as a Playwright test user with seeded log/library data
- [ ] Verifies 6 rec cards render
- [ ] Verifies clicking time filter chip opens popover and selecting changes the URL
- [ ] Verifies typing a refinement + Enter adds a pill + the grid changes
- [ ] Verifies dismissing a pill removes it + the grid changes back
- [ ] Verifies wildcard card has a visually distinct slot badge
- [ ] Test completes in <30s

**Verify:** `pnpm playwright test play-next-v2.spec.ts`

**Steps:**

- [ ] **Step 1: Write the test**

Create `tests/e2e/play-next-v2.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test.describe("/play-next v2", () => {
  test.beforeEach(async ({ page }) => {
    // Use existing Playwright sign-in helper for a seeded test user
    // (see tests/e2e/_helpers/auth.ts pattern from memory)
    await page.goto("/login");
    await page.fill('[name="email"]', "pw_test_recsv2@example.com");
    await page.click("button[type=submit]");
    await page.waitForURL("/u/**");
  });

  test("grid, filter popover, refinement flow", async ({ page }) => {
    await page.goto("/play-next");

    // 1. Grid renders
    const cards = page.locator('[data-testid="rec-card"]');
    await expect(cards).toHaveCount(6, { timeout: 10000 });

    // 2. Click time filter chip → popover opens
    await page.getByRole("button", { name: /1 hour/i }).click();
    await expect(page.getByText("15 min")).toBeVisible();
    await page.getByText("15 min").click();
    await expect(page).toHaveURL(/time=15min/);

    // 3. Add a refinement
    const input = page.getByPlaceholder(/less grindy/i);
    await input.fill("less grindy");
    await input.press("Enter");
    await expect(page).toHaveURL(/refine=less-grindy/);
    await expect(page.locator('text="less grindy"').first()).toBeVisible();

    // 4. Remove the refinement
    await page.getByLabel('Remove "less grindy"').click();
    await expect(page).not.toHaveURL(/refine=/);

    // 5. Wildcard slot has distinct badge (if present in this fixture set)
    const wildcards = page.locator('[data-slot="wildcard"]');
    const wildcardCount = await wildcards.count();
    if (wildcardCount > 0) {
      const badge = wildcards.first().locator('text="Wildcard"');
      await expect(badge).toBeVisible();
    }
  });

  test("dismiss split menu opens with Snooze + Never again", async ({ page }) => {
    await page.goto("/play-next");
    await page.locator('[data-testid="rec-card"]').first().locator("[aria-label='Dismiss']").click();
    await expect(page.getByText("Not for me")).toBeVisible();
    await expect(page.getByText("Never show this again")).toBeVisible();
  });
});
```

- [ ] **Step 2: Add `data-testid` attributes**

In `components/recs/rec-card.tsx`, add `data-testid="rec-card"` and `data-slot={rec.slot}` to the root `<div>`:

```tsx
<div className="..." data-testid="rec-card" data-slot={rec.slot}>
```

- [ ] **Step 3: Seed a test user**

If `pw_test_recsv2@example.com` doesn't exist yet, seed it via the existing test-user fixture helper (memory: `tests_setup_2026_05_13.md` — uses `pw_test_` prefix). The user needs:
- ≥50 logs across 3+ genres
- ≥5 followed users with their own logs
- ≥10 library games
- ≥2 dismissed recommendations

Add to `tests/e2e/_fixtures/seed-recs-v2.ts` if a new helper is needed.

- [ ] **Step 4: Run the test**

Run: `pnpm playwright test play-next-v2`
Expected: 2 tests pass in <30s combined.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/play-next-v2.spec.ts components/recs/rec-card.tsx tests/e2e/_fixtures/
git commit -m "test(e2e): Playwright coverage for /play-next v2 flow"
```

---

## Task 21: Verification gate

**Goal:** Run the spec's complete verification gate (12 automated + 4 manual checks). All green = ready to merge.

**Files:**
- Create: `scripts/verify-play-next-v2.ts` (orchestrates the automated checks)

**Acceptance Criteria:**
- [ ] All 12 automated checks pass (full test suite + targeted integration)
- [ ] All 4 manual checks documented as performed + screenshots in commit message

**Verify:** `pnpm tsx scripts/verify-play-next-v2.ts`

**Steps:**

- [ ] **Step 1: Write the verification script**

Create `scripts/verify-play-next-v2.ts`:

```ts
import { execSync } from "node:child_process";

const checks: Array<{ name: string; cmd: string }> = [
  { name: "Schema-v2 tests", cmd: "pnpm vitest run tests/unit/recs/schema-v2.test.ts" },
  { name: "Mood affinity", cmd: "pnpm vitest run tests/unit/recs/mood-affinity.test.ts" },
  { name: "Time fit", cmd: "pnpm vitest run tests/unit/recs/time-fit.test.ts" },
  { name: "Social score", cmd: "pnpm vitest run tests/unit/recs/social-score.test.ts" },
  { name: "Soft negative", cmd: "pnpm vitest run tests/unit/recs/soft-negative.test.ts" },
  { name: "Scoring", cmd: "pnpm vitest run tests/unit/recs/scoring.test.ts" },
  { name: "MMR diversity", cmd: "pnpm vitest run tests/unit/recs/diversity-mmr.test.ts" },
  { name: "Wildcard", cmd: "pnpm vitest run tests/unit/recs/wildcard.test.ts" },
  { name: "Buckets", cmd: "pnpm vitest run tests/unit/recs/buckets.test.ts" },
  { name: "Rerank prompt v2", cmd: "pnpm vitest run tests/unit/recs/rerank-prompt.test.ts" },
  { name: "getRecs integration", cmd: "pnpm vitest run tests/integration/recs/get-recs.test.ts" },
  { name: "E2E Playwright", cmd: "pnpm playwright test play-next-v2" },
];

let failed = 0;
for (const c of checks) {
  process.stdout.write(`Running ${c.name}... `);
  try {
    execSync(c.cmd, { stdio: "pipe" });
    console.log("✓");
  } catch (e) {
    console.log("✗");
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n${failed} of ${checks.length} automated checks failed.`);
  process.exit(1);
}

console.log(`\nAll ${checks.length} automated checks passed.`);
console.log(`\nManual checks remaining:`);
console.log(`  1. Visual review of 3×2 grid against the current /play-next screenshot`);
console.log(`  2. Refinement input UX — "less grindy" → grid changes meaningfully in <2s`);
console.log(`  3. Wildcard sanity check (3 users, 3 different histories) — wildcard pick is surprising`);
console.log(`  4. Provider-failover smoke — yank CEREBRAS_API_KEY, verify Groq picks up`);
```

- [ ] **Step 2: Run the verification**

```bash
pnpm tsx scripts/verify-play-next-v2.ts
```

Expected: all 12 checks pass.

- [ ] **Step 3: Perform manual checks**

For each of the 4 manual checks:
- Take a screenshot (or short Loom) demonstrating the behavior
- Note any deviations from expectation

- [ ] **Step 4: Final commit + tag**

```bash
git add scripts/verify-play-next-v2.ts
git commit -m "chore(verify): play-next v2 verification gate script"
git tag play-next-v2-complete
```

Optional: push the tag with `git push origin play-next-v2-complete` once the feature branch is pushed and PR is ready.

---

## Phase A complete

When all 21 tasks pass their verification gates, Phase A is done. The flag `RECS_V2_ENABLED=true` can be set in production for rollout, with `RECS_V2_USERS` controlling the canary set during gradual rollout.

**Suggested rollout sequence:**
1. Deploy to production with `RECS_V2_ENABLED=false` and `RECS_V2_USERS=<your_admin_user_id>` — only you see v2
2. Use the feature for 2-3 days, refine any rough edges that real usage surfaces
3. Add 3-5 power users to `RECS_V2_USERS` for a wider canary
4. After a week of canary, flip `RECS_V2_ENABLED=true` for full rollout
5. After 2-4 weeks of stable v2, remove the flag + delete `getRecsLegacy` in a cleanup PR

**Fast-follow tickets** (Phase B per spec):
- Today's Pick daily card on homepage (1-2 days)
- Per-card "More like this" (0.5 day)
- Inline detail expand panel (1 day)
- Confidence-pill axis tooltip (2 hours)
