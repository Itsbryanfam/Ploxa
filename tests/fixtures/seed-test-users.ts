import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Fixture helpers for Playwright. Uses Supabase's service-role admin client
 * to create + tear down test users without going through the signup UI —
 * faster and isolates the test surface to the thing being tested (privacy
 * gates, OG render, etc.).
 *
 * Convention: all test usernames are prefixed `pw_test_` so a stuck-on-DB
 * cleanup is grep-friendly (`DELETE FROM auth.users WHERE email LIKE
 * 'pw_test_%@example.test'`). The per-test cleanup() should normally
 * handle this; the prefix is a safety net.
 */

function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Playwright fixtures need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env",
    );
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface TestUser {
  userId: string;
  username: string;
  email: string;
  password: string;
  /** Removes the auth user (and cascades to profile + reviews). */
  cleanup: () => Promise<void>;
}

export interface CreateUserOptions {
  isPublic: boolean;
}

/**
 * Create a Supabase auth user + profile row in one shot. Email is
 * auto-confirmed so the login flow doesn't need a magic-link round trip.
 */
export async function createTestUser(opts: CreateUserOptions): Promise<TestUser> {
  const admin = adminClient();
  // Suffix with millis + random to keep tests parallel-safe even though we
  // serialize by default — collision avoidance is cheap.
  const slug = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const username = `pw_test_${slug}`;
  const email = `${username}@example.test`;
  const password = `Pw_test_${slug}!`;

  const { data: created, error: signUpErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (signUpErr || !created.user) {
    throw new Error(`createUser failed: ${signUpErr?.message ?? "no user returned"}`);
  }
  const userId = created.user.id;

  const { error: profileErr } = await admin
    .from("profiles")
    .insert({
      user_id: userId,
      username,
      display_name: username,
      is_public: opts.isPublic,
    });
  if (profileErr) {
    // Roll the auth user back so we don't orphan a half-created account.
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    throw new Error(`profile insert failed: ${profileErr.message}`);
  }

  return {
    userId,
    username,
    email,
    password,
    cleanup: async () => {
      // auth.users ON DELETE CASCADE removes profile + reviews + logs.
      await admin.auth.admin.deleteUser(userId).catch((err: unknown) => {
        // Don't throw inside cleanup — tests should surface the assertion
        // failure, not the cleanup hiccup.
        console.warn(`cleanup deleteUser(${userId}) failed`, err);
      });
    },
  };
}

export interface SeedReviewOptions {
  userId: string;
  gameId: number;
  isPublic: boolean;
  body?: string;
  rating?: number;
}

export interface SeededReview {
  reviewId: string;
  gameId: number;
  gameSlug: string;
}

/**
 * Insert a published review row directly. Skips the AI draft / interview
 * flow because the test isn't exercising those — only the visibility
 * surface that the published review unlocks.
 *
 * Returns the row id so privacy tests can hit /og/review/[id] directly,
 * plus the joined game slug for the canonical /u/[username]/reviews/[slug]
 * URL.
 */
export async function seedReview(opts: SeedReviewOptions): Promise<SeededReview> {
  const admin = adminClient();

  const { data: game, error: gameErr } = await admin
    .from("games")
    .select("id, slug")
    .eq("id", opts.gameId)
    .single();
  if (gameErr || !game) {
    throw new Error(`game ${opts.gameId} not found: ${gameErr?.message ?? "no row"}`);
  }

  const { data: inserted, error: insertErr } = await admin
    .from("reviews")
    .insert({
      user_id: opts.userId,
      game_id: opts.gameId,
      body: opts.body ?? "A pinned test review.\n\nHighs.\n\nLows.\n\nVerdict.",
      rating: opts.rating ?? 8,
      is_public: opts.isPublic,
      published_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (insertErr || !inserted) {
    throw new Error(`review insert failed: ${insertErr?.message ?? "no row returned"}`);
  }

  return { reviewId: inserted.id, gameId: game.id, gameSlug: game.slug };
}

/** A real game id present in the seeded games table — Penarium (id=4). */
export const SEED_GAME_ID = 4;
