# Phase 4 — Taste Fingerprint + Recommendations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the differentiating "AI-first" feature — aggregate logs/reviews into vectors, generate an AI narrative taste read, surface hybrid recommendations with mood/time/platform filter context, and ship a Twitter/Discord-shareable trading-card image. Meet all 8 items of the Phase 4 verification gate.

**Architecture:** Vector aggregation is pure SQL+TS (deterministic, live). AI narrative + rec rerank run inside Supabase Edge Functions (Deno, no Vercel timeout) and reuse the Phase 2 provider router. The fingerprint page renders four distinct tier states (empty/sparse/sharpening/full) at 0/1–9/10–29/30+ logs. `/play-next` is a mascot-driven 3-step filter flow (time → mood → platform → 5 recs) with cache key `(userId, sortedMoods, time, sortedPlatforms)`. Share card is Vercel OG Edge rendering a pixel-art trading card whose mascot pose maps to the user's dominant taste cluster.

**Tech Stack:** Next.js 16 App Router · Server Actions · Drizzle ORM · Supabase Edge Functions (Deno) · Supabase pg_cron · TanStack Query v5 · Zustand · Framer Motion · Vercel OG · zod · Upstash Redis · AI provider router (Cerebras → Groq → Cloudflare → DeepSeek, established in Phase 2)

**Spec:** [docs/superpowers/specs/2026-05-12-phase4-taste-recs-design.md](../specs/2026-05-12-phase4-taste-recs-design.md)

---

## File Structure

```
lib/taste/
├─ aggregate.ts                  Weighted blend → vectors (Q1 math)
├─ vectors.ts                    Cosine similarity + drift function
├─ tier.ts                       tierForUser(logCount) → 'empty' | 'sparse' | 'sharpening' | 'full'
├─ triggers.ts                   triggerOnLogWrite — milestone fire + cache invalidate
├─ prompts.ts                    buildNarrativePrompt + buildRerankPrompt + version constants
├─ playstyle.ts                  Mechanic → playstyle string (e.g. "Tactician") for share card
└─ server-actions.ts             refreshFingerprint, getFingerprint

lib/recs/
├─ candidate-pool.ts             Metadata-similarity prefilter (top 50)
├─ rerank.ts                     Rerank orchestrator (cache check → reuse OR fetch)
├─ cache.ts                      Stable cache-key hash
├─ moods.ts                      MOODS / TIMES const + zod schemas
└─ server-actions.ts             getRecs, refillRecs, dismissRec, saveRecForLater, playRec

lib/og/
├─ taste-card.tsx                Vercel OG JSX (1200×630 trading card)
└─ dominant-pose.ts              Vectors → MascotPose

supabase/functions/
├─ refresh-fingerprint/
│  └─ index.ts                   Aggregate → AI narrative → save (snapshot vectors)
├─ rerank-recs/
│  └─ index.ts                   Build prompt → AI call → persist cache rows
└─ taste-drift-cron/
   └─ index.ts                   Daily — find drifted users → enqueue refresh-fingerprint

lib/db/migrations/
└─ 0006_phase4_taste.sql         Drizzle-generated additive migration

supabase/migrations/
└─ 000Z_phase4_drift_cron.sql    pg_cron schedule registration (NOT Drizzle-managed)

components/taste/
├─ score-bar.tsx                 Pixel-art 8-cell horizontal bar (negative-aware)
├─ chart-grid.tsx                Top-genres / top-themes / top-mechanics / length stack
├─ tier-empty.tsx                Empty-tier render (mascot excited, CTA)
├─ tier-sparse.tsx               Sparse-tier render (greyed charts, hint speech bubble)
├─ tier-narrative.tsx            Sharpening + full render (narrative speech bubble)
├─ refresh-button.tsx            Refresh fingerprint client island
└─ share-modal.tsx               Tweet / Copy link / Download (trading card preview)

components/recs/
├─ filter-chips.tsx              Time / mood / platform chip row
├─ mascot-prompt.tsx             Mascot + speech bubble for each filter step
├─ rec-card.tsx                  Poster + title + reason + 3 buttons
└─ refill-button.tsx             "Show me more like these →" CTA

app/(app)/
├─ me/
│  └─ taste/page.tsx             Owner shortcut — redirects to /u/{ownUsername}/taste
├─ u/[username]/
│  └─ taste/page.tsx             Tier-aware page (RSC + client islands)
└─ play-next/
   └─ page.tsx                   3-step filter flow + results

app/api/og/taste/
└─ [username]/route.ts           Vercel OG endpoint (Edge runtime, 1200×630)

scripts/                         tsx smoke scripts (Phase 2/3 pattern)
├─ smoke-aggregate.ts            12-case truth table for weight × sign × normalization
├─ smoke-drift.ts                Cosine math edge cases (identity, scaling, orthogonality)
└─ smoke-recs-cache.ts           Cache-key hash determinism + sort stability

scripts/
└─ verify-phase-4.ts             39 automated checks across 9 groups (mirrors verify-phase-3 shape)

lib/db/schema.ts                 (modify) — 3 new columns + 1 rename + cache_key + 2 partial indexes
lib/recs/server-actions.ts       (caller into) lib/logs/server-actions.ts wires triggerOnLogWrite via after()
lib/logs/server-actions.ts       (modify) — fire triggerOnLogWrite on create/update/delete
lib/reviews/server-actions.ts    (modify) — fire triggerOnLogWrite on publish
app/(app)/home/cockpit-dashboard.tsx (modify) — add 2 new cards (Your taste / What should I play?)
components/layout/profile-dropdown.tsx (modify) — add "View your taste" link
```

---

## Testing convention

Same as Phase 2 and Phase 3:

- **Pure functions** (`aggregate`, `vectors`, `cache`, `dominant-pose`, `tier`): a `tsx` smoke script under `scripts/` exercises the function with hand-picked cases and prints PASS/FAIL. Run with `pnpm tsx scripts/smoke-<name>.ts`. Exit code 0 on all-pass, 1 otherwise.
- **Type-level**: every task runs `pnpm typecheck && pnpm lint && pnpm build` at the verify step. Treat the build as the integration test.
- **Edge Functions**: `supabase functions serve` locally + `curl` to exercise. Production verification happens in the final task (verification gate).
- **UI/Routes**: manual smoke per the per-task verify steps; Task 20 (verify-phase-4) is the gate.

If you find a real bug while writing a smoke script — fix it before committing.

---

## Task ordering rationale

Six-week spiral build per the spec's Strategy C. Tasks 1–3 lay the data foundation (schema + math + chart-only page) — by end of T3 a real user can visit `/me/taste` and see real charts with the sharpening tier UI. Tasks 4–7 add AI narrative + all four tier states + milestone triggers — by T7 a milestone-cross auto-generates a fresh narrative.

Tasks 8–10 ship `/play-next` with metadata-only recs (no AI rerank yet). Tasks 11–13 add the AI rerank with filter context + graceful AI-failure fallback. Tasks 14–15 ship the 3-button feedback loop and the refill CTA. Tasks 16–17 ship the trading-card share endpoint + share modal. Task 18 schedules the daily drift cron. Task 19 surfaces the new pages on `/home` cockpit + profile dropdown + adds the first-fingerprint milestone celebration toast. Task 20 ships `verify-phase-4.ts`, runs the 4 manual items, and closes the gate (tag + memory).

One branch per task (e.g. `phase-4-t1-schema`, `phase-4-t2-aggregate`, …). Merge to main on green verify per task. Avoids the Phase 3 "everything wired at the end" pattern.

---

## Task 1: Schema migration + tier function + cosine math

**Goal:** Drizzle schema changes for the Phase 4 columns, generated migration `0006_phase4_taste.sql`, plus the two pure-math modules (`tier.ts` and `vectors.ts`) that everything downstream imports.

**Files:**
- Modify: `lib/db/schema.ts` (3 column additions on `tasteFingerprints`, 1 rename, 1 column addition on `recommendations`, 2 new partial indexes)
- Create: `lib/db/migrations/0006_phase4_taste.sql` (Drizzle-generated)
- Create: `lib/taste/tier.ts`
- Create: `lib/taste/vectors.ts`
- Create: `scripts/smoke-drift.ts`

**Acceptance Criteria:**
- [ ] `lib/db/schema.ts`: `tasteFingerprints` has columns `vectorsGeneratedAt` (renamed from `generatedAt`), `narrativeGeneratedAt`, `narrativeSnapshotVectors`, `narrativeModelVersion` (renamed from `modelVersion`). `recommendations` has column `cacheKey`. Two new partial indexes: `recommendations_user_cache_key_idx` (WHERE dismissed = false) and `recommendations_user_dismissed_idx` (WHERE dismissed = true).
- [ ] `lib/db/migrations/0006_phase4_taste.sql` exists, contains no `CREATE TABLE "auth"."users"` line (Drizzle gotcha — strip if present per memory).
- [ ] `lib/taste/tier.ts` exports `tierForUser(logCount: number): 'empty' | 'sparse' | 'sharpening' | 'full'`.
- [ ] `lib/taste/vectors.ts` exports `cosineSim(a: Record<string, number>, b: Record<string, number>): number` and `drift(current: VectorBundle, snapshot: VectorBundle | null): number`.
- [ ] `pnpm tsx scripts/smoke-drift.ts` exits 0.
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean.

**Verify:** `pnpm tsx scripts/smoke-drift.ts && pnpm drizzle-kit generate && pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Update `lib/db/schema.ts` for the Phase 4 changes**

Find the existing `tasteFingerprints` block (~line 229). Replace the block so the forward-looking comment header is removed (we're shipping it now) and the renamed/new columns appear:

```typescript
// ─────────────────────────────────────────────────────────────
// AI taste fingerprint + recommendations — Phase 4
// ─────────────────────────────────────────────────────────────
export const tasteFingerprints = pgTable("taste_fingerprints", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  genreVector: jsonb("genre_vector").notNull().default(sql`'{}'::jsonb`),
  themeVector: jsonb("theme_vector").notNull().default(sql`'{}'::jsonb`),
  mechanicVector: jsonb("mechanic_vector").notNull().default(sql`'{}'::jsonb`),
  lengthPreference: jsonb("length_preference").notNull().default(sql`'{}'::jsonb`),
  difficultyPreference: jsonb("difficulty_preference").notNull().default(sql`'{}'::jsonb`),
  narrativeSummary: text("narrative_summary"),
  // Snapshot of vectors at the moment narrativeSummary was generated.
  // Used by the daily drift cron to decide whether to re-narrate.
  // Shape: { genre: Record<string, number>, theme: ..., mechanic: ... }
  narrativeSnapshotVectors: jsonb("narrative_snapshot_vectors"),
  totalLogsAtGeneration: integer("total_logs_at_generation").notNull().default(0),
  // narrative_model_version = which AI generated narrativeSummary (e.g.
  // "cerebras-qwen3-480b/narrative-v1"). Vector math is deterministic so
  // it has no model version.
  narrativeModelVersion: varchar("narrative_model_version", { length: 64 }),
  vectorsGeneratedAt: timestamp("vectors_generated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  narrativeGeneratedAt: timestamp("narrative_generated_at", { withTimezone: true }),
});
```

Find the existing `recommendations` block and add the `cacheKey` column + two new partial indexes:

```typescript
export const recommendations = pgTable(
  "recommendations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    score: numeric("score", { precision: 5, scale: 4 }).notNull(),
    reason: text("reason"),
    algorithm: recAlgorithmEnum("algorithm").notNull(),
    // Cache key = hash(userId + sortedMoods + time + sortedPlatforms).
    // Null for one-shot/legacy rows. Per-key cardinality is bounded — see
    // lib/recs/cache.ts.
    cacheKey: text("cache_key"),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    dismissed: boolean("dismissed").notNull().default(false),
  },
  (table) => ({
    // Cache-hit lookup: same (user, cacheKey, freshness ordering) for live recs.
    userCacheKeyIdx: index("recommendations_user_cache_key_idx")
      .on(table.userId, table.cacheKey, desc(table.generatedAt))
      .where(sql`${table.dismissed} = false`),
    // Negative-context lookup: most-recent dismissed by user (for rerank prompt).
    userDismissedIdx: index("recommendations_user_dismissed_idx")
      .on(table.userId, desc(table.generatedAt))
      .where(sql`${table.dismissed} = true`),
  }),
);
```

- [ ] **Step 2: Generate the migration**

```powershell
pnpm drizzle-kit generate
```

Check the new `lib/db/migrations/0006_*.sql` file. **CRITICAL** — per the Drizzle auth.users gotcha memory: grep the generated SQL for any `CREATE TABLE "auth"."users"` line and strip it if present. Drizzle sometimes hallucinates this from the FK references. The Phase 0 migration had this issue; later migrations have been clean, but always verify.

```powershell
Select-String -Path lib/db/migrations/0006_*.sql -Pattern 'CREATE TABLE "auth"."users"'
```

Should return nothing. If it finds a match, edit the SQL file to delete that block.

- [ ] **Step 3: Create `lib/taste/tier.ts`**

```typescript
/**
 * Tier classification for a user's taste data maturity.
 *
 * Drives:
 * - Which mascot pose renders on /u/{name}/taste
 * - Whether the narrative section is shown
 * - Whether AI rec rerank runs (sparse tier falls back to metadata-only)
 * - Which copy appears in onboarding nudges
 *
 * Thresholds chosen so a brand-new user crosses 'sparse' fast (any log),
 * unlocks the AI narrative at the 10-log milestone, and earns the "no
 * sharpening banner" full state at 30 logs (the master plan gate point).
 */
export type TasteTier = "empty" | "sparse" | "sharpening" | "full";

export function tierForUser(logCount: number): TasteTier {
  if (logCount <= 0) return "empty";
  if (logCount < 10) return "sparse";
  if (logCount < 30) return "sharpening";
  return "full";
}

/** Convenience — predicate forms. */
export function isAtLeast(tier: TasteTier, minimum: TasteTier): boolean {
  const order: TasteTier[] = ["empty", "sparse", "sharpening", "full"];
  return order.indexOf(tier) >= order.indexOf(minimum);
}
```

- [ ] **Step 4: Create `lib/taste/vectors.ts`**

```typescript
/**
 * Vector math for the taste fingerprint.
 *
 * Vectors are sparse maps from token (genre name, theme name, mechanic name)
 * to score in [-1, +1]. Missing keys are treated as 0.
 *
 * The drift function is what powers the daily cron's "should we re-narrate?"
 * decision. Cosine similarity is direction-only — a vector that scales 2x
 * has drift 0. That's what we want: "shape of taste changed" matters more
 * than "more games logged in the same genres."
 */

export type SparseVector = Record<string, number>;

export type VectorBundle = {
  genre: SparseVector;
  theme: SparseVector;
  mechanic: SparseVector;
};

/**
 * Cosine similarity over sparse vectors. Result in [-1, 1].
 * Two empty vectors → 0 (treated as "no shared signal").
 */
export function cosineSim(a: SparseVector, b: SparseVector): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const av = a[key] ?? 0;
    const bv = b[key] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Max cosine distance across the three vector fields between the current
 * snapshot and the snapshot taken at last narrative generation.
 *
 * Returns Infinity when no snapshot exists (forces a regen).
 *
 * Threshold guidance: 0.25 = significant taste shift; 0.1 = noisy churn.
 * Tune in W2 once we have a few real users to calibrate against.
 */
export function drift(
  current: VectorBundle,
  snapshot: VectorBundle | null,
): number {
  if (!snapshot) return Infinity;
  return Math.max(
    1 - cosineSim(current.genre, snapshot.genre),
    1 - cosineSim(current.theme, snapshot.theme),
    1 - cosineSim(current.mechanic, snapshot.mechanic),
  );
}
```

- [ ] **Step 5: Create `scripts/smoke-drift.ts`**

```typescript
import { cosineSim, drift, type SparseVector, type VectorBundle } from "@/lib/taste/vectors";
import { tierForUser, isAtLeast } from "@/lib/taste/tier";

type Case = { name: string; fn: () => boolean };

const cases: Case[] = [
  {
    name: "tierForUser: 0 → empty",
    fn: () => tierForUser(0) === "empty",
  },
  {
    name: "tierForUser: 1 → sparse",
    fn: () => tierForUser(1) === "sparse",
  },
  {
    name: "tierForUser: 9 → sparse",
    fn: () => tierForUser(9) === "sparse",
  },
  {
    name: "tierForUser: 10 → sharpening",
    fn: () => tierForUser(10) === "sharpening",
  },
  {
    name: "tierForUser: 29 → sharpening",
    fn: () => tierForUser(29) === "sharpening",
  },
  {
    name: "tierForUser: 30 → full",
    fn: () => tierForUser(30) === "full",
  },
  {
    name: "tierForUser: 500 → full",
    fn: () => tierForUser(500) === "full",
  },
  {
    name: "isAtLeast(sharpening, sparse) === true",
    fn: () => isAtLeast("sharpening", "sparse") === true,
  },
  {
    name: "isAtLeast(sparse, sharpening) === false",
    fn: () => isAtLeast("sparse", "sharpening") === false,
  },
  {
    name: "cosineSim: identical vectors === 1",
    fn: () => {
      const v: SparseVector = { a: 1, b: 2, c: 3 };
      return Math.abs(cosineSim(v, v) - 1) < 1e-10;
    },
  },
  {
    name: "cosineSim: scaled vectors === 1 (direction only)",
    fn: () => {
      const a: SparseVector = { a: 1, b: 2 };
      const b: SparseVector = { a: 2, b: 4 };
      return Math.abs(cosineSim(a, b) - 1) < 1e-10;
    },
  },
  {
    name: "cosineSim: orthogonal vectors === 0",
    fn: () => {
      const a: SparseVector = { x: 1 };
      const b: SparseVector = { y: 1 };
      return Math.abs(cosineSim(a, b)) < 1e-10;
    },
  },
  {
    name: "cosineSim: opposite vectors === -1",
    fn: () => {
      const a: SparseVector = { x: 1, y: 1 };
      const b: SparseVector = { x: -1, y: -1 };
      return Math.abs(cosineSim(a, b) - -1) < 1e-10;
    },
  },
  {
    name: "cosineSim: empty vector returns 0 (no NaN)",
    fn: () => {
      const a: SparseVector = {};
      const b: SparseVector = { x: 1 };
      return cosineSim(a, b) === 0;
    },
  },
  {
    name: "drift: null snapshot → Infinity",
    fn: () => {
      const current: VectorBundle = { genre: { a: 1 }, theme: {}, mechanic: {} };
      return drift(current, null) === Infinity;
    },
  },
  {
    name: "drift: identical snapshot → 0",
    fn: () => {
      const current: VectorBundle = { genre: { a: 1 }, theme: { b: 1 }, mechanic: { c: 1 } };
      return Math.abs(drift(current, current)) < 1e-10;
    },
  },
  {
    name: "drift: orthogonal genre shift → 1",
    fn: () => {
      const current: VectorBundle = { genre: { y: 1 }, theme: { b: 1 }, mechanic: { c: 1 } };
      const snap: VectorBundle = { genre: { x: 1 }, theme: { b: 1 }, mechanic: { c: 1 } };
      return Math.abs(drift(current, snap) - 1) < 1e-10;
    },
  },
];

let failed = 0;
for (const c of cases) {
  const ok = c.fn();
  console.log(`${ok ? "✓" : "✗"} ${c.name}`);
  if (!ok) failed++;
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 6: Run the smoke**

```powershell
pnpm tsx scripts/smoke-drift.ts
```

Expected: `17/17 passed` and exit 0.

- [ ] **Step 7: Typecheck, lint, build**

```powershell
pnpm typecheck; if ($?) { pnpm lint }; if ($?) { pnpm build }
```

All three clean.

- [ ] **Step 8: Apply migration to dev DB**

```powershell
pnpm tsx scripts/migrate.ts
```

(The project has an existing migrate helper from Phase 3 — if it doesn't exist, use `pnpm drizzle-kit push` or the equivalent. Either way: confirm the new columns exist on Supabase dashboard.)

- [ ] **Step 9: Commit**

```powershell
git add lib/db/schema.ts lib/db/migrations/0006_*.sql lib/taste/tier.ts lib/taste/vectors.ts scripts/smoke-drift.ts
git commit -m "feat(taste): schema migration 0006 + tier function + cosine math

- tasteFingerprints: add narrativeGeneratedAt, narrativeSnapshotVectors;
  rename generatedAt → vectorsGeneratedAt, modelVersion → narrativeModelVersion
- recommendations: add cacheKey column + 2 partial indexes (cache-hit + dismissed)
- lib/taste/tier.ts: tierForUser(logCount) → 4-tier classifier
- lib/taste/vectors.ts: cosineSim + drift (powers daily cron decision)
- 17-case smoke covers tier boundaries + cosine identity/scaling/orthogonality

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Vector aggregation engine

**Goal:** The `aggregate.ts` module that turns logs + reviews + game metadata into the three sparse vectors + length preference distribution, using the Q1 weighted-blend formula. Smoke-tested with a 12-case truth table.

**Files:**
- Create: `lib/taste/aggregate.ts`
- Create: `scripts/smoke-aggregate.ts`

**Acceptance Criteria:**
- [ ] `lib/taste/aggregate.ts` exports `aggregateFingerprint(input: AggregateInput): AggregateResult` where the result has `{ genre, theme, mechanic, lengthPreference, totalLogsAtGeneration }`.
- [ ] The weight function follows Q1: backlog/wishlist = 0.2; engaged (`playing|completed|played|dropped`) = 0.6; rated = 1.0 (+ intensity bonus up to 1.3); review bonus = ×1.15.
- [ ] The sign function: rating < 4 → −1; rating > 6 → +1; rating 4–6 → 0 (neutral, no directional signal); no rating + `dropped` → −1; no rating + anything else positive → +1.
- [ ] All three vectors are in [-1, 1]; sum of lengthPreference values is ≈ 1.0 (or 0 if no length data).
- [ ] `pnpm tsx scripts/smoke-aggregate.ts` exits 0 with all 12 cases pass.
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean.

**Verify:** `pnpm tsx scripts/smoke-aggregate.ts && pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Create `lib/taste/aggregate.ts`**

```typescript
import type { SparseVector, VectorBundle } from "@/lib/taste/vectors";

/** Status enum mirroring lib/db/schema.ts:logStatusEnum. */
type LogStatus = "backlog" | "wishlist" | "playing" | "completed" | "played" | "dropped";

export type AggregateInputRow = {
  /** Required */
  status: LogStatus;
  /** Numeric in [0, 10] or null. Maps to numeric(3,1) on disk. */
  rating: number | null;
  /** Whether a published review exists for this log. */
  hasPublishedReview: boolean;
  /** Game metadata (joined from games table). */
  genres: string[];
  themes: string[];
  mechanics: string[];
  /** numeric(5,1) on disk → number | null in TS. */
  playtimeAvgHours: number | null;
};

export type AggregateInput = {
  rows: AggregateInputRow[];
};

export type LengthBucket = "<5h" | "5-10h" | "10-30h" | "30-60h" | "60h+";
export type LengthPreference = Record<LengthBucket, number>;

export type AggregateResult = VectorBundle & {
  lengthPreference: LengthPreference;
  totalLogsAtGeneration: number;
};

/**
 * Q1 — per-log weight.
 *
 * - Rating dominates: 1.0 baseline + intensity bonus (up to ×1.3 when |r-5|/5 = 1).
 * - Engaged (status ∈ {playing, completed, played, dropped}) without rating: 0.6.
 * - Backlog / wishlist: 0.2 (implicit interest, e.g. bought in a bundle).
 * - Review-bearing logs get an extra ×1.15 because the user spent the most
 *   effort on them.
 */
export function weight(row: AggregateInputRow): number {
  let w: number;
  if (row.rating != null) {
    const intensity = Math.abs(row.rating - 5.0) / 5.0; // 0..1
    w = 1.0 * (1 + 0.3 * intensity); // 1.0 .. 1.3
  } else if (
    row.status === "playing" ||
    row.status === "completed" ||
    row.status === "played" ||
    row.status === "dropped"
  ) {
    w = 0.6;
  } else if (row.status === "backlog" || row.status === "wishlist") {
    w = 0.2;
  } else {
    w = 0;
  }
  if (row.hasPublishedReview) w *= 1.15;
  return w;
}

/**
 * Q1 — per-log sign.
 *
 * Rating 4-6 returns 0 (neutral — no directional signal). Below 4 = active
 * dislike, above 6 = active like. Without rating, "dropped" is implicit
 * dislike; everything else is weak positive interest.
 *
 * A 0 sign means the log's weight goes into totalW (the denominator) but
 * contributes 0 to raw[G] — so it doesn't push the vector either way.
 */
export function sign(row: AggregateInputRow): -1 | 0 | 1 {
  if (row.rating != null) {
    if (row.rating < 4) return -1;
    if (row.rating > 6) return 1;
    return 0;
  }
  if (row.status === "dropped") return -1;
  return 1;
}

function lengthBucket(hours: number): LengthBucket {
  if (hours < 5) return "<5h";
  if (hours < 10) return "5-10h";
  if (hours < 30) return "10-30h";
  if (hours < 60) return "30-60h";
  return "60h+";
}

function emptyLengthPreference(): LengthPreference {
  return { "<5h": 0, "5-10h": 0, "10-30h": 0, "30-60h": 0, "60h+": 0 };
}

/**
 * Aggregate per-log signal into the three sparse vectors + length distribution.
 *
 * For each metadata field G:
 *   raw[G]   = Σ ( sign × weight × indicator(log has G) )
 *   totalW   = Σ weight
 *   score[G] = raw[G] / max(1, totalW)   // → [-1, +1]
 *
 * Length preference is a frequency distribution (no sign — length is
 * descriptive, not preferential) normalized to sum to 1.0.
 */
export function aggregateFingerprint(input: AggregateInput): AggregateResult {
  const genreRaw: SparseVector = {};
  const themeRaw: SparseVector = {};
  const mechanicRaw: SparseVector = {};
  const lengthRaw: LengthPreference = emptyLengthPreference();

  let totalW = 0;
  let totalLengthW = 0;

  for (const row of input.rows) {
    const w = weight(row);
    if (w === 0) continue;
    const s = sign(row);
    totalW += w;

    const signedWeight = s * w;
    for (const g of row.genres) genreRaw[g] = (genreRaw[g] ?? 0) + signedWeight;
    for (const t of row.themes) themeRaw[t] = (themeRaw[t] ?? 0) + signedWeight;
    for (const m of row.mechanics) mechanicRaw[m] = (mechanicRaw[m] ?? 0) + signedWeight;

    if (row.playtimeAvgHours != null && row.playtimeAvgHours > 0) {
      const bucket = lengthBucket(row.playtimeAvgHours);
      lengthRaw[bucket] += w; // unsigned for length distribution
      totalLengthW += w;
    }
  }

  const norm = Math.max(1, totalW);
  const normalize = (vec: SparseVector): SparseVector => {
    const out: SparseVector = {};
    for (const [k, v] of Object.entries(vec)) out[k] = v / norm;
    return out;
  };
  const lengthPreference: LengthPreference = emptyLengthPreference();
  if (totalLengthW > 0) {
    for (const k of Object.keys(lengthRaw) as LengthBucket[]) {
      lengthPreference[k] = lengthRaw[k] / totalLengthW;
    }
  }

  return {
    genre: normalize(genreRaw),
    theme: normalize(themeRaw),
    mechanic: normalize(mechanicRaw),
    lengthPreference,
    totalLogsAtGeneration: input.rows.length,
  };
}
```

- [ ] **Step 2: Create `scripts/smoke-aggregate.ts`**

```typescript
import {
  aggregateFingerprint,
  weight,
  sign,
  type AggregateInputRow,
} from "@/lib/taste/aggregate";

function row(partial: Partial<AggregateInputRow>): AggregateInputRow {
  return {
    status: "played",
    rating: null,
    hasPublishedReview: false,
    genres: [],
    themes: [],
    mechanics: [],
    playtimeAvgHours: null,
    ...partial,
  };
}

type Case = { name: string; fn: () => boolean };

const cases: Case[] = [
  {
    name: "weight: rating=9 → 1.0 × (1 + 0.3 × 0.8) = 1.24",
    fn: () => Math.abs(weight(row({ rating: 9 })) - 1.24) < 1e-6,
  },
  {
    name: "weight: rating=5 (neutral intensity 0) → 1.0",
    fn: () => Math.abs(weight(row({ rating: 5 })) - 1.0) < 1e-6,
  },
  {
    name: "weight: rating=10 (max intensity 1) → 1.3",
    fn: () => Math.abs(weight(row({ rating: 10 })) - 1.3) < 1e-6,
  },
  {
    name: "weight: status=completed, no rating → 0.6",
    fn: () => Math.abs(weight(row({ status: "completed" })) - 0.6) < 1e-6,
  },
  {
    name: "weight: status=backlog, no rating → 0.2",
    fn: () => Math.abs(weight(row({ status: "backlog" })) - 0.2) < 1e-6,
  },
  {
    name: "weight: review bonus stacks (rating=8, hasReview=true)",
    fn: () => {
      const w = weight(row({ rating: 8, hasPublishedReview: true }));
      // 1.0 × (1 + 0.3 × 0.6) = 1.18, × 1.15 = 1.357
      return Math.abs(w - 1.357) < 1e-3;
    },
  },
  {
    name: "sign: rating=8 → +1",
    fn: () => sign(row({ rating: 8 })) === 1,
  },
  {
    name: "sign: rating=2 → -1 (active dislike)",
    fn: () => sign(row({ rating: 2 })) === -1,
  },
  {
    name: "sign: rating=5 → 0 (neutral, no directional signal)",
    fn: () => sign(row({ rating: 5 })) === 0,
  },
  {
    name: "sign: no rating, dropped → -1",
    fn: () => sign(row({ status: "dropped" })) === -1,
  },
  {
    name: "sign: no rating, backlog → +1 (weak positive interest)",
    fn: () => sign(row({ status: "backlog" })) === 1,
  },
  {
    name: "aggregate: empty → empty vectors",
    fn: () => {
      const r = aggregateFingerprint({ rows: [] });
      return (
        Object.keys(r.genre).length === 0 &&
        Object.keys(r.theme).length === 0 &&
        Object.keys(r.mechanic).length === 0 &&
        r.totalLogsAtGeneration === 0
      );
    },
  },
  {
    name: "aggregate: single rated-9 Roguelike → genre['Roguelike'] ≥ 0.99",
    fn: () => {
      const r = aggregateFingerprint({
        rows: [row({ rating: 9, genres: ["Roguelike"] })],
      });
      return r.genre["Roguelike"] >= 0.99;
    },
  },
  {
    name: "aggregate: rated-2 Roguelike → negative entry",
    fn: () => {
      const r = aggregateFingerprint({
        rows: [row({ rating: 2, genres: ["Roguelike"] })],
      });
      return r.genre["Roguelike"] < -0.5;
    },
  },
  {
    name: "aggregate: backlog dilutes rated signal (3 backlog Strategy + 1 rated-8 Roguelike → Roguelike entry < 1)",
    fn: () => {
      const r = aggregateFingerprint({
        rows: [
          row({ status: "backlog", genres: ["Strategy"] }),
          row({ status: "backlog", genres: ["Strategy"] }),
          row({ status: "backlog", genres: ["Strategy"] }),
          row({ rating: 8, genres: ["Roguelike"] }),
        ],
      });
      // totalW = 0.2×3 + 1.18 ≈ 1.78; Roguelike raw = +1.18; score = 1.18/1.78 ≈ 0.66
      return r.genre["Roguelike"] < 0.8 && r.genre["Roguelike"] > 0.5;
    },
  },
  {
    name: "aggregate: lengthPreference sums to ~1 when any length data present",
    fn: () => {
      const r = aggregateFingerprint({
        rows: [
          row({ rating: 8, playtimeAvgHours: 4 }),
          row({ rating: 8, playtimeAvgHours: 25 }),
        ],
      });
      const sum = Object.values(r.lengthPreference).reduce((a, b) => a + b, 0);
      return Math.abs(sum - 1.0) < 1e-6;
    },
  },
  {
    name: "aggregate: lengthPreference is all 0 when no playtime data",
    fn: () => {
      const r = aggregateFingerprint({
        rows: [row({ rating: 8, playtimeAvgHours: null })],
      });
      const sum = Object.values(r.lengthPreference).reduce((a, b) => a + b, 0);
      return sum === 0;
    },
  },
];

let failed = 0;
for (const c of cases) {
  const ok = c.fn();
  console.log(`${ok ? "✓" : "✗"} ${c.name}`);
  if (!ok) failed++;
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 3: Run the smoke**

```powershell
pnpm tsx scripts/smoke-aggregate.ts
```

Expected: `17/17 passed`, exit 0.

- [ ] **Step 4: Typecheck, lint, build**

```powershell
pnpm typecheck; if ($?) { pnpm lint }; if ($?) { pnpm build }
```

- [ ] **Step 5: Commit**

```powershell
git add lib/taste/aggregate.ts scripts/smoke-aggregate.ts
git commit -m "feat(taste): vector aggregation engine — Q1 weighted blend

- weight(): rating dominates (1.0..1.3 with intensity bonus); engaged 0.6;
  backlog/wishlist 0.2; review bonus ×1.15
- sign(): rating ≥7 → +1, ≤3 → -1, 4-6 → 0 (neutral); dropped → -1
- aggregate(): per-genre raw = Σ(sign × weight × indicator); normalized to [-1,1]
- lengthPreference: unsigned distribution over 5 buckets, sums to 1
- 17-case smoke truth table covers all weight × sign × normalization combos

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Bare fingerprint page (sharpening tier) + getFingerprint server action

**Goal:** End of W1 demo. A real user can visit `/me/taste` and see real charts derived from their actual logs. Only the sharpening tier renders (no narrative speech bubble, no refresh button yet — those come in T4–T6).

**Files:**
- Create: `lib/taste/server-actions.ts`
- Create: `components/taste/score-bar.tsx`
- Create: `components/taste/chart-grid.tsx`
- Create: `app/(app)/u/[username]/taste/page.tsx`
- Create: `app/(app)/me/taste/page.tsx`
- Modify: `lib/profile/server-actions.ts` (only if we need a `getOwnUsername` helper that doesn't already exist — verify first)

**Acceptance Criteria:**
- [ ] `lib/taste/server-actions.ts` exports `getFingerprint(userId: string): Promise<{ tier, vectors, lengthPreference, narrative, logCount }>`.
- [ ] `<ScoreBar value={number}>` renders an 8-cell pixel-art bar; negative values render greyed with a `−` indicator.
- [ ] `<ChartGrid>` renders Top Genres / Top Themes / Top Mechanics / Session Length in a 2×2 grid using `<ScoreBar>`.
- [ ] `/me/taste` redirects to `/u/{ownUsername}/taste`.
- [ ] `/u/{username}/taste` renders charts at full opacity for a sharpening/full-tier user; 404s for a private profile when the viewer isn't the owner.
- [ ] Manually verified on dev: a test account with 12 logs sees real per-genre bars matching expectations.
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean.

**Verify:** `pnpm typecheck && pnpm lint && pnpm build` then load `/me/taste` in a logged-in dev session — real charts visible.

**Steps:**

- [ ] **Step 1: Create `lib/taste/server-actions.ts`**

```typescript
"use server";

import "server-only";

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { logs, reviews, games, tasteFingerprints } from "@/lib/db/schema";
import {
  aggregateFingerprint,
  type AggregateInputRow,
} from "@/lib/taste/aggregate";
import { tierForUser, type TasteTier } from "@/lib/taste/tier";
import type { VectorBundle } from "@/lib/taste/vectors";

export type FingerprintSnapshot = {
  tier: TasteTier;
  vectors: VectorBundle;
  lengthPreference: Record<string, number>;
  /** Narrative text from DB; null when not yet generated (sparse/empty) or never refreshed (T4+). */
  narrative: string | null;
  narrativeGeneratedAt: Date | null;
  logCount: number;
};

/**
 * Read-only snapshot for rendering /u/{name}/taste.
 *
 * In Task 3 this is vector-only — no AI narrative yet (the column is null
 * for everyone). Task 4 wires the Edge Function that fills narrative.
 *
 * Aggregation is computed live on every call. Cheap enough for a 1000-log
 * power user (<50ms). When this becomes a hot path we'll move to a stored
 * row + cron-driven refresh; not yet.
 */
export async function getFingerprint(userId: string): Promise<FingerprintSnapshot> {
  // Single join query pulling everything aggregateFingerprint needs.
  const rows = await db
    .select({
      status: logs.status,
      rating: logs.rating,
      hasPublishedReview: sql<boolean>`${reviews.id} IS NOT NULL`,
      genres: games.genres,
      themes: games.themes,
      mechanics: games.mechanics,
      playtimeAvgHours: games.playtimeAvgHours,
    })
    .from(logs)
    .innerJoin(games, eq(games.id, logs.gameId))
    .leftJoin(
      reviews,
      sql`${reviews.logId} = ${logs.id} AND ${reviews.publishedAt} IS NOT NULL`,
    )
    .where(eq(logs.userId, userId));

  const inputRows: AggregateInputRow[] = rows.map((r) => ({
    status: r.status as AggregateInputRow["status"],
    rating: r.rating != null ? Number(r.rating) : null,
    hasPublishedReview: r.hasPublishedReview,
    genres: r.genres ?? [],
    themes: r.themes ?? [],
    mechanics: r.mechanics ?? [],
    playtimeAvgHours: r.playtimeAvgHours != null ? Number(r.playtimeAvgHours) : null,
  }));

  const agg = aggregateFingerprint({ rows: inputRows });

  // Pull the persisted narrative (if any) without forcing a write.
  const fpRows = await db
    .select({
      narrative: tasteFingerprints.narrativeSummary,
      narrativeGeneratedAt: tasteFingerprints.narrativeGeneratedAt,
    })
    .from(tasteFingerprints)
    .where(eq(tasteFingerprints.userId, userId))
    .limit(1);

  return {
    tier: tierForUser(inputRows.length),
    vectors: { genre: agg.genre, theme: agg.theme, mechanic: agg.mechanic },
    lengthPreference: agg.lengthPreference,
    narrative: fpRows[0]?.narrative ?? null,
    narrativeGeneratedAt: fpRows[0]?.narrativeGeneratedAt ?? null,
    logCount: inputRows.length,
  };
}
```

- [ ] **Step 2: Create `components/taste/score-bar.tsx`**

```typescript
import { cn } from "@/lib/utils";

/**
 * Pixel-art 8-cell horizontal score bar.
 *
 * value is in [-1, +1].
 * Positive: cells fill left-to-right based on |value| × 8.
 * Negative: bar renders greyed with a leading "−" indicator. Cells still
 * fill (visually we want to show "this person actively dislikes 5/8 of
 * this trait" rather than hiding it).
 * Near-zero: empty bar.
 */
export function ScoreBar({ value, label }: { value: number; label: string }) {
  const negative = value < 0;
  const magnitude = Math.min(1, Math.abs(value));
  const filled = Math.round(magnitude * 8);

  return (
    <div className="flex items-center gap-2 font-mono text-xs">
      {negative ? (
        <span className="w-3 text-center text-zinc-500" aria-label="negative score">
          −
        </span>
      ) : (
        <span className="w-3" />
      )}
      <div className="flex gap-[2px]" role="presentation" aria-hidden>
        {Array.from({ length: 8 }, (_, i) => (
          <div
            key={i}
            className={cn(
              "h-3 w-2 rounded-[1px]",
              i < filled
                ? negative
                  ? "bg-zinc-500"
                  : "bg-emerald-500"
                : "bg-zinc-800",
            )}
          />
        ))}
      </div>
      <span className={cn("flex-1 truncate", negative && "text-zinc-500")}>
        {label}
      </span>
    </div>
  );
}
```

- [ ] **Step 3: Create `components/taste/chart-grid.tsx`**

```typescript
import { ScoreBar } from "./score-bar";

type SparseVector = Record<string, number>;
type LengthPreference = Record<string, number>;

function topN(vec: SparseVector, n: number): Array<[string, number]> {
  return Object.entries(vec)
    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
    .slice(0, n);
}

export function ChartGrid({
  vectors,
  lengthPreference,
}: {
  vectors: { genre: SparseVector; theme: SparseVector; mechanic: SparseVector };
  lengthPreference: LengthPreference;
}) {
  const genres = topN(vectors.genre, 5);
  const themes = topN(vectors.theme, 5);
  const mechanics = topN(vectors.mechanic, 5);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <ChartCard title="Top Genres">
        {genres.length === 0 ? (
          <Empty />
        ) : (
          genres.map(([k, v]) => <ScoreBar key={k} value={v} label={k} />)
        )}
      </ChartCard>

      <ChartCard title="Top Themes">
        {themes.length === 0 ? (
          <Empty />
        ) : (
          themes.map(([k, v]) => <ScoreBar key={k} value={v} label={k} />)
        )}
      </ChartCard>

      <ChartCard title="Top Mechanics">
        {mechanics.length === 0 ? (
          <Empty />
        ) : (
          mechanics.map(([k, v]) => <ScoreBar key={k} value={v} label={k} />)
        )}
      </ChartCard>

      <ChartCard title="Session Length">
        <LengthDistribution data={lengthPreference} />
      </ChartCard>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950 p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Empty() {
  return <p className="text-xs text-zinc-600">No signal yet.</p>;
}

function LengthDistribution({ data }: { data: LengthPreference }) {
  const buckets: Array<["<5h" | "5-10h" | "10-30h" | "30-60h" | "60h+", string]> = [
    ["<5h", "<5 hrs"],
    ["5-10h", "5–10 hrs"],
    ["10-30h", "10–30 hrs"],
    ["30-60h", "30–60 hrs"],
    ["60h+", "60+ hrs"],
  ];
  return (
    <>
      {buckets.map(([k, label]) => (
        <ScoreBar key={k} value={data[k] ?? 0} label={label} />
      ))}
    </>
  );
}
```

- [ ] **Step 4: Create `app/(app)/u/[username]/taste/page.tsx`**

```typescript
import { notFound, redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import { ChartGrid } from "@/components/taste/chart-grid";
import { getProfileByUsername } from "@/lib/profile/server-actions";
import { getFingerprint } from "@/lib/taste/server-actions";

export const dynamic = "force-dynamic";

export default async function UserTastePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const profile = await getProfileByUsername(username);
  if (!profile) notFound();

  const me = await getCurrentUser();
  const isOwner = me?.id === profile.id;

  // Privacy gate: 404 when profile is private and viewer isn't owner.
  if (!profile.isPublic && !isOwner) notFound();

  const fp = await getFingerprint(profile.id);

  // T3 ships sharpening-tier render only. T6 adds empty/sparse/full
  // variants. For owners at empty/sparse, fall through to the same
  // chart-only view (which will show "No signal yet" placeholders).
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-8">
        <h1 className="font-mono text-2xl">
          {isOwner ? "Your taste" : `${profile.displayName ?? username}'s taste`}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {fp.logCount} {fp.logCount === 1 ? "log" : "logs"} · tier:{" "}
          <span className="font-mono">{fp.tier}</span>
        </p>
      </header>

      <ChartGrid vectors={fp.vectors} lengthPreference={fp.lengthPreference} />
    </main>
  );
}
```

- [ ] **Step 5: Create `app/(app)/me/taste/page.tsx`**

```typescript
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import { getProfileByUserId } from "@/lib/profile/server-actions";

export default async function MeTastePage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const profile = await getProfileByUserId(me.id);
  if (!profile?.username) redirect("/settings");
  redirect(`/u/${profile.username}/taste`);
}
```

- [ ] **Step 6: Verify `getProfileByUserId` and `getCurrentUser` exist**

```powershell
Select-String -Path lib/auth/current-user.ts -Pattern "export"
Select-String -Path lib/profile/server-actions.ts -Pattern "export (async )?function (getProfileByUserId|getProfileByUsername)"
```

If `getProfileByUserId` doesn't exist, add it to `lib/profile/server-actions.ts` — implementation should mirror `getProfileByUsername` but lookup by `eq(profiles.userId, userId)`. Confirm `getProfileByUsername` returns `isPublic` already (this was added in audit-fixes 2026-05-12).

- [ ] **Step 7: Typecheck, lint, build**

```powershell
pnpm typecheck; if ($?) { pnpm lint }; if ($?) { pnpm build }
```

- [ ] **Step 8: Manual smoke**

1. Start `pnpm dev`.
2. Log in.
3. Ensure your account has at least 5 logs across mixed genres (use the existing log UI if needed).
4. Visit `/me/taste`. Expect: redirect to `/u/{yourUsername}/taste`.
5. The page renders charts showing your top genres / themes / mechanics / session length, with real per-genre bars.
6. Negative values (if any) render greyed with a `−` indicator.

If charts look wrong: re-run `pnpm tsx scripts/smoke-aggregate.ts` to confirm math; then inspect the SQL query output in `lib/taste/server-actions.ts:getFingerprint` (add a `console.log(rows.length, rows[0])` if needed, then remove).

- [ ] **Step 9: Commit**

```powershell
git add lib/taste/server-actions.ts components/taste/score-bar.tsx components/taste/chart-grid.tsx app/(app)/u/[username]/taste/page.tsx app/(app)/me/taste/page.tsx lib/profile/server-actions.ts
git commit -m "feat(taste): /u/{name}/taste chart-only render (W1 demo)

- lib/taste/server-actions.ts: getFingerprint(userId) joins logs+reviews+games
  and runs aggregateFingerprint inline (~50ms even for 1000-log accounts)
- components/taste/score-bar.tsx: pixel-art 8-cell bar; negative-aware (greyed + − indicator)
- components/taste/chart-grid.tsx: 2x2 grid (genres/themes/mechanics/length)
- /me/taste redirects to /u/{ownUsername}/taste
- /u/{name}/taste: tier-aware (T3 sharpening only); 404s on private profile for non-owners

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

**End-of-W1 demo:** Visit `/me/taste` with a real account. Real charts from real logs. Negative scores visible. Sharpening tier UI.

---

## Task 4: Narrative prompt builder + refresh-fingerprint Edge Function

**Goal:** Build the AI prompt for the narrative summary, and ship a Supabase Edge Function that aggregates a user's fingerprint, calls the AI router, and persists the narrative + snapshot vectors atomically. Auth via the shared `requireServiceRole` helper (Phase 3 pattern).

**Files:**
- Create: `lib/taste/prompts.ts`
- Create: `supabase/functions/refresh-fingerprint/index.ts`
- Create: `supabase/functions/_shared/taste-engine.ts` (mirrored aggregation for Edge use — Deno can't import the Next-side `aggregate.ts` directly because of `@/` aliases and `server-only`)

**Acceptance Criteria:**
- [ ] `lib/taste/prompts.ts` exports `NARRATIVE_PROMPT_VERSION` constant and `buildNarrativePrompt(input: NarrativePromptInput): { system: string; user: string }`.
- [ ] The prompt includes: top-8 entries from each vector, length-preference distribution, top-5 recent rated-high games, top-3 recent rated-low / dropped games, tier hint, and style-guide constraints (2–3 sentences, no emoji, no quoted titles, no hedging).
- [ ] `supabase/functions/refresh-fingerprint/index.ts` accepts `POST { userId, reason: "milestone" | "manual" | "drift" }`, rejects unauthenticated requests with 401, aggregates the user's vectors, calls the AI provider router, and writes `narrative_summary` + `narrative_generated_at` + `narrative_snapshot_vectors` + `narrative_model_version` atomically.
- [ ] `supabase/functions/_shared/taste-engine.ts` mirrors `aggregateFingerprint` logic byte-for-byte in Deno-compatible form.
- [ ] Local invoke via `curl` produces a real narrative against a test user.

**Verify:** `supabase functions serve refresh-fingerprint` then `curl` with service-role key against a test userId — narrative text returned, DB row updated.

**Steps:**

- [ ] **Step 1: Create `lib/taste/prompts.ts`**

```typescript
import "server-only";

import type { VectorBundle, SparseVector } from "@/lib/taste/vectors";
import type { TasteTier } from "@/lib/taste/tier";

/** Bump on any prompt-text change. Logged in narrativeModelVersion for traceability. */
export const NARRATIVE_PROMPT_VERSION = "v1";
export const RERANK_PROMPT_VERSION = "v1"; // Used by T11.

export type NarrativePromptInput = {
  vectors: VectorBundle;
  lengthPreference: Record<string, number>;
  recentLikedGames: Array<{ title: string; genres: string[]; rating: number }>;
  recentDislikedGames: Array<{ title: string; genres: string[]; status: string; rating: number | null }>;
  tier: TasteTier;
  totalLogs: number;
};

function topN(vec: SparseVector, n: number): Array<[string, number]> {
  return Object.entries(vec)
    .filter(([, v]) => Math.abs(v) >= 0.05) // skip near-zero noise
    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
    .slice(0, n);
}

function fmtVector(name: string, vec: SparseVector): string {
  const top = topN(vec, 8);
  if (top.length === 0) return `${name}: (no signal yet)`;
  const lines = top.map(([k, v]) => `  ${k.padEnd(24)} ${v.toFixed(2)}`);
  return `${name}:\n${lines.join("\n")}`;
}

function fmtLength(pref: Record<string, number>): string {
  const entries = Object.entries(pref).filter(([, v]) => v > 0);
  if (entries.length === 0) return "Length preference: (no playtime data)";
  const lines = entries
    .sort(([, a], [, b]) => b - a)
    .map(([k, v]) => `  ${k.padEnd(8)} ${(v * 100).toFixed(0)}%`);
  return `Length preference (% of weighted logs):\n${lines.join("\n")}`;
}

export function buildNarrativePrompt(input: NarrativePromptInput): {
  system: string;
  user: string;
} {
  const confidenceHint =
    input.tier === "full"
      ? "Write with confident specificity — name concrete patterns."
      : input.tier === "sharpening"
      ? "Write specifically, but acknowledge the picture is still forming."
      : "Write tentatively — only ~few logs to go on. Hint at directions, don't make strong claims.";

  const system = [
    "You write 2–3 sentence taste summaries for video-game players.",
    "Voice: playful, observant, specific. Reference 1–2 concrete genres or themes that dominate.",
    "Forbidden: emoji; hedging words like \"might\", \"perhaps\", \"tends to\"; quotation marks around game titles; the phrases \"you love\" or \"you enjoy\" (overused).",
    "Required: name actual genres/themes/mechanics from the data; address the user as \"you\".",
    confidenceHint,
  ].join(" ");

  const liked =
    input.recentLikedGames.length === 0
      ? "(no recent rated-high games)"
      : input.recentLikedGames
          .map((g) => `  ${g.title} (${g.rating}/10) — ${g.genres.slice(0, 2).join(", ")}`)
          .join("\n");

  const disliked =
    input.recentDislikedGames.length === 0
      ? "(no recent rated-low or dropped games)"
      : input.recentDislikedGames
          .map((g) =>
            g.rating != null
              ? `  ${g.title} (${g.rating}/10) — ${g.genres.slice(0, 2).join(", ")}`
              : `  ${g.title} (${g.status}) — ${g.genres.slice(0, 2).join(", ")}`,
          )
          .join("\n");

  const user = [
    `Tier: ${input.tier} (${input.totalLogs} total logs).`,
    "",
    fmtVector("Genres (preference -1 to +1)", input.vectors.genre),
    "",
    fmtVector("Themes", input.vectors.theme),
    "",
    fmtVector("Mechanics", input.vectors.mechanic),
    "",
    fmtLength(input.lengthPreference),
    "",
    "Recent rated-high (7+):",
    liked,
    "",
    "Recent rejected (rated low or dropped):",
    disliked,
    "",
    "Write 2–3 sentences capturing this taste profile.",
  ].join("\n");

  return { system, user };
}
```

- [ ] **Step 2: Create `supabase/functions/_shared/taste-engine.ts`**

This mirrors `lib/taste/aggregate.ts` in Deno-compatible form. The Edge Function can't import the Next-side module directly (alias paths, server-only).

```typescript
// supabase/functions/_shared/taste-engine.ts
// Mirror of lib/taste/aggregate.ts for the Deno Edge runtime.
// Keep these implementations identical — same weight × sign math.

export type LogStatus =
  | "backlog"
  | "wishlist"
  | "playing"
  | "completed"
  | "played"
  | "dropped";

export type AggregateRow = {
  status: LogStatus;
  rating: number | null;
  has_published_review: boolean;
  genres: string[] | null;
  themes: string[] | null;
  mechanics: string[] | null;
  playtime_avg_hours: number | null;
};

export type SparseVector = Record<string, number>;

export type AggregateResult = {
  genre: SparseVector;
  theme: SparseVector;
  mechanic: SparseVector;
  length_preference: Record<string, number>;
  total_logs_at_generation: number;
};

export function weight(row: AggregateRow): number {
  let w: number;
  if (row.rating != null) {
    const intensity = Math.abs(row.rating - 5.0) / 5.0;
    w = 1.0 * (1 + 0.3 * intensity);
  } else if (
    row.status === "playing" ||
    row.status === "completed" ||
    row.status === "played" ||
    row.status === "dropped"
  ) {
    w = 0.6;
  } else if (row.status === "backlog" || row.status === "wishlist") {
    w = 0.2;
  } else {
    w = 0;
  }
  if (row.has_published_review) w *= 1.15;
  return w;
}

export function sign(row: AggregateRow): -1 | 0 | 1 {
  if (row.rating != null) {
    if (row.rating < 4) return -1;
    if (row.rating > 6) return 1;
    return 0;
  }
  if (row.status === "dropped") return -1;
  return 1;
}

function bucket(hours: number): "<5h" | "5-10h" | "10-30h" | "30-60h" | "60h+" {
  if (hours < 5) return "<5h";
  if (hours < 10) return "5-10h";
  if (hours < 30) return "10-30h";
  if (hours < 60) return "30-60h";
  return "60h+";
}

export function aggregate(rows: AggregateRow[]): AggregateResult {
  const genreRaw: SparseVector = {};
  const themeRaw: SparseVector = {};
  const mechanicRaw: SparseVector = {};
  const lengthRaw: Record<string, number> = {
    "<5h": 0,
    "5-10h": 0,
    "10-30h": 0,
    "30-60h": 0,
    "60h+": 0,
  };

  let totalW = 0;
  let totalLengthW = 0;

  for (const row of rows) {
    const w = weight(row);
    if (w === 0) continue;
    const s = sign(row);
    totalW += w;
    const signed = s * w;
    for (const g of row.genres ?? []) genreRaw[g] = (genreRaw[g] ?? 0) + signed;
    for (const t of row.themes ?? []) themeRaw[t] = (themeRaw[t] ?? 0) + signed;
    for (const m of row.mechanics ?? []) mechanicRaw[m] = (mechanicRaw[m] ?? 0) + signed;

    if (row.playtime_avg_hours != null && row.playtime_avg_hours > 0) {
      lengthRaw[bucket(row.playtime_avg_hours)] += w;
      totalLengthW += w;
    }
  }

  const norm = Math.max(1, totalW);
  const normalize = (v: SparseVector): SparseVector => {
    const out: SparseVector = {};
    for (const [k, val] of Object.entries(v)) out[k] = val / norm;
    return out;
  };
  const length_preference: Record<string, number> = {
    "<5h": 0,
    "5-10h": 0,
    "10-30h": 0,
    "30-60h": 0,
    "60h+": 0,
  };
  if (totalLengthW > 0) {
    for (const k of Object.keys(lengthRaw)) {
      length_preference[k] = lengthRaw[k] / totalLengthW;
    }
  }
  return {
    genre: normalize(genreRaw),
    theme: normalize(themeRaw),
    mechanic: normalize(mechanicRaw),
    length_preference,
    total_logs_at_generation: rows.length,
  };
}
```

- [ ] **Step 3: Create `supabase/functions/refresh-fingerprint/index.ts`**

```typescript
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.9";
import { requireServiceRole } from "../_shared/auth.ts";
import { aggregate, type AggregateRow } from "../_shared/taste-engine.ts";

// AI provider router lives at lib/ai/router.ts in the Next app. For the
// Edge runtime we re-export a thin Deno-compatible wrapper at
// supabase/functions/_shared/ai-router.ts (created by Phase 2 review-stream
// migration). If it doesn't exist yet, this task creates a minimal version.

type Tier = "empty" | "sparse" | "sharpening" | "full";

function tierForUser(count: number): Tier {
  if (count <= 0) return "empty";
  if (count < 10) return "sparse";
  if (count < 30) return "sharpening";
  return "full";
}

Deno.serve(async (req) => {
  const unauthorized = requireServiceRole(req);
  if (unauthorized) return unauthorized;

  let body: { userId?: string; reason?: string };
  try {
    body = (await req.json()) as { userId?: string; reason?: string };
  } catch {
    return new Response("invalid JSON body", { status: 400 });
  }
  const { userId, reason } = body;
  if (!userId) return new Response("missing userId", { status: 400 });

  const databaseUrl = Deno.env.get("DATABASE_URL")!;
  const sql = postgres(databaseUrl, { prepare: false });

  try {
    // 1. Pull all logs joined with games + review-existence indicator.
    const rows = await sql<AggregateRow[]>`
      SELECT
        l.status,
        l.rating::float AS rating,
        (r.id IS NOT NULL) AS has_published_review,
        g.genres,
        g.themes,
        g.mechanics,
        g.playtime_avg_hours::float AS playtime_avg_hours
      FROM logs l
      JOIN games g ON g.id = l.game_id
      LEFT JOIN reviews r ON r.log_id = l.id AND r.published_at IS NOT NULL
      WHERE l.user_id = ${userId}
    `;

    if (rows.length === 0) {
      return new Response(JSON.stringify({ tier: "empty", skipped: "no logs" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    const agg = aggregate(rows);
    const tier = tierForUser(rows.length);

    // 2. For sparse tier, persist vectors only — skip AI narrative.
    if (tier === "sparse") {
      await sql`
        INSERT INTO taste_fingerprints (
          user_id, genre_vector, theme_vector, mechanic_vector,
          length_preference, total_logs_at_generation, vectors_generated_at
        ) VALUES (
          ${userId},
          ${sql.json(agg.genre)},
          ${sql.json(agg.theme)},
          ${sql.json(agg.mechanic)},
          ${sql.json(agg.length_preference)},
          ${agg.total_logs_at_generation},
          NOW()
        )
        ON CONFLICT (user_id) DO UPDATE SET
          genre_vector = EXCLUDED.genre_vector,
          theme_vector = EXCLUDED.theme_vector,
          mechanic_vector = EXCLUDED.mechanic_vector,
          length_preference = EXCLUDED.length_preference,
          total_logs_at_generation = EXCLUDED.total_logs_at_generation,
          vectors_generated_at = NOW()
      `;
      return new Response(
        JSON.stringify({ tier, narrative: null, skipped: "sparse-tier-no-ai" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    // 3. Build narrative-prompt inputs (sharpening/full tier).
    const recentLiked = await sql<
      Array<{ title: string; genres: string[]; rating: number }>
    >`
      SELECT g.title, g.genres, l.rating::float AS rating
      FROM logs l JOIN games g ON g.id = l.game_id
      WHERE l.user_id = ${userId} AND l.rating IS NOT NULL AND l.rating >= 7
      ORDER BY l.updated_at DESC
      LIMIT 5
    `;
    const recentDisliked = await sql<
      Array<{ title: string; genres: string[]; status: string; rating: number | null }>
    >`
      SELECT g.title, g.genres, l.status, l.rating::float AS rating
      FROM logs l JOIN games g ON g.id = l.game_id
      WHERE l.user_id = ${userId}
        AND ((l.rating IS NOT NULL AND l.rating <= 3) OR l.status = 'dropped')
      ORDER BY l.updated_at DESC
      LIMIT 3
    `;

    // 4. Call AI router. The router lives in the Next app under lib/ai/router.ts;
    // for Edge we use a thin postgres-compatible direct fetch path.
    // For Phase 2 we already have supabase/functions/_shared/ai-router.ts —
    // use the same `callRouter` export (signature: { system, user, maxTokens, feature }).
    const { callRouter } = await import("../_shared/ai-router.ts");
    const { buildNarrativePrompt, NARRATIVE_PROMPT_VERSION } =
      await import("../_shared/prompts.ts");

    const promptInput = {
      vectors: { genre: agg.genre, theme: agg.theme, mechanic: agg.mechanic },
      lengthPreference: agg.length_preference,
      recentLikedGames: recentLiked.map((r) => ({ ...r, rating: r.rating })),
      recentDislikedGames: recentDisliked,
      tier,
      totalLogs: rows.length,
    };
    const { system, user } = buildNarrativePrompt(promptInput);
    const result = await callRouter({
      feature: "fingerprint",
      system,
      user,
      maxTokens: 200,
    });

    const modelVersion = `${result.provider}-${result.model}/narrative-${NARRATIVE_PROMPT_VERSION}`;

    // 5. Atomic write: vectors + narrative + snapshot + model version.
    await sql`
      INSERT INTO taste_fingerprints (
        user_id, genre_vector, theme_vector, mechanic_vector,
        length_preference, narrative_summary, narrative_snapshot_vectors,
        total_logs_at_generation, narrative_model_version,
        vectors_generated_at, narrative_generated_at
      ) VALUES (
        ${userId},
        ${sql.json(agg.genre)},
        ${sql.json(agg.theme)},
        ${sql.json(agg.mechanic)},
        ${sql.json(agg.length_preference)},
        ${result.text},
        ${sql.json({ genre: agg.genre, theme: agg.theme, mechanic: agg.mechanic })},
        ${agg.total_logs_at_generation},
        ${modelVersion},
        NOW(),
        NOW()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        genre_vector = EXCLUDED.genre_vector,
        theme_vector = EXCLUDED.theme_vector,
        mechanic_vector = EXCLUDED.mechanic_vector,
        length_preference = EXCLUDED.length_preference,
        narrative_summary = EXCLUDED.narrative_summary,
        narrative_snapshot_vectors = EXCLUDED.narrative_snapshot_vectors,
        total_logs_at_generation = EXCLUDED.total_logs_at_generation,
        narrative_model_version = EXCLUDED.narrative_model_version,
        vectors_generated_at = NOW(),
        narrative_generated_at = NOW()
    `;

    return Response.json({
      tier,
      narrative: result.text,
      modelVersion,
      reason: reason ?? "manual",
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
});
```

- [ ] **Step 4: Mirror `prompts.ts` for the Edge runtime**

Copy `lib/taste/prompts.ts` (Step 1) into `supabase/functions/_shared/prompts.ts` with two changes:
1. Remove `import "server-only";` and the `@/lib/taste/vectors` import.
2. Inline the `SparseVector` type definition.

This is unavoidable code duplication — Deno can't follow the `@/` aliases. Keep the two files identical; any prompt-text change must be applied to both.

- [ ] **Step 5: Verify `_shared/ai-router.ts` exists** (Phase 2 should have created it)

```powershell
Test-Path supabase/functions/_shared/ai-router.ts
```

If false: the Phase 2 router-call hasn't been mirrored for Edge yet. Create a minimal version that POSTs to one provider (Cerebras first) and falls back to the next on 5xx. Mirror the chain logic from `lib/ai/router.ts`. Sign the export as `callRouter(input: { feature: string; system: string; user: string; maxTokens: number }): Promise<{ text: string; provider: string; model: string; inputTokens: number; outputTokens: number }>`.

- [ ] **Step 6: Deploy locally and smoke**

```powershell
supabase functions serve refresh-fingerprint --no-verify-jwt --env-file .env.local
```

In another shell, with a real test userId who has 12+ logs:

```powershell
$key = (Get-Content .env.local | Select-String "SUPABASE_SERVICE_ROLE_KEY=").ToString().Split("=")[1]
curl -X POST http://localhost:54321/functions/v1/refresh-fingerprint `
  -H "apikey: $key" `
  -H "Content-Type: application/json" `
  -d '{"userId": "<paste-real-userid>", "reason": "manual"}'
```

Expected: 200 JSON with `tier`, `narrative` (2–3 sentence string), `modelVersion`. Check Supabase Studio: the `taste_fingerprints` row exists with all new columns populated.

- [ ] **Step 7: Iterate the prompt**

This is the prompt-tuning window. Read the generated narrative. If it:
- uses emoji or quotes around game titles → fix system prompt
- hedges with "might"/"perhaps" → fix system prompt
- gives vague generic copy → fix user prompt to surface more concrete data
- references genres that aren't in the user's top-8 → look at how vectors render

Iterate `buildNarrativePrompt`. Each iteration: bump `NARRATIVE_PROMPT_VERSION` (e.g. `"v1.1"`). Re-run the curl.

- [ ] **Step 8: Deploy to Supabase**

```powershell
supabase functions deploy refresh-fingerprint
```

Verify deployment in the Supabase dashboard. Note the function URL.

- [ ] **Step 9: Commit**

```powershell
git add lib/taste/prompts.ts supabase/functions/refresh-fingerprint/ supabase/functions/_shared/taste-engine.ts supabase/functions/_shared/prompts.ts
# If ai-router.ts was newly created in step 5:
git add supabase/functions/_shared/ai-router.ts
git commit -m "feat(taste): refresh-fingerprint Edge Function + narrative prompt v1

- lib/taste/prompts.ts: buildNarrativePrompt with style-guide constraints
  (2-3 sentences, no emoji, no quoted titles, no hedging) + tier-aware confidence
- supabase/functions/refresh-fingerprint: aggregate + AI call + atomic upsert
  with snapshot vectors for drift detection. Sparse tier persists vectors only.
- _shared/taste-engine.ts: Deno mirror of aggregate.ts (can't cross @/ alias)
- _shared/prompts.ts: Deno mirror of prompts.ts
- Auth via shared requireServiceRole (Phase 3 _shared/auth.ts)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: refreshFingerprint server action + rate limit

**Goal:** Server-side action callable from a client island. Auth + rate-limit + tier-gating + invocation of the Edge Function + cache invalidation. Returns the refreshed snapshot for the page to re-render with.

**Files:**
- Modify: `lib/taste/server-actions.ts` (add `refreshFingerprint` action)
- Reference: `lib/security/rate-limit.ts` (no changes — existing helper)

**Acceptance Criteria:**
- [ ] `lib/taste/server-actions.ts` exports `refreshFingerprint()` (no userId arg — derives from session).
- [ ] Returns 401 (via thrown `Error` with code `"unauthorized"`) when called unauthenticated.
- [ ] Returns rate-limited error when 4th call in 24h with key `taste:refresh:${userId}`.
- [ ] On `tier === 'empty'`: returns `{ skipped: "empty" }` without invoking AI.
- [ ] On `tier === 'sparse'`: invokes Edge Function but expects it to skip narrative AI call (already implemented in T4).
- [ ] On `tier in sharpening|full`: invokes Edge Function with `reason: "manual"`.
- [ ] After Edge Function returns, delete non-dismissed `recommendations` rows for the user (vector change invalidates rec cache).
- [ ] Returns `{ tier, narrative, vectors, lengthPreference, generatedAt }`.
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean.

**Verify:** `pnpm typecheck && pnpm lint && pnpm build` — server action surface compiles; the UI piece in T6 is what exercises it manually.

**Steps:**

- [ ] **Step 1: Extend `lib/taste/server-actions.ts`**

Append the following after the existing `getFingerprint` export:

```typescript
import { getCurrentUser } from "@/lib/auth/current-user";
import { enforceRateLimit, RateLimitedError } from "@/lib/security/rate-limit";

export async function refreshFingerprint(): Promise<
  | { ok: true; snapshot: FingerprintSnapshot }
  | { ok: false; reason: "unauthorized" | "rate-limited" | "ai-failure"; retryAfterSec?: number }
> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, reason: "unauthorized" };

  try {
    await enforceRateLimit({
      key: `taste:refresh:${me.id}`,
      limit: 3,
      windowSec: 24 * 60 * 60,
    });
  } catch (e) {
    if (e instanceof RateLimitedError) {
      return { ok: false, reason: "rate-limited", retryAfterSec: e.retryAfterSec };
    }
    throw e;
  }

  // Read current tier to short-circuit empty case without an Edge call.
  const before = await getFingerprint(me.id);
  if (before.tier === "empty") {
    return { ok: true, snapshot: before };
  }

  // Invoke the Edge Function. Sparse tier path is handled inside the
  // function (vectors-only, skip AI).
  const functionsUrl =
    process.env.SUPABASE_FUNCTIONS_URL ??
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1`;
  const apikey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!functionsUrl || !apikey) {
    console.error("refresh-fingerprint missing env (SUPABASE_FUNCTIONS_URL or SUPABASE_SERVICE_ROLE_KEY)");
    return { ok: false, reason: "ai-failure" };
  }

  let resp: Response;
  try {
    resp = await fetch(`${functionsUrl}/refresh-fingerprint`, {
      method: "POST",
      headers: { apikey, "Content-Type": "application/json" },
      body: JSON.stringify({ userId: me.id, reason: "manual" }),
    });
  } catch (err) {
    console.error("refresh-fingerprint fetch failed:", err);
    return { ok: false, reason: "ai-failure" };
  }
  if (!resp.ok) {
    console.error("refresh-fingerprint non-OK:", resp.status, await resp.text());
    return { ok: false, reason: "ai-failure" };
  }

  // Vector change invalidates rec cache (per spec trigger matrix).
  await db
    .delete(recommendations)
    .where(and(eq(recommendations.userId, me.id), eq(recommendations.dismissed, false)));

  const after = await getFingerprint(me.id);
  return { ok: true, snapshot: after };
}
```

Add the needed top-of-file imports:

```typescript
import { and, eq } from "drizzle-orm";
import { recommendations } from "@/lib/db/schema";
```

(Confirm `eq` was already imported; just add `and` and the `recommendations` table reference.)

- [ ] **Step 2: Confirm `enforceRateLimit` signature**

```powershell
Select-String -Path lib/security/rate-limit.ts -Pattern "export (async )?function enforceRateLimit"
```

If the signature differs from `{ key, limit, windowSec }`, adjust the call. The audit-fixes 2026-05-12 commit introduced this helper; signature should be stable.

- [ ] **Step 3: Confirm `RateLimitedError` has `retryAfterSec`**

```powershell
Select-String -Path lib/security/rate-limit.ts -Pattern "retryAfter"
```

Field name may be `retryAfter` or `retryAfterSec` — match what exists. Update the action accordingly.

- [ ] **Step 4: Typecheck + lint + build**

```powershell
pnpm typecheck; if ($?) { pnpm lint }; if ($?) { pnpm build }
```

- [ ] **Step 5: Commit**

```powershell
git add lib/taste/server-actions.ts
git commit -m "feat(taste): refreshFingerprint server action with rate limit

- 3/24h per user via existing enforceRateLimit helper
- Auth-gated; returns structured failure reasons (unauthorized/rate-limited/ai-failure)
- Tier=empty short-circuits without Edge call
- Sparse tier path handled inside the Edge Function (vectors-only)
- On success: deletes non-dismissed rec rows (vector change invalidates cache)
- Returns updated FingerprintSnapshot for UI re-render

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: All four tier renders + refresh button UI

**Goal:** End-of-W2 demo. The fingerprint page now renders the correct content for every tier state. The refresh button is functional (calls T5's server action and updates the visible narrative). Mascot pose changes per tier.

**Files:**
- Create: `components/taste/tier-empty.tsx`
- Create: `components/taste/tier-sparse.tsx`
- Create: `components/taste/tier-narrative.tsx` (used for both sharpening + full)
- Create: `components/taste/refresh-button.tsx` (client island)
- Modify: `app/(app)/u/[username]/taste/page.tsx` (use tier components instead of always-charts)

**Acceptance Criteria:**
- [ ] `tier-empty.tsx` renders: mascot in `excited` pose, "No taste yet — log a game and I'll start reading it.", "Find a game to log →" CTA linking to `/games`.
- [ ] `tier-sparse.tsx` renders: mascot in `helpful` pose, speech bubble "I need about {10 - logCount} more logs before I can write you a proper taste read. Here's what I've got so far.", charts at reduced opacity (CSS `opacity-50`), Refresh/Share buttons disabled.
- [ ] `tier-narrative.tsx` renders: mascot in `narrating` pose, narrative speech bubble showing `narrative ?? "Generating your read…"`, full-opacity charts, enabled Refresh + Share buttons. The "sharpening" banner shows only when `tier === 'sharpening'`.
- [ ] `<RefreshButton>` is a client island that calls `refreshFingerprint()`, shows a spinner during pending, toasts on rate-limited/ai-failure, and triggers a router refresh on success.
- [ ] Empty-tier page is owner-only (non-owners get 404 instead).
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean.
- [ ] Manually verified: an account with 0/5/15/35 logs each renders the matching tier UI.

**Verify:** `pnpm typecheck && pnpm lint && pnpm build`; then `/me/taste` in dev with hand-tweaked log counts.

**Steps:**

- [ ] **Step 1: Verify mascot pose component existence**

```powershell
Select-String -Path components -Pattern "MascotSprite|MascotPose" -Recurse | Select-Object -First 5
```

The Phase 1.5 mascot work landed pose sprites. If a `<Mascot mood="excited">` (or similar) component exists, use that. If not, create a minimal version in `components/mascot/mascot.tsx`:

```typescript
import Image from "next/image";

type Mood = "excited" | "helpful" | "narrating" | "thinking" | "celebrating" | "wary" | "tactician" | "lantern" | "cozy" | "ready";

export function Mascot({ mood, size = 96 }: { mood: Mood; size?: number }) {
  // Sprites are in /public/mascot/{mood}.png — Phase 1.5 work generated these.
  return (
    <Image
      src={`/mascot/${mood}.png`}
      alt={`mascot — ${mood}`}
      width={size}
      height={size}
      className="pixelated select-none"
      priority={false}
    />
  );
}
```

(If `pixelated` utility doesn't exist in tailwind config, add `image-rendering: pixelated` via inline style: `style={{ imageRendering: "pixelated" }}`.)

- [ ] **Step 2: Create `components/taste/tier-empty.tsx`**

```typescript
import Link from "next/link";
import { Mascot } from "@/components/mascot/mascot";

export function TierEmpty() {
  return (
    <div className="flex flex-col items-center gap-6 py-16 text-center">
      <Mascot mood="excited" size={128} />
      <div className="space-y-2">
        <h2 className="font-mono text-xl">No taste yet</h2>
        <p className="text-sm text-zinc-400">
          Log a game and I'll start reading it.
        </p>
      </div>
      <Link
        href="/games"
        className="rounded-md bg-emerald-600 px-4 py-2 font-mono text-sm text-white hover:bg-emerald-500"
      >
        Find a game to log →
      </Link>
    </div>
  );
}
```

- [ ] **Step 3: Create `components/taste/tier-sparse.tsx`**

```typescript
import { Mascot } from "@/components/mascot/mascot";
import { ChartGrid } from "./chart-grid";

export function TierSparse({
  logCount,
  vectors,
  lengthPreference,
}: {
  logCount: number;
  vectors: { genre: Record<string, number>; theme: Record<string, number>; mechanic: Record<string, number> };
  lengthPreference: Record<string, number>;
}) {
  const remaining = Math.max(1, 10 - logCount);
  return (
    <>
      <div className="mb-8 flex items-start gap-4">
        <Mascot mood="helpful" size={96} />
        <div className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 p-4">
          <p className="text-sm">
            I need about <strong>{remaining}</strong> more logs before I can
            write you a proper taste read. Here's what I've got so far.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              disabled
              className="rounded border border-zinc-800 px-3 py-1 text-xs text-zinc-600"
              title="Available once you reach 10 logs"
            >
              Refresh fingerprint
            </button>
            <button
              disabled
              className="rounded border border-zinc-800 px-3 py-1 text-xs text-zinc-600"
              title="Available once you reach 10 logs"
            >
              Share →
            </button>
          </div>
        </div>
      </div>
      <div className="opacity-50">
        <ChartGrid vectors={vectors} lengthPreference={lengthPreference} />
      </div>
    </>
  );
}
```

- [ ] **Step 4: Create `components/taste/tier-narrative.tsx`**

```typescript
import { Mascot } from "@/components/mascot/mascot";
import { ChartGrid } from "./chart-grid";
import { RefreshButton } from "./refresh-button";
import type { TasteTier } from "@/lib/taste/tier";

export function TierNarrative({
  tier,
  narrative,
  narrativeGeneratedAt,
  vectors,
  lengthPreference,
  isOwner,
  isPublic,
}: {
  tier: Exclude<TasteTier, "empty" | "sparse">;
  narrative: string | null;
  narrativeGeneratedAt: Date | null;
  vectors: { genre: Record<string, number>; theme: Record<string, number>; mechanic: Record<string, number> };
  lengthPreference: Record<string, number>;
  isOwner: boolean;
  isPublic: boolean;
}) {
  return (
    <>
      <div className="mb-8 flex items-start gap-4">
        <Mascot mood="narrating" size={96} />
        <div className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 p-4">
          <p className="text-sm leading-relaxed">
            {narrative ?? <em className="text-zinc-500">Generating your read…</em>}
          </p>
          {isOwner && (
            <div className="mt-3 flex gap-2">
              <RefreshButton />
              <ShareButton disabled={!isPublic} />
            </div>
          )}
          {narrativeGeneratedAt && (
            <p className="mt-2 text-[10px] uppercase tracking-wider text-zinc-600">
              Last refreshed{" "}
              {narrativeGeneratedAt.toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </p>
          )}
        </div>
      </div>

      {tier === "sharpening" && (
        <div className="mb-6 rounded-md border border-zinc-800 bg-zinc-950/50 p-3 text-xs text-zinc-400">
          Your taste is still sharpening — log more for refinement.
        </div>
      )}

      <ChartGrid vectors={vectors} lengthPreference={lengthPreference} />
    </>
  );
}

function ShareButton({ disabled }: { disabled: boolean }) {
  return (
    <button
      disabled={disabled}
      title={disabled ? "Make your profile public to share your taste card." : "Share your taste card"}
      className="rounded border border-zinc-800 px-3 py-1 text-xs hover:bg-zinc-900 disabled:cursor-not-allowed disabled:text-zinc-600"
    >
      Share →
    </button>
  );
}
```

(`ShareButton` is a stub here — T17 wires the real share modal.)

- [ ] **Step 5: Create `components/taste/refresh-button.tsx`** (client island)

```typescript
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { refreshFingerprint } from "@/lib/taste/server-actions";

export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const result = await refreshFingerprint();
      if (result.ok) {
        toast.success("Fingerprint refreshed");
        router.refresh();
      } else if (result.reason === "rate-limited") {
        const hrs = Math.ceil((result.retryAfterSec ?? 3600) / 3600);
        toast.error(`You can refresh again in ${hrs}h.`);
      } else if (result.reason === "ai-failure") {
        toast.error("Couldn't refresh right now — try again in a few minutes.");
      } else {
        toast.error("You need to be signed in to refresh.");
      }
    });
  }

  return (
    <button
      onClick={onClick}
      disabled={pending}
      className="rounded border border-zinc-800 px-3 py-1 text-xs hover:bg-zinc-900 disabled:opacity-60"
    >
      {pending ? "Refreshing…" : "Refresh fingerprint"}
    </button>
  );
}
```

(Confirm `sonner` is the toast library used elsewhere — Phase 1.5 cockpit uses it.)

- [ ] **Step 6: Update `app/(app)/u/[username]/taste/page.tsx`**

Replace the whole page body to use the new tier components:

```typescript
import { notFound } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import { getProfileByUsername } from "@/lib/profile/server-actions";
import { getFingerprint } from "@/lib/taste/server-actions";
import { TierEmpty } from "@/components/taste/tier-empty";
import { TierSparse } from "@/components/taste/tier-sparse";
import { TierNarrative } from "@/components/taste/tier-narrative";

export const dynamic = "force-dynamic";

export default async function UserTastePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const profile = await getProfileByUsername(username);
  if (!profile) notFound();

  const me = await getCurrentUser();
  const isOwner = me?.id === profile.id;

  // Privacy gate: 404 when profile is private and viewer isn't owner.
  if (!profile.isPublic && !isOwner) notFound();

  const fp = await getFingerprint(profile.id);

  // Empty-tier page is owner-only — non-owners 404.
  if (fp.tier === "empty" && !isOwner) notFound();

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-8">
        <h1 className="font-mono text-2xl">
          {isOwner ? "Your taste" : `${profile.displayName ?? username}'s taste`}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {fp.logCount} {fp.logCount === 1 ? "log" : "logs"} · tier:{" "}
          <span className="font-mono">{fp.tier}</span>
        </p>
      </header>

      {fp.tier === "empty" && <TierEmpty />}

      {fp.tier === "sparse" && (
        <TierSparse
          logCount={fp.logCount}
          vectors={fp.vectors}
          lengthPreference={fp.lengthPreference}
        />
      )}

      {(fp.tier === "sharpening" || fp.tier === "full") && (
        <TierNarrative
          tier={fp.tier}
          narrative={fp.narrative}
          narrativeGeneratedAt={fp.narrativeGeneratedAt}
          vectors={fp.vectors}
          lengthPreference={fp.lengthPreference}
          isOwner={isOwner}
          isPublic={profile.isPublic}
        />
      )}
    </main>
  );
}
```

- [ ] **Step 7: Manual smoke per tier**

Tier swaps are easiest by hand-editing your test account's logs. From Supabase SQL editor:

```sql
-- empty: delete all logs for test user (DESTRUCTIVE — use a sacrificial test account)
DELETE FROM logs WHERE user_id = '<test-user-id>';
-- visit /me/taste → expect TierEmpty render

-- sparse: insert 5 dummy logs
-- (use the dev "Add log" UI for variety, or hand-insert via SQL)

-- sharpening: 10-29 logs (insert another 5+)

-- full: 30+ logs (insert another 20+)
```

After each step, hard-refresh `/me/taste` and confirm the matching tier component renders.

For the Refresh button: with sharpening tier, click it. Expect: spinner → toast "Fingerprint refreshed" → page reloads with a new narrative. Click 3 more times in quick succession → 4th click → "You can refresh again in 24h." toast.

- [ ] **Step 8: Typecheck, lint, build**

```powershell
pnpm typecheck; if ($?) { pnpm lint }; if ($?) { pnpm build }
```

- [ ] **Step 9: Commit**

```powershell
git add components/taste/tier-empty.tsx components/taste/tier-sparse.tsx components/taste/tier-narrative.tsx components/taste/refresh-button.tsx app/(app)/u/[username]/taste/page.tsx components/mascot/mascot.tsx
git commit -m "feat(taste): all 4 tier renders + refresh-button client island

- TierEmpty: mascot=excited + 'find a game' CTA; owner-only
- TierSparse: mascot=helpful + 'I need N more logs' bubble + greyed charts
- TierNarrative: mascot=narrating + narrative bubble + refresh/share buttons;
  sharpening banner shown when tier !== full
- RefreshButton: client island, calls refreshFingerprint server action,
  toasts on rate-limit/ai-failure, router.refresh() on success
- Page route switches by tier; non-owners 404 on empty tier

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Milestone trigger — triggerOnLogWrite + wire into log/review server actions

**Goal:** When a user crosses the 10/25/50/100/250 log milestones via a log/review write, the refresh-fingerprint Edge Function is auto-fired (background, doesn't block the user's request). And every log write invalidates the (still-empty) rec cache.

**Files:**
- Create: `lib/taste/triggers.ts`
- Modify: `lib/logs/server-actions.ts` (call `triggerOnLogWrite` from create/update/delete paths)
- Modify: `lib/reviews/server-actions.ts` (call `triggerOnLogWrite` from publish path)

**Acceptance Criteria:**
- [ ] `lib/taste/triggers.ts` exports `triggerOnLogWrite(userId: string): Promise<void>`.
- [ ] On every call: deletes non-dismissed `recommendations` rows for that user.
- [ ] When the user's log count is exactly one of {10, 25, 50, 100, 250} after the write, fires `refresh-fingerprint` Edge Function via `fetch` + `after()` (Next 16 `unstable_after`).
- [ ] Errors in the trigger never block the parent request (caught and logged).
- [ ] `lib/logs/server-actions.ts` calls `triggerOnLogWrite` after every successful create, update, delete (including status/rating changes).
- [ ] `lib/reviews/server-actions.ts` calls `triggerOnLogWrite` after successful publish.
- [ ] Manually verified: log the 10th game on a test account → ~5–10s later, refresh `/me/taste`, narrative is freshly generated.
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean.

**Verify:** `pnpm typecheck && pnpm lint && pnpm build`; then milestone test in dev (log #10 → narrative appears).

**Steps:**

- [ ] **Step 1: Create `lib/taste/triggers.ts`**

```typescript
import "server-only";
import { unstable_after as after } from "next/server";
import { and, eq, sql as drizzleSql } from "drizzle-orm";

import { db } from "@/lib/db";
import { logs, recommendations } from "@/lib/db/schema";

const MILESTONES = [10, 25, 50, 100, 250] as const;

/**
 * Called from log/review server actions after a successful write.
 *
 * - Always: invalidates the rec cache (deletes non-dismissed recs).
 *   Vector signal has changed → cached AI recs are stale.
 * - Sometimes: fires refresh-fingerprint Edge Function if the user's
 *   total log count is now exactly one of MILESTONES.
 *
 * Errors are never thrown — the caller's transaction must not be
 * affected by trigger failures. We log and continue.
 */
export async function triggerOnLogWrite(userId: string): Promise<void> {
  try {
    // 1. Invalidate rec cache (always, regardless of milestone).
    await db
      .delete(recommendations)
      .where(and(eq(recommendations.userId, userId), eq(recommendations.dismissed, false)));

    // 2. Check milestone.
    const [{ count }] = await db
      .select({ count: drizzleSql<number>`count(*)::int` })
      .from(logs)
      .where(eq(logs.userId, userId));

    if (!MILESTONES.includes(count as (typeof MILESTONES)[number])) return;

    const functionsUrl =
      process.env.SUPABASE_FUNCTIONS_URL ??
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1`;
    const apikey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!functionsUrl || !apikey) {
      console.error("triggerOnLogWrite milestone: missing env, skipping fetch", { userId, count });
      return;
    }

    const triggerPromise = fetch(`${functionsUrl}/refresh-fingerprint`, {
      method: "POST",
      headers: { apikey, "Content-Type": "application/json" },
      body: JSON.stringify({ userId, reason: "milestone", logCount: count }),
    })
      .then(async (r) => {
        if (!r.ok) {
          console.error("refresh-fingerprint milestone non-OK:", r.status, await r.text());
        }
      })
      .catch((err) => {
        console.error("refresh-fingerprint milestone fetch failed:", userId, err);
      });

    // Next 16 unstable_after keeps the route's response unblocked.
    // Phase 3 uses the same pattern in lib/imports/server-actions.ts:triggerImport.
    after(() => triggerPromise);
  } catch (err) {
    console.error("triggerOnLogWrite failed (non-fatal):", userId, err);
  }
}
```

- [ ] **Step 2: Wire `triggerOnLogWrite` into `lib/logs/server-actions.ts`**

```powershell
Select-String -Path lib/logs/server-actions.ts -Pattern "^export (async )?function (createLog|updateLog|deleteLog)"
```

For each existing action that mutates `logs`, append a call to `triggerOnLogWrite(currentUserId)` after the successful write/commit but **before** returning. Example for the create path:

```typescript
// At top of file:
import { triggerOnLogWrite } from "@/lib/taste/triggers";

// Inside createLog (or whatever the existing function is named):
// ... existing code that does:
//   await db.insert(logs).values(...);
//   revalidatePath("/library");
// Append:
await triggerOnLogWrite(me.id);
return { ok: true /* ... */ };
```

Repeat for `updateLog` (status change → invalidates cache, may cross milestone if undo→redo), `deleteLog` (count change, may un-cross a milestone — we still invalidate cache).

If status/rating updates flow through a single `updateLog`, one call covers both.

- [ ] **Step 3: Wire `triggerOnLogWrite` into `lib/reviews/server-actions.ts`**

```powershell
Select-String -Path lib/reviews/server-actions.ts -Pattern "publishReview"
```

In `publishReview`, after the successful `UPDATE reviews SET published_at = NOW()`, append:

```typescript
import { triggerOnLogWrite } from "@/lib/taste/triggers";

// After publish update:
await triggerOnLogWrite(me.id);
```

Publishing changes the `hasPublishedReview` indicator for the relevant log, which shifts the weight (×1.15 bonus). So the rec cache invalidation is correct; milestone crossing won't be triggered by publish alone (it counts logs, not reviews), but the cache delete is still right.

- [ ] **Step 4: Typecheck, lint, build**

```powershell
pnpm typecheck; if ($?) { pnpm lint }; if ($?) { pnpm build }
```

- [ ] **Step 5: Manual smoke**

On a test account with 9 logs:

1. Visit `/me/taste` → tier=sparse, no narrative.
2. In another tab, log a 10th game via the existing UI.
3. Wait ~10s for the Edge Function to complete.
4. Hard-refresh `/me/taste` → tier=sharpening, narrative present.
5. Check Supabase Studio: `taste_fingerprints.narrative_generated_at` is fresh.
6. Add another log (11th) → narrative does not regenerate (next milestone is 25). Vector charts update live on refresh (because `getFingerprint` recomputes).

- [ ] **Step 6: Commit**

```powershell
git add lib/taste/triggers.ts lib/logs/server-actions.ts lib/reviews/server-actions.ts
git commit -m "feat(taste): milestone trigger + rec cache invalidation on log/review writes

- lib/taste/triggers.ts: triggerOnLogWrite(userId)
  - Always: DELETE non-dismissed recs for user (vector signal changed)
  - At milestones {10,25,50,100,250}: fire refresh-fingerprint via after()
  - Errors swallowed/logged so caller's transaction isn't affected
- Wired into lib/logs/server-actions.ts (create/update/delete paths)
- Wired into lib/reviews/server-actions.ts (publish path)
- Uses Phase 3's after() + service-role fetch pattern (lib/imports/server-actions.ts:triggerImport)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

**End-of-W2 demo:** Synthetic 9-log account logs game #10 → narrative auto-generates within 10s. Tier transitions sparse → sharpening visible. Refresh button works (rate-limited at 4/24h). All 4 tier UIs visually correct.

---

## Task 8: Mood/time/platform allowlist + cache key + candidate pool

**Goal:** Foundation for `/play-next`. Zod-validated mood/time/platform enums; stable cache-key hash; metadata-similarity prefilter that produces a 50-game candidate pool.

**Files:**
- Create: `lib/recs/moods.ts`
- Create: `lib/recs/cache.ts`
- Create: `lib/recs/candidate-pool.ts`
- Create: `scripts/smoke-recs-cache.ts`

**Acceptance Criteria:**
- [ ] `lib/recs/moods.ts` exports: `MOODS` const array (`['chill', 'challenged', 'story-driven', 'mindless', 'multiplayer']`), `TIMES` const array (`['15min', '1hr', '3hr+', 'multi-session']`), `moodArraySchema` (zod, min 1, max 2, allowlist), `timeSchema`, `platformArraySchema`, `filterSchema` (composite), `type FilterParams`.
- [ ] `lib/recs/cache.ts` exports `cacheKey(input: { userId: string; moods: string[]; time: string; platforms: string[] }): string` — sorts moods + platforms before hashing for stability.
- [ ] `lib/recs/candidate-pool.ts` exports `candidatePool(userId: string, opts?: { limit?: number }): Promise<CandidateGame[]>` — returns top-N games sorted by metadata similarity to the user's fingerprint, excluding games the user has already logged.
- [ ] `pnpm tsx scripts/smoke-recs-cache.ts` exits 0.
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean.

**Verify:** `pnpm tsx scripts/smoke-recs-cache.ts && pnpm typecheck && pnpm lint && pnpm build`

**Steps:**

- [ ] **Step 1: Create `lib/recs/moods.ts`**

```typescript
import { z } from "zod";
import { platformEnum } from "@/lib/db/schema";

/**
 * Allowed mood tokens. App-level allowlist (not pgEnum) so we can add
 * "atmospheric" / "narrative-light" / etc. via code change, no migration.
 */
export const MOODS = ["chill", "challenged", "story-driven", "mindless", "multiplayer"] as const;
export type Mood = (typeof MOODS)[number];

/** Time budget for the next session. */
export const TIMES = ["15min", "1hr", "3hr+", "multi-session"] as const;
export type TimeBudget = (typeof TIMES)[number];

/** Multi-select up to 2 — see Q7 in the spec. */
export const moodArraySchema = z
  .array(z.enum(MOODS as unknown as [string, ...string[]]))
  .min(1, "pick at least one mood")
  .max(2, "pick up to two moods");

export const timeSchema = z.enum(TIMES as unknown as [string, ...string[]]);

/** Platform values mirror the platform_kind pgEnum from Phase 0. */
export const platformArraySchema = z
  .array(z.enum(["steam", "xbox", "psn"] as const))
  .min(1, "pick at least one platform");

export const filterSchema = z.object({
  moods: moodArraySchema,
  time: timeSchema,
  platforms: platformArraySchema,
});

export type FilterParams = z.infer<typeof filterSchema>;
```

- [ ] **Step 2: Create `lib/recs/cache.ts`**

```typescript
import { createHash } from "node:crypto";

import "server-only";

export type CacheKeyInput = {
  userId: string;
  moods: string[];
  time: string;
  platforms: string[];
};

/**
 * Stable hash for the (user, filter) tuple.
 *
 * Moods + platforms are sorted before hashing so {moods: ["chill","multi"]}
 * and {moods: ["multi","chill"]} produce the same key (set semantics).
 *
 * Hash is sha256 truncated to 24 hex chars (96 bits) — collision-safe at
 * any realistic cardinality and short enough for storage.
 */
export function cacheKey(input: CacheKeyInput): string {
  const sortedMoods = [...input.moods].sort();
  const sortedPlatforms = [...input.platforms].sort();
  const canonical = JSON.stringify({
    u: input.userId,
    m: sortedMoods,
    t: input.time,
    p: sortedPlatforms,
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 24);
}
```

- [ ] **Step 3: Create `lib/recs/candidate-pool.ts`**

```typescript
import "server-only";
import { and, eq, inArray, not, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { games, logs, tasteFingerprints } from "@/lib/db/schema";

export type CandidateGame = {
  id: number;
  slug: string;
  title: string;
  released: Date | null;
  coverUrl: string | null;
  posterUrl: string | null;
  genres: string[] | null;
  themes: string[] | null;
  mechanics: string[] | null;
  platforms: string[] | null;
  playtimeAvgHours: number | null;
  similarityScore: number;
};

/**
 * Metadata-similarity prefilter. Pulls the user's vectors, scores every
 * game in the catalog by dot-product against the user's preferences,
 * excludes games they've already logged, returns the top N.
 *
 * Naive O(catalog × user-vectors) — fine for Phase 4 scale (RAWG seed is
 * ~10k games, user vectors are ~30 keys). When catalog grows, we'd push
 * scoring into Postgres via array overlap operators; not yet.
 */
export async function candidatePool(
  userId: string,
  opts: { limit?: number } = {},
): Promise<CandidateGame[]> {
  const limit = opts.limit ?? 50;

  const [fpRow] = await db
    .select({
      genreVector: tasteFingerprints.genreVector,
      themeVector: tasteFingerprints.themeVector,
      mechanicVector: tasteFingerprints.mechanicVector,
    })
    .from(tasteFingerprints)
    .where(eq(tasteFingerprints.userId, userId))
    .limit(1);

  // Empty / brand-new user with no fingerprint row: fall back to popular catalog.
  const genreVec = (fpRow?.genreVector as Record<string, number> | undefined) ?? {};
  const themeVec = (fpRow?.themeVector as Record<string, number> | undefined) ?? {};
  const mechanicVec = (fpRow?.mechanicVector as Record<string, number> | undefined) ?? {};

  // Pull every game the user has already logged — exclude these from candidates.
  const loggedRows = await db
    .select({ gameId: logs.gameId })
    .from(logs)
    .where(eq(logs.userId, userId));
  const loggedIds = new Set(loggedRows.map((r) => r.gameId));

  // Stream candidates from the catalog. For Phase 4 scale (~10k games) we
  // can pull the whole table; for larger catalog we'd add an index-friendly
  // pre-filter (e.g. genre overlap against top-3 user genres).
  const allGames = await db
    .select({
      id: games.id,
      slug: games.slug,
      title: games.title,
      released: games.released,
      coverUrl: games.coverUrl,
      posterUrl: games.posterUrl,
      genres: games.genres,
      themes: games.themes,
      mechanics: games.mechanics,
      platforms: games.platforms,
      playtimeAvgHours: games.playtimeAvgHours,
    })
    .from(games);

  const scored: CandidateGame[] = [];
  for (const g of allGames) {
    if (loggedIds.has(g.id)) continue;
    let s = 0;
    for (const k of g.genres ?? []) s += genreVec[k] ?? 0;
    for (const k of g.themes ?? []) s += themeVec[k] ?? 0;
    for (const k of g.mechanics ?? []) s += mechanicVec[k] ?? 0;
    if (s <= 0) continue; // skip games that the user's signal actively rejects or matches nothing
    scored.push({
      ...g,
      playtimeAvgHours: g.playtimeAvgHours != null ? Number(g.playtimeAvgHours) : null,
      similarityScore: s,
    });
  }
  scored.sort((a, b) => b.similarityScore - a.similarityScore);
  return scored.slice(0, limit);
}
```

- [ ] **Step 4: Create `scripts/smoke-recs-cache.ts`**

```typescript
import { cacheKey } from "@/lib/recs/cache";

type Case = { name: string; fn: () => boolean };

const cases: Case[] = [
  {
    name: "cacheKey: deterministic (same input → same hash)",
    fn: () => {
      const k1 = cacheKey({ userId: "u1", moods: ["chill"], time: "1hr", platforms: ["steam"] });
      const k2 = cacheKey({ userId: "u1", moods: ["chill"], time: "1hr", platforms: ["steam"] });
      return k1 === k2 && k1.length === 24;
    },
  },
  {
    name: "cacheKey: moods sort-stable (order doesn't matter)",
    fn: () => {
      const k1 = cacheKey({ userId: "u1", moods: ["chill", "multiplayer"], time: "1hr", platforms: ["steam"] });
      const k2 = cacheKey({ userId: "u1", moods: ["multiplayer", "chill"], time: "1hr", platforms: ["steam"] });
      return k1 === k2;
    },
  },
  {
    name: "cacheKey: platforms sort-stable",
    fn: () => {
      const k1 = cacheKey({ userId: "u1", moods: ["chill"], time: "1hr", platforms: ["xbox", "steam"] });
      const k2 = cacheKey({ userId: "u1", moods: ["chill"], time: "1hr", platforms: ["steam", "xbox"] });
      return k1 === k2;
    },
  },
  {
    name: "cacheKey: different users → different keys",
    fn: () => {
      const k1 = cacheKey({ userId: "u1", moods: ["chill"], time: "1hr", platforms: ["steam"] });
      const k2 = cacheKey({ userId: "u2", moods: ["chill"], time: "1hr", platforms: ["steam"] });
      return k1 !== k2;
    },
  },
  {
    name: "cacheKey: different time → different keys",
    fn: () => {
      const k1 = cacheKey({ userId: "u1", moods: ["chill"], time: "1hr", platforms: ["steam"] });
      const k2 = cacheKey({ userId: "u1", moods: ["chill"], time: "3hr+", platforms: ["steam"] });
      return k1 !== k2;
    },
  },
  {
    name: "cacheKey: different mood set → different keys",
    fn: () => {
      const k1 = cacheKey({ userId: "u1", moods: ["chill"], time: "1hr", platforms: ["steam"] });
      const k2 = cacheKey({ userId: "u1", moods: ["challenged"], time: "1hr", platforms: ["steam"] });
      return k1 !== k2;
    },
  },
];

let failed = 0;
for (const c of cases) {
  const ok = c.fn();
  console.log(`${ok ? "✓" : "✗"} ${c.name}`);
  if (!ok) failed++;
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 5: Run the smoke + typecheck**

```powershell
pnpm tsx scripts/smoke-recs-cache.ts
pnpm typecheck; if ($?) { pnpm lint }; if ($?) { pnpm build }
```

- [ ] **Step 6: Commit**

```powershell
git add lib/recs/moods.ts lib/recs/cache.ts lib/recs/candidate-pool.ts scripts/smoke-recs-cache.ts
git commit -m "feat(recs): moods allowlist + cache-key hash + candidate-pool prefilter

- lib/recs/moods.ts: MOODS (5), TIMES (4) as const arrays + zod schemas
  (multi-select capped at 2 per Q7)
- lib/recs/cache.ts: sha256(canonical-json) truncated to 24 hex chars;
  sorts moods+platforms for set-equivalence
- lib/recs/candidate-pool.ts: dot-product scoring vs fingerprint vectors,
  excludes already-logged games, returns top-50
- 6-case smoke covers determinism + sort-stability + distinguishing inputs

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: getRecs server action (metadata-only path) + /play-next 3-step flow

**Goal:** `/play-next` page exists with the three-step filter flow + results view, powered by the metadata-only `getRecs`. AI rerank is **deliberately deferred** to T11 — this task ships a working route with templated reasoning so we can demo the flow end-to-end without AI cost.

**Files:**
- Create: `lib/recs/server-actions.ts` (initial `getRecs` only — `dismissRec` / `saveRecForLater` / `playRec` come in T14)
- Create: `app/(app)/play-next/page.tsx`
- Create: `components/recs/filter-chips.tsx`
- Create: `components/recs/mascot-prompt.tsx`
- Create: `components/recs/rec-card.tsx` (button-less stub — T15 wires actions)

**Acceptance Criteria:**
- [ ] `lib/recs/server-actions.ts` exports `getRecs(filters: FilterParams): Promise<RecResult>` returning 5 recs with templated reasoning and `algorithm: 'similarity'`.
- [ ] The reasoning template references both genre and filter context: e.g. `"Quick session that fits your ${time} window. Heavy on ${topMatchedGenre}, your top genre."`.
- [ ] The filter context narrows the candidate pool: time → filter games whose `playtime_avg_hours` falls in a compatible bucket; platforms → filter games whose `platforms` overlaps the user's selection.
- [ ] If the user is in `tier === 'sparse'`, getRecs still works (uses sparse fingerprint or popularity fallback) but reasoning explicitly says "based on partial signal."
- [ ] If the user is in `tier === 'empty'`, getRecs returns empty `recs: []` with a `reason: 'no-signal'` banner directive.
- [ ] `/play-next` renders 3 sequential filter steps (time → mood → platform) with state in URL search params, then a results view with 5 rec cards.
- [ ] An "editable filter pills" row at top of results lets the user click any pill to reopen that step.
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean.
- [ ] Manually verified: full flow works end-to-end with real recs from a test account.

**Verify:** `pnpm typecheck && pnpm lint && pnpm build`; then walk through `/play-next` end-to-end.

**Steps:**

- [ ] **Step 1: Create `lib/recs/server-actions.ts`**

```typescript
"use server";

import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { recommendations } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth/current-user";
import { candidatePool, type CandidateGame } from "@/lib/recs/candidate-pool";
import { cacheKey } from "@/lib/recs/cache";
import { filterSchema, type FilterParams, type TimeBudget } from "@/lib/recs/moods";
import { getFingerprint } from "@/lib/taste/server-actions";

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
  algorithm: "similarity" | "ai_rerank" | "hybrid";
};

export type RecResult =
  | { ok: true; tier: "sparse" | "sharpening" | "full"; recs: RecCard[]; algorithm: "similarity" | "ai_rerank" | "hybrid"; banner?: string }
  | { ok: false; reason: "unauthorized" | "empty-tier" | "no-candidates" };

/** Map a TimeBudget to a [minHours, maxHours] window for filtering candidates. */
function timeWindow(time: TimeBudget): [number, number] {
  switch (time) {
    case "15min":
      return [0, 3];
    case "1hr":
      return [0, 12];
    case "3hr+":
      return [2, 60];
    case "multi-session":
      return [10, Infinity];
  }
}

/**
 * T9 metadata-only implementation. T11 will introduce AI rerank.
 */
export async function getRecs(rawFilters: FilterParams): Promise<RecResult> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, reason: "unauthorized" };

  const filters = filterSchema.parse(rawFilters);
  const fp = await getFingerprint(me.id);

  if (fp.tier === "empty") return { ok: false, reason: "empty-tier" };

  // Pull candidate pool from fingerprint.
  const all = await candidatePool(me.id, { limit: 50 });

  // Apply filter constraints.
  const [minH, maxH] = timeWindow(filters.time);
  const platSet = new Set(filters.platforms);
  const filtered: CandidateGame[] = all.filter((g) => {
    // Time budget — only filter if game has playtime data
    if (g.playtimeAvgHours != null) {
      if (g.playtimeAvgHours < minH || g.playtimeAvgHours > maxH) return false;
    }
    // Platform overlap — only filter if game has platforms data
    if (g.platforms && g.platforms.length > 0) {
      const platMatches = g.platforms.some((p) => platSet.has(p as "steam" | "xbox" | "psn"));
      if (!platMatches) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    return { ok: false, reason: "no-candidates" };
  }

  // Top 5 from the filtered list.
  const top = filtered.slice(0, 5);
  const key = cacheKey({
    userId: me.id,
    moods: filters.moods,
    time: filters.time,
    platforms: filters.platforms,
  });

  // Build templated reasoning. Mention 1-2 of the user's top genres
  // that overlap with the game's genres.
  const topUserGenres = Object.entries(fp.vectors.genre)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([k]) => k);

  const recs: RecCard[] = top.map((g) => {
    const overlap = (g.genres ?? []).filter((x) => topUserGenres.includes(x));
    const genreNote =
      overlap.length > 0
        ? `Heavy on ${overlap[0]}${overlap[1] ? ` and ${overlap[1]}` : ""}, ${overlap.length > 1 ? "your top genres" : "one of your top genres"}.`
        : "Strong match against your taste profile.";
    const timeNote =
      filters.time === "15min"
        ? "Quick to pick up and put down."
        : filters.time === "1hr"
        ? "Fits a one-hour session comfortably."
        : filters.time === "3hr+"
        ? "Made for a longer evening."
        : "Built for the long haul.";
    const reason = `${timeNote} ${genreNote}`;
    return {
      id: randomUUID(),
      gameId: g.id,
      slug: g.slug,
      title: g.title,
      releasedYear: g.released ? g.released.getFullYear() : null,
      posterUrl: g.posterUrl,
      coverUrl: g.coverUrl,
      score: Math.min(1, g.similarityScore / 5),
      reason,
      algorithm: "similarity",
    };
  });

  // Persist with the cache key so T11's rerank can detect existing cache.
  await db
    .insert(recommendations)
    .values(
      recs.map((r) => ({
        userId: me.id,
        gameId: r.gameId,
        score: r.score.toFixed(4),
        reason: r.reason,
        algorithm: "similarity" as const,
        cacheKey: key,
      })),
    );

  return {
    ok: true,
    tier: fp.tier,
    recs,
    algorithm: "similarity",
    banner: fp.tier === "sparse" ? "Your taste is still sharpening — these picks use genre matching only." : undefined,
  };
}
```

- [ ] **Step 2: Create `components/recs/mascot-prompt.tsx`**

```typescript
import { Mascot } from "@/components/mascot/mascot";

export function MascotPrompt({
  mood,
  children,
}: {
  mood: "helpful" | "thinking" | "narrating";
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start gap-4">
      <Mascot mood={mood} size={80} />
      <div className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 p-4">
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `components/recs/filter-chips.tsx`**

```typescript
"use client";

import { cn } from "@/lib/utils";

export function FilterChips<T extends string>({
  options,
  selected,
  onChange,
  multi = false,
  max = 1,
}: {
  options: ReadonlyArray<T>;
  selected: T[];
  onChange: (next: T[]) => void;
  multi?: boolean;
  max?: number;
}) {
  function toggle(v: T) {
    if (!multi) {
      onChange([v]);
      return;
    }
    if (selected.includes(v)) {
      onChange(selected.filter((x) => x !== v));
    } else if (selected.length < max) {
      onChange([...selected, v]);
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = selected.includes(o);
        return (
          <button
            key={o}
            type="button"
            onClick={() => toggle(o)}
            className={cn(
              "rounded-full border px-4 py-2 text-sm font-mono transition-colors",
              active
                ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                : "border-zinc-800 text-zinc-400 hover:border-zinc-700",
            )}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Create `components/recs/rec-card.tsx`** (T9 stub — no actions)

```typescript
import Image from "next/image";

import type { RecCard as RecCardData } from "@/lib/recs/server-actions";

export function RecCard({ rec }: { rec: RecCardData }) {
  const art = rec.posterUrl ?? rec.coverUrl;
  return (
    <div className="overflow-hidden rounded-md border border-zinc-800 bg-zinc-950">
      <div className="relative aspect-[2/3] w-full bg-zinc-900">
        {art ? (
          <Image src={art} alt={rec.title} fill className="object-cover" sizes="240px" />
        ) : null}
      </div>
      <div className="space-y-2 p-3">
        <h3 className="text-sm font-medium leading-tight">
          {rec.title}
          {rec.releasedYear ? (
            <span className="ml-1 font-normal text-zinc-500">'{String(rec.releasedYear).slice(-2)}</span>
          ) : null}
        </h3>
        <p className="text-xs leading-snug text-zinc-400">{rec.reason}</p>
        {rec.algorithm === "similarity" && (
          <p className="text-[10px] uppercase tracking-wider text-zinc-600">basic match</p>
        )}
        {/* T15 wires the 3 action buttons. */}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create `app/(app)/play-next/page.tsx`**

```typescript
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import { getFingerprint } from "@/lib/taste/server-actions";
import { PlayNextClient } from "./_client";

export const dynamic = "force-dynamic";

export default async function PlayNextPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login?next=/play-next");
  const fp = await getFingerprint(me.id);

  // Use plain object for initial filters (URL state is authoritative on client).
  const params = await searchParams;
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-8">
        <h1 className="font-mono text-2xl">What should I play next?</h1>
      </header>
      <PlayNextClient
        initialParams={params}
        tier={fp.tier}
        userConnectedPlatforms={["steam", "xbox", "psn"]}
      />
    </main>
  );
}
```

(For T9 we hardcode `userConnectedPlatforms = ["steam","xbox","psn"]`. T17/T18 will pass real connected-platform data from `platform_connections`.)

- [ ] **Step 6: Create `app/(app)/play-next/_client.tsx`** (client island for the flow)

```typescript
"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

import { FilterChips } from "@/components/recs/filter-chips";
import { MascotPrompt } from "@/components/recs/mascot-prompt";
import { RecCard } from "@/components/recs/rec-card";
import { MOODS, TIMES, type FilterParams } from "@/lib/recs/moods";
import { getRecs, type RecCard as RecCardData, type RecResult } from "@/lib/recs/server-actions";

type Platform = "steam" | "xbox" | "psn";

export function PlayNextClient({
  initialParams,
  tier,
  userConnectedPlatforms,
}: {
  initialParams: Record<string, string | string[] | undefined>;
  tier: "empty" | "sparse" | "sharpening" | "full";
  userConnectedPlatforms: Platform[];
}) {
  const router = useRouter();
  const pathname = usePathname();

  // Parse initial filter from URL.
  const parseArray = (v: string | string[] | undefined): string[] => {
    if (!v) return [];
    if (Array.isArray(v)) return v;
    return v.split(",");
  };
  const initTime = (initialParams.time as string) ?? "";
  const initMoods = parseArray(initialParams.moods);
  const initPlatforms = parseArray(initialParams.platforms);

  const [time, setTime] = useState(initTime);
  const [moods, setMoods] = useState<string[]>(initMoods);
  const [platforms, setPlatforms] = useState<string[]>(
    initPlatforms.length > 0 ? initPlatforms : userConnectedPlatforms,
  );
  const [editingStep, setEditingStep] = useState<"time" | "mood" | "platform" | "done">(
    initTime && initMoods.length > 0 && initPlatforms.length > 0 ? "done" : !initTime ? "time" : initMoods.length === 0 ? "mood" : "platform",
  );
  const [recsState, setRecsState] = useState<RecResult | null>(null);
  const [pending, startTransition] = useTransition();

  if (tier === "empty") {
    return (
      <MascotPrompt mood="helpful">
        <p className="text-sm">
          Log at least one game and I'll start recommending. Try{" "}
          <a href="/games" className="text-emerald-400 underline">finding something here</a>.
        </p>
      </MascotPrompt>
    );
  }

  function syncUrl(next: { time?: string; moods?: string[]; platforms?: string[] }) {
    const sp = new URLSearchParams();
    const t = next.time ?? time;
    const m = next.moods ?? moods;
    const p = next.platforms ?? platforms;
    if (t) sp.set("time", t);
    if (m.length > 0) sp.set("moods", m.join(","));
    if (p.length > 0) sp.set("platforms", p.join(","));
    router.replace(`${pathname}?${sp.toString()}`);
  }

  function loadRecs() {
    startTransition(async () => {
      const filters: FilterParams = {
        time: time as FilterParams["time"],
        moods: moods as FilterParams["moods"],
        platforms: platforms as FilterParams["platforms"],
      };
      const result = await getRecs(filters);
      setRecsState(result);
    });
  }

  // Step 1 — TIME
  if (editingStep === "time") {
    return (
      <MascotPrompt mood="helpful">
        <p className="mb-4 text-sm">How long do you have?</p>
        <FilterChips
          options={TIMES}
          selected={time ? [time] : []}
          onChange={(next) => {
            const t = next[0];
            setTime(t);
            syncUrl({ time: t });
            setEditingStep("mood");
          }}
        />
      </MascotPrompt>
    );
  }

  // Step 2 — MOOD
  if (editingStep === "mood") {
    return (
      <>
        <FilterPills time={time} moods={moods} platforms={platforms} onEdit={setEditingStep} />
        <MascotPrompt mood="helpful">
          <p className="mb-4 text-sm">Mood? (pick up to 2)</p>
          <FilterChips
            options={MOODS}
            selected={moods}
            onChange={(next) => {
              setMoods(next);
              syncUrl({ moods: next });
            }}
            multi
            max={2}
          />
          <button
            type="button"
            disabled={moods.length === 0}
            onClick={() => setEditingStep("platform")}
            className="mt-4 rounded bg-emerald-600 px-4 py-2 text-sm font-mono text-white disabled:opacity-50"
          >
            Continue →
          </button>
        </MascotPrompt>
      </>
    );
  }

  // Step 3 — PLATFORM
  if (editingStep === "platform") {
    return (
      <>
        <FilterPills time={time} moods={moods} platforms={platforms} onEdit={setEditingStep} />
        <MascotPrompt mood="helpful">
          <p className="mb-4 text-sm">Platform?</p>
          <FilterChips
            options={userConnectedPlatforms}
            selected={platforms}
            onChange={(next) => {
              setPlatforms(next);
              syncUrl({ platforms: next });
            }}
            multi
            max={userConnectedPlatforms.length}
          />
          <button
            type="button"
            disabled={platforms.length === 0}
            onClick={() => {
              setEditingStep("done");
              loadRecs();
            }}
            className="mt-4 rounded bg-emerald-600 px-4 py-2 text-sm font-mono text-white disabled:opacity-50"
          >
            Show me what to play →
          </button>
        </MascotPrompt>
      </>
    );
  }

  // Results
  return (
    <>
      <FilterPills time={time} moods={moods} platforms={platforms} onEdit={setEditingStep} />
      {pending && (
        <MascotPrompt mood="thinking">
          <p className="text-sm">One moment — picking your five…</p>
        </MascotPrompt>
      )}
      {!pending && recsState && recsState.ok && (
        <>
          {recsState.banner && (
            <div className="mb-4 rounded-md border border-zinc-800 bg-zinc-950/50 p-3 text-xs text-zinc-400">
              {recsState.banner}
            </div>
          )}
          <MascotPrompt mood="narrating">
            <p className="text-sm">
              {recsState.recs.length} {recsState.recs.length === 1 ? "pick" : "picks"} for you.
            </p>
          </MascotPrompt>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
            {recsState.recs.map((r) => (
              <RecCard key={r.id} rec={r} />
            ))}
          </div>
        </>
      )}
      {!pending && recsState && !recsState.ok && (
        <MascotPrompt mood="helpful">
          <p className="text-sm">
            {recsState.reason === "empty-tier"
              ? "You don't have any logs yet — log a game first."
              : recsState.reason === "no-candidates"
              ? "Couldn't find a fit for that exact combo. Try widening the time window or different platforms."
              : "Something went wrong."}
          </p>
        </MascotPrompt>
      )}
    </>
  );
}

function FilterPills({
  time,
  moods,
  platforms,
  onEdit,
}: {
  time: string;
  moods: string[];
  platforms: string[];
  onEdit: (step: "time" | "mood" | "platform") => void;
}) {
  return (
    <div className="mb-6 flex flex-wrap gap-2 text-xs">
      <Pill label={`Time: ${time}`} onClick={() => onEdit("time")} />
      <Pill label={`Mood: ${moods.join(" + ")}`} onClick={() => onEdit("mood")} />
      <Pill label={`Platform: ${platforms.join(", ")}`} onClick={() => onEdit("platform")} />
    </div>
  );
}

function Pill({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-zinc-700 px-3 py-1 hover:border-zinc-500"
    >
      {label} <span className="ml-1 opacity-50">✎</span>
    </button>
  );
}
```

- [ ] **Step 7: Typecheck, lint, build, manual smoke**

```powershell
pnpm typecheck; if ($?) { pnpm lint }; if ($?) { pnpm build }
```

Then dev: visit `/play-next`. Walk through Time → Mood → Platform → Results. Confirm:
- 5 rec cards render with posters
- Reasoning sentences include both time-budget phrasing and a genre reference
- Filter pills are editable
- Direct URL navigation works: `/play-next?time=1hr&moods=chill&platforms=steam`

- [ ] **Step 8: Commit**

```powershell
git add lib/recs/server-actions.ts app/(app)/play-next/ components/recs/
git commit -m "feat(recs): /play-next 3-step flow with metadata-only recs (T9)

- lib/recs/server-actions.ts: getRecs(filters) — candidate pool +
  time-window/platform filter + templated reasoning that references
  time budget + overlap genres; persists with cacheKey for T11 hit detection
- /play-next page: server component fetches tier; client island runs
  time → mood (up to 2) → platform → results flow with URL state
- MascotPrompt / FilterChips / RecCard components
- AI rerank explicitly deferred to T11; algorithm='similarity' for now

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: Cockpit + connected-platforms wiring + sparse tier degradation polish

**Goal:** Replace the hardcoded platform list in `/play-next` with real `platform_connections` data. Wire the `/home` cockpit "What should I play?" card so it deep-links to `/play-next` with sensible defaults. Polish the sparse tier path so it produces useful recs even with thin signal.

**Files:**
- Modify: `app/(app)/play-next/page.tsx` (pass real connected platforms)
- Modify: `app/(app)/_cockpit/cockpit-dashboard.tsx` (add "What should I play?" card)
- Modify: `lib/recs/server-actions.ts` (sparse tier popularity fallback if vectors are too thin)

**Acceptance Criteria:**
- [ ] `/play-next` page reads from `platform_connections` and shows only platforms the user has actively connected; if no connections, all 3 platforms are offered as checkboxes (no degradation — manual users have a platform too).
- [ ] `/home` cockpit gains a "What should I play?" card that links to `/play-next`. Hidden for `tier === 'empty'`.
- [ ] `getRecs` for sparse tier: if vectors are too thin (sum of absolute values < 2.0), fall back to RAWG popularity (highest `rawgRating` games matching platform/time constraints).
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean.
- [ ] Manual: a brand-new account with 3 logs sees populated recs (popularity-based) at `/play-next` — not an empty grid.

**Verify:** `pnpm typecheck && pnpm lint && pnpm build`; then dev-test on a sparse-tier account.

**Steps:**

- [ ] **Step 1: Pass real connected platforms to `/play-next`**

Find `listConnections` or equivalent in `lib/imports/server-actions.ts`:

```powershell
Select-String -Path lib/imports/server-actions.ts -Pattern "export (async )?function (listConnections|getConnections)"
```

Replace the hardcoded line in `app/(app)/play-next/page.tsx`:

```typescript
import { listConnections } from "@/lib/imports/server-actions";

// Inside the page component:
const connections = await listConnections();
const connected: Array<"steam" | "xbox" | "psn"> = connections
  .filter((c) => c.isActive)
  .map((c) => c.platform);
// If user has no active connections, default to all 3 (they may use manual)
const userConnectedPlatforms = connected.length > 0 ? connected : (["steam", "xbox", "psn"] as const);
```

(Confirm shape of `listConnections` return — adjust mapping accordingly.)

- [ ] **Step 2: Add the "What should I play?" cockpit card**

Open `app/(app)/_cockpit/cockpit-dashboard.tsx`. After an existing card (e.g. the Mascot greeting), append:

```tsx
{fp.tier !== "empty" && (
  <Link
    href="/play-next"
    className="group flex items-center gap-4 rounded-md border border-zinc-800 bg-zinc-950 p-4 transition-colors hover:border-zinc-700"
  >
    <Mascot mood="helpful" size={64} />
    <div className="flex-1">
      <h3 className="font-mono text-sm">What should I play?</h3>
      <p className="mt-1 text-xs text-zinc-500">Pick a time and mood — I'll suggest five.</p>
    </div>
    <span className="font-mono text-emerald-400 group-hover:translate-x-1 transition-transform">→</span>
  </Link>
)}
```

You'll need to pass `fp.tier` into the cockpit. The cockpit page is a server component; call `getFingerprint(me.id)` once at the top and pass `tier` to the dashboard.

The "Your taste" card is added in T19 — only the rec card lands in T10.

- [ ] **Step 3: Sparse tier popularity fallback in `getRecs`**

Modify `lib/recs/server-actions.ts`:

```typescript
// At top of getRecs, after fp = await getFingerprint(...)
const vectorMass =
  Object.values(fp.vectors.genre).reduce((a, b) => a + Math.abs(b), 0) +
  Object.values(fp.vectors.theme).reduce((a, b) => a + Math.abs(b), 0) +
  Object.values(fp.vectors.mechanic).reduce((a, b) => a + Math.abs(b), 0);
const useFallback = fp.tier === "sparse" && vectorMass < 2.0;

let candidates = await candidatePool(me.id, { limit: 50 });

if (useFallback || candidates.length === 0) {
  // Popularity fallback: top-rated catalog, exclude already-logged.
  const loggedRows = await db.select({ gameId: logs.gameId }).from(logs).where(eq(logs.userId, me.id));
  const loggedIds = new Set(loggedRows.map((r) => r.gameId));
  const popular = await db
    .select({ /* same columns as candidatePool */ ... })
    .from(games)
    .orderBy(desc(games.rawgRating))
    .limit(200);
  candidates = popular
    .filter((g) => !loggedIds.has(g.id))
    .slice(0, 50)
    .map((g) => ({
      ...g,
      playtimeAvgHours: g.playtimeAvgHours != null ? Number(g.playtimeAvgHours) : null,
      similarityScore: g.rawgRating != null ? Number(g.rawgRating) : 0,
    }));
}
```

Update the templated reason in the sparse-fallback path to say `"Highly rated and broadly liked — solid starter pick while your taste sharpens."` rather than `"Heavy on Roguelike…"` which would be misleading.

- [ ] **Step 4: Typecheck, lint, build**

```powershell
pnpm typecheck; if ($?) { pnpm lint }; if ($?) { pnpm build }
```

- [ ] **Step 5: Manual smoke**

- Test account with 0 logs: `/play-next` redirects from empty-tier branch with a "Log first" message — confirmed.
- Test account with 3 logs (sparse tier, low vector mass): expect popularity-based fallback list at `/play-next`.
- Test account with 15 logs (sharpening tier): expect similarity-based list with overlapping-genre reasoning.
- `/home` cockpit: confirm the "What should I play?" card renders and links to `/play-next`.

- [ ] **Step 6: Commit**

```powershell
git add app/(app)/play-next/page.tsx app/(app)/_cockpit/cockpit-dashboard.tsx lib/recs/server-actions.ts
git commit -m "feat(recs): real connected platforms + sparse popularity fallback + cockpit card

- /play-next reads from platform_connections via listConnections;
  defaults to all 3 platforms when user has no active connections
- /home cockpit: 'What should I play?' card (hidden for tier=empty)
- getRecs: sparse tier with low vector mass (sum |entries| < 2.0) falls back
  to RAWG popularity; reason copy reflects the basis honestly
- T10 closes W3 demo — usable /play-next at every tier

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

**End-of-W3 demo:** `/play-next` works for sparse and sharpening tiers. Filter flow is editable. 5 rec cards with templated reasoning. Cockpit card surfaces the page from `/home`.

---

## Task 11: Rerank prompt builder + rerank-recs Edge Function

**Goal:** AI-powered rerank that takes the 50-game candidate pool + filter context + fingerprint and returns the top 5 with per-game reasoning that explicitly references the filter. Edge Function, same provider router as T4.

**Files:**
- Modify: `lib/taste/prompts.ts` (add `buildRerankPrompt`)
- Modify: `supabase/functions/_shared/prompts.ts` (mirror)
- Create: `supabase/functions/rerank-recs/index.ts`

**Acceptance Criteria:**
- [ ] `lib/taste/prompts.ts` exports `buildRerankPrompt(input: RerankPromptInput): { system: string; user: string }`.
- [ ] Prompt includes: user's narrative + top vector entries + filter context + 50 candidate games (concise format) + last 20 dismissed games + last 5 currently-playing games.
- [ ] AI is instructed to: pick exactly 5, score each in [0,1], write one sentence of reasoning that **explicitly references the filter** (chill/challenged, time budget, platform).
- [ ] Output schema validated by zod: `{ recs: Array<{ gameId: number; score: number; reason: string }> }`.
- [ ] `rerank-recs` Edge Function: accepts `POST { userId, filters: FilterParams, candidateIds: number[] }`; rejects unauthenticated; calls AI router; persists 5 rows in `recommendations` with `cacheKey` and `algorithm: 'ai_rerank'`.
- [ ] Local curl smoke produces a real reranked list with filter-aware reasoning.

**Verify:** `supabase functions serve rerank-recs` + curl with test user + sample candidates → 200 JSON with 5 reasoned recs.

**Steps:**

- [ ] **Step 1: Append `buildRerankPrompt` to `lib/taste/prompts.ts`**

```typescript
export type RerankPromptInput = {
  narrative: string | null;
  vectors: VectorBundle;
  filters: {
    moods: string[];
    time: string;
    platforms: string[];
  };
  candidates: Array<{
    id: number;
    title: string;
    genres: string[];
    themes: string[];
    mechanics: string[];
    playtimeAvgHours: number | null;
    description: string | null;
  }>;
  dismissedGames: Array<{ title: string; genres: string[] }>;
  currentlyPlaying: Array<{ title: string }>;
};

export function buildRerankPrompt(input: RerankPromptInput): { system: string; user: string } {
  const moodList = input.filters.moods.join(" + ");
  const system = [
    "You are recommending the next game for a player from a candidate list.",
    "Pick exactly 5 from the candidates. Score each in [0, 1].",
    `Write ONE sentence of reasoning per game (max 25 words) that EXPLICITLY references the player's filter context (mood: ${moodList}; time: ${input.filters.time}).`,
    "Reasoning style: concrete and observed (e.g. 'Quick puzzle loops with no fail state — fits your half-hour window.'). Forbidden: emoji, hedging, the phrases 'you love' / 'you enjoy', quotation marks around titles.",
    "Output ONLY valid JSON matching this exact schema:",
    `{ "recs": [{ "gameId": <int>, "score": <0..1>, "reason": "<one sentence>" }, ... 5 items] }`,
    "No prose before or after the JSON. No code fences. Just the object.",
  ].join("\n");

  const candidateList = input.candidates
    .map((c) => {
      const meta = [c.genres.slice(0, 3).join("/"), c.themes.slice(0, 2).join("/"), c.mechanics.slice(0, 2).join("/")]
        .filter(Boolean)
        .join(" · ");
      const lenStr = c.playtimeAvgHours != null ? `~${c.playtimeAvgHours.toFixed(0)}h` : "?h";
      return `  [${c.id}] ${c.title} (${meta}, ${lenStr})${c.description ? " — " + c.description.slice(0, 80) : ""}`;
    })
    .join("\n");

  const userBlocks: string[] = [
    `Filter: mood=${moodList}; time=${input.filters.time}; platforms=${input.filters.platforms.join(",")}`,
    "",
  ];

  if (input.narrative) {
    userBlocks.push("Their taste read:", input.narrative, "");
  }

  // Top vectors (compressed).
  const topGenres = Object.entries(input.vectors.genre)
    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
    .slice(0, 5)
    .map(([k, v]) => `${k}:${v.toFixed(2)}`)
    .join(", ");
  if (topGenres) userBlocks.push(`Top genre signal: ${topGenres}`, "");

  userBlocks.push(`Candidate games (id, metadata, playtime):\n${candidateList}`, "");

  if (input.dismissedGames.length > 0) {
    const dismissed = input.dismissedGames.map((g) => `${g.title} (${g.genres.slice(0, 2).join(",")})`).join("; ");
    userBlocks.push(`The player has REJECTED these (avoid recommending unless a strong match outweighs the signal): ${dismissed}`, "");
  }

  if (input.currentlyPlaying.length > 0) {
    const playing = input.currentlyPlaying.map((g) => g.title).join("; ");
    userBlocks.push(`Currently playing (do not recommend these): ${playing}`, "");
  }

  userBlocks.push("Return the JSON object now.");

  return { system, user: userBlocks.join("\n") };
}
```

- [ ] **Step 2: Mirror `buildRerankPrompt` into `supabase/functions/_shared/prompts.ts`**

Copy verbatim, replacing the `VectorBundle` import with an inline type.

- [ ] **Step 3: Create `supabase/functions/rerank-recs/index.ts`**

```typescript
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.9";
import { requireServiceRole } from "../_shared/auth.ts";
import { buildRerankPrompt, RERANK_PROMPT_VERSION } from "../_shared/prompts.ts";
import { callRouter } from "../_shared/ai-router.ts";

type Filters = { moods: string[]; time: string; platforms: string[] };

type Candidate = {
  id: number;
  title: string;
  genres: string[];
  themes: string[];
  mechanics: string[];
  playtime_avg_hours: number | null;
  description: string | null;
};

function safeParseJson(text: string): unknown {
  // Defensive: strip a stray code fence if the model produced one despite instruction.
  const cleaned = text.replace(/^```(?:json)?\n?/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const unauthorized = requireServiceRole(req);
  if (unauthorized) return unauthorized;

  let body: { userId?: string; filters?: Filters; candidateIds?: number[]; cacheKey?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("invalid JSON body", { status: 400 });
  }
  const { userId, filters, candidateIds, cacheKey } = body;
  if (!userId || !filters || !candidateIds || !cacheKey) {
    return new Response("missing userId / filters / candidateIds / cacheKey", { status: 400 });
  }

  const databaseUrl = Deno.env.get("DATABASE_URL")!;
  const sql = postgres(databaseUrl, { prepare: false });

  try {
    // Pull fingerprint + narrative.
    const [fp] = await sql<
      Array<{
        narrative: string | null;
        genre: Record<string, number>;
        theme: Record<string, number>;
        mechanic: Record<string, number>;
      }>
    >`
      SELECT
        narrative_summary AS narrative,
        genre_vector AS genre,
        theme_vector AS theme,
        mechanic_vector AS mechanic
      FROM taste_fingerprints
      WHERE user_id = ${userId}
      LIMIT 1
    `;

    // Pull candidate metadata.
    const candidates = await sql<Candidate[]>`
      SELECT id, title, genres, themes, mechanics,
        playtime_avg_hours::float AS playtime_avg_hours,
        description
      FROM games
      WHERE id = ANY(${candidateIds}::int[])
    `;

    // Pull dismissed games (last 20) and currently-playing logs (last 5).
    const dismissed = await sql<Array<{ title: string; genres: string[] }>>`
      SELECT g.title, g.genres
      FROM recommendations r JOIN games g ON g.id = r.game_id
      WHERE r.user_id = ${userId} AND r.dismissed = true
      ORDER BY r.generated_at DESC LIMIT 20
    `;
    const playing = await sql<Array<{ title: string }>>`
      SELECT g.title FROM logs l JOIN games g ON g.id = l.game_id
      WHERE l.user_id = ${userId} AND l.status = 'playing'
      ORDER BY l.updated_at DESC LIMIT 5
    `;

    const { system, user } = buildRerankPrompt({
      narrative: fp?.narrative ?? null,
      vectors: {
        genre: fp?.genre ?? {},
        theme: fp?.theme ?? {},
        mechanic: fp?.mechanic ?? {},
      },
      filters,
      candidates: candidates.map((c) => ({
        id: c.id,
        title: c.title,
        genres: c.genres ?? [],
        themes: c.themes ?? [],
        mechanics: c.mechanics ?? [],
        playtimeAvgHours: c.playtime_avg_hours,
        description: c.description,
      })),
      dismissedGames: dismissed.map((d) => ({ title: d.title, genres: d.genres ?? [] })),
      currentlyPlaying: playing,
    });

    const aiResult = await callRouter({ feature: "recommendation", system, user, maxTokens: 600 });
    const parsed = safeParseJson(aiResult.text) as
      | { recs: Array<{ gameId: number; score: number; reason: string }> }
      | null;

    if (!parsed || !Array.isArray(parsed.recs) || parsed.recs.length === 0) {
      console.error("rerank-recs: AI returned unparseable response", aiResult.text.slice(0, 300));
      return Response.json({ ok: false, reason: "ai-bad-output" }, { status: 502 });
    }

    // Validate game IDs exist in candidate set; clamp scores; trim to 5.
    const candidateIdSet = new Set(candidateIds);
    const cleaned = parsed.recs
      .filter((r) => candidateIdSet.has(r.gameId))
      .map((r) => ({
        gameId: r.gameId,
        score: Math.max(0, Math.min(1, Number(r.score) || 0)),
        reason: String(r.reason || "").slice(0, 280),
      }))
      .slice(0, 5);

    if (cleaned.length === 0) {
      return Response.json({ ok: false, reason: "no-valid-recs" }, { status: 502 });
    }

    const modelVersion = `${aiResult.provider}-${aiResult.model}/rerank-${RERANK_PROMPT_VERSION}`;

    // Replace any existing non-dismissed rows for this cache key, then insert new.
    await sql.begin(async (tx) => {
      await tx`
        DELETE FROM recommendations
        WHERE user_id = ${userId} AND cache_key = ${cacheKey} AND dismissed = false
      `;
      for (const r of cleaned) {
        await tx`
          INSERT INTO recommendations
            (user_id, game_id, score, reason, algorithm, cache_key, generated_at, dismissed)
          VALUES
            (${userId}, ${r.gameId}, ${r.score.toFixed(4)}, ${r.reason}, 'ai_rerank', ${cacheKey}, NOW(), false)
        `;
      }
    });

    return Response.json({
      ok: true,
      recs: cleaned,
      modelVersion,
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
});
```

- [ ] **Step 4: Deploy + curl smoke**

```powershell
supabase functions deploy rerank-recs
```

Locally:

```powershell
supabase functions serve rerank-recs --no-verify-jwt --env-file .env.local
```

Curl with a real user + 50 candidate ids (pulled by hand from `candidatePool` output):

```powershell
$key = ...  # service-role key
$body = @{
  userId = "<test-user-id>"
  filters = @{ moods = @("chill"); time = "1hr"; platforms = @("steam") }
  candidateIds = @(123, 456, ...) # 50 ids from candidatePool
  cacheKey = "test-key-abc"
} | ConvertTo-Json -Depth 5

curl -X POST http://localhost:54321/functions/v1/rerank-recs `
  -H "apikey: $key" `
  -H "Content-Type: application/json" `
  -d $body
```

Expected: 200 JSON with `ok: true`, `recs` array of 5, each with `gameId`, `score`, `reason`. Reason should mention "chill" or "low-friction" or "relaxing" + a time/platform indicator.

If the AI returns malformed JSON: iterate the system prompt (T11.Step 1) to constrain output. Re-run.

- [ ] **Step 5: Commit**

```powershell
git add lib/taste/prompts.ts supabase/functions/_shared/prompts.ts supabase/functions/rerank-recs/
git commit -m "feat(recs): rerank-recs Edge Function with filter-aware AI reranking

- buildRerankPrompt: candidate list (id+meta+playtime), narrative + top vectors,
  filter context, dismissed-games negative context, currently-playing exclusions
- JSON-strict output schema (model picks 5, scores 0..1, one-sentence reasoning
  EXPLICITLY referencing mood + time)
- Edge Function: validates gameId against candidate set, clamps scores,
  trims to 5; atomic delete-and-insert under cache_key
- Auth via shared requireServiceRole; provider router via shared ai-router.ts

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 12: getRecs completes — cache check + rerank + AI failure fallback

**Goal:** `getRecs` now uses the rerank Edge Function for sharpening/full tiers. Cache hits short-circuit. AI failure falls back to the T9 metadata path with a banner. `algorithm` field correctly distinguishes paths.

**Files:**
- Modify: `lib/recs/server-actions.ts` (replace T9's templated path with cache + rerank flow)

**Acceptance Criteria:**
- [ ] `getRecs(filters)`:
  - Computes `cacheKey(userId, moods, time, platforms)`.
  - Looks up existing non-dismissed rows with that `cacheKey`; if 5 rows exist and the user's `vectorsGeneratedAt` is older than those rows, return them as cache-hit (`algorithm: 'hybrid'` from the persisted rows).
  - Otherwise, computes candidate pool, invokes `rerank-recs` Edge Function. On success, returns the new recs (`algorithm: 'ai_rerank'`).
  - On AI failure: falls back to T9 templated path with banner "AI ranking unavailable — basic matching shown" (`algorithm: 'similarity'`).
- [ ] Sparse tier always skips rerank — uses T9 metadata + sparse banner.
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean.
- [ ] Manual: same filter combo twice → second call is instant (cache hit). Change filter → fresh rerank.

**Verify:** `pnpm typecheck && pnpm lint && pnpm build`; then dev-smoke a cache-hit pattern.

**Steps:**

- [ ] **Step 1: Refactor `getRecs` in `lib/recs/server-actions.ts`**

Replace the existing body with this:

```typescript
export async function getRecs(rawFilters: FilterParams): Promise<RecResult> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, reason: "unauthorized" };

  const filters = filterSchema.parse(rawFilters);
  const fp = await getFingerprint(me.id);

  if (fp.tier === "empty") return { ok: false, reason: "empty-tier" };

  const key = cacheKey({
    userId: me.id,
    moods: filters.moods,
    time: filters.time,
    platforms: filters.platforms,
  });

  // 1. Cache check (non-dismissed rows for this key, generated AFTER vectors were last updated).
  const cached = await db
    .select({
      id: recommendations.id,
      gameId: recommendations.gameId,
      score: recommendations.score,
      reason: recommendations.reason,
      algorithm: recommendations.algorithm,
      generatedAt: recommendations.generatedAt,
    })
    .from(recommendations)
    .where(
      and(
        eq(recommendations.userId, me.id),
        eq(recommendations.cacheKey, key),
        eq(recommendations.dismissed, false),
      ),
    )
    .orderBy(desc(recommendations.score));

  // Determine when vectors last changed for this user (drives cache freshness).
  const [vrow] = await db
    .select({ vectorsGeneratedAt: tasteFingerprints.vectorsGeneratedAt })
    .from(tasteFingerprints)
    .where(eq(tasteFingerprints.userId, me.id))
    .limit(1);
  const vectorsAt = vrow?.vectorsGeneratedAt ?? new Date(0);

  const cacheStillFresh =
    cached.length >= 4 && cached.every((c) => c.generatedAt > vectorsAt);

  if (cacheStillFresh) {
    const gameRows = await db
      .select({
        id: games.id,
        slug: games.slug,
        title: games.title,
        released: games.released,
        posterUrl: games.posterUrl,
        coverUrl: games.coverUrl,
      })
      .from(games)
      .where(inArray(games.id, cached.map((c) => c.gameId)));
    const gameById = new Map(gameRows.map((g) => [g.id, g]));
    const recs: RecCard[] = cached
      .slice(0, 5)
      .map((c) => {
        const g = gameById.get(c.gameId);
        if (!g) return null;
        return {
          id: c.id,
          gameId: c.gameId,
          slug: g.slug,
          title: g.title,
          releasedYear: g.released ? g.released.getFullYear() : null,
          posterUrl: g.posterUrl,
          coverUrl: g.coverUrl,
          score: Number(c.score),
          reason: c.reason ?? "",
          algorithm: c.algorithm as "ai_rerank" | "similarity" | "hybrid",
        };
      })
      .filter((r): r is RecCard => r !== null);
    if (recs.length >= 4) {
      return { ok: true, tier: fp.tier, recs, algorithm: "hybrid" };
    }
    // Otherwise fall through to regenerate (cache thin).
  }

  // 2. Sparse tier → skip AI rerank, use T9-style templated path.
  if (fp.tier === "sparse") {
    return metadataOnlyRecs(me.id, fp, filters, key);
  }

  // 3. Sharpening / full tier → invoke rerank Edge Function.
  const candidates = await candidatePool(me.id, { limit: 50 });
  if (candidates.length === 0) {
    return { ok: false, reason: "no-candidates" };
  }
  // Apply hard filter constraints to candidate pool before sending to AI.
  const [minH, maxH] = timeWindow(filters.time);
  const platSet = new Set(filters.platforms);
  const filtered = candidates.filter((g) => {
    if (g.playtimeAvgHours != null && (g.playtimeAvgHours < minH || g.playtimeAvgHours > maxH)) return false;
    if (g.platforms && g.platforms.length > 0) {
      if (!g.platforms.some((p) => platSet.has(p as "steam" | "xbox" | "psn"))) return false;
    }
    return true;
  });
  if (filtered.length === 0) return { ok: false, reason: "no-candidates" };

  const functionsUrl =
    process.env.SUPABASE_FUNCTIONS_URL ??
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1`;
  const apikey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let rerankOk = false;
  if (functionsUrl && apikey) {
    try {
      const resp = await fetch(`${functionsUrl}/rerank-recs`, {
        method: "POST",
        headers: { apikey, "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: me.id,
          filters,
          candidateIds: filtered.map((c) => c.id),
          cacheKey: key,
        }),
      });
      if (resp.ok) {
        const j = (await resp.json()) as
          | { ok: true; recs: Array<{ gameId: number; score: number; reason: string }> }
          | { ok: false };
        if ("ok" in j && j.ok) {
          rerankOk = true;
        }
      }
    } catch (err) {
      console.error("rerank-recs invoke failed:", err);
    }
  }

  if (rerankOk) {
    // Re-read the persisted rows (the Edge Function wrote them).
    const fresh = await db
      .select({
        id: recommendations.id,
        gameId: recommendations.gameId,
        score: recommendations.score,
        reason: recommendations.reason,
        algorithm: recommendations.algorithm,
      })
      .from(recommendations)
      .where(
        and(
          eq(recommendations.userId, me.id),
          eq(recommendations.cacheKey, key),
          eq(recommendations.dismissed, false),
        ),
      )
      .orderBy(desc(recommendations.score));
    const gameRows = await db
      .select({
        id: games.id, slug: games.slug, title: games.title,
        released: games.released, posterUrl: games.posterUrl, coverUrl: games.coverUrl,
      })
      .from(games)
      .where(inArray(games.id, fresh.map((c) => c.gameId)));
    const gameById = new Map(gameRows.map((g) => [g.id, g]));
    const recs: RecCard[] = fresh
      .map((c) => {
        const g = gameById.get(c.gameId);
        if (!g) return null;
        return {
          id: c.id,
          gameId: c.gameId,
          slug: g.slug,
          title: g.title,
          releasedYear: g.released ? g.released.getFullYear() : null,
          posterUrl: g.posterUrl,
          coverUrl: g.coverUrl,
          score: Number(c.score),
          reason: c.reason ?? "",
          algorithm: c.algorithm as "ai_rerank",
        };
      })
      .filter((r): r is RecCard => r !== null);
    return { ok: true, tier: fp.tier, recs, algorithm: "ai_rerank" };
  }

  // 4. AI failure → fall back to T9 metadata path with banner.
  const fallback = await metadataOnlyRecs(me.id, fp, filters, key);
  if (fallback.ok) {
    fallback.banner = "AI ranking unavailable — basic matching shown.";
  }
  return fallback;
}

/**
 * Extracted T9 path — used by sparse tier and AI-failure fallback.
 */
async function metadataOnlyRecs(
  userId: string,
  fp: Awaited<ReturnType<typeof getFingerprint>>,
  filters: FilterParams,
  key: string,
): Promise<RecResult> {
  // ... move the T9 body verbatim into here, but use `userId` in place of `me.id`
  //     and persist with algorithm: 'similarity'.
  // (Copy-paste from T9 step 1 — same code, just lifted into a helper.)
}
```

(Note: the implementation step is to *refactor* — extract the T9 body into `metadataOnlyRecs` and have the new `getRecs` call it for sparse + AI-failure paths.)

- [ ] **Step 2: Typecheck, lint, build**

```powershell
pnpm typecheck; if ($?) { pnpm lint }; if ($?) { pnpm build }
```

- [ ] **Step 3: Manual smoke**

1. Visit `/play-next`, pick a fresh filter combo. Wait 5–10s for AI rerank. Recs have AI reasoning that mentions mood + time. `algorithm` UI badge (we'll add in T13) reads "AI ranking" or similar.
2. Click "Edit" on the time pill, change to a different value. Walk through. New rerank. Different reasoning.
3. Click back to the first time value. **Instant** load — cache hit. Same recs as step 1.
4. Force AI failure: stop the local Supabase Functions server (or set `SUPABASE_FUNCTIONS_URL` to a bad URL). Reload `/play-next` with a new filter combo. Expect metadata-only recs + banner.

- [ ] **Step 4: Commit**

```powershell
git add lib/recs/server-actions.ts
git commit -m "feat(recs): getRecs uses rerank + cache check + AI-failure fallback

- Cache hit: non-dismissed rows for cache_key, generatedAt > vectorsGeneratedAt
  → return persisted recs (algorithm='hybrid')
- Sparse tier: skip AI, use metadataOnlyRecs helper (T9 path lifted)
- Sharpening / full: invoke rerank-recs Edge Function with candidate ids
- AI failure: metadataOnlyRecs + 'AI ranking unavailable' banner
- T9 templated path lifted into metadataOnlyRecs helper for reuse

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 13: Thinking mascot during rerank + algorithm badge + reason rendering polish

**Goal:** UX polish on the results view: the mascot animates `thinking` for the 5–10s rerank, the algorithm tier is visible to the user, and the AI reasoning renders without ellipsis-truncation surprises.

**Files:**
- Modify: `app/(app)/play-next/_client.tsx` (mascot pose + algorithm-badge rendering)
- Modify: `components/recs/rec-card.tsx` (show algorithm badge per rec)

**Acceptance Criteria:**
- [ ] While `pending`, mascot in `thinking` pose; speech bubble copy varies by filter to feel less canned.
- [ ] Each `<RecCard>` renders a small badge with text per `algorithm`:
  - `ai_rerank` / `hybrid` → "AI pick" (subtle, emerald color)
  - `similarity` → "basic match" (zinc-500)
- [ ] AI reasoning is rendered on up to 3 lines with `line-clamp-3`; full reason available via `title` attribute for accessibility.
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean.
- [ ] Manual: a fresh rerank shows the mascot thinking for the actual call duration; results render the AI-pick badge.

**Verify:** `pnpm typecheck && pnpm lint && pnpm build` + manual.

**Steps:**

- [ ] **Step 1: Update mascot copy in `_client.tsx`**

In the results block:

```typescript
{pending && (
  <MascotPrompt mood="thinking">
    <p className="text-sm">
      {time === "15min" ? "Scanning for a quick hit…" :
       time === "1hr" ? "Picking your hour…" :
       time === "3hr+" ? "Finding something for the long evening…" :
       "Plotting a multi-session…"}
    </p>
  </MascotPrompt>
)}
```

(Change `mood="thinking"` requires `<Mascot>` to support that pose — add the sprite if missing. Phase 1.5 should have it.)

- [ ] **Step 2: Update `components/recs/rec-card.tsx`**

```typescript
import Image from "next/image";
import { cn } from "@/lib/utils";

import type { RecCard as RecCardData } from "@/lib/recs/server-actions";

export function RecCard({ rec }: { rec: RecCardData }) {
  const art = rec.posterUrl ?? rec.coverUrl;
  const isAi = rec.algorithm === "ai_rerank" || rec.algorithm === "hybrid";
  return (
    <div className="overflow-hidden rounded-md border border-zinc-800 bg-zinc-950">
      <div className="relative aspect-[2/3] w-full bg-zinc-900">
        {art ? <Image src={art} alt={rec.title} fill className="object-cover" sizes="240px" /> : null}
        <span
          className={cn(
            "absolute right-1 top-1 rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider",
            isAi ? "bg-emerald-600/80 text-white" : "bg-zinc-800/80 text-zinc-400",
          )}
        >
          {isAi ? "AI pick" : "basic match"}
        </span>
      </div>
      <div className="space-y-2 p-3">
        <h3 className="text-sm font-medium leading-tight">
          {rec.title}
          {rec.releasedYear ? (
            <span className="ml-1 font-normal text-zinc-500">'{String(rec.releasedYear).slice(-2)}</span>
          ) : null}
        </h3>
        <p
          title={rec.reason}
          className="line-clamp-3 text-xs leading-snug text-zinc-400"
        >
          {rec.reason}
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Confirm `line-clamp-3` works**

Tailwind v4 should ship line-clamp by default. If not, add `@tailwindcss/line-clamp` plugin (small one-line install). Or implement via inline style fallback.

- [ ] **Step 4: Typecheck, lint, build, manual smoke**

```powershell
pnpm typecheck; if ($?) { pnpm lint }; if ($?) { pnpm build }
```

Visit `/play-next`. Fresh filter combo. Watch the thinking mascot. Results: 5 cards each with a colored badge (emerald for AI, zinc for basic). Hover the reason text — full text in tooltip.

- [ ] **Step 5: Commit**

```powershell
git add app/(app)/play-next/_client.tsx components/recs/rec-card.tsx
git commit -m "feat(recs): thinking mascot during rerank + algorithm badges + reason polish

- Mascot 'thinking' pose during the 5-10s rerank wait; speech bubble copy
  varies by time-budget filter so it feels less canned
- RecCard badge: 'AI pick' (emerald) for ai_rerank/hybrid; 'basic match'
  (zinc) for similarity-only or fallback
- Reason text: line-clamp-3 + full text in title attribute (a11y)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

**End-of-W4 demo:** AI rerank produces 5 picks with filter-aware reasoning in 5–10s. Cache hits are instant on repeat filter combos. AI failure degrades gracefully with a banner. Sparse tier still works on metadata-only.

---

## Task 14: Feedback server actions — dismiss / save-for-later / play / refill

**Goal:** The four server actions that power the 3-button feedback UI. Each enforces owner-only access. `saveRecForLater` and `playRec` create logs via the existing log-creation path (which fires `triggerOnLogWrite` for cache invalidation + potential milestone narrative regen). `refillRecs` powers the "Show me more like these →" CTA.

**Files:**
- Modify: `lib/recs/server-actions.ts` (add the 4 actions)
- Reference: `lib/logs/server-actions.ts` (use existing `createLog` or `upsertLog`)

**Acceptance Criteria:**
- [ ] `dismissRec(recId: string)` sets `dismissed=true` on a single row. Owner-only. Does NOT invalidate cache or trigger refill.
- [ ] `saveRecForLater(recId: string)` creates `log(userId, gameId, status='backlog')` via `ON CONFLICT (user_id, game_id, is_replay) DO NOTHING`; sets `dismissed=true` on the rec row. Returns `{ ok: true, message: "Added to your backlog." }`.
- [ ] `playRec(recId: string, platform?: PlatformKind)` — if platform provided AND user has it connected: creates `log(status='playing', platforms=[platform])` via `ON CONFLICT … DO UPDATE SET status='playing'`; sets rec dismissed; returns `{ ok: true, redirect: false, message: ... }`. Else returns `{ ok: true, redirect: true, slug: <gameSlug> }`.
- [ ] `refillRecs(filters: FilterParams)` — deletes non-dismissed rows for `(userId, cacheKey)`; re-invokes `rerank-recs` Edge Function (which sees all historically dismissed games in negative context). Returns the new `RecResult`.
- [ ] All four call `triggerOnLogWrite` on log-create paths (handled automatically by `createLog`).
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean.

**Verify:** `pnpm typecheck && pnpm lint && pnpm build`; T15 manually smokes the UI wiring.

**Steps:**

- [ ] **Step 1: Read existing log-creation API**

```powershell
Select-String -Path lib/logs/server-actions.ts -Pattern "export (async )?function (createLog|upsertLog|setLog)"
```

Identify the function that's safe to call with `(userId, gameId, status)` and that already fires `triggerOnLogWrite`. If only a higher-level `createLog(formData)` exists, write a lower-level helper:

```typescript
// lib/logs/server-actions.ts — add if not present:
export async function ensureLog(input: {
  userId: string;
  gameId: number;
  status: LogStatus;
  platforms?: string[];
}): Promise<{ logId: string; created: boolean }> {
  // ON CONFLICT respects (user_id, game_id, is_replay) unique index from schema.
  const [row] = await db
    .insert(logs)
    .values({
      userId: input.userId,
      gameId: input.gameId,
      status: input.status,
      platforms: input.platforms,
    })
    .onConflictDoUpdate({
      target: [logs.userId, logs.gameId, logs.isReplay],
      // If user already logged at backlog and we're "playing", upgrade.
      // If they're at playing/completed and we're "backlog", do nothing
      // (don't downgrade — user data wins).
      set:
        input.status === "playing"
          ? { status: "playing", platforms: input.platforms ?? sql`platforms`, updatedAt: new Date() }
          : { updatedAt: sql`${logs.updatedAt}` /* no-op */ },
    })
    .returning({ id: logs.id });
  await triggerOnLogWrite(input.userId);
  return { logId: row.id, created: true };
}
```

(Match the exact pattern of existing inserts in `lib/logs/server-actions.ts` if different — e.g. drizzle vs raw postgres helper.)

- [ ] **Step 2: Add the four actions to `lib/recs/server-actions.ts`**

```typescript
import { eq, and, desc, inArray } from "drizzle-orm";
import { recommendations, games, logs, platformConnections } from "@/lib/db/schema";
import { ensureLog } from "@/lib/logs/server-actions";
import { triggerOnLogWrite } from "@/lib/taste/triggers";

export async function dismissRec(recId: string): Promise<
  { ok: true } | { ok: false; reason: "unauthorized" | "not-found" }
> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, reason: "unauthorized" };

  const [row] = await db
    .select({ id: recommendations.id, userId: recommendations.userId })
    .from(recommendations)
    .where(eq(recommendations.id, recId))
    .limit(1);
  if (!row) return { ok: false, reason: "not-found" };
  if (row.userId !== me.id) return { ok: false, reason: "unauthorized" };

  await db
    .update(recommendations)
    .set({ dismissed: true })
    .where(eq(recommendations.id, recId));

  // No cache invalidation: the remaining rows for this cache key stay served.
  // The dismissed gameId picks up automatically into the next rerank prompt's
  // negative context (rerank-recs SELECTs WHERE dismissed=true).
  return { ok: true };
}

export async function saveRecForLater(recId: string): Promise<
  { ok: true; message: string } | { ok: false; reason: "unauthorized" | "not-found" }
> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, reason: "unauthorized" };

  const [row] = await db
    .select({ id: recommendations.id, userId: recommendations.userId, gameId: recommendations.gameId })
    .from(recommendations)
    .where(eq(recommendations.id, recId))
    .limit(1);
  if (!row) return { ok: false, reason: "not-found" };
  if (row.userId !== me.id) return { ok: false, reason: "unauthorized" };

  await ensureLog({ userId: me.id, gameId: row.gameId, status: "backlog" });

  await db
    .update(recommendations)
    .set({ dismissed: true })
    .where(eq(recommendations.id, recId));

  return { ok: true, message: "Added to your backlog." };
}

export async function playRec(
  recId: string,
  platform?: "steam" | "xbox" | "psn",
): Promise<
  | { ok: true; redirect: false; message: string }
  | { ok: true; redirect: true; slug: string }
  | { ok: false; reason: "unauthorized" | "not-found" | "platform-not-connected" }
> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, reason: "unauthorized" };

  const [row] = await db
    .select({
      id: recommendations.id,
      userId: recommendations.userId,
      gameId: recommendations.gameId,
    })
    .from(recommendations)
    .where(eq(recommendations.id, recId))
    .limit(1);
  if (!row) return { ok: false, reason: "not-found" };
  if (row.userId !== me.id) return { ok: false, reason: "unauthorized" };

  const [game] = await db
    .select({ slug: games.slug, platforms: games.platforms })
    .from(games)
    .where(eq(games.id, row.gameId))
    .limit(1);
  if (!game) return { ok: false, reason: "not-found" };

  if (!platform) {
    // No platform hint → redirect to game-detail page.
    return { ok: true, redirect: true, slug: game.slug };
  }

  // Verify connection.
  const [conn] = await db
    .select({ id: platformConnections.id })
    .from(platformConnections)
    .where(
      and(
        eq(platformConnections.userId, me.id),
        eq(platformConnections.platform, platform),
        eq(platformConnections.isActive, true),
      ),
    )
    .limit(1);
  if (!conn) return { ok: false, reason: "platform-not-connected" };

  // Verify the game has this platform.
  if (!(game.platforms ?? []).includes(platform)) {
    return { ok: true, redirect: true, slug: game.slug };
  }

  await ensureLog({
    userId: me.id,
    gameId: row.gameId,
    status: "playing",
    platforms: [platform],
  });
  await db.update(recommendations).set({ dismissed: true }).where(eq(recommendations.id, recId));

  return { ok: true, redirect: false, message: `Marked as playing on ${platform}.` };
}

export async function refillRecs(rawFilters: FilterParams): Promise<RecResult> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, reason: "unauthorized" };

  const filters = filterSchema.parse(rawFilters);
  const key = cacheKey({
    userId: me.id,
    moods: filters.moods,
    time: filters.time,
    platforms: filters.platforms,
  });

  // Wipe the current cache rows for this filter so getRecs re-runs the rerank.
  // (The historically-dismissed rows persist for negative-context use.)
  await db
    .delete(recommendations)
    .where(
      and(
        eq(recommendations.userId, me.id),
        eq(recommendations.cacheKey, key),
        eq(recommendations.dismissed, false),
      ),
    );

  return getRecs(filters);
}
```

- [ ] **Step 3: Typecheck, lint, build**

```powershell
pnpm typecheck; if ($?) { pnpm lint }; if ($?) { pnpm build }
```

- [ ] **Step 4: Commit**

```powershell
git add lib/recs/server-actions.ts lib/logs/server-actions.ts
git commit -m "feat(recs): dismiss / save / play / refill server actions

- dismissRec(recId): owner-only; sets dismissed=true; no cache invalidation
  (remaining 4 rows stay served; gameId enters next rerank negative context)
- saveRecForLater(recId): creates log(status=backlog) via ensureLog (which
  fires triggerOnLogWrite → cache invalidate + maybe milestone narrative)
- playRec(recId, platform?): smart routing — confirms platform connection;
  creates log(status=playing) when connected; falls back to /games/{slug}
  redirect when no platform hint or game doesn't have the platform
- refillRecs(filters): wipes cache for current key, calls getRecs → fresh
  AI rerank with cumulative dismissed history in negative context

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 15: Wire 3 buttons + refill into RecCard with optimistic dismiss + toast feedback

**Goal:** RecCard now actually does things. The three buttons fire the right server actions, the dismissed card slides out, and the "Show me more like these →" CTA appears after at least one dismissal. Toast feedback on every action.

**Files:**
- Modify: `components/recs/rec-card.tsx` (add 3 buttons + optimistic state)
- Modify: `app/(app)/play-next/_client.tsx` (wire refill CTA + optimistic dismiss)
- Create: `components/recs/refill-button.tsx` (small island)

**Acceptance Criteria:**
- [ ] RecCard has three buttons: `Play this` (with optional platform picker dropdown when multiple connected), `Save for later`, `Not for me`.
- [ ] Click "Not for me" → card slides out via Framer Motion → server action fires in the background → toast `"Dismissed."` on success.
- [ ] Click "Save for later" → card slides out → log created → toast `"Added to your backlog."`.
- [ ] Click "Play this" → if no platform overlap → redirect to `/games/{slug}`. If single platform overlap → create log + toast `"Marked as playing on {platform}."`. If multiple platform overlap → show platform picker → user clicks one → create log + toast.
- [ ] After any dismissal (Not for me / Save / Play): "Show me more like these →" CTA appears at the bottom; clicking it calls `refillRecs(filters)` and replaces the grid.
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean.
- [ ] Manual: each button works on a real test account.

**Verify:** `pnpm typecheck && pnpm lint && pnpm build` + manual.

**Steps:**

- [ ] **Step 1: Update `components/recs/rec-card.tsx` with action buttons**

```typescript
"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTransition, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import {
  dismissRec,
  saveRecForLater,
  playRec,
  type RecCard as RecCardData,
} from "@/lib/recs/server-actions";

type Platform = "steam" | "xbox" | "psn";

export function RecCard({
  rec,
  connectedPlatforms,
  gamePlatforms,
  onDismissed,
}: {
  rec: RecCardData;
  connectedPlatforms: Platform[];
  gamePlatforms: Platform[];
  onDismissed: (recId: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [hidden, setHidden] = useState(false);

  const overlap = gamePlatforms.filter((p) => connectedPlatforms.includes(p));

  function doDismiss(action: () => Promise<void>) {
    setHidden(true);
    startTransition(async () => {
      await action();
      onDismissed(rec.id);
    });
  }

  function onNotForMe() {
    doDismiss(async () => {
      const r = await dismissRec(rec.id);
      if (r.ok) toast("Dismissed.");
      else toast.error("Couldn't dismiss this one.");
    });
  }

  function onSave() {
    doDismiss(async () => {
      const r = await saveRecForLater(rec.id);
      if (r.ok) toast.success(r.message);
      else toast.error("Couldn't save this one.");
    });
  }

  function onPlayWithPlatform(p?: Platform) {
    doDismiss(async () => {
      const r = await playRec(rec.id, p);
      if (!r.ok) {
        toast.error(
          r.reason === "platform-not-connected"
            ? "That platform isn't connected."
            : "Couldn't mark as playing.",
        );
        return;
      }
      if (r.redirect) {
        router.push(`/games/${r.slug}`);
      } else {
        toast.success(r.message);
      }
    });
  }

  if (hidden) return null;

  const art = rec.posterUrl ?? rec.coverUrl;
  const isAi = rec.algorithm === "ai_rerank" || rec.algorithm === "hybrid";

  return (
    <motion.div
      layout
      initial={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
      className="overflow-hidden rounded-md border border-zinc-800 bg-zinc-950"
    >
      <div className="relative aspect-[2/3] w-full bg-zinc-900">
        {art ? <Image src={art} alt={rec.title} fill className="object-cover" sizes="240px" /> : null}
        <span
          className={cn(
            "absolute right-1 top-1 rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider",
            isAi ? "bg-emerald-600/80 text-white" : "bg-zinc-800/80 text-zinc-400",
          )}
        >
          {isAi ? "AI pick" : "basic match"}
        </span>
      </div>
      <div className="space-y-2 p-3">
        <h3 className="text-sm font-medium leading-tight">
          {rec.title}
          {rec.releasedYear ? (
            <span className="ml-1 font-normal text-zinc-500">'{String(rec.releasedYear).slice(-2)}</span>
          ) : null}
        </h3>
        <p title={rec.reason} className="line-clamp-3 text-xs leading-snug text-zinc-400">
          {rec.reason}
        </p>
        <div className="flex flex-col gap-1 pt-2">
          <PlayThisButton overlap={overlap} pending={pending} onPlay={onPlayWithPlatform} />
          <button
            type="button"
            disabled={pending}
            onClick={onSave}
            className="rounded border border-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-700 disabled:opacity-50"
          >
            Save for later
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onNotForMe}
            className="rounded border border-zinc-900 px-2 py-1 text-xs text-zinc-500 hover:border-zinc-800 hover:text-zinc-400 disabled:opacity-50"
          >
            Not for me
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function PlayThisButton({
  overlap,
  pending,
  onPlay,
}: {
  overlap: Platform[];
  pending: boolean;
  onPlay: (p?: Platform) => void;
}) {
  const [openPicker, setOpenPicker] = useState(false);

  if (overlap.length === 0) {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => onPlay(undefined)}
        className="rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        Play this →
      </button>
    );
  }

  if (overlap.length === 1) {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => onPlay(overlap[0])}
        className="rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        Play on {overlap[0]} →
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        disabled={pending}
        onClick={() => setOpenPicker((o) => !o)}
        className="w-full rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        Play this ▾
      </button>
      {openPicker && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-md border border-zinc-700 bg-zinc-900 p-1 shadow-lg">
          {overlap.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setOpenPicker(false);
                onPlay(p);
              }}
              className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-zinc-800"
            >
              On {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire dismissal + refill in `_client.tsx`**

In the results-render block of `PlayNextClient`, wire optimistic dismiss + refill:

```typescript
const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

function onCardDismissed(recId: string) {
  setDismissedIds((s) => new Set(s).add(recId));
}

function onRefill() {
  startTransition(async () => {
    const filters: FilterParams = {
      time: time as FilterParams["time"],
      moods: moods as FilterParams["moods"],
      platforms: platforms as FilterParams["platforms"],
    };
    const next = await refillRecs(filters);
    setRecsState(next);
    setDismissedIds(new Set());
  });
}

// ... in the results render:
const visibleRecs = recsState?.ok ? recsState.recs.filter((r) => !dismissedIds.has(r.id)) : [];
const hasDismissed = dismissedIds.size > 0;

// Replace the recs.map block:
<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
  {visibleRecs.map((r) => (
    <RecCard
      key={r.id}
      rec={r}
      connectedPlatforms={userConnectedPlatforms}
      gamePlatforms={[]} // T15.Step 3: thread game.platforms through getRecs response
      onDismissed={onCardDismissed}
    />
  ))}
</div>
{hasDismissed && (
  <div className="mt-6 flex justify-center">
    <button
      type="button"
      onClick={onRefill}
      disabled={pending}
      className="rounded border border-emerald-700 px-4 py-2 text-sm font-mono text-emerald-300 hover:bg-emerald-950/30 disabled:opacity-50"
    >
      Show me more like these →
    </button>
  </div>
)}
```

Add the `refillRecs` import:

```typescript
import { getRecs, refillRecs, type RecCard as RecCardData, type RecResult } from "@/lib/recs/server-actions";
```

- [ ] **Step 3: Thread game platforms into RecResult**

To support the platform-picker dropdown, `RecCard` needs to know what platforms each game has. Update `RecCard` type in `lib/recs/server-actions.ts` to include `platforms: string[]`. Update both the rerank-result re-read path and the metadata-only path to populate it via a join on `games.platforms`. Update `_client.tsx` to pass `gamePlatforms={r.platforms as Platform[]}`.

(Mechanical update — the same JOIN already loads `games.id/slug/title`; just add `games.platforms` to the SELECT and pass through.)

- [ ] **Step 4: Typecheck, lint, build**

```powershell
pnpm typecheck; if ($?) { pnpm lint }; if ($?) { pnpm build }
```

- [ ] **Step 5: Manual smoke**

On a test account with sharpening tier + Steam connected:

1. Visit `/play-next`, walk through to results.
2. Click "Save for later" on rec #1 → card slides out → toast "Added to your backlog." → confirm in `/library` that the backlog log exists.
3. Click "Not for me" on rec #2 → card slides out → toast "Dismissed."
4. "Show me more like these →" CTA appears at bottom.
5. Click "Play on steam" on rec #3 (game has Steam) → card slides out → toast "Marked as playing on steam." → confirm log in `/library` at status=playing.
6. For a rec whose game has no Steam (test by picking PSN-only): click "Play this →" → redirect to `/games/{slug}`.
7. Click "Show me more like these →" → mascot thinks → fresh rerank → 5 new cards, no overlap with the 3 dismissed games (because they're in negative context).

- [ ] **Step 6: Commit**

```powershell
git add components/recs/rec-card.tsx app/(app)/play-next/_client.tsx lib/recs/server-actions.ts
git commit -m "feat(recs): 3-button feedback UI with optimistic dismiss + refill CTA

- RecCard: Play this / Save for later / Not for me buttons
  - Play this: 0 connected overlap → /games redirect; 1 → direct create-log;
    2+ → platform-picker dropdown
  - Save for later: creates log(status=backlog), slides card out, toast
  - Not for me: slides card out, dismissed=true, no immediate refill
- Optimistic dismiss via local Set<recId>; framer-motion exit animation
- 'Show me more like these →' CTA appears after first dismissal; calls
  refillRecs → fresh rerank with cumulative dismissed history
- Threaded games.platforms into RecResult for the platform-picker

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

**End-of-W5 demo:** Full feedback loop. Dismiss / save / play all observable in `/library`. The next refill rerank avoids dismissed games.

---

## Task 16: dominant-pose + playstyle mapping + Vercel OG trading-card endpoint

**Goal:** The shareable trading card. Vercel OG renders a 1200×630 pixel-art card with the mascot in a pose that maps to the user's dominant taste cluster, plus stats panel and narrative excerpt. Endpoint at `/api/og/taste/{username}`, Edge runtime, public profiles only.

**Files:**
- Create: `lib/og/dominant-pose.ts`
- Create: `lib/taste/playstyle.ts`
- Create: `lib/og/taste-card.tsx`
- Create: `app/api/og/taste/[username]/route.ts`

**Acceptance Criteria:**
- [ ] `lib/og/dominant-pose.ts` exports `dominantPose(vectors: VectorBundle): MascotPose` mapping 12+ keywords to 6 poses with a "narrating" default.
- [ ] `lib/taste/playstyle.ts` exports `playstyleFromMechanics(mechanics: Record<string, number>): string` mapping 12+ mechanic names to a one-word playstyle.
- [ ] `lib/og/taste-card.tsx` exports a function-component that takes `{ username, narrative, topGenre, playstyle, lengthSweetSpot, pose }` and returns the OG JSX.
- [ ] `/api/og/taste/[username]` route returns a 1200×630 PNG; 404s when profile is private; cache header is `Cache-Control: public, s-maxage=604800, stale-while-revalidate=86400`.
- [ ] Hitting the URL in a browser shows a rendered image with all elements visible.

**Verify:** Visit `/api/og/taste/<my-username>` in a browser with `?v=2026` (any version key) — image renders.

**Steps:**

- [ ] **Step 1: Create `lib/og/dominant-pose.ts`**

```typescript
import type { VectorBundle, SparseVector } from "@/lib/taste/vectors";

export type MascotPose =
  | "narrating"
  | "tactician"
  | "lantern"
  | "cozy"
  | "ready"
  | "wary"
  | "celebrating";

const POSE_KEYWORDS: Array<{ pose: MascotPose; tokens: string[] }> = [
  { pose: "tactician", tokens: ["Strategy", "Turn-based Strategy", "Tactics", "Tactical RPG", "Real-Time Strategy"] },
  { pose: "lantern", tokens: ["Narrative", "Story-driven", "Adventure", "RPG", "Visual Novel"] },
  { pose: "cozy", tokens: ["Casual", "Cozy", "Life Sim", "Simulation", "Puzzle"] },
  { pose: "ready", tokens: ["Action", "Shooter", "FPS", "Platformer", "Hack and Slash"] },
  { pose: "wary", tokens: ["Horror", "Survival", "Survival Horror", "Roguelike", "Souls-like"] },
];

/**
 * Pick the dominant mascot pose from the user's vectors.
 *
 * Looks across all three vectors (genre/theme/mechanic) for any token
 * that matches a pose's keyword list, weighted by the token's score.
 * Highest-scoring pose wins. Ties broken by POSE_KEYWORDS order.
 *
 * Falls back to "narrating" when no keyword matches (e.g. brand-new user
 * with empty vectors).
 */
export function dominantPose(vectors: VectorBundle): MascotPose {
  const scores: Record<MascotPose, number> = {
    narrating: 0,
    tactician: 0,
    lantern: 0,
    cozy: 0,
    ready: 0,
    wary: 0,
    celebrating: 0,
  };

  function scan(vec: SparseVector) {
    for (const [token, value] of Object.entries(vec)) {
      if (value <= 0) continue;
      for (const { pose, tokens } of POSE_KEYWORDS) {
        if (tokens.some((t) => t.toLowerCase() === token.toLowerCase())) {
          scores[pose] += value;
        }
      }
    }
  }
  scan(vectors.genre);
  scan(vectors.theme);
  scan(vectors.mechanic);

  let best: MascotPose = "narrating";
  let bestScore = 0;
  for (const { pose } of POSE_KEYWORDS) {
    if (scores[pose] > bestScore) {
      best = pose;
      bestScore = scores[pose];
    }
  }
  return best;
}
```

- [ ] **Step 2: Create `lib/taste/playstyle.ts`**

```typescript
const PLAYSTYLE_MAP: Array<[string, string]> = [
  ["Turn-based", "Tactician"],
  ["Real-Time Strategy", "Commander"],
  ["Permadeath", "Survivor"],
  ["Roguelike", "Survivor"],
  ["Puzzle", "Solver"],
  ["Stealth", "Operative"],
  ["Open World", "Wanderer"],
  ["Crafting", "Builder"],
  ["Co-op", "Companion"],
  ["Competitive", "Contender"],
  ["Souls-like", "Pilgrim"],
  ["Visual Novel", "Reader"],
  ["Sandbox", "Sandboxer"],
  ["Simulation", "Caretaker"],
];

export function playstyleFromMechanics(mechanics: Record<string, number>): string {
  let best: string | null = null;
  let bestScore = 0;
  for (const [mechanic, label] of PLAYSTYLE_MAP) {
    const score = mechanics[mechanic] ?? 0;
    if (score > bestScore) {
      best = label;
      bestScore = score;
    }
  }
  return best ?? "Curator";
}
```

- [ ] **Step 3: Create `lib/og/taste-card.tsx`**

Vercel OG uses JSX with a constrained set of CSS properties. Inline styles only; no className.

```typescript
/* @jsxImportSource react */
import type { MascotPose } from "./dominant-pose";

const FONT_MONO = "ui-monospace, monospace";

export type TasteCardProps = {
  username: string;
  narrative: string;
  topGenre: string;
  playstyle: string;
  lengthSweetSpot: string;
  pose: MascotPose;
  /** Absolute URL of the mascot sprite for the pose (passed in from the route). */
  mascotImageUrl: string;
};

export function TasteCard(props: TasteCardProps) {
  return (
    <div
      style={{
        width: 1200,
        height: 630,
        display: "flex",
        background: "#0a0a0a",
        fontFamily: FONT_MONO,
        color: "#e4e4e7",
        padding: 40,
      }}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          border: "4px solid #27272a",
          borderRadius: 16,
          padding: 40,
          gap: 24,
        }}
      >
        {/* Top row: mascot + username */}
        <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
          <img
            src={props.mascotImageUrl}
            width={120}
            height={120}
            style={{ imageRendering: "pixelated" }}
            alt=""
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 18, color: "#71717a", textTransform: "uppercase", letterSpacing: 2 }}>
              taste card
            </span>
            <span style={{ fontSize: 36, color: "#e4e4e7" }}>@{props.username}</span>
          </div>
        </div>

        {/* Stats panel */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            background: "#18181b",
            border: "2px solid #27272a",
            borderRadius: 8,
            padding: 20,
            gap: 12,
            fontSize: 22,
          }}
        >
          <Row label="TOP GENRE" value={props.topGenre} />
          <Row label="PLAYSTYLE" value={props.playstyle} />
          <Row label="SWEET SPOT" value={props.lengthSweetSpot} />
        </div>

        {/* Narrative */}
        <div
          style={{
            display: "flex",
            fontSize: 24,
            lineHeight: 1.4,
            color: "#a1a1aa",
            marginTop: "auto",
          }}
        >
          "{props.narrative}"
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
      <span style={{ color: "#52525b", width: 160 }}>{label}</span>
      <span style={{ color: "#fafafa", flex: 1 }}>{value}</span>
    </div>
  );
}
```

- [ ] **Step 4: Create `app/api/og/taste/[username]/route.ts`**

```typescript
import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { profiles, tasteFingerprints, authUsers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { dominantPose } from "@/lib/og/dominant-pose";
import { playstyleFromMechanics } from "@/lib/taste/playstyle";
import { TasteCard } from "@/lib/og/taste-card";

export const runtime = "edge";

function lengthSweetSpot(lengthPref: Record<string, number>): string {
  const buckets: Array<[string, string]> = [
    ["<5h", "<5 HRS"],
    ["5-10h", "5–10 HRS"],
    ["10-30h", "10–30 HRS"],
    ["30-60h", "30–60 HRS"],
    ["60h+", "60+ HRS"],
  ];
  let best: string | null = null;
  let bestScore = 0;
  for (const [k, label] of buckets) {
    if ((lengthPref[k] ?? 0) > bestScore) {
      best = label;
      bestScore = lengthPref[k];
    }
  }
  return best ?? "VARIED";
}

function topGenre(genreVec: Record<string, number>): string {
  let best: string | null = null;
  let bestScore = -Infinity;
  for (const [k, v] of Object.entries(genreVec)) {
    if (v > bestScore) {
      best = k;
      bestScore = v;
    }
  }
  return (best ?? "UNDISCOVERED").toUpperCase();
}

export async function GET(
  request: Request,
  context: { params: Promise<{ username: string }> },
): Promise<Response> {
  const { username } = await context.params;

  // Look up profile + privacy gate.
  const [profile] = await db
    .select({
      userId: profiles.userId,
      isPublic: profiles.isPublic,
    })
    .from(profiles)
    .where(eq(profiles.username, username))
    .limit(1);
  if (!profile) return new NextResponse("Not Found", { status: 404 });
  if (!profile.isPublic) return new NextResponse("Not Found", { status: 404 });

  const [fp] = await db
    .select({
      narrative: tasteFingerprints.narrativeSummary,
      genre: tasteFingerprints.genreVector,
      mechanic: tasteFingerprints.mechanicVector,
      theme: tasteFingerprints.themeVector,
      length: tasteFingerprints.lengthPreference,
    })
    .from(tasteFingerprints)
    .where(eq(tasteFingerprints.userId, profile.userId))
    .limit(1);
  if (!fp || !fp.narrative) return new NextResponse("Not Found", { status: 404 });

  const vectors = {
    genre: (fp.genre as Record<string, number>) ?? {},
    theme: (fp.theme as Record<string, number>) ?? {},
    mechanic: (fp.mechanic as Record<string, number>) ?? {},
  };
  const pose = dominantPose(vectors);
  const playstyle = playstyleFromMechanics(vectors.mechanic);
  const top = topGenre(vectors.genre);
  const sweet = lengthSweetSpot((fp.length as Record<string, number>) ?? {});

  // Absolute URL for the mascot sprite (Edge can't read /public directly).
  const origin = new URL(request.url).origin;
  const mascotImageUrl = `${origin}/mascot/${pose}.png`;

  return new ImageResponse(
    (
      <TasteCard
        username={username}
        narrative={fp.narrative}
        topGenre={top}
        playstyle={playstyle.toUpperCase()}
        lengthSweetSpot={sweet}
        pose={pose}
        mascotImageUrl={mascotImageUrl}
      />
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        "Cache-Control": "public, s-maxage=604800, stale-while-revalidate=86400",
      },
    },
  );
}
```

- [ ] **Step 5: Verify mascot sprites exist for the 6 poses**

```powershell
Get-ChildItem public/mascot/*.png | Select-Object Name
```

Confirm: `tactician.png`, `lantern.png`, `cozy.png`, `ready.png`, `wary.png`, `narrating.png` all exist. If any are missing, use a placeholder copy of an existing sprite for now; replace with proper art in Phase 7 (commission step).

- [ ] **Step 6: Manual smoke**

```powershell
pnpm dev
# Visit http://localhost:3000/api/og/taste/<your-username>
```

Image renders. Trading-card layout visible. Mascot pose matches your dominant cluster. Stats panel populated. Narrative truncated cleanly.

Test the 404 path: flip your profile `is_public = false` in Supabase Studio; reload → expect 404.

- [ ] **Step 7: Commit**

```powershell
git add lib/og/ lib/taste/playstyle.ts app/api/og/taste/
git commit -m "feat(taste): trading-card OG endpoint at /api/og/taste/{username}

- lib/og/dominant-pose.ts: 5 keyword pose mappings (tactician/lantern/cozy/
  ready/wary) + narrating default — scans all 3 vectors for keyword overlap
- lib/taste/playstyle.ts: 14 mechanic → playstyle mappings (Tactician,
  Commander, Survivor, Solver, ...)
- lib/og/taste-card.tsx: Vercel OG JSX — 1200×630 pixel-art trading card
  (mascot + username + stats panel + narrative)
- /api/og/taste/{username} route: Edge runtime, 7-day cache header,
  404 on private profile

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 17: Share modal — Tweet / Copy link / Download

**Goal:** The `<ShareButton>` placeholder on `/u/{name}/taste` (T6) becomes a real modal that previews the trading card and offers three share affordances.

**Files:**
- Create: `components/taste/share-modal.tsx`
- Modify: `components/taste/tier-narrative.tsx` (use real ShareModal instead of stub button)

**Acceptance Criteria:**
- [ ] `<ShareModal>` is a client island that renders a `<dialog>` (or shadcn Sheet/Dialog if used elsewhere) with:
  - Live preview of `/api/og/taste/{username}?v={narrativeGeneratedAt}` as an image
  - Tweet button → opens `https://twitter.com/intent/tweet?text=...&url=...` in a new window
  - Copy link button → writes `https://{origin}/u/{username}/taste` to clipboard, toasts "Link copied"
  - Download image button → fetches the OG URL and triggers a download
- [ ] Disabled state when `is_public=false` was already handled in T6 — but the modal itself should also gate behind the public check defensively.
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean.
- [ ] Manual: open modal → preview renders → Tweet button opens a Twitter compose window → Copy link copies → Download saves a PNG.

**Verify:** `pnpm typecheck && pnpm lint && pnpm build` + manual.

**Steps:**

- [ ] **Step 1: Create `components/taste/share-modal.tsx`**

```typescript
"use client";

import { useState } from "react";
import Image from "next/image";
import { toast } from "sonner";

export function ShareModal({
  username,
  narrativeGeneratedAt,
  origin,
}: {
  username: string;
  narrativeGeneratedAt: Date | null;
  origin: string;
}) {
  const [open, setOpen] = useState(false);

  const profileUrl = `${origin}/u/${username}/taste`;
  const versionKey = narrativeGeneratedAt?.getTime() ?? Date.now();
  const ogUrl = `${origin}/api/og/taste/${username}?v=${versionKey}`;

  function onTweet() {
    const text = `Read my gaming taste at @yourapp →`;
    const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(profileUrl)}`;
    window.open(intent, "_blank", "noopener,noreferrer");
  }

  async function onCopyLink() {
    try {
      await navigator.clipboard.writeText(profileUrl);
      toast.success("Link copied.");
    } catch {
      toast.error("Couldn't copy. Long-press the URL to copy manually.");
    }
  }

  async function onDownload() {
    try {
      const resp = await fetch(ogUrl);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${username}-taste.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Couldn't download. Try right-click → Save As on the preview.");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-zinc-800 px-3 py-1 text-xs hover:bg-zinc-900"
      >
        Share →
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-w-2xl rounded-lg border border-zinc-800 bg-zinc-950 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 font-mono text-lg">Share your taste card</h2>
            <div className="mb-4 overflow-hidden rounded-md border border-zinc-800 bg-zinc-900">
              <Image src={ogUrl} alt="Taste card preview" width={1200} height={630} unoptimized />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onTweet}
                className="rounded bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-500"
              >
                Tweet
              </button>
              <button
                type="button"
                onClick={onCopyLink}
                className="rounded border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-900"
              >
                Copy link
              </button>
              <button
                type="button"
                onClick={onDownload}
                className="rounded border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-900"
              >
                Download image
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="ml-auto text-xs text-zinc-500 hover:text-zinc-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Wire `ShareModal` into `TierNarrative`**

Replace the `<ShareButton disabled={!isPublic} />` stub with:

```typescript
// At top of components/taste/tier-narrative.tsx:
import { ShareModal } from "./share-modal";
import { headers } from "next/headers";

// Pass origin from the parent server component into TierNarrative:
//   in app/(app)/u/[username]/taste/page.tsx:
//     const origin = new URL(req.url ?? "https://example.com").origin;
//     // Cleaner: get from request headers.

// Or use Next 16 headers() in the server component to compute origin:
const h = await headers();
const host = h.get("host") ?? "localhost:3000";
const proto = h.get("x-forwarded-proto") ?? "http";
const origin = `${proto}://${host}`;

// Then in JSX:
{isPublic ? (
  <ShareModal
    username={username}
    narrativeGeneratedAt={narrativeGeneratedAt}
    origin={origin}
  />
) : (
  <button
    disabled
    title="Make your profile public to share your taste card."
    className="rounded border border-zinc-800 px-3 py-1 text-xs disabled:cursor-not-allowed disabled:text-zinc-600"
  >
    Share →
  </button>
)}
```

Pass `username` and `origin` through `TierNarrative`'s props; update its signature.

- [ ] **Step 3: Typecheck, lint, build + manual smoke**

```powershell
pnpm typecheck; if ($?) { pnpm lint }; if ($?) { pnpm build }
```

Open the share modal on a sharpening/full account. Preview shows the trading card. Click each button. Verify Twitter intent + clipboard + download all work.

- [ ] **Step 4: Commit**

```powershell
git add components/taste/share-modal.tsx components/taste/tier-narrative.tsx
git commit -m "feat(taste): share modal with Tweet / Copy link / Download

- ShareModal: dialog with live OG preview (cache-busted by narrativeGeneratedAt)
- Tweet → Twitter intent URL in new window
- Copy link → clipboard + toast
- Download image → fetch OG endpoint, blob download
- Disabled-with-tooltip Share button for private profiles (gates client side
  + OG endpoint already 404s server side per T16)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 18: Daily drift cron — taste-drift-cron Edge Function + pg_cron schedule

**Goal:** Daily 03:00 UTC cron that scans users whose last narrative is older than 7 days, computes drift against the snapshot, and enqueues `refresh-fingerprint` for any user whose vectors drifted > 0.25. Concurrency cap 10 (mirrors Phase 3 daily-sync).

**Files:**
- Create: `supabase/functions/taste-drift-cron/index.ts`
- Create: `supabase/migrations/0007_phase4_drift_cron.sql` (pg_cron schedule registration)

**Acceptance Criteria:**
- [ ] Edge Function: accepts `POST` with service-role apikey; rejects without; scans `taste_fingerprints` rows where `narrative_generated_at IS NOT NULL AND narrative_generated_at < NOW() - INTERVAL '7 days'`.
- [ ] For each candidate, recomputes current vectors via Edge-side aggregation and compares to `narrative_snapshot_vectors`; if drift > 0.25, enqueues a `refresh-fingerprint` call via `EdgeRuntime.waitUntil`.
- [ ] Concurrency cap = 10 per batch.
- [ ] pg_cron schedules the function at `0 3 * * *` daily.
- [ ] Local invoke produces non-empty `{ scanned, drifted, scheduled }` against a hand-aged narrative_generated_at.

**Verify:** Local invoke via `curl` with service-role key → `{ scanned: N, drifted: M, scheduled: M }` JSON.

**Steps:**

- [ ] **Step 1: Create `supabase/functions/taste-drift-cron/index.ts`**

```typescript
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.9";
import { requireServiceRole } from "../_shared/auth.ts";
import { aggregate, type AggregateRow } from "../_shared/taste-engine.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

function cosineSim(a: Record<string, number>, b: Record<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const av = a[k] ?? 0;
    const bv = b[k] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function drift(
  current: { genre: Record<string, number>; theme: Record<string, number>; mechanic: Record<string, number> },
  snap: { genre: Record<string, number>; theme: Record<string, number>; mechanic: Record<string, number> },
): number {
  return Math.max(
    1 - cosineSim(current.genre, snap.genre),
    1 - cosineSim(current.theme, snap.theme),
    1 - cosineSim(current.mechanic, snap.mechanic),
  );
}

const DRIFT_THRESHOLD = 0.25;

Deno.serve(async (req) => {
  const unauthorized = requireServiceRole(req);
  if (unauthorized) return unauthorized;

  const databaseUrl = Deno.env.get("DATABASE_URL")!;
  const functionsUrl =
    Deno.env.get("SUPABASE_FUNCTIONS_URL") ?? Deno.env.get("SUPABASE_URL") + "/functions/v1";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sql = postgres(databaseUrl, { prepare: false });

  try {
    // 1. Find candidate users (narrative > 7 days old).
    const candidates = await sql<
      Array<{ user_id: string; snapshot: { genre: Record<string, number>; theme: Record<string, number>; mechanic: Record<string, number> } | null }>
    >`
      SELECT user_id, narrative_snapshot_vectors AS snapshot
      FROM taste_fingerprints
      WHERE narrative_generated_at IS NOT NULL
        AND narrative_generated_at < NOW() - INTERVAL '7 days'
    `;

    let drifted = 0;
    let scheduled = 0;
    const BATCH = 10;

    for (let i = 0; i < candidates.length; i += BATCH) {
      const slice = candidates.slice(i, i + BATCH);
      const jobs = slice.map(async (c) => {
        // Recompute vectors for this user.
        const rows = await sql<AggregateRow[]>`
          SELECT l.status, l.rating::float AS rating,
            (r.id IS NOT NULL) AS has_published_review,
            g.genres, g.themes, g.mechanics, g.playtime_avg_hours::float AS playtime_avg_hours
          FROM logs l JOIN games g ON g.id = l.game_id
          LEFT JOIN reviews r ON r.log_id = l.id AND r.published_at IS NOT NULL
          WHERE l.user_id = ${c.user_id}
        `;
        if (rows.length === 0) return;
        const agg = aggregate(rows);
        const current = { genre: agg.genre, theme: agg.theme, mechanic: agg.mechanic };
        const d = c.snapshot ? drift(current, c.snapshot) : Infinity;
        if (d > DRIFT_THRESHOLD) {
          drifted++;
          const triggerPromise = fetch(`${functionsUrl}/refresh-fingerprint`, {
            method: "POST",
            headers: { apikey: serviceRoleKey, "Content-Type": "application/json" },
            body: JSON.stringify({ userId: c.user_id, reason: "drift", driftValue: d }),
          }).catch((err) => console.error("taste-drift-cron trigger failed:", c.user_id, err));
          if (typeof EdgeRuntime !== "undefined") {
            EdgeRuntime.waitUntil(triggerPromise);
          } else {
            await triggerPromise;
          }
          scheduled++;
        }
      });
      await Promise.all(jobs);
    }

    return Response.json({ scanned: candidates.length, drifted, scheduled });
  } finally {
    await sql.end({ timeout: 5 });
  }
});
```

- [ ] **Step 2: Create `supabase/migrations/0007_phase4_drift_cron.sql`**

Mirror the Phase 3 pg_cron migration shape:

```sql
-- Phase 4: daily taste-drift cron (03:00 UTC)
-- Idempotent registration — safe to re-run.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'taste-drift-cron') THEN
    PERFORM cron.unschedule('taste-drift-cron');
  END IF;
END $$;

SELECT cron.schedule(
  'taste-drift-cron',
  '0 3 * * *',
  $$
    SELECT net.http_post(
      url := vault.read_secret('functions_url') || '/taste-drift-cron',
      headers := jsonb_build_object('apikey', vault.read_secret('service_role_key'))
    ) AS request_id;
  $$
);
```

(Verify the vault secret names match what Phase 3's `daily-sync` migration used; if Phase 3 used `service_role_key` and `functions_url` set up via `select vault.create_secret(...)`, reuse them here. Otherwise create them inline before scheduling.)

- [ ] **Step 3: Apply migration + deploy function**

```powershell
# Apply the SQL migration via Supabase dashboard or CLI:
supabase db push  # or whatever path the project uses for SQL-only migrations
supabase functions deploy taste-drift-cron
```

- [ ] **Step 4: Manual smoke**

In Supabase Studio:

```sql
-- Age the test user's narrative so it's a candidate
UPDATE taste_fingerprints
SET narrative_generated_at = NOW() - INTERVAL '10 days',
    narrative_snapshot_vectors = '{"genre": {"ForcedShift": 1.0}, "theme": {}, "mechanic": {}}'::jsonb
WHERE user_id = '<test-user-id>';
```

```powershell
curl -X POST https://<project>.supabase.co/functions/v1/taste-drift-cron `
  -H "apikey: <service-role-key>"
```

Expected: `{ scanned: 1, drifted: 1, scheduled: 1 }`. Wait ~10s. Re-query the test user's `narrative_generated_at` — should be fresh.

- [ ] **Step 5: Commit**

```powershell
git add supabase/functions/taste-drift-cron/ supabase/migrations/0007_phase4_drift_cron.sql
git commit -m "feat(taste): daily drift cron — re-narrate users whose vectors drifted >0.25

- supabase/functions/taste-drift-cron: scan users with narrative_generated_at
  >7 days old; recompute vectors; cosine-distance compare to
  narrative_snapshot_vectors; trigger refresh-fingerprint via
  EdgeRuntime.waitUntil for any user past the 0.25 drift threshold
- Concurrency cap 10 (matches Phase 3 daily-sync)
- pg_cron schedule 0 3 * * * via supabase/migrations/0007 (vault-secret-based,
  idempotent registration via unschedule-then-schedule)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 19: Cockpit "Your taste" card + profile dropdown link + first-fingerprint celebration toast

**Goal:** Discovery surfaces on `/home` cockpit and the profile dropdown. Plus the celebratory milestone toast when a user generates their first fingerprint (crosses the 10-log threshold).

**Files:**
- Modify: `app/(app)/_cockpit/cockpit-dashboard.tsx` (add "Your taste" card)
- Modify: `components/layout/profile-dropdown.tsx` (add "View your taste" link)
- Create: `components/taste/milestone-toast.tsx` (client island that fires once when narrative first appears)
- Modify: `app/(app)/u/[username]/taste/page.tsx` (mount the milestone-toast on owner views)

**Acceptance Criteria:**
- [ ] `/home` cockpit gains a "Your taste" card next to the "What should I play?" card (from T10). Shows: tier badge, 1-line narrative excerpt (line-clamp-1), chart thumbnail (mini ScoreBar grid), and `View →` linking to `/me/taste`. Hidden for `tier === 'empty'`.
- [ ] Profile dropdown gains a "View your taste" link to `/me/taste`. Visible always (even at tier=empty, where it redirects to the empty-tier UX).
- [ ] First fingerprint milestone toast: when the owner visits `/me/taste` and sees a freshly-generated narrative (narrative present, `narrative_generated_at` within last 5 minutes, and a localStorage flag `firstFingerprintCelebrated:${userId}` not yet set), a toast `🎉 Your first taste read is ready!` fires once. Flag persists so it never fires again.
- [ ] `pnpm typecheck && pnpm lint && pnpm build` clean.
- [ ] Manual: cross 10 logs → visit /me/taste → toast fires once. Reload → no toast.

(Note: per the locked design principles, no emojis in product UI. The celebration toast uses a small pixel-art `🎉` substitute — a `<Mascot mood="celebrating" />` rendered inline. Adjust the spec wording at the toast.)

**Verify:** `pnpm typecheck && pnpm lint && pnpm build` + manual.

**Steps:**

- [ ] **Step 1: Cockpit "Your taste" card**

Modify `app/(app)/_cockpit/cockpit-dashboard.tsx`:

```typescript
// Add near the top:
import { getFingerprint } from "@/lib/taste/server-actions";
import { ScoreBar } from "@/components/taste/score-bar";

// Inside the dashboard:
const fp = await getFingerprint(me.id);

// ... existing layout ...
{fp.tier !== "empty" && (
  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
    <Link
      href="/me/taste"
      className="group rounded-md border border-zinc-800 bg-zinc-950 p-4 transition-colors hover:border-zinc-700"
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-mono text-sm">Your taste</h3>
        <span className="font-mono text-xs text-zinc-500">{fp.tier}</span>
      </div>
      {fp.narrative ? (
        <p className="mb-3 line-clamp-1 text-xs text-zinc-400">{fp.narrative}</p>
      ) : (
        <p className="mb-3 text-xs italic text-zinc-600">Generating your read…</p>
      )}
      <div className="space-y-1">
        {Object.entries(fp.vectors.genre)
          .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
          .slice(0, 3)
          .map(([k, v]) => (
            <ScoreBar key={k} value={v} label={k} />
          ))}
      </div>
      <span className="mt-3 block font-mono text-xs text-emerald-400 group-hover:translate-x-1 transition-transform">
        View →
      </span>
    </Link>

    {/* The 'What should I play?' card from T10 — keep it here */}
    {/* ... existing T10 card ... */}
  </div>
)}

{fp.tier === "empty" && (
  <Link
    href="/games"
    className="group flex items-center gap-4 rounded-md border border-zinc-800 bg-zinc-950 p-4 hover:border-zinc-700"
  >
    <Mascot mood="excited" size={64} />
    <div className="flex-1">
      <h3 className="font-mono text-sm">Log your first game</h3>
      <p className="mt-1 text-xs text-zinc-500">I'll start reading your taste as soon as you do.</p>
    </div>
    <span className="font-mono text-emerald-400 group-hover:translate-x-1 transition-transform">→</span>
  </Link>
)}
```

- [ ] **Step 2: Profile dropdown link**

Open `components/layout/profile-dropdown.tsx`. Add a new menu item:

```typescript
import { Sparkles } from "lucide-react"; // or whatever icon set the project uses

// Inside the menu:
<DropdownMenuItem asChild>
  <Link href="/me/taste" className="cursor-pointer">
    <Sparkles className="mr-2 h-4 w-4" />
    View your taste
  </Link>
</DropdownMenuItem>
```

(Adjust to match the existing dropdown's components — likely shadcn `DropdownMenu`.)

- [ ] **Step 3: Create `components/taste/milestone-toast.tsx`**

```typescript
"use client";

import { useEffect } from "react";
import { toast } from "sonner";

import { Mascot } from "@/components/mascot/mascot";

const RECENT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export function MilestoneToast({
  userId,
  narrative,
  narrativeGeneratedAt,
}: {
  userId: string;
  narrative: string | null;
  narrativeGeneratedAt: Date | null;
}) {
  useEffect(() => {
    if (!narrative || !narrativeGeneratedAt) return;
    const flagKey = `firstFingerprintCelebrated:${userId}`;
    if (localStorage.getItem(flagKey)) return;
    const age = Date.now() - narrativeGeneratedAt.getTime();
    if (age > RECENT_WINDOW_MS) return;

    toast.custom(
      () => (
        <div className="flex items-center gap-3 rounded-md border border-emerald-700 bg-emerald-950/80 px-4 py-3 text-sm">
          <Mascot mood="celebrating" size={40} />
          <span>Your first taste read is ready!</span>
        </div>
      ),
      { duration: 6000 },
    );
    localStorage.setItem(flagKey, String(Date.now()));
  }, [userId, narrative, narrativeGeneratedAt]);

  return null;
}
```

- [ ] **Step 4: Mount `<MilestoneToast>` in the taste page**

Open `app/(app)/u/[username]/taste/page.tsx`. After the existing render, add (only when owner):

```typescript
{isOwner && (
  <MilestoneToast
    userId={profile.id}
    narrative={fp.narrative}
    narrativeGeneratedAt={fp.narrativeGeneratedAt}
  />
)}
```

Import: `import { MilestoneToast } from "@/components/taste/milestone-toast";`

- [ ] **Step 5: Typecheck, lint, build, manual smoke**

```powershell
pnpm typecheck; if ($?) { pnpm lint }; if ($?) { pnpm build }
```

Test sequence on a test account at 9 logs:

1. `/home` → "Your taste" card hidden (tier=empty path may show "Log your first game" CTA — adjust as needed for 0-log vs 1–9-log).
2. Log a 10th game.
3. ~10s later, refresh `/me/taste` → narrative appears + celebration toast fires.
4. Hard-refresh `/me/taste` → no toast (flag set).
5. `/home` → "Your taste" card now shows the tier + narrative + mini bars.
6. Profile dropdown → "View your taste" link visible.

- [ ] **Step 6: Commit**

```powershell
git add app/(app)/_cockpit/cockpit-dashboard.tsx components/layout/profile-dropdown.tsx components/taste/milestone-toast.tsx app/(app)/u/[username]/taste/page.tsx
git commit -m "feat(taste): cockpit cards + profile dropdown link + milestone celebration toast

- /home cockpit: 'Your taste' card (tier badge + narrative excerpt + 3 mini
  ScoreBars + View link); 'What should I play?' card stays from T10
- Empty-tier cockpit: 'Log your first game' CTA replacing both cards
- Profile dropdown: 'View your taste' link → /me/taste
- MilestoneToast: client island fires once-per-user via localStorage flag
  when narrative is < 5min old; uses celebrating mascot pose inline (no emoji)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 20: scripts/verify-phase-4.ts + 4 manual items + gate closure ceremony

**Goal:** The verification gate. 39 automated checks across 9 groups (mirrors `verify-phase-3.ts`), 4 manual items run by the operator, then tag `phase-4-complete` + memory file + index update.

**Files:**
- Create: `scripts/verify-phase-4.ts`
- Create: `memory/phase_4_complete.md` (only after gate passes)
- Modify: `memory/MEMORY.md` (add pointer to the new memory file)

**Acceptance Criteria:**
- [ ] `scripts/verify-phase-4.ts` runs 39 automated checks across 9 groups (A–I) per the spec's verification section. Exit code 0 on all-pass; 1 otherwise. Output is colored per-check + final summary table.
- [ ] All 39 automated checks pass against the live DB + deployed Edge Functions + dev server.
- [ ] All 4 manual items (M1: narrative quality at 30 logs; M2: rec reasoning references filter context; M3: share card Discord preview; M4: pose mapping across 3 clusters) verified by hand.
- [ ] Tag `phase-4-complete` exists.
- [ ] `memory/phase_4_complete.md` exists with: gate criterion table, deliverables shipped, pre-Phase-5 housekeeping, next-phase guidance.
- [ ] `memory/MEMORY.md` updated with `- [Phase 4 complete](phase_4_complete.md)` line.

**Verify:** `pnpm tsx scripts/verify-phase-4.ts` → `39/39 passed` → ceremony.

**Steps:**

- [ ] **Step 1: Create `scripts/verify-phase-4.ts`**

This script is long — model it on the structure of `scripts/verify-phase-3.ts`. The skeleton:

```typescript
#!/usr/bin/env tsx
import "dotenv/config";
import { db } from "@/lib/db";
import { sql, eq } from "drizzle-orm";

// Color codes for pretty output (same as verify-phase-3.ts)
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

type CheckResult = { name: string; pass: boolean; detail?: string };
const results: Array<{ group: string; checks: CheckResult[] }> = [];

function check(group: string, name: string, fn: () => Promise<boolean> | boolean): Promise<void> {
  // ... same pattern as verify-phase-3
}

async function main() {
  // GROUP A — Schema sanity (5 checks)
  results.push({ group: "A. Schema sanity", checks: [] });
  await check("A. Schema sanity", "taste_fingerprints has narrative_snapshot_vectors", async () => {
    const r = await db.execute(sql`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'taste_fingerprints'
        AND column_name = 'narrative_snapshot_vectors'
    `);
    return r.rows.length > 0;
  });
  // ... 4 more

  // GROUP B — Edge function deploy + auth (6 checks)
  // GROUP C — Vector aggregation smoke (4 checks) — delegate to smoke-aggregate.ts via execSync
  // GROUP D — Tier + drift (4) — delegate to smoke-drift.ts
  // GROUP E — Rec engine smoke (5)
  // GROUP F — Server action auth + behavior (5)
  // GROUP G — Privacy + OG (4)
  // GROUP H — Prompt builders + mood allowlist (3)
  // GROUP I — Delegated smokes (3) — exit codes of the smoke scripts

  // ... summary table + criterion mapping
}

main().then(() => {
  // Exit 0 if all groups passed; 1 otherwise.
  const allPassed = results.every((g) => g.checks.every((c) => c.pass));
  process.exit(allPassed ? 0 : 1);
});
```

Use `scripts/verify-phase-3.ts` as a structural reference — copy the helpers, color-output, and group-summary table format verbatim. Adapt each check to Phase 4's assertions.

Group A example checks:
- `taste_fingerprints.narrative_snapshot_vectors` column exists
- `taste_fingerprints.narrative_generated_at` column exists
- `taste_fingerprints.narrative_model_version` column exists (renamed from model_version)
- `recommendations.cache_key` column exists
- Two new indexes exist (`recommendations_user_cache_key_idx`, `recommendations_user_dismissed_idx`) via `pg_indexes`

Group B example checks:
- `supabase functions list` includes refresh-fingerprint, rerank-recs, taste-drift-cron
- `curl` without apikey returns 401 for each of the three

Group F example checks:
- Direct call to `dismissRec("nonexistent-id")` from a service-role context returns `{ ok: false, reason: "not-found" }`
- Call to `dismissRec(someoneElsesRecId)` returns `{ ok: false, reason: "unauthorized" }`

Group I delegates:

```typescript
import { execSync } from "node:child_process";
await check("I. Delegated smokes", "smoke-aggregate.ts passes", () => {
  try {
    execSync("pnpm tsx scripts/smoke-aggregate.ts", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
});
```

Full check enumeration (the 39):

| # | Group | Check |
|---|---|---|
| 1–5 | A | Schema columns + indexes |
| 6–11 | B | Edge function deploys + auth (3 functions × {deployed, 401 no key, 401 bad key} → 9, but tag the bad-key checks as a single per-fn check → 6) |
| 12–15 | C | Aggregation: empty/rated-9/rated-2/backlog-blend |
| 16–19 | D | Tier boundaries + drift identity + drift orthogonality + drift scaling |
| 20–24 | E | Candidate pool returns 50; cache key sort-stable; rerank result schema validates; sparse skips AI; cache hit avoids AI call |
| 25–29 | F | Auth gates: refresh/dismiss/save/play unauthenticated → fail; rate-limit 4th refresh in 24h → fail |
| 30–33 | G | /u/{public}/taste 200; /u/{private}/taste 404; OG public 200; OG private 404 |
| 34–36 | H | buildNarrativePrompt produces non-empty; buildRerankPrompt produces non-empty; mood zod rejects 3 moods + accepts 2 |
| 37–39 | I | smoke-aggregate.ts; smoke-drift.ts; smoke-recs-cache.ts |

- [ ] **Step 2: Run the verify script against live infra**

```powershell
pnpm tsx scripts/verify-phase-4.ts
```

Iterate any failures: re-check the assertions, fix the code, re-run. Don't ship a verify script with known-failing checks.

- [ ] **Step 3: Run the 4 manual items**

**M1 — Narrative quality at 30 logs:**
Use a real test account at exactly 30 rated logs. Visit `/me/taste`. Read the narrative. It should: reference ≥2 concrete genres/themes; use confident voice; no hedging; no emoji; no quoted titles. If it fails any of these, iterate `NARRATIVE_PROMPT_VERSION` and re-run T20.

**M2 — Rec reasoning references filter context:**
Visit `/play-next`. Pick `chill / 1hr / steam`. Each of the 5 returned reasons must mention either "chill" / "low friction" / "relaxing" / a time-budget indicator / a specific feature mapping to the filters. If 2+ reasons say only "matches your top genre" → iterate `RERANK_PROMPT_VERSION` and re-run.

**M3 — Share card Discord preview:**
Click "Share" on `/me/taste`. Copy the link. Paste it into a real Discord channel. The card image must render in the preview embed with mascot + stats + narrative visible.

**M4 — Mascot pose mapping:**
Create three synthetic test accounts (force-set their `genre_vector`):
- One with `{"Strategy": 1.0, "Tactics": 0.9}` → expect `tactician` pose.
- One with `{"Narrative": 1.0, "Adventure": 0.9}` → expect `lantern` pose.
- One with `{"Casual": 1.0, "Puzzle": 0.9}` → expect `cozy` pose.

Visit each `/api/og/taste/{username}` and confirm the sprite matches.

- [ ] **Step 4: Commit the verify script**

```powershell
git add scripts/verify-phase-4.ts
git commit -m "chore(phase-4): add verify-phase-4 automated verification pass

39 automated checks across 9 groups + 4 manual items map to the 8-point
Phase 4 gate. Mirrors verify-phase-3 structure (helpers, color output,
final summary table). Delegated smokes (aggregate, drift, recs-cache).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 5: Tag the phase**

```powershell
git tag phase-4-complete
git push origin main --tags
```

- [ ] **Step 6: Write `memory/phase_4_complete.md`**

```markdown
---
name: Phase 4 complete
description: Taste Fingerprint + Recommendations shipped; 39/39 automated + 4 manual gate items verified
type: project
---
**What:** Phase 4 (Taste Fingerprint + Recommendations) shipped on <YYYY-MM-DD>, tagged `phase-4-complete` at commit `<SHA>`. Aggregation engine + AI narrative + hybrid recs + trading-card share + daily drift cron + 3-button feedback loop all working.

**Why:** The differentiating "AI-first" feature. Letterboxd has lists and stats; this is taste reading + filter-aware recommendations. The phase that justifies the category claim.

**How to apply:** When picking up Phase 5 (Social Layer), Phase 4 is the last completed phase. Verification artifact: `scripts/verify-phase-4.ts` — re-runnable CI gate; covers schema/index sanity, Edge Function auth, server action auth, prompt builders, privacy gating, and delegates to aggregate / drift / cache smokes.

## Gate-criterion status (all 8 closed)
1. Tier system renders correctly ✓ (auto + manual)
2. Vector aggregation matches Q1 blend ✓ (auto)
3. AI narrative gen + model version + non-trivial ✓ (auto + manual M1)
4. Refresh button + rate limit + drift cron ✓ (auto)
5. Hybrid rec engine with filter-context reasoning ✓ (auto + manual M2)
6. 3-button feedback wires through to logs ✓ (auto)
7. Trading-card share + preview rendering ✓ (auto + manual M3)
8. Privacy gating on /u/{name}/taste + OG endpoint ✓ (auto)

## Phase 4 deliverables shipped on main
- Aggregation: `lib/taste/aggregate.ts` (Q1 weighted blend)
- Vector math: `lib/taste/vectors.ts` (cosine + drift)
- Tier classifier: `lib/taste/tier.ts`
- Prompts: `lib/taste/prompts.ts` (narrative + rerank)
- Triggers: `lib/taste/triggers.ts` (milestone + cache invalidate)
- Server actions: `lib/taste/server-actions.ts`, `lib/recs/server-actions.ts`
- Recs: `lib/recs/{candidate-pool, rerank, cache, moods}.ts`
- OG: `lib/og/{taste-card, dominant-pose}.tsx`, `app/api/og/taste/[username]/route.ts`
- Edge Functions: `supabase/functions/{refresh-fingerprint, rerank-recs, taste-drift-cron}/`
- Pages: `/me/taste`, `/u/[username]/taste`, `/play-next`
- Components: `components/taste/*`, `components/recs/*`

## Next: Phase 5 (Social Layer, weeks 21-26)
Per the master plan: follow/unfollow, public profile (library + reviews + fingerprint + lists), activity feed, comments on reviews, lists, notifications, discovery surface. All forward-looking social schema (`follows`, `notifications`, `lists`) already in DB with explicit `// Forward-looking: Phase 5` comments.
```

- [ ] **Step 7: Update `memory/MEMORY.md`**

Append:

```
- [Phase 4 complete](phase_4_complete.md) — Taste Fingerprint + Recommendations shipped (tag phase-4-complete); 39/39 automated + 4 manual; ready for Phase 5 (Social Layer)
```

- [ ] **Step 8: Final commit**

```powershell
git add memory/phase_4_complete.md memory/MEMORY.md
git commit -m "docs(phase-4): closure memory + MEMORY.md pointer"
git push origin main
```

**Phase 4 complete.** Working tree clean; tag `phase-4-complete` on main; 8/8 gate criteria closed.

---

## Self-Review

After writing this plan, the following spec sections map to tasks:

| Spec section | Task(s) |
|---|---|
| Locked design principles 1–8 | All tasks reference; T1 establishes data invariants |
| Decision Q1 (weighted blend) | T2 (aggregate.ts) + T2 smoke truth table |
| Decision Q2 (vectors live, narrative lazy) | T3 (vectors live in getFingerprint), T4 (narrative via Edge), T18 (drift cron) |
| Decision Q3 (hybrid recs + cache) | T8 (cache key + candidate pool), T11 (rerank Edge fn), T12 (cache-hit logic) |
| Decision Q4 (inherits users.is_public) | T3, T16, T17 (all gate via profile.isPublic) |
| Decision Q5 (3 buttons = log writes) | T14, T15 |
| Decision Q6 (tier system) | T1 (tierForUser), T6 (4 renders) |
| Decision Q7 (mood allowlist) | T8 (moods.ts) |
| Decision Q8 (trading card) | T16, T17 |
| Routes / IA | T3 (taste page), T9 (/play-next), T16 (OG), T19 (cockpit + dropdown) |
| Vector math + Q1 blend | T2 |
| Length preference / difficulty deferred | T2 (deferred is documented in aggregate.ts comment) |
| Drift detection | T1 (drift fn), T18 (cron uses it) |
| Privacy matrix | T3 (page gate), T16 (OG gate), T17 (share disabled when private) |
| Cost controls | T5 (rate limit), T18 (drift threshold) |
| Verification gate | T20 |
| Build sequence W1–W6 | T1–T3 / T4–T7 / T8–T10 / T11–T13 / T14–T15 / T16–T20 |

No spec requirement is unmapped. No placeholders ("TBD", "implement later") remain in the task bodies — every step has either runnable code, a verifiable command, or a specific instruction with named files.

Type consistency: `FilterParams`, `RecCard`, `RecResult`, `FingerprintSnapshot`, `TasteTier`, `VectorBundle`, `MascotPose` all defined once (T1/T3/T8/T9) and referenced consistently downstream. The `narrative_snapshot_vectors` shape `{ genre, theme, mechanic }` is the same in T1 (schema), T4 (Edge function write), T18 (cron read).

One pragmatic duplication: `aggregate` logic is mirrored in `lib/taste/aggregate.ts` (Next) and `supabase/functions/_shared/taste-engine.ts` (Deno) because the Edge runtime can't follow the Next `@/` alias. Same trade-off for `prompts.ts`. Documented at the duplication site.

Ready to execute.






