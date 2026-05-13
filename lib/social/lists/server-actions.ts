"use server";
import { and, eq, gt, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { slugifyTitle, uniqueSlugForUser } from "./slug";
import { onListPublish } from "./triggers";

const { lists, listItems, profiles } = schema;

// ─────────────────────────────────────────────────────────────
// createList
// ─────────────────────────────────────────────────────────────

const createSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  isPublic: z.boolean().default(true),
});

export type CreateListResult =
  | { ok: true; listId: string; slug: string }
  | { ok: false; reason: "not-authenticated" | "invalid-input" };

export async function createList(input: unknown): Promise<CreateListResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid-input" };
  const { title, description, isPublic } = parsed.data;

  const user = await getCachedUser();
  if (!user) return { ok: false, reason: "not-authenticated" };

  const baseSlug = slugifyTitle(title);
  const slug = await uniqueSlugForUser(user.id, baseSlug);

  const inserted = await db
    .insert(lists)
    .values({
      userId: user.id,
      title,
      description: description ?? null,
      slug,
      isPublic,
    })
    .returning({ id: lists.id, slug: lists.slug });

  return { ok: true, listId: inserted[0].id, slug: inserted[0].slug };
}

// ─────────────────────────────────────────────────────────────
// updateList
// ─────────────────────────────────────────────────────────────

const updateSchema = z.object({
  listId: z.string().uuid(),
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  isPublic: z.boolean().optional(),
});

export async function updateList(
  input: unknown,
): Promise<{ ok: boolean; slug?: string }> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false };
  const { listId, title, description, isPublic } = parsed.data;

  const user = await getCachedUser();
  if (!user) return { ok: false };

  const existing = await db.query.lists.findFirst({
    where: and(eq(lists.id, listId), eq(lists.userId, user.id)),
  });
  if (!existing) return { ok: false };

  const set: Record<string, unknown> = {};
  if (title !== undefined) set.title = title;
  if (description !== undefined) set.description = description;
  if (isPublic !== undefined) set.isPublic = isPublic;
  set.updatedAt = new Date();

  // Slug regenerates only when title changed AND list is unpublished.
  // Published lists keep their original slug forever for URL stability.
  if (
    title !== undefined &&
    title !== existing.title &&
    existing.publishedAt === null
  ) {
    const baseSlug = slugifyTitle(title);
    set.slug = await uniqueSlugForUser(user.id, baseSlug);
  }

  await db.update(lists).set(set).where(eq(lists.id, listId));

  return {
    ok: true,
    slug: typeof set.slug === "string" ? set.slug : existing.slug,
  };
}

// ─────────────────────────────────────────────────────────────
// publishList
// ─────────────────────────────────────────────────────────────

export async function publishList(listId: string): Promise<{ ok: boolean }> {
  const user = await getCachedUser();
  if (!user) return { ok: false };

  const existing = await db.query.lists.findFirst({
    where: and(eq(lists.id, listId), eq(lists.userId, user.id)),
  });
  if (!existing) return { ok: false };
  if (!existing.isPublic) return { ok: false }; // can't publish a private list
  if (existing.publishedAt !== null) return { ok: true }; // idempotent

  await db
    .update(lists)
    .set({ publishedAt: new Date() })
    .where(eq(lists.id, listId));

  await onListPublish({ listId, authorId: user.id });

  // Revalidate canonical list views. Username-keyed, not userId-keyed —
  // routes are /u/{username}/lists/{slug}.
  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.userId, user.id),
    columns: { username: true },
  });
  if (profile) {
    revalidatePath(`/u/${profile.username}/lists`);
    revalidatePath(`/u/${profile.username}/lists/${existing.slug}`);
  }

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// deleteList
// ─────────────────────────────────────────────────────────────

export async function deleteList(listId: string): Promise<{ ok: boolean }> {
  const user = await getCachedUser();
  if (!user) return { ok: false };
  // FK cascade from migration 0008 drops list_items.
  await db
    .delete(lists)
    .where(and(eq(lists.id, listId), eq(lists.userId, user.id)));
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// addItemToList
// ─────────────────────────────────────────────────────────────

const addItemSchema = z.object({
  listId: z.string().uuid(),
  gameId: z.number().int().positive(),
  note: z.string().max(280).optional(),
});

export async function addItemToList(input: unknown): Promise<{ ok: boolean }> {
  const parsed = addItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false };

  const user = await getCachedUser();
  if (!user) return { ok: false };

  // Ownership check.
  const list = await db.query.lists.findFirst({
    where: and(eq(lists.id, parsed.data.listId), eq(lists.userId, user.id)),
    columns: { id: true },
  });
  if (!list) return { ok: false };

  // Position = max(existing) + 1.
  const maxRow = await db
    .select({
      value: sql<number>`coalesce(max(${listItems.position}), 0)::int`,
    })
    .from(listItems)
    .where(eq(listItems.listId, parsed.data.listId));
  const nextPosition = (maxRow[0]?.value ?? 0) + 1;

  await db
    .insert(listItems)
    .values({
      listId: parsed.data.listId,
      gameId: parsed.data.gameId,
      position: nextPosition,
      note: parsed.data.note ?? null,
    })
    .onConflictDoNothing(); // (listId, gameId) PK — idempotent re-add

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// removeItemFromList
// ─────────────────────────────────────────────────────────────

const removeItemSchema = z.object({
  listId: z.string().uuid(),
  gameId: z.number().int().positive(),
});

export async function removeItemFromList(
  input: unknown,
): Promise<{ ok: boolean }> {
  const parsed = removeItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false };

  const user = await getCachedUser();
  if (!user) return { ok: false };

  // Ownership.
  const list = await db.query.lists.findFirst({
    where: and(eq(lists.id, parsed.data.listId), eq(lists.userId, user.id)),
    columns: { id: true },
  });
  if (!list) return { ok: false };

  // Read the removed item's position so we know which others to shift down.
  const existing = await db.query.listItems.findFirst({
    where: and(
      eq(listItems.listId, parsed.data.listId),
      eq(listItems.gameId, parsed.data.gameId),
    ),
    columns: { position: true },
  });
  if (!existing) return { ok: true }; // already gone — idempotent

  await db.delete(listItems).where(
    and(
      eq(listItems.listId, parsed.data.listId),
      eq(listItems.gameId, parsed.data.gameId),
    ),
  );

  // Renumber: decrement position by 1 for all items above the removed slot.
  await db
    .update(listItems)
    .set({ position: sql`${listItems.position} - 1` })
    .where(
      and(
        eq(listItems.listId, parsed.data.listId),
        gt(listItems.position, existing.position),
      ),
    );

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// reorderListItems
// ─────────────────────────────────────────────────────────────

const reorderSchema = z.object({
  listId: z.string().uuid(),
  orderedGameIds: z.array(z.number().int().positive()).max(500),
});

export async function reorderListItems(
  input: unknown,
): Promise<{ ok: boolean }> {
  const parsed = reorderSchema.safeParse(input);
  if (!parsed.success) return { ok: false };

  const user = await getCachedUser();
  if (!user) return { ok: false };

  // Ownership.
  const list = await db.query.lists.findFirst({
    where: and(eq(lists.id, parsed.data.listId), eq(lists.userId, user.id)),
    columns: { id: true },
  });
  if (!list) return { ok: false };

  // Bulk UPDATE in a transaction. Row-by-row update is fine at the 500-cap
  // budget; if reorderable lists ever grow larger, refactor to a single
  // UPDATE FROM VALUES.
  await db.transaction(async (tx) => {
    for (let i = 0; i < parsed.data.orderedGameIds.length; i++) {
      await tx
        .update(listItems)
        .set({ position: i + 1 })
        .where(
          and(
            eq(listItems.listId, parsed.data.listId),
            eq(listItems.gameId, parsed.data.orderedGameIds[i]),
          ),
        );
    }
  });

  return { ok: true };
}
