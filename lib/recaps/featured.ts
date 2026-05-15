"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { isAdmin } from "@/lib/social/moderation/admin";
import { NotAdminError } from "@/lib/recaps/featured-read";

/**
 * featured.ts — Phase 6 T7 admin-only server actions for managing the
 * featured-list pin shown on /discover.
 *
 * Why `NotAdminError` lives in `featured-read.ts` instead of inline here:
 * Next.js 16 validates that every export of a `"use server"` file is an
 * async function (see `feedback_pnpm_build_canonical_gate.md`). A class
 * export would fail the build. Consumers that need to `instanceof`-check
 * the thrown error import the class directly from
 * `@/lib/recaps/featured-read`. This file imports it locally so it can
 * throw an instance.
 *
 * The `surface` column is currently hardcoded to "discover_landing" in
 * both pin and unpin actions. The schema keeps the column open for
 * future surfaces; expand the call sites when those land.
 */

const SURFACE = "discover_landing" as const;

async function assertAdminSession(): Promise<string> {
  const user = await getCachedUser();
  if (!user || !isAdmin(user.id)) throw new NotAdminError();
  return user.id;
}

/**
 * Pin a list as the featured surface item.
 *
 * Flow:
 *   1. Admin gate (throws NotAdminError on failure).
 *   2. Validate the list exists and is_public — throws plain Error on miss
 *      so the admin UI can surface a friendly message.
 *   3. In a single transaction: close any currently-active pin on this
 *      surface (UPDATE … pinned_until = now()), then INSERT the new pin.
 *   4. Revalidate /discover and /admin/featured so cached pages flip
 *      immediately.
 */
export async function pinFeaturedList(input: {
  listId: string;
  pinnedUntil?: Date | null;
}): Promise<void> {
  const adminId = await assertAdminSession();

  // Validate list exists + is public. Schema column is `is_public`
  // (boolean), NOT `visibility` — plan was wrong on the column name.
  const listRows = (await db.execute<{ id: string; is_public: boolean }>(sql`
    SELECT id, is_public FROM lists WHERE id = ${input.listId} LIMIT 1
  `)) as unknown as Array<{ id: string; is_public: boolean }>;
  if (!listRows[0]) throw new Error("List not found");
  if (!listRows[0].is_public) throw new Error("List must be public to pin");

  await db.transaction(async (tx) => {
    // Close any existing active pin on this surface. The partial unique
    // index in the schema (one active pin per surface where pinned_until
    // is null or in the future) makes this required before insert.
    await tx.execute(sql`
      UPDATE featured_lists SET pinned_until = now()
      WHERE surface = ${SURFACE}
        AND (pinned_until IS NULL OR pinned_until > now())
    `);
    await tx.insert(schema.featuredLists).values({
      listId: input.listId,
      surface: SURFACE,
      pinnedUntil: input.pinnedUntil ?? null,
      pinnedBy: adminId,
    });
  });

  revalidatePath("/discover");
  revalidatePath("/admin/featured");
}

/**
 * Remove the current pin (if any) by setting pinned_until = now() on every
 * row whose window is still open. No-op when nothing is pinned.
 */
export async function unpinFeaturedList(): Promise<void> {
  await assertAdminSession();
  await db.execute(sql`
    UPDATE featured_lists SET pinned_until = now()
    WHERE surface = ${SURFACE}
      AND (pinned_until IS NULL OR pinned_until > now())
  `);
  revalidatePath("/discover");
  revalidatePath("/admin/featured");
}
