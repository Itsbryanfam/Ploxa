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

/**
 * Result shape used by the `useActionState` form-action wrappers below.
 * Kept as a re-exported async-function return type rather than a class so
 * the Next.js 16 `"use server"` export gate stays green. (Bare type aliases
 * also get rejected — only async functions may be exported from a "use
 * server" file. The wrappers return `Promise<FormActionState>` literally;
 * the alias lives in callers via `Awaited<ReturnType<typeof …>>`.)
 *
 * Why we need wrappers at all: `<form action={serverFn}>` is fire-and-forget
 * in Next.js 16 — thrown errors don't reach the form. To surface
 * "List not found" / "List must be public" / "Admin only" messages in the
 * admin UI we wrap the actions, catch errors, and return them as state via
 * React 19's `useActionState`.
 */

/**
 * Form-action wrapper around `pinFeaturedList` for `useActionState` in the
 * admin Pin form. Returns `{ error: null }` on success; the page revalidates
 * via the underlying action so the rendered "current pin" reflects the new
 * row on the next render pass.
 */
export async function pinFeaturedListFormAction(
  _prevState: { error: string | null },
  formData: FormData,
): Promise<{ error: string | null }> {
  const listIdRaw = formData.get("listId");
  const pinnedUntilRaw = formData.get("pinnedUntil");
  const listId = typeof listIdRaw === "string" ? listIdRaw.trim() : "";
  if (!listId) return { error: "List ID is required" };

  let pinnedUntil: Date | null = null;
  if (typeof pinnedUntilRaw === "string" && pinnedUntilRaw.trim().length > 0) {
    const parsed = new Date(pinnedUntilRaw);
    if (Number.isNaN(parsed.getTime())) {
      return { error: "Invalid expiry date" };
    }
    if (parsed.getTime() <= Date.now()) {
      return { error: "Expiry must be in the future" };
    }
    pinnedUntil = parsed;
  }

  try {
    await pinFeaturedList({ listId, pinnedUntil });
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to pin list" };
  }
}

/**
 * Form-action wrapper around `unpinFeaturedList`. The Unpin button on the
 * admin page submits a tiny `<form action={…}>` with no inputs; the wrapper
 * exists only so errors (NotAdminError, transient DB failures) can be
 * surfaced via `useActionState` rather than throwing through the form.
 */
export async function unpinFeaturedListFormAction(
  _prevState: { error: string | null },
  _formData: FormData,
): Promise<{ error: string | null }> {
  try {
    await unpinFeaturedList();
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to unpin list" };
  }
}
