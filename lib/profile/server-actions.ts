"use server";

import type { User } from "@supabase/supabase-js";
import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { usernameSchema } from "./username-schema";
import { RESERVED_USERNAMES } from "./reserved-usernames";
import { UsernameCollisionError } from "./errors";
import {
  enforceRateLimit,
  clientIpForRateLimit,
  RateLimitedError,
} from "@/lib/security/rate-limit";

export interface HeaderUser {
  id: string;
  username: string | null;
  email: string;
  profilePictureUrl: string | null;
  profilePictureKind: "static" | "gif" | null;
  profilePicturePosterUrl: string | null;
}

async function posterUrlFor(userId: string): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data } = supabase.storage
    .from("avatars")
    .getPublicUrl(`${userId}/avatar-poster.png`);
  return data.publicUrl;
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
    profilePicturePosterUrl:
      profile?.profilePictureKind === "gif" ? await posterUrlFor(authUser.id) : null,
  };
}

export async function getProfileByUsername(username: string) {
  const profile = await db.query.profiles.findFirst({
    where: eq(schema.profiles.username, username),
    columns: {
      userId: true,
      username: true,
      displayName: true,
      bio: true,
      // Returned so callers can `notFound()` when the profile is private and
      // the viewer isn't the owner. Phase 3 sibling routes (/u/.../reviews)
      // already filter on this; the index page now does too.
      isPublic: true,
    },
  });
  return profile ?? null;
}

export async function getProfileByUserId(userId: string) {
  const profile = await db.query.profiles.findFirst({
    where: eq(schema.profiles.userId, userId),
    columns: {
      userId: true,
      username: true,
      displayName: true,
      bio: true,
      isPublic: true,
    },
  });
  return profile ?? null;
}

export type CheckUsernameResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "reserved" | "taken" };

export async function checkUsernameAvailability(
  value: string,
): Promise<CheckUsernameResult> {
  // Rate-limit per IP — without this, the action enumerates usernames
  // wholesale via wordlist scraping. 30/min matches a fast-typing user
  // with debounce keystroke checks without enabling scrapes.
  try {
    const ip = await clientIpForRateLimit();
    await enforceRateLimit({
      scope: "username:check",
      identifier: ip,
      limit: 30,
      windowSeconds: 60,
    });
  } catch (err) {
    if (err instanceof RateLimitedError) {
      // Surface as "invalid" so the input shows the generic error message
      // instead of leaking that we're rate-limiting.
      return { ok: false, reason: "invalid" };
    }
    throw err;
  }

  // Check reserved first — cheapest, no DB round-trip.
  if (RESERVED_USERNAMES.has(value)) return { ok: false, reason: "reserved" };
  const parsed = usernameSchema.safeParse(value);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  // Indexed unique lookup on username column.
  const existing = await db.query.profiles.findFirst({
    where: eq(schema.profiles.username, value),
    columns: { userId: true }, // minimal projection — we only need existence
  });
  return existing ? { ok: false, reason: "taken" } : { ok: true };
}

export async function ensureMyProfile(opts?: { username?: string }) {
  const user = await getCachedUser();
  if (!user) return null;

  const existing = await db.query.profiles.findFirst({
    where: eq(schema.profiles.userId, user.id),
  });
  if (existing) return existing;

  // ---------------------------------------------------------------------------
  // Determine username to use for the new row
  // ---------------------------------------------------------------------------
  let username: string;

  // Validate AND reject reserved names — matches updateUsername() at line
  // 252-261. Without the reserved check, callers feeding user-controlled
  // strings (e.g. auth callback passing user_metadata.username) could
  // claim "admin", "api", etc. through this path even though the explicit
  // /signup path blocks them via checkUsernameAvailability().
  const parsedExplicit = opts?.username
    ? usernameSchema.safeParse(opts.username)
    : null;
  const explicitUsername =
    parsedExplicit?.success && !RESERVED_USERNAMES.has(parsedExplicit.data)
      ? parsedExplicit.data
      : undefined;

  if (explicitUsername) {
    // Caller supplied a validated+available name — use it directly.
    // No retry loop: if there's a collision, we surface it rather than
    // silently picking a different name from what the user chose.
    username = explicitUsername;
  } else {
    // Email-prefix derivation, capped at usernameSchema's 24-char ceiling.
    // Reserve 2 chars for the numeric retry suffix so a 22-char base + "10"
    // still fits. The DB column is varchar(32) — we use less of it to keep
    // auto-derived usernames inside the regex the rest of the app validates
    // against (lib/profile/username-schema.ts:6).
    const baseUsername = (user.email?.split("@")[0] ?? "user")
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "");
    const baseTruncated = baseUsername.slice(0, 22);
    const initialFallback = (baseUsername.slice(0, 24) || `user${Date.now()}`).slice(0, 24);

    // Build all candidates up-front (initial + 10 numeric suffixes) and look
    // them all up in a single inArray query — replaces an O(N) round-trip
    // loop with one query.
    const candidates = [
      initialFallback,
      ...Array.from({ length: 10 }, (_, i) => `${baseTruncated}${i + 1}`),
    ];
    const taken = await db
      .select({ username: schema.profiles.username })
      .from(schema.profiles)
      .where(inArray(schema.profiles.username, candidates));
    const takenSet = new Set(taken.map((t) => t.username));

    username = candidates.find((c) => !takenSet.has(c)) ?? `user${Date.now()}`.slice(0, 24);
  }

  // Postgres unique-violation SQLSTATE — handles the TOCTOU race between the
  // findFirst loop above and the insert below (two near-simultaneous signups
  // with the same email prefix). Same pattern as createLog in lib/logs.
  const PG_UNIQUE_VIOLATION = "23505";
  try {
    const [created] = await db
      .insert(schema.profiles)
      // displayName intentionally null at signup. The header walks
      // `displayName ?? username` so the UI shows @username until the
      // user sets a real display name in /settings. Seeding with the
      // email leaked PII on the public profile page (caught 2026-05-13).
      .values({ userId: user.id, username, displayName: null })
      .returning();
    return created;
  } catch (err) {
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
      if (explicitUsername) {
        // Caller picked this name explicitly; surface the collision so they
        // can be offered alternatives rather than silently getting a different name.
        throw new UsernameCollisionError(explicitUsername);
      }
      // Auto-derived path: re-fetch the row that won the race (could be ours
      // if another concurrent request inserted the same userId row first, or
      // the email-prefix row grabbed by a different user).
      const winner = await db.query.profiles.findFirst({
        where: eq(schema.profiles.userId, user.id),
      });
      return winner ?? null;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Username suggestion helper
// ---------------------------------------------------------------------------

/**
 * Generate up to 3 candidate usernames near `taken` that are not in use.
 * Used by signup when the user's chosen name was grabbed between the
 * client-side availability check and the server-side insert.
 */
export async function suggestUsernames(taken: string): Promise<string[]> {
  const candidates = [
    `${taken}1`,
    `${taken}_g`,
    `${taken}_2`,
    `${taken}3`,
    `${taken}_x`,
  ].filter((c) => usernameSchema.safeParse(c).success);
  if (candidates.length === 0) return [];
  const rows = await db
    .select({ username: schema.profiles.username })
    .from(schema.profiles)
    .where(inArray(schema.profiles.username, candidates));
  const usedSet = new Set(rows.map((r) => r.username));
  return candidates.filter((c) => !usedSet.has(c)).slice(0, 3);
}

// ---------------------------------------------------------------------------
// Username update
// ---------------------------------------------------------------------------

export type UpdateUsernameResult =
  | { ok: true; username: string }
  | { ok: false; error: string };

export async function updateUsername(
  newUsername: string,
): Promise<UpdateUsernameResult> {
  const user = await getCachedUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const parsed = usernameSchema.safeParse(newUsername);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid username.",
    };
  }
  if (RESERVED_USERNAMES.has(parsed.data)) {
    return { ok: false, error: "this name is reserved" };
  }

  // Read the user's current username so we can revalidate the old /u/[username] route.
  const existing = await db.query.profiles.findFirst({
    where: eq(schema.profiles.userId, user.id),
    columns: { username: true },
  });
  if (!existing) return { ok: false, error: "Profile not found." };
  // No-op: caller asked to set the name to what it already is.
  if (existing.username === parsed.data) {
    return { ok: true, username: parsed.data };
  }

  try {
    await db
      .update(schema.profiles)
      .set({
        username: parsed.data,
        // Refresh updatedAt so any sort/cache invalidates correctly.
        updatedAt: new Date(),
      })
      .where(eq(schema.profiles.userId, user.id));
  } catch (err) {
    // Unique-constraint violation = another user grabbed the name between
    // the live-availability check and this UPDATE. Surface clean.
    if (
      typeof err === "object" &&
      err !== null &&
      (err as { code?: string }).code === "23505"
    ) {
      return { ok: false, error: "That username is taken." };
    }
    throw err;
  }

  revalidatePath("/", "layout");
  revalidatePath(`/u/${existing.username}`, "page");
  revalidatePath(`/u/${parsed.data}`, "page");
  return { ok: true, username: parsed.data };
}
