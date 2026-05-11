import "server-only";
import { schema } from "@/lib/db";

/**
 * The Drizzle `db.select(...)` projection used to drive `mapRowToLibraryItem`.
 * Shared by `lib/logs/server-actions.ts:getUserLibrary` and the inline query
 * in `app/(app)/u/[username]/page.tsx` so the two queries can't drift —
 * adding a field to `LibraryItem` is now a single-projection change instead
 * of two parallel edits.
 */
export const LOG_GAME_SELECT = {
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
} as const;
