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

/**
 * A pool of real game ids that exist in every test DB. Used by seedLogs to
 * spread rows across distinct games (the logs table has a unique index on
 * (user_id, game_id, is_replay), so each game id can host at most 2 rows:
 * one with is_replay=false, one with is_replay=true).
 *
 * Ids verified against the live catalog on 2026-05-14.
 */
export const SEED_GAME_IDS = [4, 20, 21, 24, 25, 26, 27, 28, 29, 30, 32, 33, 34] as const;

/**
 * Insert a follow row directly via service-role. Idempotent on PK
 * conflict (23505) — same row already exists, so a noop is the
 * correct outcome.
 *
 * Used by social-flow E2Es that need a pre-existing edge for the
 * /follow-feed assertions to make sense without first walking the
 * UI to create them.
 */
export async function seedFollow(args: {
  followerId: string;
  followedId: string;
}): Promise<void> {
  const admin = adminClient();
  const { error } = await admin
    .from("follows")
    .insert({ follower_id: args.followerId, followed_id: args.followedId });
  if (error && error.code !== "23505") {
    throw new Error(`seedFollow failed: ${error.message}`);
  }
}

export interface SeedListOptions {
  userId: string;
  /** Defaults to a random pw_test_-style title. */
  title?: string;
  /** Slug — must be unique per user. Defaults to a random hash. */
  slug?: string;
  isPublic: boolean;
  /** When true, sets published_at to now. Required for non-owner OG visibility. */
  published: boolean;
  description?: string;
}

export interface SeededList {
  listId: string;
  slug: string;
}

/**
 * Expose the admin client for specs that need direct DB access.
 * Each call creates a new client instance (cheap — no long-lived connection).
 */
export { adminClient };

/**
 * Options for seedLogs. Spreads N log rows for one user across a date range
 * using the SEED_GAME_IDS pool. The logs table has a unique index on
 * (user_id, game_id, is_replay), so we cycle through distinct game ids and
 * set is_replay=false for all rows (keeping it simple and deterministic).
 *
 * The aggregator counts logs via `COALESCE(started_at, last_event_at)`, so
 * we populate last_event_at at evenly-spaced intervals inside [start, end).
 */
export interface SeedLogsOptions {
  userId: string;
  count: number;
  /** ISO date string for window start, e.g. "2026-01-01". */
  startDate: string;
  /** ISO date string for window end (exclusive), e.g. "2026-12-31". */
  endDate: string;
}

export interface SeededLog {
  logId: string;
  gameId: number;
}

/**
 * Insert `count` log rows for a user, spread evenly across [startDate, endDate).
 * Each log uses a distinct game_id from SEED_GAME_IDS (cycles if count > pool).
 * Status cycles through completed/playing/backlog for realism.
 * Existing rows for the same (user_id, game_id, is_replay) are deleted first
 * so the helper is idempotent across repeated runs within a single test suite run.
 */
export async function seedLogs(opts: SeedLogsOptions): Promise<SeededLog[]> {
  const admin = adminClient();
  const { userId, count, startDate, endDate } = opts;

  const startMs = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime();
  const stepMs = Math.floor((endMs - startMs) / Math.max(count, 1));

  const statuses = ["completed", "playing", "backlog"] as const;
  const results: SeededLog[] = [];

  for (let i = 0; i < count; i++) {
    const gameId = SEED_GAME_IDS[i % SEED_GAME_IDS.length];
    const eventAt = new Date(startMs + stepMs * i).toISOString();
    const status = statuses[i % statuses.length];

    // Remove any stale row for this (user, game, is_replay) triple first.
    await admin
      .from("logs")
      .delete()
      .eq("user_id", userId)
      .eq("game_id", gameId)
      .eq("is_replay", false);

    const { data: inserted, error } = await admin
      .from("logs")
      .insert({
        user_id: userId,
        game_id: gameId,
        status,
        is_replay: false,
        last_event_at: eventAt,
        is_private: false,
      })
      .select("id")
      .single();

    if (error || !inserted) {
      throw new Error(
        `seedLogs insert failed for game ${gameId}: ${error?.message ?? "no row returned"}`,
      );
    }
    results.push({ logId: inserted.id, gameId });
  }

  return results;
}

/**
 * Insert a list row directly via service-role. Used by privacy tests for
 * /og/list/[id] — keeps the test surface narrow (skips the "create list →
 * edit → publish" UI flow).
 */
export async function seedList(opts: SeedListOptions): Promise<SeededList> {
  const admin = adminClient();
  const slug = opts.slug ?? `pw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const title = opts.title ?? `Test list ${slug}`;
  const { data: inserted, error } = await admin
    .from("lists")
    .insert({
      user_id: opts.userId,
      title,
      slug,
      description: opts.description ?? null,
      is_public: opts.isPublic,
      published_at: opts.published ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (error || !inserted) {
    throw new Error(`list insert failed: ${error?.message ?? "no row returned"}`);
  }
  return { listId: inserted.id, slug };
}
