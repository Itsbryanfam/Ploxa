# Phase 6 — Recaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 6 — cinematic year-in-review pageant (11 scenes) with monthly mini-recap variant (7 scenes) and a single-row featured-list admin pin on `/discover`. Spec: `docs/superpowers/specs/2026-05-14-phase6-recaps-design.md` (commit `d082065`).

**Architecture:** Single `buildRecap({mode, windowStart, windowEnd})` aggregator drives both surfaces; scene catalog tags `yearOnly` for monthly filtering. Captions generated via existing `lib/ai/router.ts` (7 calls YIR / 5 monthly) with per-scene fallback templates. Lazy generate-on-view with email pre-warm cron mirroring Phase 5 digest pattern. Pageant is a Framer Motion auto-advancing scene sequencer mobile-first 9:16. OG share cards via Satori parameterized per scene.

**Tech Stack:** Next.js 16 App Router (RSC + Server Actions), Drizzle ORM (Postgres), Tailwind v4, Framer Motion, Vercel AI SDK via `lib/ai/router.ts`, Resend, pg_cron + Supabase Vault, React Email for templates, Vitest + Playwright. Brand: Ploxa, prod URL `ploxa.vercel.app`.

---

## Task 1: Migrations 0016 + 0017 + schema types

**Goal:** Land the schema delta — new tables `monthly_recaps` + `featured_lists`, columns on `year_in_reviews` + `profiles`, and `monthly` enum value on `email_digest_cadence`.

**Files:**
- Create: `lib/db/migrations/0016_phase6_recaps.sql`
- Create: `lib/db/migrations/0017_phase6_enum.sql`
- Modify: `lib/db/schema.ts` (add `monthlyRecaps`, `featuredLists`; extend `yearInReviews`; extend `profiles`; extend enum)
- Create: `tests/unit/recaps/schema.test.ts`

**Acceptance Criteria:**
- [ ] 0016 SQL applies cleanly to a fresh DB
- [ ] 0017 SQL applies cleanly (separate file because `ALTER TYPE ADD VALUE` can't run in a transaction with the migration harness)
- [ ] Drizzle schema exports `monthlyRecaps`, `featuredLists`; `yearInReviews` has `shareImageHash` + `lockedAt`; `profiles` has `lastRecapSentAt`
- [ ] `monthly_recaps_user_year_month_uniq` unique index on `(user_id, year, month_index)`
- [ ] `featured_lists_surface_active_uniq` partial unique index on `(surface)` WHERE `pinned_until IS NULL` (predicate is narrow because Postgres requires IMMUTABLE predicates and `now()` is STABLE; time-bounded pin races are handled application-side by the close-then-insert pattern in `pinFeaturedList` — see Task 7)
- [ ] `email_digest_cadence` enum includes `'monthly'`
- [ ] `pnpm tsc --noEmit` clean
- [ ] Drizzle snapshot chain remains valid (grep for `CREATE TABLE "auth"."users"` and strip per `feedback_drizzle_auth_users_gotcha.md`; verify with `pnpm db:check` per audit T17)

**Verify:** `pnpm tsc --noEmit && pnpm vitest run tests/unit/recaps/schema.test.ts && pnpm db:check`

**Steps:**

- [ ] **Step 1: Write failing test asserting schema shape**

Create `tests/unit/recaps/schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { schema } from "@/lib/db";

describe("Phase 6 schema additions", () => {
  it("exports monthlyRecaps table", () => {
    expect(schema.monthlyRecaps).toBeDefined();
  });
  it("exports featuredLists table", () => {
    expect(schema.featuredLists).toBeDefined();
  });
  it("yearInReviews has shareImageHash + lockedAt columns", () => {
    const cols = Object.keys((schema.yearInReviews as unknown as { _: { columns: Record<string, unknown> } })._.columns);
    expect(cols).toContain("shareImageHash");
    expect(cols).toContain("lockedAt");
  });
  it("profiles has lastRecapSentAt column", () => {
    const cols = Object.keys((schema.profiles as unknown as { _: { columns: Record<string, unknown> } })._.columns);
    expect(cols).toContain("lastRecapSentAt");
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

`pnpm vitest run tests/unit/recaps/schema.test.ts` — expect failure on `monthlyRecaps` undefined.

- [ ] **Step 3: Write migration 0016**

Create `lib/db/migrations/0016_phase6_recaps.sql`:

```sql
-- Phase 6 — Recaps tables + column adds
-- Note: monthly_recaps + featured_lists are NEW tables; year_in_reviews + profiles
-- get column additions. Indexes are NOT created CONCURRENTLY because these are
-- brand-new tables/columns with zero existing rows, so locking impact is nil.

CREATE TABLE monthly_recaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  year integer NOT NULL,
  month_index integer NOT NULL CHECK (month_index BETWEEN 1 AND 12),
  payload jsonb NOT NULL,
  share_image_hash varchar(32),
  generated_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz
);
CREATE UNIQUE INDEX monthly_recaps_user_year_month_uniq
  ON monthly_recaps(user_id, year, month_index);

ALTER TABLE year_in_reviews
  ADD COLUMN share_image_hash varchar(32),
  ADD COLUMN locked_at timestamptz;

CREATE TABLE featured_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  surface varchar(32) NOT NULL,
  pinned_at timestamptz NOT NULL DEFAULT now(),
  pinned_until timestamptz,
  pinned_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT
);
-- Partial unique index: at most one indefinite pin per surface at any time.
-- Predicate is narrow (just IS NULL) because Postgres requires IMMUTABLE
-- predicates and now() is STABLE. Time-bounded pin races (two admins clicking
-- "Pin" with an expiry simultaneously when no prior pin exists) are handled
-- application-side by the close-then-insert pattern in pinFeaturedList — see
-- lib/recaps/featured.ts (T7).
CREATE UNIQUE INDEX featured_lists_surface_active_uniq
  ON featured_lists(surface)
  WHERE pinned_until IS NULL;

ALTER TABLE profiles
  ADD COLUMN last_recap_sent_at timestamptz;
```

- [ ] **Step 4: Write migration 0017 (enum extension, isolated)**

Create `lib/db/migrations/0017_phase6_enum.sql`:

```sql
-- ALTER TYPE ADD VALUE cannot run inside a transaction; isolating to its own
-- migration file per the project convention.
ALTER TYPE email_digest_cadence ADD VALUE IF NOT EXISTS 'monthly';
```

- [ ] **Step 5: Update Drizzle schema**

Modify `lib/db/schema.ts`. Add to `email_digest_cadence` enum values: `"monthly"`. Extend `yearInReviews`:

```ts
export const yearInReviews = pgTable(
  "year_in_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    payload: jsonb("payload").notNull(),
    shareImageUrl: text("share_image_url"),     // existing — leave alone
    shareImageHash: varchar("share_image_hash", { length: 32 }),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
  },
  (table) => ({
    userYearIdx: uniqueIndex("year_in_reviews_user_year_uniq").on(table.userId, table.year),
  }),
);

export const monthlyRecaps = pgTable(
  "monthly_recaps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    monthIndex: integer("month_index").notNull(),
    payload: jsonb("payload").notNull(),
    shareImageHash: varchar("share_image_hash", { length: 32 }),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
  },
  (table) => ({
    userYearMonthUniq: uniqueIndex("monthly_recaps_user_year_month_uniq")
      .on(table.userId, table.year, table.monthIndex),
  }),
);

export const featuredLists = pgTable("featured_lists", {
  id: uuid("id").primaryKey().defaultRandom(),
  listId: uuid("list_id").notNull().references(() => lists.id, { onDelete: "cascade" }),
  surface: varchar("surface", { length: 32 }).notNull(),
  pinnedAt: timestamp("pinned_at", { withTimezone: true }).notNull().defaultNow(),
  pinnedUntil: timestamp("pinned_until", { withTimezone: true }),
  pinnedBy: uuid("pinned_by").notNull().references(() => authUsers.id, { onDelete: "restrict" }),
});
```

Add `lastRecapSentAt: timestamp("last_recap_sent_at", { withTimezone: true })` to the existing `profiles` table definition.

- [ ] **Step 6: Generate Drizzle snapshot + bridge chain integrity**

Run `pnpm drizzle-kit generate`. Strip any `CREATE TABLE "auth"."users"` per the gotcha. Verify the snapshot chain via `pnpm db:check` (gate added in audit T17). If a snapshot bridge is missing, use the bridging-snapshot pattern from `lib/db/README.md`.

- [ ] **Step 7: Run all gates**

```
pnpm vitest run tests/unit/recaps/schema.test.ts
pnpm tsc --noEmit
pnpm db:check
```

All green.

- [ ] **Step 8: Commit**

```bash
git add lib/db/migrations/0016_phase6_recaps.sql lib/db/migrations/0017_phase6_enum.sql lib/db/schema.ts lib/db/migrations/meta/ tests/unit/recaps/schema.test.ts
git commit -m "feat(recaps): T1 migrations 0016+0017 + schema for Phase 6"
```

---

## Task 2: Types + scene catalog + window helpers

**Goal:** Foundation types — `RecapPayload`, `Scene`, `SceneId`, `RecapMode`; the 11-entry scene catalog with `yearOnly` flags + fallback templates; date-window helpers.

**Files:**
- Create: `lib/recaps/types.ts`
- Create: `lib/recaps/scenes.ts`
- Create: `lib/recaps/window.ts`
- Create: `tests/unit/recaps/scenes.test.ts`
- Create: `tests/unit/recaps/window.test.ts`

**Acceptance Criteria:**
- [ ] 11 scene entries exported, each with `{id, requiredData, aiCaption, yearOnly?, fallbackTemplate}`
- [ ] `filterScenes(scenes, mode)` returns 11 for yearly, 7 for monthly (yearOnly: surprise, taste_evolution, reviews)
- [ ] `yearWindow(year)` returns Jan 1 → Jan 1 (next year) UTC
- [ ] `monthWindow(year, monthIndex)` returns 1st of month → 1st of next month UTC
- [ ] All fallback templates accept a `payload` argument and return a string

**Verify:** `pnpm vitest run tests/unit/recaps/scenes.test.ts tests/unit/recaps/window.test.ts && pnpm tsc --noEmit`

**Steps:**

- [ ] **Step 1: Write failing tests**

`tests/unit/recaps/window.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { yearWindow, monthWindow } from "@/lib/recaps/window";

describe("window helpers", () => {
  it("yearWindow returns Jan 1 UTC for both ends", () => {
    const { start, end } = yearWindow(2026);
    expect(start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
  it("monthWindow Feb 2024 (leap) ends Mar 1", () => {
    const { start, end } = monthWindow(2024, 2);
    expect(start.toISOString()).toBe("2024-02-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2024-03-01T00:00:00.000Z");
  });
  it("monthWindow Dec wraps to next year Jan", () => {
    const { end } = monthWindow(2026, 12);
    expect(end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});
```

`tests/unit/recaps/scenes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SCENE_CATALOG, filterScenes } from "@/lib/recaps/scenes";

describe("scene catalog", () => {
  it("contains 11 entries", () => {
    expect(SCENE_CATALOG).toHaveLength(11);
  });
  it("yearly mode returns all 11", () => {
    expect(filterScenes(SCENE_CATALOG, "yearly")).toHaveLength(11);
  });
  it("monthly mode skips 4 yearOnly scenes: surprise, taste_evolution, reviews, longest_game (no — longest_game stays)", () => {
    // yearOnly scenes per spec: surprise, taste_evolution, reviews
    const monthly = filterScenes(SCENE_CATALOG, "monthly");
    expect(monthly).toHaveLength(7);
    const ids = monthly.map((s) => s.id);
    expect(ids).not.toContain("surprise");
    expect(ids).not.toContain("taste_evolution");
    expect(ids).not.toContain("reviews");
  });
  it("AI-tagged scenes are exactly 7 in yearly mode", () => {
    const ai = filterScenes(SCENE_CATALOG, "yearly").filter((s) => s.aiCaption);
    expect(ai).toHaveLength(7);
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

`pnpm vitest run tests/unit/recaps/` — failures expected.

- [ ] **Step 3: Implement window helpers**

Create `lib/recaps/window.ts`:

```ts
export interface DateWindow {
  start: Date;
  end: Date;
}

export function yearWindow(year: number): DateWindow {
  return {
    start: new Date(Date.UTC(year, 0, 1)),
    end: new Date(Date.UTC(year + 1, 0, 1)),
  };
}

export function monthWindow(year: number, monthIndex: number): DateWindow {
  // monthIndex is 1-12 (human-readable). new Date.UTC takes 0-11 (JS).
  if (monthIndex < 1 || monthIndex > 12) {
    throw new RangeError(`monthIndex must be 1-12, got ${monthIndex}`);
  }
  const jsMonthZero = monthIndex - 1;
  return {
    start: new Date(Date.UTC(year, jsMonthZero, 1)),
    end: new Date(Date.UTC(year, jsMonthZero + 1, 1)),
  };
}
```

- [ ] **Step 4: Implement types**

Create `lib/recaps/types.ts`:

```ts
export type RecapMode = "yearly" | "monthly";

export type SceneId =
  | "opening"
  | "stats_total"
  | "top_games"
  | "goty"
  | "genre_dominance"
  | "mechanic_love"
  | "surprise"
  | "taste_evolution"
  | "longest_game"
  | "most_replayed"   // substitute for longest_game when no Steam playtime
  | "top_theme"        // substitute for mechanic_love when <3 mechanics
  | "completion_ratio" // substitute for taste_evolution when single-quarter
  | "mood_themes"      // substitute for surprise when no outlier
  | "reviews"
  | "closing";

export interface SceneDefinition {
  id: SceneId;
  aiCaption: boolean;
  yearOnly?: boolean;
  holdDurationMs?: number; // override default 8000 ms
  fallbackTemplate: (payload: RecapPayload) => string;
}

export type RecapTier = "ok" | "too_sparse";

export interface TopGameRef {
  gameId: string;
  rawgId: number | null;
  title: string;
  coverUrl: string | null;
  rating: number; // 0-5
  status: "completed" | "playing" | "dropped" | "replaying" | "backlog";
}

export interface RecapPayload {
  tier: RecapTier;
  mode: RecapMode;
  windowStart: string; // ISO
  windowEnd: string;   // ISO
  scenes: SceneId[];   // ordered list of scenes to render (after substitution)
  totals: {
    totalGames: number;
    totalHoursPlayed: number | null;
    completedCount: number;
    droppedCount: number;
    replayingCount: number;
    reviewCount: number;
  };
  topGames: TopGameRef[];     // up to 5
  goty?: TopGameRef;          // single highest-rated
  topGenre?: { name: string; pct: number; secondName: string | null; secondPct: number };
  topMechanic?: { name: string };
  topTheme?: { name: string };  // substitution
  surprise?: { game: TopGameRef; surpriseGenre: string; baselineAvg: number };
  tasteEvolution?: { q1Vibe: string; q4Vibe: string };
  completionRatio?: { completedPct: number; droppedPct: number };  // substitution
  moodThemes?: { themes: string[] };  // substitution
  longestGame?: { game: TopGameRef; hoursPlayed: number };
  mostReplayed?: { game: TopGameRef; replayCount: number };  // substitution
  favoriteReviewSnippet?: { reviewId: string; gameTitle: string; snippet: string };
  // Filled in by captions module after AI generation; empty before:
  captions: Partial<Record<SceneId, string>>;
}
```

- [ ] **Step 5: Implement scene catalog**

Create `lib/recaps/scenes.ts`:

```ts
import type { RecapMode, RecapPayload, SceneDefinition } from "./types";

export const SCENE_CATALOG: SceneDefinition[] = [
  {
    id: "opening",
    aiCaption: true,
    fallbackTemplate: (p) =>
      `Welcome to your ${p.mode === "yearly" ? "year" : "month"} in games — ${p.totals.totalGames} to look back on.`,
  },
  {
    id: "stats_total",
    aiCaption: false,
    fallbackTemplate: (p) => `${p.totals.totalGames} games · ${p.totals.completedCount} completed`,
  },
  {
    id: "top_games",
    aiCaption: false,
    holdDurationMs: 10_000,
    fallbackTemplate: (p) => `Your top ${p.mode === "yearly" ? "5" : "3"}.`,
  },
  {
    id: "goty",
    aiCaption: true,
    fallbackTemplate: (p) =>
      p.goty ? `Your top-rated game: ${p.goty.title}, ${p.goty.rating}/5.` : "No clear winner this time.",
  },
  {
    id: "genre_dominance",
    aiCaption: true,
    fallbackTemplate: (p) =>
      p.topGenre
        ? `${p.topGenre.name} owned your ${p.mode === "yearly" ? "year" : "month"} — ${p.topGenre.pct}% of your library.`
        : "Your tastes were balanced this time.",
  },
  {
    id: "mechanic_love",
    aiCaption: true,
    fallbackTemplate: (p) => (p.topMechanic ? `Your love language: ${p.topMechanic.name}.` : "Many mechanics, no clear favorite."),
  },
  {
    id: "surprise",
    aiCaption: true,
    yearOnly: true,
    fallbackTemplate: (p) =>
      p.surprise
        ? `Your biggest surprise: ${p.surprise.game.title}, rated ${p.surprise.game.rating}/5.`
        : "No standout surprises this year.",
  },
  {
    id: "taste_evolution",
    aiCaption: true,
    yearOnly: true,
    fallbackTemplate: (p) =>
      p.tasteEvolution ? `From ${p.tasteEvolution.q1Vibe} to ${p.tasteEvolution.q4Vibe}.` : "Steady taste all year.",
  },
  {
    id: "longest_game",
    aiCaption: false,
    fallbackTemplate: (p) =>
      p.longestGame ? `${p.longestGame.game.title} owned you for ${p.longestGame.hoursPlayed}h.` : "Brief sessions only.",
  },
  {
    id: "reviews",
    aiCaption: false,
    yearOnly: true,
    fallbackTemplate: (p) =>
      p.totals.reviewCount > 0 ? `You wrote ${p.totals.reviewCount} reviews this year.` : "No reviews this year.",
  },
  {
    id: "closing",
    aiCaption: true,
    fallbackTemplate: (p) => `That was your ${p.mode === "yearly" ? "year" : "month"}. Share it?`,
  },
];

export function filterScenes(catalog: SceneDefinition[], mode: RecapMode): SceneDefinition[] {
  if (mode === "monthly") return catalog.filter((s) => !s.yearOnly);
  return catalog;
}

export function getScene(id: SceneDefinition["id"]): SceneDefinition | undefined {
  return SCENE_CATALOG.find((s) => s.id === id);
}
```

- [ ] **Step 6: Run tests to confirm pass**

`pnpm vitest run tests/unit/recaps/`

- [ ] **Step 7: tsc**

`pnpm tsc --noEmit` — should be clean.

- [ ] **Step 8: Commit**

```bash
git add lib/recaps/ tests/unit/recaps/window.test.ts tests/unit/recaps/scenes.test.ts
git commit -m "feat(recaps): T2 types + scene catalog + window helpers"
```

---

## Task 3: Aggregator (buildRecap) with sparse-data sentinel

**Goal:** Pure `buildRecap({userId, windowStart, windowEnd, mode})` function — queries logs/reviews/lists/taste; returns either `{tier: 'too_sparse'}` (<10 logs) or full payload (without substitutions yet, without AI captions).

**Files:**
- Create: `lib/recaps/aggregate.ts`
- Create: `tests/unit/recaps/aggregate.test.ts`
- Possibly modify: `lib/db/schema.ts` if any helper view is added (not expected)

**Acceptance Criteria:**
- [ ] Sparse-data: <10 logs in window → `{tier: 'too_sparse'}`; no further work done
- [ ] Full payload: ≥10 logs → produces `RecapPayload` matching the zod schema
- [ ] Totals correctly aggregate logs in window: totalGames, totalHoursPlayed, completedCount, droppedCount, replayingCount, reviewCount
- [ ] topGames: top 5 by rating DESC, ties broken by `last_event_at DESC`, includes cover URL
- [ ] goty: topGames[0] (cleanly identical reference)
- [ ] topGenre + secondGenre: derived from taste vector aggregation across window's logs (genres-vector entries weighted by log count)
- [ ] topMechanic: same approach using IGDB mechanics facet vector
- [ ] longestGame: highest `hours_played` log in window (game cover joined)
- [ ] favoriteReviewSnippet: most-liked review in window, first 60 chars
- [ ] All queries parameterized; no string interpolation
- [ ] Window boundaries are half-open `[start, end)` — uses logs `played_at` if non-null else `last_event_at`

**Verify:** `pnpm vitest run tests/unit/recaps/aggregate.test.ts && pnpm tsc --noEmit`

**Steps:**

- [ ] **Step 1: Write failing tests with synthetic data**

`tests/unit/recaps/aggregate.test.ts`:

```ts
import { describe, expect, it, beforeEach, vi } from "vitest";

// Mock db before importing aggregator
vi.mock("@/lib/db", () => {
  const mockSql = vi.fn();
  return {
    db: { execute: mockSql },
    schema: {},
  };
});

import { db } from "@/lib/db";
import { buildRecap } from "@/lib/recaps/aggregate";
import { yearWindow } from "@/lib/recaps/window";

const mockExecute = vi.mocked(db.execute);

beforeEach(() => {
  mockExecute.mockReset();
});

describe("buildRecap", () => {
  it("returns too_sparse for <10 logs in window", async () => {
    // First query: count of logs in window
    mockExecute.mockResolvedValueOnce([{ count: "9" }] as never);
    const { start, end } = yearWindow(2026);
    const result = await buildRecap({
      userId: "u-1",
      windowStart: start,
      windowEnd: end,
      mode: "yearly",
    });
    expect(result.tier).toBe("too_sparse");
    expect(mockExecute).toHaveBeenCalledTimes(1); // short-circuits, no more queries
  });

  it("produces payload for ≥10 logs", async () => {
    // Sequence: count → totals → top_games → top_genre → top_mechanic → longest_game → favorite_review
    mockExecute
      .mockResolvedValueOnce([{ count: "15" }] as never)
      .mockResolvedValueOnce([{ total_games: 15, total_hours: 120.5, completed: 8, dropped: 2, replaying: 1, reviews: 4 }] as never)
      .mockResolvedValueOnce([
        { game_id: "g-1", rawg_id: 100, title: "Game A", cover_url: "https://example/g.jpg", rating: "5.0", status: "completed" },
        { game_id: "g-2", rawg_id: 101, title: "Game B", cover_url: null, rating: "4.5", status: "completed" },
      ] as never)
      .mockResolvedValueOnce([{ genre: "Action", count: "8" }, { genre: "RPG", count: "5" }] as never)
      .mockResolvedValueOnce([{ mechanic: "Roguelite", count: "6" }] as never)
      .mockResolvedValueOnce([{ game_id: "g-1", title: "Game A", cover_url: "https://example/g.jpg", rating: "5.0", status: "completed", hours_played: "45.5" }] as never)
      .mockResolvedValueOnce([{ review_id: "r-1", game_title: "Game A", body: "This game owned my year, full stop. Highly recommended." }] as never);

    const { start, end } = yearWindow(2026);
    const result = await buildRecap({ userId: "u-1", windowStart: start, windowEnd: end, mode: "yearly" });
    expect(result.tier).toBe("ok");
    expect(result.totals.totalGames).toBe(15);
    expect(result.totals.totalHoursPlayed).toBe(120.5);
    expect(result.topGames).toHaveLength(2);
    expect(result.goty?.title).toBe("Game A");
    expect(result.topGenre?.name).toBe("Action");
    expect(result.topMechanic?.name).toBe("Roguelite");
    expect(result.longestGame?.hoursPlayed).toBe(45.5);
    expect(result.favoriteReviewSnippet?.snippet.length).toBeLessThanOrEqual(60);
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

- [ ] **Step 3: Implement `lib/recaps/aggregate.ts`**

```ts
import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { DateWindow } from "./window";
import type { RecapMode, RecapPayload, SceneId, TopGameRef } from "./types";
import { SCENE_CATALOG, filterScenes } from "./scenes";

interface BuildRecapInput {
  userId: string;
  windowStart: Date;
  windowEnd: Date;
  mode: RecapMode;
}

const SPARSE_THRESHOLD = 10;

export async function buildRecap(input: BuildRecapInput): Promise<RecapPayload> {
  const { userId, windowStart, windowEnd, mode } = input;

  // Step 1: count logs in window — sparse-data gate
  const countRows = (await db.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text as count FROM logs
    WHERE user_id = ${userId}
      AND COALESCE(played_at, last_event_at) >= ${windowStart.toISOString()}
      AND COALESCE(played_at, last_event_at) <  ${windowEnd.toISOString()}
  `)) as unknown as Array<{ count: string }>;
  const logCount = parseInt(countRows[0]?.count ?? "0", 10);

  if (logCount < SPARSE_THRESHOLD) {
    return {
      tier: "too_sparse",
      mode,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      scenes: [],
      totals: { totalGames: logCount, totalHoursPlayed: null, completedCount: 0, droppedCount: 0, replayingCount: 0, reviewCount: 0 },
      topGames: [],
      captions: {},
    };
  }

  // Run remaining aggregations in parallel
  const [totalsRows, topGamesRows, topGenreRows, topMechanicRows, longestRows, favoriteReviewRows] = await Promise.all([
    db.execute<{ total_games: number; total_hours: string | null; completed: number; dropped: number; replaying: number; reviews: number }>(sql`
      SELECT
        COUNT(*)::int as total_games,
        SUM(hours_played)::text as total_hours,
        COUNT(*) FILTER (WHERE status = 'completed')::int as completed,
        COUNT(*) FILTER (WHERE status = 'dropped')::int as dropped,
        COUNT(*) FILTER (WHERE status = 'replaying')::int as replaying,
        (SELECT COUNT(*)::int FROM reviews WHERE user_id = ${userId} AND created_at >= ${windowStart.toISOString()} AND created_at < ${windowEnd.toISOString()}) as reviews
      FROM logs
      WHERE user_id = ${userId}
        AND COALESCE(played_at, last_event_at) >= ${windowStart.toISOString()}
        AND COALESCE(played_at, last_event_at) <  ${windowEnd.toISOString()}
    `),
    db.execute<{ game_id: string; rawg_id: number | null; title: string; cover_url: string | null; rating: string; status: string }>(sql`
      SELECT l.game_id, g.rawg_id, g.title, g.background_image as cover_url, l.rating::text as rating, l.status
      FROM logs l JOIN games g ON g.id = l.game_id
      WHERE l.user_id = ${userId}
        AND COALESCE(l.played_at, l.last_event_at) >= ${windowStart.toISOString()}
        AND COALESCE(l.played_at, l.last_event_at) <  ${windowEnd.toISOString()}
        AND l.rating IS NOT NULL
      ORDER BY l.rating DESC, l.last_event_at DESC
      LIMIT 5
    `),
    db.execute<{ genre: string; count: string }>(sql`
      SELECT unnest(g.genres) as genre, COUNT(*)::text as count
      FROM logs l JOIN games g ON g.id = l.game_id
      WHERE l.user_id = ${userId}
        AND COALESCE(l.played_at, l.last_event_at) >= ${windowStart.toISOString()}
        AND COALESCE(l.played_at, l.last_event_at) <  ${windowEnd.toISOString()}
      GROUP BY genre
      ORDER BY count DESC
      LIMIT 2
    `),
    db.execute<{ mechanic: string; count: string }>(sql`
      SELECT unnest(g.mechanics) as mechanic, COUNT(*)::text as count
      FROM logs l JOIN games g ON g.id = l.game_id
      WHERE l.user_id = ${userId}
        AND COALESCE(l.played_at, l.last_event_at) >= ${windowStart.toISOString()}
        AND COALESCE(l.played_at, l.last_event_at) <  ${windowEnd.toISOString()}
        AND g.mechanics IS NOT NULL
      GROUP BY mechanic
      ORDER BY count DESC
      LIMIT 1
    `),
    db.execute<{ game_id: string; title: string; cover_url: string | null; rating: string; status: string; hours_played: string }>(sql`
      SELECT l.game_id, g.title, g.background_image as cover_url, l.rating::text as rating, l.status, l.hours_played::text as hours_played
      FROM logs l JOIN games g ON g.id = l.game_id
      WHERE l.user_id = ${userId}
        AND COALESCE(l.played_at, l.last_event_at) >= ${windowStart.toISOString()}
        AND COALESCE(l.played_at, l.last_event_at) <  ${windowEnd.toISOString()}
        AND l.hours_played IS NOT NULL AND l.hours_played > 0
      ORDER BY l.hours_played DESC NULLS LAST
      LIMIT 1
    `),
    db.execute<{ review_id: string; game_title: string; body: string }>(sql`
      SELECT r.id as review_id, g.title as game_title, r.body
      FROM reviews r JOIN games g ON g.id = r.game_id
      WHERE r.user_id = ${userId}
        AND r.created_at >= ${windowStart.toISOString()}
        AND r.created_at <  ${windowEnd.toISOString()}
        AND r.is_draft = false
      ORDER BY r.like_count DESC NULLS LAST, r.created_at DESC
      LIMIT 1
    `),
  ]);

  // postgres-js: cast through unknown to iterate
  const totals = (totalsRows as unknown as Array<{ total_games: number; total_hours: string | null; completed: number; dropped: number; replaying: number; reviews: number }>)[0];
  const topGamesRaw = topGamesRows as unknown as Array<{ game_id: string; rawg_id: number | null; title: string; cover_url: string | null; rating: string; status: string }>;
  const topGenreRaw = topGenreRows as unknown as Array<{ genre: string; count: string }>;
  const topMechanicRaw = topMechanicRows as unknown as Array<{ mechanic: string; count: string }>;
  const longestRaw = longestRows as unknown as Array<{ game_id: string; title: string; cover_url: string | null; rating: string; status: string; hours_played: string }>;
  const reviewRaw = favoriteReviewRows as unknown as Array<{ review_id: string; game_title: string; body: string }>;

  const topGames: TopGameRef[] = topGamesRaw.map((r) => ({
    gameId: r.game_id,
    rawgId: r.rawg_id,
    title: r.title,
    coverUrl: r.cover_url,
    rating: parseFloat(r.rating),
    status: r.status as TopGameRef["status"],
  }));

  const totalGenreInWindow = topGenreRaw.reduce((acc, g) => acc + parseInt(g.count, 10), 0);
  const topGenre = topGenreRaw[0]
    ? {
        name: topGenreRaw[0].genre,
        pct: Math.round((parseInt(topGenreRaw[0].count, 10) / Math.max(totalGenreInWindow, 1)) * 100),
        secondName: topGenreRaw[1]?.genre ?? null,
        secondPct: topGenreRaw[1] ? Math.round((parseInt(topGenreRaw[1].count, 10) / totalGenreInWindow) * 100) : 0,
      }
    : undefined;

  const topMechanic = topMechanicRaw[0] ? { name: topMechanicRaw[0].mechanic } : undefined;

  const longestGame = longestRaw[0]
    ? {
        game: {
          gameId: longestRaw[0].game_id,
          rawgId: null,
          title: longestRaw[0].title,
          coverUrl: longestRaw[0].cover_url,
          rating: parseFloat(longestRaw[0].rating),
          status: longestRaw[0].status as TopGameRef["status"],
        },
        hoursPlayed: parseFloat(longestRaw[0].hours_played),
      }
    : undefined;

  const favoriteReviewSnippet = reviewRaw[0]
    ? {
        reviewId: reviewRaw[0].review_id,
        gameTitle: reviewRaw[0].game_title,
        snippet: reviewRaw[0].body.slice(0, 60),
      }
    : undefined;

  // Determine scenes (substitution applied in Task 4); for now, all base scenes
  const baseScenes = filterScenes(SCENE_CATALOG, mode).map((s) => s.id);

  return {
    tier: "ok",
    mode,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    scenes: baseScenes,
    totals: {
      totalGames: totals.total_games,
      totalHoursPlayed: totals.total_hours !== null ? parseFloat(totals.total_hours) : null,
      completedCount: totals.completed,
      droppedCount: totals.dropped,
      replayingCount: totals.replaying,
      reviewCount: totals.reviews,
    },
    topGames,
    goty: topGames[0],
    topGenre,
    topMechanic,
    longestGame,
    favoriteReviewSnippet,
    captions: {},
  };
}
```

- [ ] **Step 4: Run tests until pass**

`pnpm vitest run tests/unit/recaps/aggregate.test.ts`

- [ ] **Step 5: Commit**

```bash
git add lib/recaps/aggregate.ts tests/unit/recaps/aggregate.test.ts
git commit -m "feat(recaps): T3 aggregator with sparse-data sentinel"
```

---

## Task 4: Substitution map in aggregator

**Goal:** Apply substitution rules — no-Steam → `most_replayed`, <3 mechanics → `top_theme`, no quarter variance → `completion_ratio`, no surprise → `mood_themes`, 0 reviews → drop `reviews` scene.

**Files:**
- Modify: `lib/recaps/aggregate.ts` (add substitution pass)
- Modify: `lib/recaps/types.ts` (already has substitution scene IDs)
- Create: `tests/unit/recaps/substitutions.test.ts`

**Acceptance Criteria:**
- [ ] No `longest_game` data → `scenes` contains `most_replayed` instead, payload populates `mostReplayed`
- [ ] No `topMechanic` data → `scenes` contains `top_theme` instead, payload populates `topTheme`
- [ ] Single-quarter activity → `scenes` excludes `taste_evolution`, includes `completion_ratio` instead
- [ ] No surprise (rating variance <0.5 across genres) → `scenes` excludes `surprise`, includes `mood_themes`
- [ ] 0 reviews → `scenes` excludes `reviews` entirely (no substitute)
- [ ] Scene count floor: ≥10 logs always produces ≥8 scenes (or 6 for monthly after yearOnly filter)

**Verify:** `pnpm vitest run tests/unit/recaps/substitutions.test.ts`

**Steps:**

- [ ] **Step 1: Write failing tests** covering each substitution path. Use mocked `db.execute` returning queries that simulate each missing-data scenario.

```ts
// tests/unit/recaps/substitutions.test.ts — abbreviated
import { describe, expect, it, beforeEach, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: { execute: vi.fn() }, schema: {} }));
import { db } from "@/lib/db";
import { buildRecap } from "@/lib/recaps/aggregate";
import { yearWindow } from "@/lib/recaps/window";
const mockExecute = vi.mocked(db.execute);

describe("substitution map", () => {
  beforeEach(() => mockExecute.mockReset());

  it("no Steam playtime → most_replayed substitutes longest_game", async () => {
    // Setup mock chain: count=15, totals (with replaying=3), top_games=[...], top_genre, top_mechanic, longest=[] (empty), review
    mockExecute
      .mockResolvedValueOnce([{ count: "15" }] as never)
      .mockResolvedValueOnce([{ total_games: 15, total_hours: null, completed: 8, dropped: 2, replaying: 3, reviews: 4 }] as never)
      .mockResolvedValueOnce([{ game_id: "g-1", rawg_id: null, title: "Game A", cover_url: null, rating: "5.0", status: "replaying" }] as never)
      .mockResolvedValueOnce([{ genre: "Action", count: "8" }] as never)
      .mockResolvedValueOnce([{ mechanic: "Roguelite", count: "6" }] as never)
      .mockResolvedValueOnce([] as never)  // no longest_game (no Steam playtime)
      .mockResolvedValueOnce([] as never)  // no review
      // most_replayed substitute query:
      .mockResolvedValueOnce([{ game_id: "g-1", title: "Game A", cover_url: null, rating: "5.0", status: "replaying", replay_count: "3" }] as never);

    const { start, end } = yearWindow(2026);
    const r = await buildRecap({ userId: "u-1", windowStart: start, windowEnd: end, mode: "yearly" });
    expect(r.scenes).toContain("most_replayed");
    expect(r.scenes).not.toContain("longest_game");
    expect(r.mostReplayed?.replayCount).toBe(3);
  });

  // Additional tests:
  // - <3 mechanics → top_theme substitute (assert scenes contains 'top_theme')
  // - single-quarter activity → completion_ratio substitute
  // - low rating variance → mood_themes substitute
  // - 0 reviews → scenes excludes 'reviews' (no substitute)
});
```

- [ ] **Step 2: Run tests — expect failures**

- [ ] **Step 3: Extend aggregator with substitution pass**

After base aggregation, add `applySubstitutions(payload)` helper that returns the final scene list + populates substitute payload fields. Add it as a sub-function in `lib/recaps/aggregate.ts`:

```ts
async function applySubstitutions(
  payload: RecapPayload,
  userId: string,
  windowStart: Date,
  windowEnd: Date,
): Promise<RecapPayload> {
  const scenes = [...payload.scenes];

  // 1. longest_game → most_replayed if hours_played absent
  if (!payload.longestGame) {
    const idx = scenes.indexOf("longest_game");
    if (idx >= 0) {
      const rows = (await db.execute<{ game_id: string; title: string; cover_url: string | null; rating: string; status: string; replay_count: string }>(sql`
        SELECT l.game_id, g.title, g.background_image as cover_url, l.rating::text as rating, l.status,
          (SELECT COUNT(*)::text FROM log_events e WHERE e.log_id = l.id AND e.type = 'status_change' AND e.payload->>'to' = 'replaying') as replay_count
        FROM logs l JOIN games g ON g.id = l.game_id
        WHERE l.user_id = ${userId} AND COALESCE(l.played_at, l.last_event_at) >= ${windowStart.toISOString()} AND COALESCE(l.played_at, l.last_event_at) < ${windowEnd.toISOString()}
        ORDER BY replay_count DESC NULLS LAST, l.last_event_at DESC
        LIMIT 1
      `)) as unknown as Array<{ game_id: string; title: string; cover_url: string | null; rating: string; status: string; replay_count: string }>;
      if (rows[0] && parseInt(rows[0].replay_count, 10) > 0) {
        scenes[idx] = "most_replayed";
        payload.mostReplayed = {
          game: { gameId: rows[0].game_id, rawgId: null, title: rows[0].title, coverUrl: rows[0].cover_url, rating: parseFloat(rows[0].rating), status: rows[0].status as TopGameRef["status"] },
          replayCount: parseInt(rows[0].replay_count, 10),
        };
      } else {
        scenes.splice(idx, 1);
      }
    }
  }

  // 2. mechanic_love → top_theme if no mechanic
  if (!payload.topMechanic) {
    const idx = scenes.indexOf("mechanic_love");
    if (idx >= 0) {
      const rows = (await db.execute<{ theme: string; count: string }>(sql`
        SELECT unnest(g.themes) as theme, COUNT(*)::text as count
        FROM logs l JOIN games g ON g.id = l.game_id
        WHERE l.user_id = ${userId} AND COALESCE(l.played_at, l.last_event_at) >= ${windowStart.toISOString()} AND COALESCE(l.played_at, l.last_event_at) < ${windowEnd.toISOString()} AND g.themes IS NOT NULL
        GROUP BY theme ORDER BY count DESC LIMIT 1
      `)) as unknown as Array<{ theme: string; count: string }>;
      if (rows[0]) {
        scenes[idx] = "top_theme";
        payload.topTheme = { name: rows[0].theme };
      } else {
        scenes.splice(idx, 1);
      }
    }
  }

  // 3. taste_evolution → completion_ratio (yearly only — already filtered for monthly)
  if (payload.mode === "yearly" && !payload.tasteEvolution) {
    const idx = scenes.indexOf("taste_evolution");
    if (idx >= 0) {
      scenes[idx] = "completion_ratio";
      const total = Math.max(payload.totals.totalGames, 1);
      payload.completionRatio = {
        completedPct: Math.round((payload.totals.completedCount / total) * 100),
        droppedPct: Math.round((payload.totals.droppedCount / total) * 100),
      };
    }
  }

  // 4. surprise → mood_themes (yearly only)
  if (payload.mode === "yearly" && !payload.surprise) {
    const idx = scenes.indexOf("surprise");
    if (idx >= 0) {
      const rows = (await db.execute<{ theme: string }>(sql`
        SELECT unnest(g.themes) as theme
        FROM logs l JOIN games g ON g.id = l.game_id
        WHERE l.user_id = ${userId} AND COALESCE(l.played_at, l.last_event_at) >= ${windowStart.toISOString()} AND COALESCE(l.played_at, l.last_event_at) < ${windowEnd.toISOString()} AND g.themes IS NOT NULL
        GROUP BY theme ORDER BY COUNT(*) DESC LIMIT 3
      `)) as unknown as Array<{ theme: string }>;
      if (rows.length > 0) {
        scenes[idx] = "mood_themes";
        payload.moodThemes = { themes: rows.map((r) => r.theme) };
      } else {
        scenes.splice(idx, 1);
      }
    }
  }

  // 5. reviews → drop if 0 reviews (no substitute)
  if (payload.totals.reviewCount === 0) {
    const idx = scenes.indexOf("reviews");
    if (idx >= 0) scenes.splice(idx, 1);
  }

  payload.scenes = scenes;
  return payload;
}
```

Wire `applySubstitutions` into `buildRecap` before the return. (Note: `taste_evolution` + `surprise` original data computation is a future enhancement — for now they're always absent, so substitutions fire on the yearly path. Surprise heuristic + Q1/Q4 vector comparison are stretch — covered by fallback templates if not populated.)

- [ ] **Step 4: Run tests until pass**

- [ ] **Step 5: Commit**

```bash
git add lib/recaps/aggregate.ts tests/unit/recaps/substitutions.test.ts
git commit -m "feat(recaps): T4 substitution map — no-Steam, no-mechanic, no-quarter, no-surprise, no-reviews"
```

---

## Task 5: AI prompts

**Goal:** Seven scene-specific prompt builders in `lib/recaps/prompts.ts` — strict shape, no emojis, no exclamation marks, voice locked.

**Files:**
- Create: `lib/recaps/prompts.ts`
- Create: `tests/unit/recaps/prompts.test.ts`

**Acceptance Criteria:**
- [ ] Seven exported builder functions: `buildOpeningPrompt`, `buildGotyPrompt`, `buildGenreDominancePrompt`, `buildMechanicLovePrompt`, `buildSurprisePrompt`, `buildTasteEvolutionPrompt`, `buildClosingPrompt`
- [ ] Each accepts the relevant slice of `RecapPayload` and returns `{system, user}` string pair
- [ ] Shared constraint suffix appended automatically: "Output ONLY JSON matching schema `{caption: string}`. No emojis. No exclamation marks. Address user as 'you'. One sentence, ≤140 chars."
- [ ] Tests assert no emojis/exclamation marks in prompt body (defense in depth — we don't want to invite the model to mirror them)

**Verify:** `pnpm vitest run tests/unit/recaps/prompts.test.ts`

**Steps:**

- [ ] **Step 1: Write tests**

```ts
import { describe, expect, it } from "vitest";
import { buildOpeningPrompt, buildGotyPrompt, buildGenreDominancePrompt, buildMechanicLovePrompt, buildSurprisePrompt, buildTasteEvolutionPrompt, buildClosingPrompt } from "@/lib/recaps/prompts";

const sharedAssertions = (output: { system: string; user: string }) => {
  expect(output.system).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u); // no emoji
  expect(output.user).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  expect(output.system).not.toMatch(/!/);
  expect(output.user).not.toMatch(/!/);
  expect(output.system).toMatch(/no emojis/i);
};

describe("recap prompts", () => {
  it("opening prompt renders with totals", () => {
    const out = buildOpeningPrompt({ totalGames: 47, year: 2026, reviewCount: 5, topGenre: "Action" });
    expect(out.user).toContain("47");
    sharedAssertions(out);
  });
  // ... similar for the other six
});
```

- [ ] **Step 2: Run — expect failure**

- [ ] **Step 3: Implement `lib/recaps/prompts.ts`**

```ts
const SHARED_CONSTRAINTS = `Constraints:
- No emojis
- No exclamation marks
- Address user as "you"
- One sentence
- 140 chars max
- Voice: knowing observer — warmer than analytics, less performative than a marketing tagline

Output ONLY JSON matching schema: { "caption": string }`;

export interface PromptOutput {
  system: string;
  user: string;
}

export function buildOpeningPrompt(input: { totalGames: number; year: number; reviewCount: number; topGenre: string | null }): PromptOutput {
  return {
    system: `You write the opening hook line for a personalized year-in-review for a video game tracker. ${SHARED_CONSTRAINTS}`,
    user: `User logged ${input.totalGames} games in ${input.year}. They wrote ${input.reviewCount} reviews. Dominant genre: ${input.topGenre ?? "varied"}. Write one hook line that sets up the recap.`,
  };
}

export function buildGotyPrompt(input: { title: string; rating: number; status: string }): PromptOutput {
  return {
    system: `You write the reveal line for the user's top-rated game of the year. ${SHARED_CONSTRAINTS}`,
    user: `Game: ${input.title}. Rating: ${input.rating}/5. Status: ${input.status}. Voice: celebratory but grounded.`,
  };
}

export function buildGenreDominancePrompt(input: { topGenre: string; topGenrePct: number; secondGenre: string | null; secondGenrePct: number }): PromptOutput {
  return {
    system: `You write the observation line for the user's dominant genre of the year. ${SHARED_CONSTRAINTS}`,
    user: `Top genre: ${input.topGenre} (${input.topGenrePct}%). Second: ${input.secondGenre ?? "none"} (${input.secondGenrePct}%). Caption the observation.`,
  };
}

export function buildMechanicLovePrompt(input: { topMechanic: string }): PromptOutput {
  return {
    system: `You write the "love language" line for the user's top game mechanic. ${SHARED_CONSTRAINTS}`,
    user: `Top mechanic: ${input.topMechanic}. Example shape: "Roguelite progression was your love language this year."`,
  };
}

export function buildSurprisePrompt(input: { game: string; surpriseGenre: string; rating: number; baselineAvg: number }): PromptOutput {
  return {
    system: `You write the reveal line for the user's "surprise of the year" — a game they rated unexpectedly highly in a genre they usually rate lower. ${SHARED_CONSTRAINTS}`,
    user: `Game: ${input.game}. Genre: ${input.surpriseGenre}. Rating: ${input.rating}/5. Their typical ${input.surpriseGenre} rating: ${input.baselineAvg.toFixed(1)}/5. Voice: warm reveal.`,
  };
}

export function buildTasteEvolutionPrompt(input: { q1Vibe: string; q4Vibe: string }): PromptOutput {
  return {
    system: `You write the line describing how the user's gaming taste shifted from Q1 to Q4. ${SHARED_CONSTRAINTS}`,
    user: `Q1 dominant vibe: ${input.q1Vibe}. Q4 dominant vibe: ${input.q4Vibe}. Reflective tone.`,
  };
}

export function buildClosingPrompt(input: { topGame: string; topGenre: string; surpriseGame: string | null; year: number; mode: "yearly" | "monthly" }): PromptOutput {
  return {
    system: `You write the closing share line for the user's recap pageant. ${SHARED_CONSTRAINTS}`,
    user: `Window: ${input.mode === "yearly" ? input.year : `${input.mode} recap`}. Top game: ${input.topGame}. Top genre: ${input.topGenre}. Surprise: ${input.surpriseGame ?? "none"}. Designed to be shared on social.`,
  };
}
```

- [ ] **Step 4: Run tests — pass**

- [ ] **Step 5: Commit**

```bash
git add lib/recaps/prompts.ts tests/unit/recaps/prompts.test.ts
git commit -m "feat(recaps): T5 AI prompts for seven captioned scenes"
```

---

## Task 6: Captions module with retry/fallback

**Goal:** `generateCaption(scene, payload)` → string. Calls `lib/ai/router.ts` with the zod schema, falls back to `scene.fallbackTemplate(payload)` on any failure; logs to `ai_calls`.

**Files:**
- Create: `lib/recaps/captions.ts`
- Create: `tests/unit/recaps/captions.test.ts`

**Acceptance Criteria:**
- [ ] Success path: router returns `{caption: "..."}` → that string returned
- [ ] Zod validation failure → one retry with stricter system suffix → if still failing, fallback template runs
- [ ] Provider exhaustion (`AiProviderError`) → fallback template runs (no throw)
- [ ] `ai_calls` row written every attempt — `success=true` on valid response, `success=false` with `error_message` on fallback path
- [ ] `generateCaptions(payload, scenes)` parallelizes all AI-tagged scenes via Promise.all
- [ ] Non-AI scenes return their fallbackTemplate output directly (no router call)

**Verify:** `pnpm vitest run tests/unit/recaps/captions.test.ts`

**Steps:**

- [ ] **Step 1: Write tests — mock the AI router**

```ts
// tests/unit/recaps/captions.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/ai/router", () => ({
  generateObject: vi.fn(),
  AiProviderError: class extends Error { constructor(msg: string) { super(msg); this.name = "AiProviderError"; } },
}));
vi.mock("@/lib/db", () => ({ db: { insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })) }, schema: { aiCalls: {} } }));

import { generateObject } from "@/lib/ai/router";
import { generateCaption } from "@/lib/recaps/captions";
import { getScene } from "@/lib/recaps/scenes";

const mockGenerate = vi.mocked(generateObject);

beforeEach(() => mockGenerate.mockReset());

const samplePayload = {
  tier: "ok",
  mode: "yearly",
  windowStart: "2026-01-01T00:00:00.000Z",
  windowEnd: "2027-01-01T00:00:00.000Z",
  scenes: ["opening", "goty", "closing"],
  totals: { totalGames: 47, totalHoursPlayed: 120, completedCount: 30, droppedCount: 5, replayingCount: 2, reviewCount: 4 },
  topGames: [{ gameId: "g1", rawgId: null, title: "Game A", coverUrl: null, rating: 5, status: "completed" }],
  goty: { gameId: "g1", rawgId: null, title: "Game A", coverUrl: null, rating: 5, status: "completed" },
  topGenre: { name: "Action", pct: 40, secondName: "RPG", secondPct: 20 },
  captions: {},
} as const;

describe("generateCaption", () => {
  it("returns AI response on success", async () => {
    mockGenerate.mockResolvedValueOnce({ caption: "An action-packed year." });
    const scene = getScene("opening")!;
    const out = await generateCaption(scene, samplePayload as never, "user-1");
    expect(out).toBe("An action-packed year.");
  });

  it("falls back to template on AiProviderError", async () => {
    const { AiProviderError } = await import("@/lib/ai/router");
    mockGenerate.mockRejectedValueOnce(new AiProviderError("all providers exhausted"));
    const scene = getScene("opening")!;
    const out = await generateCaption(scene, samplePayload as never, "user-1");
    expect(out).toBe(scene.fallbackTemplate(samplePayload as never));
  });

  it("falls back after one retry on zod validation failure", async () => {
    mockGenerate.mockRejectedValueOnce(new Error("zod parse failed: caption length"));
    mockGenerate.mockRejectedValueOnce(new Error("zod parse failed: caption length"));
    const scene = getScene("opening")!;
    const out = await generateCaption(scene, samplePayload as never, "user-1");
    expect(out).toBe(scene.fallbackTemplate(samplePayload as never));
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run — failures**

- [ ] **Step 3: Implement `lib/recaps/captions.ts`**

```ts
import "server-only";
import { z } from "zod";
import { generateObject, AiProviderError } from "@/lib/ai/router";
import { db, schema } from "@/lib/db";
import type { RecapPayload, SceneDefinition, SceneId } from "./types";
import {
  buildOpeningPrompt,
  buildGotyPrompt,
  buildGenreDominancePrompt,
  buildMechanicLovePrompt,
  buildSurprisePrompt,
  buildTasteEvolutionPrompt,
  buildClosingPrompt,
} from "./prompts";

const CaptionSchema = z.object({ caption: z.string().min(8).max(140) });

type PromptInput = { system: string; user: string };

function buildPrompt(sceneId: SceneId, payload: RecapPayload): PromptInput | null {
  switch (sceneId) {
    case "opening":
      return buildOpeningPrompt({
        totalGames: payload.totals.totalGames,
        year: new Date(payload.windowStart).getUTCFullYear(),
        reviewCount: payload.totals.reviewCount,
        topGenre: payload.topGenre?.name ?? null,
      });
    case "goty":
      return payload.goty ? buildGotyPrompt({ title: payload.goty.title, rating: payload.goty.rating, status: payload.goty.status }) : null;
    case "genre_dominance":
      return payload.topGenre ? buildGenreDominancePrompt({ topGenre: payload.topGenre.name, topGenrePct: payload.topGenre.pct, secondGenre: payload.topGenre.secondName, secondGenrePct: payload.topGenre.secondPct }) : null;
    case "mechanic_love":
      return payload.topMechanic ? buildMechanicLovePrompt({ topMechanic: payload.topMechanic.name }) : null;
    case "surprise":
      return payload.surprise
        ? buildSurprisePrompt({ game: payload.surprise.game.title, surpriseGenre: payload.surprise.surpriseGenre, rating: payload.surprise.game.rating, baselineAvg: payload.surprise.baselineAvg })
        : null;
    case "taste_evolution":
      return payload.tasteEvolution ? buildTasteEvolutionPrompt({ q1Vibe: payload.tasteEvolution.q1Vibe, q4Vibe: payload.tasteEvolution.q4Vibe }) : null;
    case "closing":
      return buildClosingPrompt({
        topGame: payload.goty?.title ?? "varied",
        topGenre: payload.topGenre?.name ?? "varied",
        surpriseGame: payload.surprise?.game.title ?? null,
        year: new Date(payload.windowStart).getUTCFullYear(),
        mode: payload.mode,
      });
    default:
      return null;
  }
}

async function logAiCall(args: {
  userId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  success: boolean;
  errorMessage: string | null;
}) {
  await db.insert(schema.aiCalls).values({
    userId: args.userId,
    feature: "year_in_review",
    provider: args.provider,
    model: args.model,
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
    latencyMs: args.latencyMs,
    success: args.success,
    errorMessage: args.errorMessage,
  });
}

export async function generateCaption(scene: SceneDefinition, payload: RecapPayload, userId: string): Promise<string> {
  if (!scene.aiCaption) return scene.fallbackTemplate(payload);

  const prompt = buildPrompt(scene.id, payload);
  if (!prompt) return scene.fallbackTemplate(payload);

  const started = Date.now();
  try {
    const result = await generateObject({ schema: CaptionSchema, system: prompt.system, prompt: prompt.user });
    await logAiCall({ userId, provider: result.provider, model: result.model, inputTokens: result.usage?.inputTokens ?? 0, outputTokens: result.usage?.outputTokens ?? 0, latencyMs: Date.now() - started, success: true, errorMessage: null });
    return result.object.caption;
  } catch (err) {
    if (err instanceof AiProviderError) {
      await logAiCall({ userId, provider: "n/a", model: "n/a", inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - started, success: false, errorMessage: err.message });
      return scene.fallbackTemplate(payload);
    }
    // Retry once with stricter shape suffix
    try {
      const retry = await generateObject({
        schema: CaptionSchema,
        system: prompt.system + "\n\nIMPORTANT: Output ONLY valid JSON matching the schema. Do not include backticks, prose, or any other text.",
        prompt: prompt.user,
      });
      await logAiCall({ userId, provider: retry.provider, model: retry.model, inputTokens: retry.usage?.inputTokens ?? 0, outputTokens: retry.usage?.outputTokens ?? 0, latencyMs: Date.now() - started, success: true, errorMessage: null });
      return retry.object.caption;
    } catch (retryErr) {
      await logAiCall({ userId, provider: "n/a", model: "n/a", inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - started, success: false, errorMessage: retryErr instanceof Error ? retryErr.message : String(retryErr) });
      return scene.fallbackTemplate(payload);
    }
  }
}

export async function generateAllCaptions(payload: RecapPayload, userId: string): Promise<Record<SceneId, string>> {
  const { SCENE_CATALOG } = await import("./scenes");
  const scenes = SCENE_CATALOG.filter((s) => payload.scenes.includes(s.id));
  const entries = await Promise.all(
    scenes.map(async (s) => [s.id, await generateCaption(s, payload, userId)] as const),
  );
  return Object.fromEntries(entries) as Record<SceneId, string>;
}
```

**Note:** This task assumes `lib/ai/router.ts` exports `generateObject({schema, system, prompt})` returning `{object, provider, model, usage}` and `AiProviderError`. **Verify this assumption against `lib/ai/router.ts` before implementing — adjust the import shape if the router exposes a different surface.** Also add `"year_in_review"` to the `ai_feature` enum if it doesn't exist (verify `lib/db/schema.ts` `aiFeatureEnum` values).

- [ ] **Step 4: Run tests — pass**

- [ ] **Step 5: Verify aiFeatureEnum has `year_in_review` value**

`grep aiFeatureEnum lib/db/schema.ts` — if `"year_in_review"` not in values, add it via a small migration appendage to 0016 or use the existing `"recommendation"` value as the closest match. Document the choice in a comment.

- [ ] **Step 6: Commit**

```bash
git add lib/recaps/captions.ts tests/unit/recaps/captions.test.ts
git commit -m "feat(recaps): T6 captions module with router retry + fallback templates"
```

---

## Task 7: Featured-list server actions

**Goal:** `getActiveFeaturedList`, `pinFeaturedList`, `unpinFeaturedList` in `lib/recaps/featured.ts`. Admin-only writes.

**Files:**
- Create: `lib/recaps/featured.ts`
- Create: `tests/unit/recaps/featured.test.ts`

**Acceptance Criteria:**
- [ ] `getActiveFeaturedList(surface)` returns `{listId, listTitle, listSlug, authorUsername, itemCount, coverUrls}` or `null`. Joins `featured_lists` → `lists` → `list_items` for counts. Cached with `cache()` per request.
- [ ] `pinFeaturedList({listId, pinnedUntil?})` — server action. Derives session user via `getCachedUser()`, calls `assertAdmin(user.id)` (throw `NotAdminError` if not). Validates list exists + is public. Closes any existing active pin via `UPDATE … pinned_until = now()`. INSERTs new row. `revalidatePath('/discover')` + `revalidatePath('/admin/featured')`.
- [ ] `unpinFeaturedList(surface)` — admin-only. UPDATEs existing active row to `pinned_until = now()`. Same revalidate calls.
- [ ] Tests cover: non-admin caller rejected; list-not-found rejected; private-list rejected; happy path

**Verify:** `pnpm vitest run tests/unit/recaps/featured.test.ts`

**Steps:**

- [ ] **Step 1: Write tests**

```ts
// tests/unit/recaps/featured.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/auth-cache", () => ({ getCachedUser: vi.fn() }));
vi.mock("@/lib/social/moderation/admin", () => ({ isAdmin: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { execute: vi.fn(), insert: vi.fn(), update: vi.fn(), select: vi.fn() }, schema: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getCachedUser } from "@/lib/supabase/auth-cache";
import { isAdmin } from "@/lib/social/moderation/admin";
import { pinFeaturedList } from "@/lib/recaps/featured";

beforeEach(() => {
  vi.mocked(getCachedUser).mockReset();
  vi.mocked(isAdmin).mockReset();
});

describe("pinFeaturedList", () => {
  it("rejects non-admin caller", async () => {
    vi.mocked(getCachedUser).mockResolvedValue({ id: "u-1" } as never);
    vi.mocked(isAdmin).mockReturnValue(false);
    await expect(pinFeaturedList({ listId: "l-1" })).rejects.toThrow(/admin/i);
  });
  // ... list-not-found, private-list, happy path
});
```

- [ ] **Step 2: Run — failure**

- [ ] **Step 3: Implement `lib/recaps/featured.ts`** — full file with `"use server"` directive on action exports; `getActiveFeaturedList` is a non-server cached helper.

```ts
"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { isAdmin } from "@/lib/social/moderation/admin";

export class NotAdminError extends Error {
  constructor() { super("Admin only"); this.name = "NotAdminError"; }
}

async function assertAdminSession(): Promise<string> {
  const user = await getCachedUser();
  if (!user || !isAdmin(user.id)) throw new NotAdminError();
  return user.id;
}

export async function pinFeaturedList(input: { listId: string; pinnedUntil?: Date | null }): Promise<void> {
  const adminId = await assertAdminSession();

  // Validate list exists + is public
  const listRows = (await db.execute<{ id: string; visibility: string }>(sql`
    SELECT id, visibility FROM lists WHERE id = ${input.listId} LIMIT 1
  `)) as unknown as Array<{ id: string; visibility: string }>;
  if (!listRows[0]) throw new Error("List not found");
  if (listRows[0].visibility !== "public") throw new Error("List must be public to pin");

  await db.transaction(async (tx) => {
    // Close any existing active pin on this surface
    await tx.execute(sql`
      UPDATE featured_lists SET pinned_until = now()
      WHERE surface = 'discover_landing'
        AND (pinned_until IS NULL OR pinned_until > now())
    `);
    // Insert new pin
    await tx.insert(schema.featuredLists).values({
      listId: input.listId,
      surface: "discover_landing",
      pinnedUntil: input.pinnedUntil ?? null,
      pinnedBy: adminId,
    });
  });

  revalidatePath("/discover");
  revalidatePath("/admin/featured");
}

export async function unpinFeaturedList(): Promise<void> {
  await assertAdminSession();
  await db.execute(sql`
    UPDATE featured_lists SET pinned_until = now()
    WHERE surface = 'discover_landing'
      AND (pinned_until IS NULL OR pinned_until > now())
  `);
  revalidatePath("/discover");
  revalidatePath("/admin/featured");
}
```

And in a separate non-`"use server"` file `lib/recaps/featured-read.ts`:

```ts
import { cache } from "react";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export interface FeaturedListSummary {
  listId: string;
  listTitle: string;
  listSlug: string;
  authorUsername: string;
  itemCount: number;
  coverUrls: string[];
}

export const getActiveFeaturedList = cache(async (surface: string): Promise<FeaturedListSummary | null> => {
  const rows = (await db.execute<{ list_id: string; title: string; slug: string; username: string; item_count: string; cover_urls: string[] }>(sql`
    SELECT
      l.id as list_id,
      l.title,
      l.slug,
      p.username,
      (SELECT COUNT(*)::text FROM list_items WHERE list_id = l.id) as item_count,
      ARRAY(
        SELECT g.background_image FROM list_items li
        JOIN games g ON g.id = li.game_id
        WHERE li.list_id = l.id AND g.background_image IS NOT NULL
        ORDER BY li.position ASC LIMIT 4
      ) as cover_urls
    FROM featured_lists fl
    JOIN lists l ON l.id = fl.list_id
    JOIN profiles p ON p.user_id = l.user_id
    WHERE fl.surface = ${surface}
      AND (fl.pinned_until IS NULL OR fl.pinned_until > now())
    ORDER BY fl.pinned_at DESC
    LIMIT 1
  `)) as unknown as Array<{ list_id: string; title: string; slug: string; username: string; item_count: string; cover_urls: string[] }>;
  if (!rows[0]) return null;
  return {
    listId: rows[0].list_id,
    listTitle: rows[0].title,
    listSlug: rows[0].slug,
    authorUsername: rows[0].username,
    itemCount: parseInt(rows[0].item_count, 10),
    coverUrls: rows[0].cover_urls ?? [],
  };
});
```

**Note:** Split rationale — exports from a `"use server"` file must be async functions only (per `feedback_pnpm_build_canonical_gate.md`). The reader is split into a non-`"use server"` file because exporting a `cache()`-wrapped function or class triggers Next.js 16 validation. Confirm split mirrors Phase 5 `lib/profile/redact.ts` precedent.

- [ ] **Step 4: Run tests — pass**

- [ ] **Step 5: Commit**

```bash
git add lib/recaps/featured.ts lib/recaps/featured-read.ts tests/unit/recaps/featured.test.ts
git commit -m "feat(recaps): T7 featured-list server actions + read helper"
```

---

## Task 8: Admin /admin/featured page

**Goal:** Pin affordance UI — current pin + Unpin button + Pin form.

**Files:**
- Create: `app/(app)/admin/featured/page.tsx`
- Create: `components/admin/featured-pin-form.tsx`
- Create: `components/admin/featured-current-pin.tsx`

**Acceptance Criteria:**
- [ ] Non-admin viewer: 404
- [ ] Renders current pin (or "No active pin" empty state) + Unpin button
- [ ] Renders Pin form: list URL or admin's own public lists dropdown + optional expiry date input
- [ ] Submit calls `pinFeaturedList`; error states surfaced (list-not-found, private-list)
- [ ] After successful pin: page revalidates and reflects new pin

**Verify:** `pnpm tsc --noEmit && pnpm build` (catches "use server" validation regressions per `feedback_pnpm_build_canonical_gate.md`)

**Steps:**

- [ ] **Step 1: Implement page** (mirrors `app/(app)/admin/reports/page.tsx` shape)

```tsx
// app/(app)/admin/featured/page.tsx
import { notFound } from "next/navigation";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { isAdmin } from "@/lib/social/moderation/admin";
import { getActiveFeaturedList } from "@/lib/recaps/featured-read";
import { FeaturedCurrentPin } from "@/components/admin/featured-current-pin";
import { FeaturedPinForm } from "@/components/admin/featured-pin-form";

export const metadata = {
  title: "Admin · Featured list",
  robots: { index: false, follow: false },
};

export default async function AdminFeaturedPage() {
  const user = await getCachedUser();
  if (!isAdmin(user?.id)) notFound();

  const current = await getActiveFeaturedList("discover_landing");

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Featured list</h1>
        <p className="text-sm text-[var(--text-dim)] mt-1">
          Pins one list to the top of /discover.
        </p>
      </header>

      <FeaturedCurrentPin pin={current} />
      <FeaturedPinForm />
    </div>
  );
}
```

- [ ] **Step 2: Implement components**

`components/admin/featured-current-pin.tsx`: client component, displays the current pin via `<FeaturedListCard>` (T9) + Unpin button that calls `unpinFeaturedList`.

`components/admin/featured-pin-form.tsx`: client component with `<form action={pinAction}>`, list-URL input + optional expiry, basic Zod validation.

- [ ] **Step 3: Verify**

`pnpm tsc --noEmit && pnpm build` — must succeed (the `pnpm build` gate catches Server Action validation that `tsc` misses).

- [ ] **Step 4: Commit**

```bash
git add app/(app)/admin/featured/ components/admin/featured-pin-form.tsx components/admin/featured-current-pin.tsx
git commit -m "feat(recaps): T8 admin /admin/featured page + pin form"
```

---

## Task 9: /discover featured-list render + FeaturedListCard

**Goal:** Render the active pin (if any) above existing trending sections on `/discover` landing.

**Files:**
- Modify: `app/(app)/discover/page.tsx` (add featured section)
- Create: `components/recaps/FeaturedListCard.tsx`
- Create: `tests/unit/recaps/featured-list-card.test.tsx`

**Acceptance Criteria:**
- [ ] When `getActiveFeaturedList('discover_landing')` returns null: section not rendered (no empty state)
- [ ] When returns a pin: card renders above "Popular this week" with title + "Picked by us · N games" + cover composite + link to canonical `/u/{author}/lists/{slug}`
- [ ] Card uses semantic markup (`<article>`, headings) and respects existing CSS vars

**Verify:** `pnpm vitest run tests/unit/recaps/featured-list-card.test.tsx && pnpm tsc --noEmit`

**Steps:**

- [ ] **Step 1: Write component test** (snapshot or behavior — pick behavior assertions over snapshots per project convention; check that the link href is correct, the count renders, etc.)

- [ ] **Step 2: Implement `<FeaturedListCard>`** with same poster-grid pattern as Phase 5 `<ListCard>` from `components/lists/list-card.tsx`.

```tsx
import Link from "next/link";
import type { FeaturedListSummary } from "@/lib/recaps/featured-read";

export function FeaturedListCard({ pin }: { pin: FeaturedListSummary }) {
  const href = `/u/${pin.authorUsername}/lists/${pin.listSlug}`;
  return (
    <article className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-6 hover:bg-[var(--bg-card-hover)] transition-colors">
      <Link href={href} className="block">
        <div className="flex gap-4">
          <div className="grid grid-cols-2 gap-1 w-24 h-24 rounded-lg overflow-hidden flex-shrink-0">
            {pin.coverUrls.slice(0, 4).map((url, i) => (
              <img key={i} src={url} alt="" className="w-full h-full object-cover" />
            ))}
          </div>
          <div className="flex-1">
            <p className="text-xs uppercase tracking-wider text-[var(--accent)]">Picked by us</p>
            <h3 className="text-lg font-semibold text-[var(--text)] mt-1">{pin.listTitle}</h3>
            <p className="text-sm text-[var(--text-dim)] mt-1">{pin.itemCount} {pin.itemCount === 1 ? "game" : "games"}</p>
          </div>
        </div>
      </Link>
    </article>
  );
}
```

- [ ] **Step 3: Modify `app/(app)/discover/page.tsx`** — fetch pin in the existing `Promise.all`, render `<FeaturedListCard>` before "Popular this week" only when present.

- [ ] **Step 4: Verify**

`pnpm vitest run && pnpm tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add app/(app)/discover/page.tsx components/recaps/FeaturedListCard.tsx tests/unit/recaps/featured-list-card.test.tsx
git commit -m "feat(recaps): T9 /discover featured-list render + card"
```

---

## Task 10: SparseDataState component

**Goal:** Mascot empty state for users with <10 logs in window.

**Files:**
- Create: `components/recaps/SparseDataState.tsx`
- Create: `tests/unit/recaps/sparse-data-state.test.tsx`

**Acceptance Criteria:**
- [ ] Renders mascot illustration (existing pose from `components/mascot/states.ts`) + heading + body copy
- [ ] Copy is neutral + warm: "Come back when you've logged a few more" — no exclamation marks, no emojis
- [ ] Includes CTA back to `/u/{username}` profile
- [ ] Respects `prefers-reduced-motion` (no idle animation)

**Verify:** `pnpm vitest run tests/unit/recaps/sparse-data-state.test.tsx`

**Steps:**

- [ ] **Step 1: Implement** — small component, ~30 lines. Reference existing `<MascotState>` from `components/mascot/states.ts` for pose import.
- [ ] **Step 2: Test** — render + assert no exclamation marks (defense), correct CTA href.
- [ ] **Step 3: Commit**

```bash
git add components/recaps/SparseDataState.tsx tests/unit/recaps/sparse-data-state.test.tsx
git commit -m "feat(recaps): T10 sparse-data mascot empty state"
```

---

## Task 11: YIR page route + cache-or-build flow

**Goal:** `/u/[username]/year/[year]/page.tsx` server component implementing the cache-or-build flow from the spec.

**Files:**
- Create: `app/(app)/u/[username]/year/[year]/page.tsx`
- Create: `app/(app)/u/[username]/year/[year]/loading.tsx`
- Create: `lib/recaps/cache-or-build.ts` (extract logic for testability)
- Create: `tests/unit/recaps/cache-or-build.test.ts`

**Acceptance Criteria:**
- [ ] Resolves username → userId; checks viewer auth; applies private-profile gate (404 for non-followers)
- [ ] SELECT existing row; if locked OR generated <7 days ago: render with cached payload (no aggregator run, no AI calls)
- [ ] Else: run buildRecap → if `too_sparse` render `<SparseDataState>` (no row written); else run captions, upsert, render
- [ ] `loading.tsx` shows "I'm reviewing your year…" mascot state
- [ ] `generateMetadata` reads `?scene` searchParam and returns OG meta pointing to `/og/year/.../scene/{i}` when set, otherwise the summary card

**Verify:** `pnpm vitest run tests/unit/recaps/cache-or-build.test.ts && pnpm tsc --noEmit && pnpm build`

**Steps:**

- [ ] **Step 1: Write cache-or-build unit tests** — mock all db + buildRecap + generateAllCaptions, exercise the four branches (cached-locked, cached-fresh, stale-current-year, no-row).

- [ ] **Step 2: Extract logic into `lib/recaps/cache-or-build.ts`**

```ts
import "server-only";
import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { buildRecap } from "./aggregate";
import { generateAllCaptions } from "./captions";
import { yearWindow } from "./window";
import type { RecapPayload } from "./types";
import crypto from "node:crypto";

interface CacheOrBuildInput { userId: string; year: number; }

export async function cacheOrBuildYearly(input: CacheOrBuildInput): Promise<RecapPayload> {
  const { userId, year } = input;
  const rows = (await db.execute<{ payload: RecapPayload; locked_at: string | null; generated_at: string }>(sql`
    SELECT payload, locked_at, generated_at::text FROM year_in_reviews WHERE user_id = ${userId} AND year = ${year} LIMIT 1
  `)) as unknown as Array<{ payload: RecapPayload; locked_at: string | null; generated_at: string }>;

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  if (rows[0]) {
    const isLocked = rows[0].locked_at !== null;
    const isFreshCurrentYear = year === currentYear && new Date(rows[0].generated_at) > sevenDaysAgo;
    const isPastYear = year < currentYear;
    if (isLocked || isFreshCurrentYear || isPastYear) {
      return rows[0].payload;
    }
  }

  const { start, end } = yearWindow(year);
  const payload = await buildRecap({ userId, windowStart: start, windowEnd: end, mode: "yearly" });
  if (payload.tier === "too_sparse") {
    // Do NOT write row; return as-is for the page to render <SparseDataState>
    return payload;
  }

  const captions = await generateAllCaptions(payload, userId);
  payload.captions = captions;

  const hash = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32);

  await db.execute(sql`
    INSERT INTO year_in_reviews (user_id, year, payload, share_image_hash, generated_at)
    VALUES (${userId}, ${year}, ${JSON.stringify(payload)}::jsonb, ${hash}, now())
    ON CONFLICT (user_id, year) DO UPDATE SET
      payload = EXCLUDED.payload,
      share_image_hash = EXCLUDED.share_image_hash,
      generated_at = now()
  `);

  return payload;
}
```

- [ ] **Step 3: Implement page route**

```tsx
// app/(app)/u/[username]/year/[year]/page.tsx
import { notFound } from "next/navigation";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { getProfileByUsername } from "@/lib/profile/queries"; // existing helper
import { canViewProfile } from "@/lib/profile/redact";       // existing helper
import { cacheOrBuildYearly } from "@/lib/recaps/cache-or-build";
import { Pageant } from "@/components/recaps/Pageant";
import { SparseDataState } from "@/components/recaps/SparseDataState";

interface PageProps {
  params: Promise<{ username: string; year: string }>;
  searchParams: Promise<{ scene?: string }>;
}

export async function generateMetadata({ params, searchParams }: PageProps) {
  const { username, year } = await params;
  const { scene } = await searchParams;
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://ploxa.vercel.app";
  const ogPath = scene
    ? `/og/year/${username}/${year}/scene/${scene}`
    : `/og/year/${username}/${year}`;
  return {
    title: `${username}'s ${year} in games`,
    openGraph: { images: [`${base}${ogPath}`] },
    twitter: { card: "summary_large_image" as const, images: [`${base}${ogPath}`] },
  };
}

export default async function YearPage({ params, searchParams }: PageProps) {
  const { username, year: yearStr } = await params;
  const { scene } = await searchParams;
  const year = parseInt(yearStr, 10);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) notFound();

  const viewer = await getCachedUser();
  const profile = await getProfileByUsername(username);
  if (!profile) notFound();
  if (!(await canViewProfile(profile, viewer?.id ?? null))) notFound();

  const payload = await cacheOrBuildYearly({ userId: profile.userId, year });
  if (payload.tier === "too_sparse") {
    return <SparseDataState username={username} mode="yearly" />;
  }

  return <Pageant payload={payload} mode="yearly" initialSceneIndex={scene ? parseInt(scene, 10) : 0} />;
}
```

**Note:** Verify `getProfileByUsername` + `canViewProfile` exact import paths against current codebase (Phase 5 + audit T01 introduced these helpers; names may differ). Substitute existing helpers if so.

- [ ] **Step 4: Implement `loading.tsx`**

Simple mascot loading state. Server component, no client JS needed.

- [ ] **Step 5: Verify**

`pnpm vitest run && pnpm tsc --noEmit && pnpm build`

- [ ] **Step 6: Commit**

```bash
git add lib/recaps/cache-or-build.ts app/(app)/u/[username]/year/[year]/ tests/unit/recaps/cache-or-build.test.ts
git commit -m "feat(recaps): T11 YIR page route + cache-or-build flow"
```

---

## Task 12: Pageant component (Framer Motion scene sequencer)

**Goal:** Client component `<Pageant>` that auto-advances scenes with mascot beats; swipe/keyboard/tap controls; progress bar; share affordance.

**Files:**
- Create: `components/recaps/Pageant.tsx`
- Create: `components/recaps/PageantProgressBar.tsx`
- Create: `components/recaps/PageantControls.tsx`
- Create: `tests/unit/recaps/pageant-state.test.ts` (state machine logic only — no DOM tests)

**Acceptance Criteria:**
- [ ] Renders the correct scene component for the current index
- [ ] Auto-advance via `useEffect` timer (8s default, per-scene override from `Scene.holdDurationMs`)
- [ ] Tap-third-zones, swipe (Framer Motion `useDrag`), keyboard (← → space Esc) all work
- [ ] Pause is sticky — manual resume required (no auto-resume)
- [ ] Progress bar fills L→R during hold; instant-fills on skip-forward
- [ ] Closing scene replaces small share icon with three big buttons (Twitter · Discord · Copy link)
- [ ] `prefers-reduced-motion`: zero-duration transitions, scenes still render
- [ ] State machine extracted to a pure reducer for testability

**Verify:** `pnpm vitest run tests/unit/recaps/pageant-state.test.ts && pnpm tsc --noEmit`

**Steps:**

- [ ] **Step 1: Implement pure state reducer**

```ts
// In Pageant.tsx, exportable for tests
type PageantAction =
  | { type: "ADVANCE" }
  | { type: "BACK" }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "JUMP"; index: number };

interface PageantState {
  index: number;
  isPaused: boolean;
  total: number;
}

export function pageantReducer(state: PageantState, action: PageantAction): PageantState {
  switch (action.type) {
    case "ADVANCE":
      return state.index >= state.total - 1 ? state : { ...state, index: state.index + 1 };
    case "BACK":
      return state.index <= 0 ? state : { ...state, index: state.index - 1 };
    case "PAUSE":
      return { ...state, isPaused: true };
    case "RESUME":
      return { ...state, isPaused: false };
    case "JUMP":
      return { ...state, index: Math.max(0, Math.min(action.index, state.total - 1)) };
  }
}
```

- [ ] **Step 2: Write reducer tests** — assert all transitions including bounds (no advance past last, no back past first).

- [ ] **Step 3: Implement `<Pageant>`** — client component, uses `useReducer(pageantReducer)`. AnimatePresence wraps the active scene. Framer Motion `useDrag` for swipe. `useEffect` timer that respects pause. Tap-third-zones rendered as three absolute-positioned divs. Keyboard listener via `useEffect`+`window.addEventListener`. The scene to render is dispatched via a switch on `payload.scenes[state.index]`.

- [ ] **Step 4: Implement progress bar + controls** as separate small components.

- [ ] **Step 5: Verify**

```
pnpm vitest run tests/unit/recaps/pageant-state.test.ts
pnpm tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add components/recaps/Pageant.tsx components/recaps/PageantProgressBar.tsx components/recaps/PageantControls.tsx tests/unit/recaps/pageant-state.test.ts
git commit -m "feat(recaps): T12 pageant component with state machine + controls"
```

---

## Task 13: Scene components — data scenes

**Goal:** Five non-AI scene components rendering data viz + (template-filled) caption.

**Files:**
- Create: `components/recaps/scenes/OpeningScene.tsx`
- Create: `components/recaps/scenes/StatsTotalScene.tsx`
- Create: `components/recaps/scenes/TopGamesScene.tsx`
- Create: `components/recaps/scenes/LongestGameScene.tsx`
- Create: `components/recaps/scenes/ReviewsScene.tsx`
- Create: `tests/unit/recaps/scenes-data.test.tsx`

**Acceptance Criteria:**
- [ ] Each component is a function `({payload, caption, isActive}) → JSX`
- [ ] Mascot pose appropriate for the scene (reuse existing poses)
- [ ] Data viz animates on `isActive` change (Framer Motion `motion.div` with stagger)
- [ ] Caption always rendered (not behind animation gates) for a11y
- [ ] `prefers-reduced-motion`: instant final state
- [ ] Tests verify required data flows + caption rendering

**Verify:** `pnpm vitest run tests/unit/recaps/scenes-data.test.tsx`

**Steps:**

- [ ] **Step 1: Implement OpeningScene** — big year text + mascot + AI caption.
- [ ] **Step 2: Implement StatsTotalScene** — three big number tiles (total games / hours / completed) with tick-up animation via Framer Motion + spring.
- [ ] **Step 3: Implement TopGamesScene** — vertical poster stack, 1-by-1 reveal with stagger.
- [ ] **Step 4: Implement LongestGameScene** — hourglass animation (CSS) + game cover + hours played.
- [ ] **Step 5: Implement ReviewsScene** — quill icon + review count + favorite snippet quote.
- [ ] **Step 6: Test each** — render with sample payload, assert caption text, key data points appear.
- [ ] **Step 7: Commit**

```bash
git add components/recaps/scenes/{OpeningScene,StatsTotalScene,TopGamesScene,LongestGameScene,ReviewsScene}.tsx tests/unit/recaps/scenes-data.test.tsx
git commit -m "feat(recaps): T13 five data scenes (opening, stats, top, longest, reviews)"
```

---

## Task 14: Scene components — AI-captioned scenes

**Goal:** Six AI-captioned scene components (and the four substitute scenes for graceful degradation).

**Files:**
- Create: `components/recaps/scenes/GotyScene.tsx`
- Create: `components/recaps/scenes/GenreDominanceScene.tsx`
- Create: `components/recaps/scenes/MechanicLoveScene.tsx`
- Create: `components/recaps/scenes/SurpriseScene.tsx`
- Create: `components/recaps/scenes/TasteEvolutionScene.tsx`
- Create: `components/recaps/scenes/ClosingScene.tsx`
- Create: `components/recaps/scenes/MostReplayedScene.tsx` (substitute for LongestGameScene)
- Create: `components/recaps/scenes/TopThemeScene.tsx` (substitute for MechanicLoveScene)
- Create: `components/recaps/scenes/CompletionRatioScene.tsx` (substitute for TasteEvolutionScene)
- Create: `components/recaps/scenes/MoodThemesScene.tsx` (substitute for SurpriseScene)
- Create: `tests/unit/recaps/scenes-ai.test.tsx`

**Acceptance Criteria:**
- [ ] Each component is a function `({payload, caption, isActive}) → JSX`
- [ ] AI caption rendered prominently; mascot pose appropriate
- [ ] GotyScene: full-bleed game cover + title overlay + rating chip
- [ ] GenreDominanceScene: large genre name + donut chart sliver showing the percentage
- [ ] MechanicLoveScene: mechanic name in big type + small mechanic icon if available
- [ ] SurpriseScene: game cover with sparkle effect + rating delta annotation
- [ ] TasteEvolutionScene: two-column Q1/Q4 side-by-side vibe comparison
- [ ] ClosingScene: stats grid + three big share buttons (Twitter · Discord · Copy link), no small share icon
- [ ] Substitute scenes follow same shape as their primaries
- [ ] `prefers-reduced-motion`: instant final state

**Verify:** `pnpm vitest run tests/unit/recaps/scenes-ai.test.tsx`

**Steps:**

- [ ] **Step 1-6: Implement six primary AI scenes** — see acceptance criteria for shape.
- [ ] **Step 7-10: Implement four substitute scenes** — reuse the relevant primary's layout where possible.
- [ ] **Step 11: Test each** — render + assert caption appears + key data fields visible.
- [ ] **Step 12: Commit**

```bash
git add components/recaps/scenes/{GotyScene,GenreDominanceScene,MechanicLoveScene,SurpriseScene,TasteEvolutionScene,ClosingScene,MostReplayedScene,TopThemeScene,CompletionRatioScene,MoodThemesScene}.tsx tests/unit/recaps/scenes-ai.test.tsx
git commit -m "feat(recaps): T14 six AI scenes + four substitute scenes"
```

---

## Task 15: OG endpoint family

**Goal:** Four OG routes (yearly summary, yearly per-scene, monthly summary, monthly per-scene) sharing a single Satori card builder.

**Files:**
- Create: `app/og/year/[username]/[year]/route.tsx`
- Create: `app/og/year/[username]/[year]/scene/[i]/route.tsx`
- Create: `app/og/month/[username]/[yyyymm]/route.tsx`
- Create: `app/og/month/[username]/[yyyymm]/scene/[i]/route.tsx`
- Create: `lib/recaps/og/card.tsx` (shared Satori JSX builder)
- Create: `tests/unit/recaps/og.test.tsx`

**Acceptance Criteria:**
- [ ] All four routes return 200 with `image/png` 1200×630 (or whatever Satori produces)
- [ ] Routes return 200 even when profile is private (privacy is "share is consent")
- [ ] Each scene index maps to a scene-specific layout via switch on `sceneId`
- [ ] Card renders: dark gradient + star field + scene-specific hero + footer with `ploxa.vercel.app/u/.../year/2026` + small wordmark
- [ ] No external font fetches at request time (use bundled or fall back to system stack)

**Verify:** `pnpm vitest run tests/unit/recaps/og.test.tsx && pnpm tsc --noEmit && pnpm build`

**Steps:**

- [ ] **Step 1: Implement shared Satori card builder** in `lib/recaps/og/card.tsx`. Mirrors `app/api/og/taste/[username]/route.tsx` structure (Phase 4 precedent).
- [ ] **Step 2: Implement summary route** that reads username + year, calls `cacheOrBuildYearly`, passes payload to the card builder with `mode: 'summary'`.
- [ ] **Step 3: Implement per-scene route** that additionally accepts a scene index; passes to card builder with `mode: 'scene', sceneIndex: i`.
- [ ] **Step 4: Implement monthly equivalents** — parameterized by `[yyyymm]` (parse "202605" → year 2026, month 5).
- [ ] **Step 5: Test** — assert 200 for public + private profiles; assert content-type header.
- [ ] **Step 6: Commit**

```bash
git add app/og/year/ app/og/month/ lib/recaps/og/card.tsx tests/unit/recaps/og.test.tsx
git commit -m "feat(recaps): T15 OG endpoints — yearly + monthly summary + per-scene"
```

---

## Task 16: Monthly route + page

**Goal:** `/u/[username]/month/[yyyymm]/page.tsx` mirroring the yearly route — different cache table + mode.

**Files:**
- Create: `app/(app)/u/[username]/month/[yyyymm]/page.tsx`
- Create: `app/(app)/u/[username]/month/[yyyymm]/loading.tsx`
- Modify: `lib/recaps/cache-or-build.ts` (add `cacheOrBuildMonthly`)
- Create: `tests/unit/recaps/cache-or-build-monthly.test.ts`

**Acceptance Criteria:**
- [ ] `yyyymm` parsing rejects invalid input (e.g., "202613") → 404
- [ ] Page calls `cacheOrBuildMonthly({userId, year, monthIndex})` which targets `monthly_recaps` table
- [ ] All other behavior mirrors yearly (sparse-data state, captions, OG meta with `?scene` searchParam)

**Verify:** `pnpm vitest run tests/unit/recaps/cache-or-build-monthly.test.ts && pnpm tsc --noEmit && pnpm build`

**Steps:**

- [ ] **Step 1: Extract `cacheOrBuildMonthly`** — basically `cacheOrBuildYearly` with table swap + `monthWindow` + mode flag.
- [ ] **Step 2: Implement monthly page** — copy yearly page, swap aggregator + mode + OG path family.
- [ ] **Step 3: Test** — invalid yyyymm rejects; happy path.
- [ ] **Step 4: Verify** — `pnpm build`.
- [ ] **Step 5: Commit**

```bash
git add app/(app)/u/[username]/month/ lib/recaps/cache-or-build.ts tests/unit/recaps/cache-or-build-monthly.test.ts
git commit -m "feat(recaps): T16 monthly route + cacheOrBuildMonthly"
```

---

## Task 17: Email template (RecapEmail)

**Goal:** React Email template — yearly + monthly variants with hero CTA + unsubscribe footer.

**Files:**
- Create: `lib/email/recap-template.tsx`
- Create: `tests/unit/recaps/recap-email.test.ts`

**Acceptance Criteria:**
- [ ] `renderRecapHtml({payload, mode, recapUrl, unsubscribeUrl})` returns string
- [ ] `renderRecapPlainText({payload, mode, recapUrl, unsubscribeUrl})` returns string
- [ ] Yearly variant subject helper: `recapSubject({mode, year, month?})`
- [ ] Hero section shows top game cover (when present), genre + count, big CTA "See your year →"
- [ ] Monthly variant has smaller hero, same shape
- [ ] Both include unsubscribe footer using existing `lib/email/unsubscribe-token.ts` JWT signer (reuse `signUnsubscribeToken`)

**Verify:** `pnpm vitest run tests/unit/recaps/recap-email.test.ts`

**Steps:**

- [ ] **Step 1: Implement** — mirror `lib/email/digest-template.tsx` shape (React Email components: `<Html>`, `<Body>`, `<Container>`, `<Heading>`, `<Button>`, etc.).
- [ ] **Step 2: Test snapshot or output structure** — assert subject contains `recapSubject({mode: "yearly", year: 2026})` produces `"Your 2026 in games — preview is ready"` etc.
- [ ] **Step 3: Commit**

```bash
git add lib/email/recap-template.tsx tests/unit/recaps/recap-email.test.ts
git commit -m "feat(recaps): T17 recap email template (yearly + monthly variants)"
```

---

## Task 18: Recap-email worker

**Goal:** Header-secret gated batch worker that pre-warms rows + sends emails. Mirrors Phase 5 digest worker.

**Files:**
- Create: `app/api/internal/recap-email/run/route.ts`
- Create: `tests/unit/recaps/recap-email-worker.test.ts`

**Acceptance Criteria:**
- [ ] 404 for non-matching `X-Cron-Secret` header (no 401 — same shape as Phase 5)
- [ ] Body schema `{ mode: 'annual_preview' | 'annual_locked' | 'monthly' }`
- [ ] Cohort filter SQL matches schedule rules (see spec § Email pre-warm cron flow)
- [ ] Worker pool BATCH_CONCURRENCY=5 via `Promise.all` over queue draining
- [ ] Per-row try/catch — single failure doesn't poison batch
- [ ] Dedupe via `profiles.last_recap_sent_at`
- [ ] Resend error checked explicitly (`sendResult.error`); not just thrown
- [ ] On `annual_locked` mode: row's `locked_at` set to `now()`
- [ ] Returns `{sent, failed, candidates, skipped}` JSON

**Verify:** `pnpm vitest run tests/unit/recaps/recap-email-worker.test.ts && pnpm tsc --noEmit`

**Steps:**

- [ ] **Step 1: Implement** — start from `app/api/internal/digest/run/route.ts` (Phase 5 precedent). Swap: cohort query (per-mode), Worker action (calls `cacheOrBuildYearly` or `cacheOrBuildMonthly`, then renders + sends recap email).

- [ ] **Step 2: Test** — mock Resend + db.execute; assert: 404 on missing secret, dedupe respect, error path. Use the same testing patterns as Phase 5 digest's tests.

- [ ] **Step 3: Verify**

```
pnpm vitest run tests/unit/recaps/recap-email-worker.test.ts
pnpm tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add app/api/internal/recap-email/run/ tests/unit/recaps/recap-email-worker.test.ts
git commit -m "feat(recaps): T18 recap-email cron worker"
```

---

## Task 19: pg_cron migration (3 jobs + Jan 5 locking)

**Goal:** Supabase migration with three cron jobs (annual_preview, annual_locked, monthly) plus a fourth standalone Jan 5 locking job.

**Files:**
- Create: `supabase/migrations/20260514_0001_phase6_recap_cron.sql`

**Acceptance Criteria:**
- [ ] Vault secret `phase6_cron_secret` creation via `vault.create_secret` (skip-if-exists; reference Phase 5 precedent)
- [ ] Three cron jobs pointing to `/api/internal/recap-email/run` with `X-Cron-Secret` header and the appropriate `mode` JSON body
- [ ] Fourth cron `phase6-yir-lock` runs `0 12 5 1 *` with SQL: `UPDATE year_in_reviews SET locked_at = now() WHERE year = (EXTRACT(YEAR FROM now())::int - 1) AND locked_at IS NULL`
- [ ] Migration is reversible enough to test locally (uses `vault.create_secret` not direct INSERT; cron jobs unscheduled cleanly via `cron.unschedule()` if needed)

**Verify:** Migration apply via `mcp__supabase__apply_migration` against test branch (operator-gated; not auto-runnable in tests)

**Steps:**

- [ ] **Step 1: Write migration** — model off `supabase/migrations/20260513_0001_phase5_digest_cron.sql`.

Skeleton:
```sql
-- Phase 6 — Recap email cron + Jan 5 locking
SELECT vault.create_secret(
  encode(gen_random_bytes(32), 'hex'),
  'phase6_cron_secret',
  'X-Cron-Secret header for /api/internal/recap-email/run'
) WHERE NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'phase6_cron_secret');

SELECT cron.schedule(
  'phase6-recap-annual-preview',
  '0 12 1 12 *',
  $$SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'app_base_url') || '/api/internal/recap-email/run',
      headers := jsonb_build_object('Content-Type', 'application/json', 'X-Cron-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'phase6_cron_secret')),
      body := '{"mode":"annual_preview"}'::jsonb
    );$$
);
-- ... annual_locked + monthly cron entries
-- ... Jan 5 lock cron (pure SQL, no HTTP)
```

**Note:** `app_base_url` Vault secret — verify if it already exists (Phase 5 may have introduced; if not, the migration must create it too, populated with `https://ploxa.vercel.app`).

- [ ] **Step 2: Commit migration file (not yet apply)**

```bash
git add supabase/migrations/20260514_0001_phase6_recap_cron.sql
git commit -m "feat(recaps): T19 pg_cron migration — 3 email jobs + Jan 5 lock"
```

(Operator applies via `mcp__supabase__apply_migration` in T24 close-out.)

---

## Task 20: Refresh button + server action

**Goal:** "Refresh my year" affordance on the YIR page for current-year only; rate-limited 1/day per user.

**Files:**
- Create: `lib/recaps/refresh-action.ts`
- Create: `components/recaps/RefreshButton.tsx`
- Modify: `components/recaps/Pageant.tsx` (render the button on closing scene for current-year)
- Create: `tests/unit/recaps/refresh-action.test.ts`

**Acceptance Criteria:**
- [ ] Server action `refreshYearly({year})` — verifies session, asserts `year === current year` and not locked, applies rate limit (1/day via `enforceRateLimit({scope: 'recap_refresh', identifier: userId, limit: 1, windowSeconds: 86400})`), re-runs cache-or-build with cache bust.
- [ ] Button shown only on current-year closing scene; hidden when `locked_at IS NOT NULL`
- [ ] Optimistic loading state during refresh; toast on success
- [ ] Rate-limit error surfaces user-readable message

**Verify:** `pnpm vitest run tests/unit/recaps/refresh-action.test.ts && pnpm tsc --noEmit && pnpm build`

**Steps:**

- [ ] **Step 1: Implement server action**
- [ ] **Step 2: Implement button component** with `useFormStatus` for loading
- [ ] **Step 3: Wire into Pageant closing scene** conditionally
- [ ] **Step 4: Test** — rate limit hit, locked-year reject, happy path
- [ ] **Step 5: Commit**

```bash
git add lib/recaps/refresh-action.ts components/recaps/RefreshButton.tsx components/recaps/Pageant.tsx tests/unit/recaps/refresh-action.test.ts
git commit -m "feat(recaps): T20 refresh button + rate-limited server action"
```

---

## Task 21: verify-phase-6.ts script

**Goal:** 10-group automated gate matching the spec's verify table.

**Files:**
- Create: `scripts/verify-phase-6.ts`

**Acceptance Criteria:**
- [ ] Implements G1-G10 from spec verify gate (see spec § Verify gate)
- [ ] Same shape as `scripts/verify-phase-5.ts` (Phase 5 precedent — `runGroup()` wrapper, ~2s runtime)
- [ ] All 10 groups pass against a healthy state
- [ ] Script is executable via `pnpm tsx --conditions react-server --env-file=.env scripts/verify-phase-6.ts`

**Verify:** `pnpm tsx --conditions react-server --env-file=.env scripts/verify-phase-6.ts`

**Steps:**

- [ ] **Step 1: Implement** — copy `scripts/verify-phase-5.ts` as scaffold; rewrite each group to assert the Phase 6 criteria. Use direct DB queries, mock-free.
- [ ] **Step 2: Run + iterate** until all 10 groups pass.
- [ ] **Step 3: Commit**

```bash
git add scripts/verify-phase-6.ts
git commit -m "feat(recaps): T21 verify-phase-6 — 10 automated gate checks"
```

---

## Task 22: Playwright e2e

**Goal:** Smoke spec — first-view aggregator + cache hit + private-profile 404 + sparse-data state.

**Files:**
- Create: `tests/e2e/phase6-pageant.spec.ts`

**Acceptance Criteria:**
- [ ] Test: Visit `/u/{pwTestUser}/year/2026` cold → pageant renders (heading "Welcome to your year") within 15s
- [ ] Test: Visit again → response <500ms (cache hit)
- [ ] Test: Set test user profile private → `/year/2026` returns 404 to other test user; same user can still access their own
- [ ] Test: Sparse user (5 logs) → `<SparseDataState>` content visible
- [ ] Test: Closing scene share button copies URL to clipboard
- [ ] Uses existing `pw_test_` user prefix pattern from Phase 5

**Verify:** `pnpm playwright test tests/e2e/phase6-pageant.spec.ts`

**Steps:**

- [ ] **Step 1: Implement spec** — reuse fixtures from existing Phase 5 e2e specs (e.g., `tests/e2e/follow-and-feed.spec.ts` login pattern).
- [ ] **Step 2: Run** — iterate until green.
- [ ] **Step 3: Commit**

```bash
git add tests/e2e/phase6-pageant.spec.ts
git commit -m "test(recaps): T22 Playwright smoke — pageant + cache + private + sparse"
```

---

## Task 23: Operator close-out doc

**Goal:** Document the steps the operator must take to bring Phase 6 live in prod. Mirrors Phase 5 close-out.

**Files:**
- Create: `docs/superpowers/operator-close-out/2026-05-14-phase6.md`

**Acceptance Criteria:**
- [ ] Step-by-step ordered list covering: apply migrations 0016 + 0017, apply Phase 6 cron migration, verify Vault `phase6_cron_secret` populated, set `RECAP_CRON_SECRET` env in Vercel, set `RESEND_RECAP_FROM_ADDRESS` env (optional — defaults to `recap@ploxa.vercel.app`), deploy, smoke-test annual_preview cron via curl, verify M1-M5 manual gates
- [ ] Includes the exact `curl` command for triggering cron manually with header secret
- [ ] References `feedback_*` memories where relevant (e.g., `feedback_pnpm_build_canonical_gate.md`)
- [ ] No PII / no real secrets in the doc (placeholders only)

**Verify:** Manual read-through — operator can execute without ambiguity.

**Steps:**

- [ ] **Step 1: Write doc** modeled on the Phase 5 close-out memory section.
- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/operator-close-out/2026-05-14-phase6.md
git commit -m "docs(recaps): T23 operator close-out doc for Phase 6"
```

---

## Final integration check

After all 23 tasks land, run the full gate suite:

```
pnpm tsc --noEmit
pnpm lint
pnpm vitest run          # expect 0 failures; ~250+ unit tests including new ~30 recap tests
pnpm playwright test     # expect 0 failures
pnpm verify-phase-6      # 10/10 green
pnpm verify-phase-{3,4,5} # existing gates still green
pnpm build               # catches Next.js 16 server-action validation
pnpm db:check            # snapshot chain valid
```

If all green: tag `phase-6-complete`, push to main, write `phase_6_complete.md` memory file. Operator close-out runs separately.

---

## Risks + open implementation questions

1. **`lib/ai/router.ts` API shape may differ from T6 assumptions.** Verify `generateObject` import + signature before T6. Adjust accordingly. If router exposes a different surface (e.g., `generate({schema, system, prompt})`), align T6 + prompt builders.
2. **`aiFeatureEnum` may not have `"year_in_review"` value.** Verify before T6; if missing, add a one-line ALTER TYPE in 0016 (or use closest existing value with documented rationale).
3. **Profile helper imports** (`getProfileByUsername`, `canViewProfile`) — verify actual names in current codebase before T11. Phase 5 + audit may have renamed.
4. **`app_base_url` Vault secret** may not exist if Phase 5 wired the URL differently. Verify in T19; add to migration if needed.
5. **`generateObject` retry path uses `result.usage?.inputTokens`** — if the router uses different telemetry property names, adjust in T6.
6. **CSS for full-viewport vertical 9:16 with phone-shape desktop backdrop** is finicky. Reference the existing taste-page layout for the pattern; if no precedent, allocate buffer time in T12.
7. **Reduced-motion handling** in T12-T14 — Framer Motion's `useReducedMotion()` hook is the canonical entrypoint; verify all motion components respect it before T22 e2e.
8. **Database migration apply order:** 0016 must apply before 0017 (enum extension references the existing `email_digest_cadence` type). pg_cron migration applies after 0016+0017.
9. **Existing `share_image_url` column on `year_in_reviews`** is unused but not dropped. If later phases want to repurpose, address in a separate cleanup task — not Phase 6.
