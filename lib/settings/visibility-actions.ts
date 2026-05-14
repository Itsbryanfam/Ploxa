"use server";

import "server-only";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";

export type ToggleVisibilityResult =
  | { ok: true }
  | { ok: false; error: string };

export async function toggleProfileVisibility(
  isPublic: boolean,
): Promise<ToggleVisibilityResult> {
  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Not signed in." };

  await db
    .update(schema.profiles)
    .set({ isPublic, updatedAt: new Date() })
    .where(eq(schema.profiles.userId, user.id));

  // Read username for the public-profile revalidation. Inline findFirst matches
  // the updateDiscordUsername / updateDisplayName / updateBio pattern.
  const profile = await db.query.profiles.findFirst({
    where: eq(schema.profiles.userId, user.id),
    columns: { username: true },
  });
  if (profile?.username) revalidatePath(`/u/${profile.username}`, "page");
  revalidatePath("/settings/privacy", "page");
  return { ok: true };
}
