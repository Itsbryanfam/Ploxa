"use server";

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function getProfileByUsername(username: string) {
  const profile = await db.query.profiles.findFirst({
    where: eq(schema.profiles.username, username),
  });
  return profile ?? null;
}

export async function ensureMyProfile() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const existing = await db.query.profiles.findFirst({
    where: eq(schema.profiles.userId, user.id),
  });
  if (existing) return existing;

  // Generate username from email prefix
  const baseUsername = (user.email?.split("@")[0] ?? "user").toLowerCase().replace(/[^a-z0-9_]/g, "");
  let username = baseUsername.slice(0, 32) || `user${Date.now()}`;

  // Ensure unique — append numeric suffix if collision
  for (let i = 0; i < 10; i++) {
    const conflict = await db.query.profiles.findFirst({
      where: eq(schema.profiles.username, username),
    });
    if (!conflict) break;
    username = `${baseUsername}${i + 1}`;
  }

  const [created] = await db
    .insert(schema.profiles)
    .values({ userId: user.id, username, displayName: user.email ?? username })
    .returning();
  return created;
}
