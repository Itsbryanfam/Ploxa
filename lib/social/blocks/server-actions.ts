"use server";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { cascadeBlock } from "./side-effects";

const { blocks, profiles } = schema;

export type BlockResult =
  | { ok: true }
  | { ok: false; reason: "not-authenticated" | "self-block" };

export async function block(targetUserId: string): Promise<BlockResult> {
  const user = await getCachedUser();
  if (!user) return { ok: false, reason: "not-authenticated" };
  if (user.id === targetUserId) return { ok: false, reason: "self-block" };

  const inserted = await db
    .insert(blocks)
    .values({ blockerId: user.id, blockedId: targetUserId })
    .onConflictDoNothing()
    .returning({ blockerId: blocks.blockerId });

  // Guard: only run cascade on a fresh block row. If the block already
  // exists, the cascade either already ran (or the content was already gone
  // before the first block). Skipping redundant hard-deletes here.
  if (inserted.length > 0) {
    await cascadeBlock({ blockerId: user.id, blockedId: targetUserId });
  }

  revalidatePath("/home/feed");
  revalidatePath("/settings/blocked");
  return { ok: true };
}

export async function unblock(targetUserId: string): Promise<BlockResult> {
  const user = await getCachedUser();
  if (!user) return { ok: false, reason: "not-authenticated" };
  await db
    .delete(blocks)
    .where(
      and(eq(blocks.blockerId, user.id), eq(blocks.blockedId, targetUserId)),
    );
  revalidatePath("/home/feed");
  revalidatePath("/settings/blocked");
  return { ok: true };
}

/**
 * Returns the current user's block list — usernames + avatars + blocked-at
 * timestamps, newest first. Drives /settings/blocked.
 *
 * No `userId` parameter on purpose: a block list is private data. Identity
 * is derived from session via getCachedUser() — never trust a caller-supplied
 * UUID for this kind of read. (Contrast: getFollowers/getFollowing in
 * follows/server-actions.ts accept viewerId because follow edges are public.)
 *
 * Returns `[]` for logged-out callers rather than throwing — keeps the
 * /settings/blocked page render straightforward.
 */
export async function getBlocked(): Promise<
  Array<{
    userId: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    blockedAt: Date;
  }>
> {
  const user = await getCachedUser();
  if (!user) return [];
  return await db
    .select({
      userId: profiles.userId,
      username: profiles.username,
      displayName: profiles.displayName,
      avatarUrl: profiles.avatarUrl,
      blockedAt: blocks.createdAt,
    })
    .from(blocks)
    .innerJoin(profiles, eq(profiles.userId, blocks.blockedId))
    .where(eq(blocks.blockerId, user.id))
    .orderBy(desc(blocks.createdAt));
}
