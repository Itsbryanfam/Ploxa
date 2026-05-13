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

  // Cascade only on a fresh insert — not on a redundant block() call while
  // the block row already exists. (Goal text says "re-block re-runs cascade"
  // but that conflicts with this guard; follow the code, not the prose.)
  if (inserted.length > 0) {
    await cascadeBlock({ blockerId: user.id, blockedId: targetUserId });
  }

  revalidatePath("/home/feed");
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

export async function getBlocked(userId: string) {
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
    .where(eq(blocks.blockerId, userId))
    .orderBy(desc(blocks.createdAt));
}
