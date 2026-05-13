import "server-only";
import { and, eq, like } from "drizzle-orm";

import { db, schema } from "@/lib/db";

const SLUG_MAX_LENGTH = 60;

/**
 * Title → URL slug. Lowercases, collapses non-alphanumeric runs into a
 * single dash, trims leading/trailing dashes, caps at 60 chars. Returns
 * 'untitled' for inputs that produce an empty slug (e.g. emoji-only).
 *
 * Pure function — safe to call from client and server. The DB-bound
 * dedup logic lives in uniqueSlugForUser below.
 */
export function slugifyTitle(title: string): string {
  const normalized = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH);
  return normalized.length === 0 ? "untitled" : normalized;
}

/**
 * Ensure (userId, slug) is unique by appending -2, -3, ... if the base
 * slug collides. Bounded by the lists_user_slug_uniq unique index in
 * migration 0008 — but the index would throw on INSERT, not auto-bump,
 * so we pre-check.
 *
 * Race: between this read and the caller's INSERT, another row could land.
 * Postgres would then throw on the unique violation; callers don't retry.
 * For Phase 5 the race window is acceptable (rare for a single user
 * to create two lists with the same title in the same millisecond).
 */
export async function uniqueSlugForUser(
  userId: string,
  baseSlug: string,
): Promise<string> {
  // Pull all slugs starting with the base; precise match happens in JS.
  const existing = await db
    .select({ slug: schema.lists.slug })
    .from(schema.lists)
    .where(
      and(
        eq(schema.lists.userId, userId),
        like(schema.lists.slug, `${baseSlug}%`),
      ),
    );

  const slugs = new Set(existing.map((r) => r.slug));
  if (!slugs.has(baseSlug)) return baseSlug;

  for (let i = 2; i < 1000; i++) {
    const candidate = `${baseSlug}-${i}`;
    if (!slugs.has(candidate)) return candidate;
  }
  // Pathological fallback — should never hit with sane usage.
  return `${baseSlug}-${Math.random().toString(36).slice(2, 8)}`;
}
