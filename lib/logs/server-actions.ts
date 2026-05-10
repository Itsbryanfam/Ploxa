"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getGameDetail } from "@/lib/games/server-actions";
import { LOG_STATUSES } from "@/lib/db/schema-types";

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

  // Check for existing non-replay log on this game.
  const existing = await db.query.logs.findFirst({
    where: and(
      eq(schema.logs.userId, user.id),
      eq(schema.logs.gameId, game.id),
      eq(schema.logs.isReplay, false),
    ),
  });
  if (existing) {
    return { ok: false, error: "Already logged. Edit the existing log instead." };
  }

  // Insert. Wrap in try/catch so the (userId, gameId, isReplay) unique-constraint
  // race (between findFirst above and this insert) maps to the same friendly
  // "Already logged" message instead of bubbling as an unhandled throw.
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
