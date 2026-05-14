"use server";

import "server-only";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";

const CADENCE_VALUES = ["off", "daily", "weekly"] as const;
type Cadence = (typeof CADENCE_VALUES)[number];

const TYPE_TO_COLUMN = {
  follows: "emailFollows",
  reactions: "emailReactions",
  comments: "emailComments",
  wishlist: "emailWishlist",
} as const;
type EmailType = keyof typeof TYPE_TO_COLUMN;

export type UpdatePrefsResult = { ok: true } | { ok: false; error: string };

export async function updateCadence(value: Cadence): Promise<UpdatePrefsResult> {
  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!(CADENCE_VALUES as readonly string[]).includes(value)) {
    return { ok: false, error: "Invalid cadence value." };
  }
  await db
    .update(schema.profiles)
    .set({ emailDigestCadence: value, updatedAt: new Date() })
    .where(eq(schema.profiles.userId, user.id));
  revalidatePath("/settings/notifications", "page");
  return { ok: true };
}

export async function updateEmailType(
  type: EmailType,
  enabled: boolean,
): Promise<UpdatePrefsResult> {
  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const column = TYPE_TO_COLUMN[type];
  if (!column) return { ok: false, error: "Invalid notification type." };
  await db
    .update(schema.profiles)
    .set({ [column]: enabled, updatedAt: new Date() })
    .where(eq(schema.profiles.userId, user.id));
  revalidatePath("/settings/notifications", "page");
  return { ok: true };
}
