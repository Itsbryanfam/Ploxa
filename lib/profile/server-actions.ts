"use server";

import type { User } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface HeaderUser {
  id: string;
  username: string | null;
  email: string;
  profilePictureUrl: string | null;
  profilePictureKind: "static" | "gif" | null;
  // TODO(Phase 1.5 Task 8): add `profilePicturePosterUrl: string | null` —
  // computed from the Supabase Storage path when profilePictureKind === "gif".
  // Without it the Avatar GIF branch falls back to using the animated GIF as
  // its own poster, defeating the hover-swap UX. Add when the server-side
  // poster path helper lands in Task 8.
}

/**
 * Build the data the AppHeader needs from an already-authenticated Supabase
 * user. The caller is expected to have already run `supabase.auth.getUser()`
 * and gated on its result — we accept the user object instead of re-fetching
 * it here so each authenticated render only verifies the session once.
 */
export async function getHeaderUser(authUser: User): Promise<HeaderUser> {
  const profile = await db.query.profiles.findFirst({
    where: eq(schema.profiles.userId, authUser.id),
    columns: {
      username: true,
      profilePictureUrl: true,
      profilePictureKind: true,
    },
  });
  return {
    id: authUser.id,
    username: profile?.username ?? null,
    email: authUser.email ?? "",
    profilePictureUrl: profile?.profilePictureUrl ?? null,
    profilePictureKind: profile?.profilePictureKind ?? null,
  };
}

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
  // Reserve 2 chars for the numeric retry suffix so a 31-char base + "10"
  // doesn't blow past the schema's varchar(32) limit.
  const baseTruncated = baseUsername.slice(0, 30);
  let username = (baseUsername.slice(0, 32) || `user${Date.now()}`).slice(0, 32);

  // Ensure unique — append numeric suffix if collision
  for (let i = 0; i < 10; i++) {
    const conflict = await db.query.profiles.findFirst({
      where: eq(schema.profiles.username, username),
    });
    if (!conflict) break;
    username = `${baseTruncated}${i + 1}`;
  }

  // Postgres unique-violation SQLSTATE — handles the TOCTOU race between the
  // findFirst loop above and the insert below (two near-simultaneous signups
  // with the same email prefix). Same pattern as createLog in lib/logs.
  const PG_UNIQUE_VIOLATION = "23505";
  try {
    const [created] = await db
      .insert(schema.profiles)
      .values({ userId: user.id, username, displayName: user.email ?? username })
      .returning();
    return created;
  } catch (err) {
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
      // Either another request inserted our (userId) row first, or another
      // user grabbed our username. Re-fetch the row that exists for this user.
      const winner = await db.query.profiles.findFirst({
        where: eq(schema.profiles.userId, user.id),
      });
      return winner ?? null;
    }
    throw err;
  }
}
