"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { getGameDetail } from "@/lib/games/server-actions";
import { LOG_STATUSES, type LogStatus } from "@/lib/db/schema-types";
import { triggerOnLogWrite } from "@/lib/taste/triggers";
import { mapRowToLibraryItem, type LibraryItem } from "./library-item";
import { LOG_GAME_SELECT } from "./select";

// Re-exported so existing `import type { LibraryItem, UserStats } from "@/lib/logs/server-actions"`
// callers keep working. Type-only re-exports are erased at compile time, so this is
// allowed inside a `"use server"` module.
export type { LibraryItem, UserStats } from "./library-item";

const createLogInput = z.object({
  rawgId: z.number().int().positive(),
  status: z.enum(LOG_STATUSES as [typeof LOG_STATUSES[number], ...typeof LOG_STATUSES[number][]]),
  rating: z
    .number()
    .min(0)
    .max(10)
    .refine((v) => v * 2 === Math.round(v * 2), "Rating must be in 0.5 steps")
    .optional(),
  note: z.string().max(200).optional(),
});

export type CreateLogResult =
  | { ok: true; logId: string; gameSlug: string }
  | { ok: false; error: string };

// Postgres unique-violation SQLSTATE — used to detect duplicate-log races.
const PG_UNIQUE_VIOLATION = "23505";

export async function createLog(input: unknown): Promise<CreateLogResult> {
  const parsed = createLogInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { rawgId, status, rating, note } = parsed.data;

  // Auth check
  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Not signed in" };

  // Ensure the game exists in our DB (write-through from RAWG if missing).
  // getGameDetail can throw on a RAWG 404 / network blip / Zod parse mismatch —
  // surface as a recoverable error envelope rather than letting it hit the
  // Next.js error boundary.
  let game: Awaited<ReturnType<typeof getGameDetail>>;
  try {
    game = await getGameDetail(rawgId);
  } catch {
    return { ok: false, error: "Couldn't load that game. Please try again." };
  }

  // Insert. The (userId, gameId, isReplay) unique index enforces dedup.
  // SQLSTATE 23505 (unique violation) maps to the friendly "Already logged"
  // message; no pre-check SELECT is needed.
  let inserted: { id: string } | undefined;
  try {
    [inserted] = await db
      .insert(schema.logs)
      .values({
        userId: user.id,
        gameId: game.id,
        status,
        // rating > 0 already short-circuits when rating is undefined (undefined > 0 is false);
        // wrapping in `rating != null` makes the intent explicit.
        rating: rating != null && rating > 0 ? String(rating) : null,
        notes: note?.trim() || null,
      })
      .returning({ id: schema.logs.id });
  } catch (err) {
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
      return { ok: false, error: "Already logged. Edit the existing log instead." };
    }
    throw err;
  }
  if (!inserted) {
    return { ok: false, error: "Insert failed. Please try again." };
  }

  revalidatePath("/", "layout");
  await triggerOnLogWrite(user.id);
  return { ok: true, logId: inserted.id, gameSlug: game.slug };
}

/**
 * Lower-level idempotent log writer used by paths that already have a
 * resolved `gameId` (the rec-feedback actions in `lib/recs/server-actions.ts`)
 * — they don't need `createLog`'s RAWG round-trip, friendly error envelope, or
 * Zod-validated `formData` shape. Caller is responsible for auth + owner checks
 * before invoking. Always fires `triggerOnLogWrite` so the taste pipeline picks
 * up new logs regardless of which code path inserted them.
 *
 * Two upsert paths under the `(userId, gameId, isReplay=false)` unique index:
 *   - `status: "playing"` — overwrite existing row's status to "playing" and
 *     overwrite `platforms` when supplied. Touches `updatedAt`. The realistic
 *     case is backlog → playing; reaching this path with an existing
 *     "completed" or "dropped" row would technically downgrade, but T14's
 *     only `playing` caller is `playRec`, which only ever fires from a
 *     recommendation, and `candidatePool` already excludes games the user
 *     has logged. So the upgrade-only invariant holds in practice.
 *   - `status: "backlog"` (and other future statuses) — DO NOTHING on conflict.
 *     "User already has this in their library" is the steady state; we don't
 *     downgrade or churn `updatedAt` just because the rec system wanted to
 *     bump it to backlog.
 *
 * No return value — current callers only need the side effect.
 */
export async function ensureLog(input: {
  userId: string;
  gameId: number;
  status: LogStatus;
  platforms?: string[];
}): Promise<void> {
  if (input.status === "playing") {
    await db
      .insert(schema.logs)
      .values({
        userId: input.userId,
        gameId: input.gameId,
        status: "playing",
        platforms: input.platforms,
      })
      .onConflictDoUpdate({
        target: [schema.logs.userId, schema.logs.gameId, schema.logs.isReplay],
        set: {
          status: "playing",
          // Preserve existing platforms when the caller didn't supply a new
          // array. `?? schema.logs.platforms` resolves to the column itself;
          // Drizzle emits `SET "platforms" = "logs"."platforms"` (a no-op in
          // Postgres ON CONFLICT DO UPDATE — keeps the row's prior value).
          platforms: input.platforms ?? schema.logs.platforms,
          updatedAt: new Date(),
        },
      });
  } else {
    await db
      .insert(schema.logs)
      .values({
        userId: input.userId,
        gameId: input.gameId,
        status: input.status,
        platforms: input.platforms,
      })
      .onConflictDoNothing({
        target: [schema.logs.userId, schema.logs.gameId, schema.logs.isReplay],
      });
  }
  await triggerOnLogWrite(input.userId);
}

export type SortKey = "rating-desc" | "rating-asc" | "recent" | "title-asc" | "released-desc";

export interface GetLibraryArgs {
  status?: LogStatus | "all";
  sort?: SortKey;
}

export async function getUserLibrary(args: GetLibraryArgs = {}): Promise<LibraryItem[]> {
  const user = await getCachedUser();
  if (!user) return [];

  const orderBy = (() => {
    switch (args.sort) {
      case "rating-asc":
        return asc(schema.logs.rating);
      case "rating-desc":
        return desc(schema.logs.rating);
      case "title-asc":
        return asc(schema.games.title);
      case "released-desc":
        return desc(schema.games.released);
      case "recent":
      default:
        return desc(schema.logs.updatedAt);
    }
  })();

  const rows = await db
    .select(LOG_GAME_SELECT)
    .from(schema.logs)
    .innerJoin(schema.games, eq(schema.logs.gameId, schema.games.id))
    .where(
      and(
        eq(schema.logs.userId, user.id),
        args.status && args.status !== "all" ? eq(schema.logs.status, args.status) : undefined,
      ),
    )
    .orderBy(orderBy);

  const items = rows.map((r) => mapRowToLibraryItem(r.log, r.game));

  // Only attach existingReviewId for *published* reviews. Unpublished drafts
  // (orphans from a failed prior interview) should NOT make the log card show
  // "Edit review" — the user needs to restart the interview; generateDraft
  // will overwrite the stale draft on the way through.
  const userReviews = await db.query.reviews.findMany({
    where: and(
      eq(schema.reviews.userId, user.id),
      isNotNull(schema.reviews.publishedAt),
    ),
    columns: { id: true, gameId: true },
  });
  const reviewByGameId = new Map(userReviews.map((r) => [r.gameId, r.id]));
  return items.map((item) => ({
    ...item,
    existingReviewId: reviewByGameId.get(item.game.id),
  }));
}

/**
 * Fetch the current user's log for a given game, or `null` if none.
 * Used by `/games/[slug]` and its intercepted-modal counterpart — both pages
 * need the same shape of data, so this helper keeps them from drifting.
 */
export async function getUserLogForGame(
  gameId: number,
  game: {
    id: number; slug: string; title: string; coverUrl: string | null;
    posterUrl: string | null;
    released: Date | null; genres: string[] | null; platforms: string[] | null;
  },
): Promise<LibraryItem | null> {
  const user = await getCachedUser();
  if (!user) return null;
  const row = await db.query.logs.findFirst({
    where: and(eq(schema.logs.userId, user.id), eq(schema.logs.gameId, gameId)),
  });
  return row ? mapRowToLibraryItem(row, game) : null;
}

/**
 * Combined fetch for both `/games/[slug]` and its intercepted-modal
 * counterpart: returns the user's log AND their published review for a
 * single game in one DB round-trip.
 *
 * Anchored on the `games` row (always 1 row, since the caller already
 * resolved the game) with two LEFT JOINs so:
 *   - log === null   if the user hasn't logged this game
 *   - ownReview === null if the user hasn't published a review for it
 *
 * The orphan-review case (review without log) is preserved: `reviews.logId`
 * is `onDelete: "set null"`, so deleting a log keeps its review row alive.
 * Anchoring on `games` (not `logs`) means we still surface those.
 *
 * Replaces what used to be two parallel queries — `getUserLogForGame` + a
 * direct `db.query.reviews.findFirst` — on every game detail page render.
 */
export interface GameDetailUserState {
  log: LibraryItem | null;
  ownReview: { id: string; body: string; rating: number | null } | null;
}

export async function getGameDetailUserState(
  gameId: number,
  game: {
    id: number; slug: string; title: string; coverUrl: string | null;
    posterUrl: string | null;
    released: Date | null; genres: string[] | null; platforms: string[] | null;
  },
): Promise<GameDetailUserState> {
  const user = await getCachedUser();
  if (!user) return { log: null, ownReview: null };

  const rows = await db
    .select({
      log: schema.logs,
      review: {
        id: schema.reviews.id,
        body: schema.reviews.body,
        rating: schema.reviews.rating,
      },
    })
    .from(schema.games)
    .leftJoin(
      schema.logs,
      and(
        eq(schema.logs.gameId, schema.games.id),
        eq(schema.logs.userId, user.id),
      ),
    )
    .leftJoin(
      schema.reviews,
      and(
        eq(schema.reviews.gameId, schema.games.id),
        eq(schema.reviews.userId, user.id),
        isNotNull(schema.reviews.publishedAt),
      ),
    )
    .where(eq(schema.games.id, gameId))
    .limit(1);

  const row = rows[0];
  if (!row) return { log: null, ownReview: null };

  return {
    log: row.log ? mapRowToLibraryItem(row.log, game) : null,
    ownReview: row.review
      ? {
          id: row.review.id,
          body: row.review.body,
          rating: row.review.rating != null ? Number(row.review.rating) : null,
        }
      : null,
  };
}

const updateStatusInput = z.object({
  logId: z.string().uuid(),
  status: z.enum(LOG_STATUSES as [LogStatus, ...LogStatus[]]),
});

export async function updateLogStatus(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const parsed = updateStatusInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };

  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const result = await db
    .update(schema.logs)
    .set({ status: parsed.data.status, updatedAt: new Date() })
    .where(and(eq(schema.logs.id, parsed.data.logId), eq(schema.logs.userId, user.id)))
    .returning({ id: schema.logs.id });

  if (result.length === 0) return { ok: false, error: "Log not found" };
  revalidatePath("/", "layout");
  await triggerOnLogWrite(user.id);
  return { ok: true };
}

export async function deleteLog(logId: string): Promise<{ ok: boolean; error?: string }> {
  // Reject malformed ids before they reach Postgres — bad UUIDs would otherwise
  // bubble as an unhandled driver throw rather than a friendly envelope.
  if (!z.string().uuid().safeParse(logId).success) {
    return { ok: false, error: "Invalid log ID" };
  }

  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const result = await db
    .delete(schema.logs)
    .where(and(eq(schema.logs.id, logId), eq(schema.logs.userId, user.id)))
    .returning({ id: schema.logs.id });

  if (result.length === 0) return { ok: false, error: "Log not found" };
  revalidatePath("/", "layout");
  await triggerOnLogWrite(user.id);
  return { ok: true };
}

/**
 * Shape of a single activity-timeline event. Derived locally by
 * `computeRecentActivityFromLibrary` (in cockpit-dashboard.tsx) from a
 * pre-loaded library array; no dedicated DB fetch.
 */
export interface ActivityEvent {
  type: "logged";
  logId: string;
  status: LogStatus;
  rating: number | null;
  gameTitle: string;
  gameSlug: string;
  at: Date;
}

const updateLogFullInput = z.object({
  logId: z.string().uuid(),
  status: z.enum(LOG_STATUSES as [LogStatus, ...LogStatus[]]),
  rating: z.number().min(0).max(10).optional().nullable(),
  startedAt: z.string().optional().nullable(), // ISO date string
  finishedAt: z.string().optional().nullable(),
  hoursPlayed: z.number().min(0).max(99999).optional().nullable(),
  platformPlayedOn: z.string().max(64).optional().nullable(),
  isReplay: z.boolean(),
  isPrivate: z.boolean(),
  notes: z.string().max(2000).optional().nullable(),
});

export async function updateLogFull(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const parsed = updateLogFullInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };

  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const d = parsed.data;
  const result = await db
    .update(schema.logs)
    .set({
      status: d.status,
      rating: d.rating != null && d.rating > 0 ? String(d.rating) : null,
      startedAt: d.startedAt ? new Date(d.startedAt) : null,
      finishedAt: d.finishedAt ? new Date(d.finishedAt) : null,
      hoursPlayed: d.hoursPlayed != null ? String(d.hoursPlayed) : null,
      platformPlayedOn: d.platformPlayedOn || null,
      isReplay: d.isReplay,
      isPrivate: d.isPrivate,
      notes: d.notes?.trim() || null,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.logs.id, d.logId), eq(schema.logs.userId, user.id)))
    .returning({ id: schema.logs.id });

  if (result.length === 0) return { ok: false, error: "Log not found" };
  revalidatePath("/", "layout");
  await triggerOnLogWrite(user.id);
  return { ok: true };
}
