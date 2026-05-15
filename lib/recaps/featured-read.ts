import "server-only";

import { cache } from "react";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * featured-read.ts — Phase 6 T7 read surface + error class for the
 * featured-list (`/discover` pin) feature.
 *
 * Split rationale: `featured.ts` is a `"use server"` file, which Next.js 16
 * validates at build time — only async functions may be exported. The
 * `NotAdminError` class export and the `cache()`-wrapped read helper both
 * fail that gate, so they live here. The server-action file re-exports
 * `NotAdminError` from this module so callers can `instanceof`-check the
 * thrown error without knowing the split. See
 * `feedback_pnpm_build_canonical_gate.md` and the `lib/profile/redact.ts`
 * precedent.
 */

export class NotAdminError extends Error {
  constructor() {
    super("Admin only");
    this.name = "NotAdminError";
  }
}

export interface FeaturedListSummary {
  listId: string;
  listTitle: string;
  listSlug: string;
  authorUsername: string;
  itemCount: number;
  coverUrls: string[];
}

/**
 * Returns the active featured-list pin for a given surface, or null when
 * no row is currently pinned. Wrapped in React's `cache()` so multiple
 * Server Components in the same request share one round-trip.
 *
 * Joins:
 *   featured_lists → lists (title / slug / user_id / is_public)
 *                  → profiles (username)
 *   subquery → list_items + games for `coverUrls` (up to 4) and `itemCount`.
 *
 * Schema note: the catalog column is `games.cover_url`, NOT
 * `background_image` — the latter is RAWG's API field, not the local
 * column name. Same correction applied in T3.
 *
 * `surface` is currently always "discover_landing" — the plan keeps the
 * column open for future surfaces (e.g. landing-page hero) but only one
 * is wired up. Passing the value through as a parameter so future surfaces
 * can be added without changing this signature.
 */
export const getActiveFeaturedList = cache(
  async (surface: string): Promise<FeaturedListSummary | null> => {
    const rows = (await db.execute<{
      list_id: string;
      title: string;
      slug: string;
      username: string;
      item_count: string;
      cover_urls: string[];
    }>(sql`
      SELECT
        l.id AS list_id,
        l.title,
        l.slug,
        p.username,
        (SELECT COUNT(*)::text FROM list_items WHERE list_id = l.id) AS item_count,
        ARRAY(
          SELECT g.cover_url FROM list_items li
          JOIN games g ON g.id = li.game_id
          WHERE li.list_id = l.id AND g.cover_url IS NOT NULL
          ORDER BY li.position ASC
          LIMIT 4
        ) AS cover_urls
      FROM featured_lists fl
      JOIN lists l ON l.id = fl.list_id
      JOIN profiles p ON p.user_id = l.user_id
      WHERE fl.surface = ${surface}
        AND (fl.pinned_until IS NULL OR fl.pinned_until > now())
      ORDER BY fl.pinned_at DESC
      LIMIT 1
    `)) as unknown as Array<{
      list_id: string;
      title: string;
      slug: string;
      username: string;
      item_count: string;
      cover_urls: string[];
    }>;
    if (!rows[0]) return null;
    return {
      listId: rows[0].list_id,
      listTitle: rows[0].title,
      listSlug: rows[0].slug,
      authorUsername: rows[0].username,
      itemCount: Number.parseInt(rows[0].item_count, 10),
      coverUrls: rows[0].cover_urls ?? [],
    };
  },
);
