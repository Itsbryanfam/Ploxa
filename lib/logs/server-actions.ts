"use server";

import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getGameDetail } from "@/lib/games/server-actions";
import { LOG_STATUSES, type LogStatus } from "@/lib/db/schema-types";
import { mapRowToLibraryItem, type LibraryItem } from "./library-item";

// Re-exported so existing `import type { LibraryItem } from "@/lib/logs/server-actions"`
// callers keep working. Type-only re-exports are erased at compile time, so this is
// allowed inside a `"use server"` module.
export type { LibraryItem } from "./library-item";

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
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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

  return { ok: true, logId: inserted.id, gameSlug: game.slug };
}

export type SortKey = "rating-desc" | "rating-asc" | "recent" | "title-asc" | "released-desc";

export interface GetLibraryArgs {
  status?: LogStatus | "all";
  sort?: SortKey;
}

export async function getUserLibrary(args: GetLibraryArgs = {}): Promise<LibraryItem[]> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
    .select({
      log: {
        id: schema.logs.id,
        status: schema.logs.status,
        rating: schema.logs.rating,
        startedAt: schema.logs.startedAt,
        finishedAt: schema.logs.finishedAt,
        hoursPlayed: schema.logs.hoursPlayed,
        platformPlayedOn: schema.logs.platformPlayedOn,
        isReplay: schema.logs.isReplay,
        isPrivate: schema.logs.isPrivate,
        notes: schema.logs.notes,
        createdAt: schema.logs.createdAt,
        updatedAt: schema.logs.updatedAt,
      },
      game: {
        id: schema.games.id,
        slug: schema.games.slug,
        title: schema.games.title,
        coverUrl: schema.games.coverUrl,
        released: schema.games.released,
        genres: schema.games.genres,
        platforms: schema.games.platforms,
      },
    })
    .from(schema.logs)
    .innerJoin(schema.games, eq(schema.logs.gameId, schema.games.id))
    .where(
      and(
        eq(schema.logs.userId, user.id),
        args.status && args.status !== "all" ? eq(schema.logs.status, args.status) : undefined,
      ),
    )
    .orderBy(orderBy);

  return rows.map((r) => mapRowToLibraryItem(r.log, r.game));
}

const updateStatusInput = z.object({
  logId: z.string().uuid(),
  status: z.enum(LOG_STATUSES as [LogStatus, ...LogStatus[]]),
});

export async function updateLogStatus(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const parsed = updateStatusInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const result = await db
    .update(schema.logs)
    .set({ status: parsed.data.status, updatedAt: new Date() })
    .where(and(eq(schema.logs.id, parsed.data.logId), eq(schema.logs.userId, user.id)))
    .returning({ id: schema.logs.id });

  if (result.length === 0) return { ok: false, error: "Log not found" };
  return { ok: true };
}

export async function deleteLog(logId: string): Promise<{ ok: boolean; error?: string }> {
  // Reject malformed ids before they reach Postgres — bad UUIDs would otherwise
  // bubble as an unhandled driver throw rather than a friendly envelope.
  if (!z.string().uuid().safeParse(logId).success) {
    return { ok: false, error: "Invalid log ID" };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const result = await db
    .delete(schema.logs)
    .where(and(eq(schema.logs.id, logId), eq(schema.logs.userId, user.id)))
    .returning({ id: schema.logs.id });

  if (result.length === 0) return { ok: false, error: "Log not found" };
  return { ok: true };
}

export interface UserStats {
  total: number;
  byStatus: Record<LogStatus, number>;
  averageRating: number | null;
}

export async function getUserStats(): Promise<UserStats | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const rows = await db
    .select({
      status: schema.logs.status,
      rating: schema.logs.rating,
    })
    .from(schema.logs)
    .where(eq(schema.logs.userId, user.id));

  const byStatus: Record<LogStatus, number> = {
    backlog: 0, playing: 0, completed: 0, dropped: 0, on_hold: 0, wishlist: 0,
  };
  let ratingSum = 0;
  let ratingCount = 0;
  for (const r of rows) {
    byStatus[r.status as LogStatus]++;
    if (r.rating != null) {
      ratingSum += Number(r.rating);
      ratingCount++;
    }
  }

  return {
    total: rows.length,
    byStatus,
    averageRating: ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : null,
  };
}

export interface ActivityEvent {
  type: "logged";
  logId: string;
  status: LogStatus;
  rating: number | null;
  gameTitle: string;
  gameSlug: string;
  at: Date;
}

export async function getRecentActivity(limit = 10): Promise<ActivityEvent[]> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const rows = await db
    .select({
      logId: schema.logs.id,
      status: schema.logs.status,
      rating: schema.logs.rating,
      title: schema.games.title,
      slug: schema.games.slug,
      at: schema.logs.updatedAt,
    })
    .from(schema.logs)
    .innerJoin(schema.games, eq(schema.logs.gameId, schema.games.id))
    .where(eq(schema.logs.userId, user.id))
    .orderBy(desc(schema.logs.updatedAt))
    .limit(limit);

  return rows.map((r) => ({
    type: "logged" as const,
    logId: r.logId,
    status: r.status as LogStatus,
    rating: r.rating ? Number(r.rating) : null,
    gameTitle: r.title,
    gameSlug: r.slug,
    at: r.at,
  }));
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

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
  return { ok: true };
}
