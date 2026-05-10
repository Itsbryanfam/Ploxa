// Pure helpers around the `LibraryItem` shape. Kept in its own module (no
// `"use server"` directive, no DB imports) so it can be imported from both
// server actions and client components — like `schema-types.ts`.
import type { LogStatus } from "@/lib/db/schema-types";

export interface LibraryItem {
  logId: string;
  status: LogStatus;
  rating: number | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  hoursPlayed: number | null;
  platformPlayedOn: string | null;
  isReplay: boolean;
  isPrivate: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  game: {
    id: number;
    slug: string;
    title: string;
    coverUrl: string | null;
    released: Date | null;
    genres: string[];
    platforms: string[];
  };
}

/**
 * Convert a Drizzle `logs` row + a `games` row into the `LibraryItem` shape
 * used throughout the UI. Single source of truth for:
 *  - the `numeric` → `number` coercion (Drizzle returns numerics as strings),
 *  - the `null` → `[]` fallback for genres / platforms arrays,
 *  - the `id` → `logId` rename.
 *
 * Adding a field to `LibraryItem` requires editing only this function (and
 * the interface above). Call sites stay untouched.
 */
export function mapRowToLibraryItem(
  row: {
    id: string;
    status: LogStatus;
    rating: string | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    hoursPlayed: string | null;
    platformPlayedOn: string | null;
    isReplay: boolean;
    isPrivate: boolean;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  game: {
    id: number;
    slug: string;
    title: string;
    coverUrl: string | null;
    released: Date | null;
    genres: string[] | null;
    platforms: string[] | null;
  },
): LibraryItem {
  return {
    logId: row.id,
    status: row.status,
    rating: row.rating ? Number(row.rating) : null,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    hoursPlayed: row.hoursPlayed ? Number(row.hoursPlayed) : null,
    platformPlayedOn: row.platformPlayedOn,
    isReplay: row.isReplay,
    isPrivate: row.isPrivate,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    game: {
      id: game.id,
      slug: game.slug,
      title: game.title,
      coverUrl: game.coverUrl,
      released: game.released,
      genres: game.genres ?? [],
      platforms: game.platforms ?? [],
    },
  };
}
