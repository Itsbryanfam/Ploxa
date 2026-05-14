import { desc, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgSchema,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// Reference to Supabase's auth.users (managed by Supabase, we don't create it).
const authSchema = pgSchema("auth");
export const authUsers = authSchema.table("users", {
  id: uuid("id").primaryKey(),
});

// ─────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────
export const logStatusEnum = pgEnum("log_status", [
  "backlog",
  "playing",
  "completed",
  "dropped",
  "on_hold",
  "wishlist",
]);

export const importStatusEnum = pgEnum("import_status", [
  "queued",
  "running",
  "completed",
  "failed",
]);

export const platformEnum = pgEnum("platform_kind", ["steam", "xbox", "psn"]);

// Forward-looking: Phase 4 (Taste Fingerprint + Recommendations).
// Schema lives in DB now; no app reads it yet.
export const recAlgorithmEnum = pgEnum("rec_algorithm", [
  "similarity",
  "ai",
  "hybrid",
]);

export const aiFeatureEnum = pgEnum("ai_feature", [
  "review_draft",
  "fingerprint",
  "recommendation",
  "year_in_review",
  "interview_question",
]);

// Forward-looking: Phase 5 (Social Layer). Schema lives in DB; no app reads yet.
export const notificationTypeEnum = pgEnum("notification_type", [
  "new_follower",
  "review_liked",
  "review_commented",
  "list_liked",
  "wishlist_logged_by_friend",
  "comment_replied",
]);

// ─────────────────────────────────────────────────────────────
// Phase 5 enums (live in DB via migration 0008)
// ─────────────────────────────────────────────────────────────
export const reportTargetTypeEnum = pgEnum("report_target_type", [
  "comment",
  "review",
  "list",
  "profile",
]);

export const reportStatusEnum = pgEnum("report_status", [
  "pending",
  "resolved_action_taken",
  "resolved_no_action",
  "auto_flagged",
]);

export const emailDigestCadenceEnum = pgEnum("email_digest_cadence", [
  "off",
  "daily",
  "weekly",
]);

// ─────────────────────────────────────────────────────────────
// Profiles (one per auth.users row)
// ─────────────────────────────────────────────────────────────
export const profiles = pgTable("profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  username: varchar("username", { length: 32 }).notNull().unique(),
  displayName: varchar("display_name", { length: 64 }),
  bio: text("bio"),
  // Dormant: predates Phase 1.5's PFP feature. No callers in app code.
  // Kept for additive-only migration safety; new code uses profilePictureUrl.
  avatarUrl: text("avatar_url"),
  profilePictureUrl: text("profile_picture_url"),
  // The DB-side CHECK constraint (profile_picture_kind IN ('static','gif'))
  // is enforced on the live database but is NOT captured in Drizzle's
  // snapshot (text({ enum: [...] }) only narrows the TypeScript type). The
  // constraint was added by hand to migration 0001. Re-running drizzle-kit
  // generate produces no diff for the CHECK; fresh environments must apply
  // migration 0001 to get the constraint.
  profilePictureKind: text("profile_picture_kind", { enum: ["static", "gif"] }),
  mascotVariant: varchar("mascot_variant", { length: 32 }).default("default"),
  // Self-reported Discord handle for the profile pill ("username" or
  // "username#1234"). No OAuth — display-only with click-to-copy because
  // Discord profile URLs aren't publicly routable. Added 2026-05-13.
  discordUsername: varchar("discord_username", { length: 32 }),
  isPublic: boolean("is_public").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  // Phase 5: email digest preference. 'weekly' default = Sunday digest cron.
  emailDigestCadence: emailDigestCadenceEnum("email_digest_cadence")
    .notNull()
    .default("weekly"),
  lastDigestSentAt: timestamp("last_digest_sent_at", { withTimezone: true }),
});

// ─────────────────────────────────────────────────────────────
// Games (RAWG-cached catalog)
// ─────────────────────────────────────────────────────────────
export const games = pgTable("games", {
  id: integer("id").primaryKey(), // RAWG id
  slug: varchar("slug", { length: 200 }).notNull().unique(),
  title: text("title").notNull(),
  released: timestamp("released", { withTimezone: false, mode: "date" }),
  // Landscape hero art from RAWG (~16:9). Drives game-detail.tsx hero strip
  // and remains the fallback for portrait slots when posterUrl is null.
  coverUrl: text("cover_url"),
  // Portrait (2:3) box art. Sourced via lib/games/poster-source.ts —
  // Steam Storefront search → Steam CDN library_600x900_2x → SGDB (if key).
  // Populated by scripts/backfill-posters.ts (one-time) and
  // enrichPostersForImport (per-import). Always nullable; UI must fall
  // back to coverUrl.
  posterUrl: text("poster_url"),
  posterSource: text("poster_source", { enum: ["steam", "sgdb", "rawg"] }),
  screenshotUrls: text("screenshot_urls").array(),
  description: text("description"),
  genres: text("genres").array(),
  themes: text("themes").array(),
  mechanics: text("mechanics").array(),
  platforms: text("platforms").array(),
  playtimeAvgHours: numeric("playtime_avg_hours", { precision: 5, scale: 1 }),
  metacriticScore: integer("metacritic_score"),
  rawgRating: numeric("rawg_rating", { precision: 3, scale: 2 }),
  cachedAt: timestamp("cached_at", { withTimezone: true }).notNull().defaultNow(),
  // ─── IGDB integration (added 2026-05-13) ───────────────────
  // Steam appid for the IGDB external_games bridge. Filled as a
  // side-effect of Phase 1 backfill (read from IGDB's external_games
  // category=1) and directly from the import externalId for new
  // post-v11 imports. Nullable — Xbox/manual imports stay null.
  steamAppid: integer("steam_appid"),
  // IGDB's game_modes facet (~6 canonical values: Single player,
  // Multiplayer, Co-operative, Split screen, MMO, Battle Royale).
  // Separate column rather than appended to mechanics so future code
  // can weigh modes vs mechanics differently in prompts.
  gameModes: text("game_modes").array(),
  // IGDB's player_perspectives facet (~7 values: First person, Third
  // person, Bird view / Isometric, Side view, Text, Auditory, VR).
  playerPerspectives: text("player_perspectives").array(),
  // Cached IGDB id; null = either unresolved OR resolved-and-not-found.
  // Disambiguate via igdbResolvedAt: null = never tried; non-null with
  // igdbId null = AI-fallback eligible.
  igdbId: integer("igdb_id"),
  igdbResolvedAt: timestamp("igdb_resolved_at", { withTimezone: true }),
});

export const gameAliases = pgTable(
  "game_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
  },
  (table) => ({
    aliasGameIdx: uniqueIndex("game_aliases_alias_game_uniq").on(table.gameId, table.alias),
  }),
);

// ─────────────────────────────────────────────────────────────
// App-level secret cache (Twitch OAuth tokens, etc.)
// ─────────────────────────────────────────────────────────────
// Service-role-only; never exposed via PostgREST. RLS not enabled
// because the table is touched only by lib/igdb/twitch-oauth.ts
// and the Edge mirror via DATABASE_URL (service-role connection).
export const appSecrets = pgTable("app_secrets", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────
// Logs (the core "I played this" record)
// ─────────────────────────────────────────────────────────────
export const logs = pgTable(
  "logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "restrict" }),
    status: logStatusEnum("status").notNull().default("backlog"),
    rating: numeric("rating", { precision: 3, scale: 1 }),
    startedAt: timestamp("started_at", { withTimezone: false, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: false, mode: "date" }),
    hoursPlayed: numeric("hours_played", { precision: 6, scale: 1 }),
    // Legacy single-platform column. New reads use platforms[]; falls back to this when null.
    // Phase 3 dual-writes both; Phase 5+ backfills platforms[] and drops this column.
    platformPlayedOn: text("platform_played_on"),
    // Canonical multi-platform array. New code reads: `platforms ?? (platformPlayedOn ? [platformPlayedOn] : [])`.
    platforms: text("platforms").array(),
    isReplay: boolean("is_replay").notNull().default(false),
    isPrivate: boolean("is_private").notNull().default(false),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // Phase 5: feed event tracking. Bumped on status change / rating set/changed.
    // Cleared rating does NOT update this (clearing isn't a positive social signal).
    // NOTE: T1's universal backfill marked ALL existing rows (including backlog +
    // wishlist) with last_event_at=updated_at. T13 owns the cleanup that nulls
    // these out for status IN ('backlog','wishlist').
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    lastEventType: text("last_event_type"), // 'status_change' | 'rating_set'
  },
  (table) => ({
    userGameIdx: uniqueIndex("logs_user_game_replay_uniq").on(table.userId, table.gameId, table.isReplay),
    userUpdatedAtIdx: index("logs_user_updated_at_idx").on(table.userId, desc(table.updatedAt)),
    userStatusUpdatedIdx: index("logs_user_status_updated_at_idx").on(table.userId, table.status, desc(table.updatedAt)),
    userEventIdx: index("logs_user_event_idx")
      .on(table.userId, desc(table.lastEventAt))
      .where(sql`${table.lastEventAt} IS NOT NULL`),
  }),
);

// ─────────────────────────────────────────────────────────────
// Reviews
// ─────────────────────────────────────────────────────────────
export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "restrict" }),
    logId: uuid("log_id").references(() => logs.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    rating: numeric("rating", { precision: 3, scale: 1 }),
    isAiAssisted: boolean("is_ai_assisted").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    isPublic: boolean("is_public").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // (userId, gameId) — unique enforces one-review-per-(user, game) at the
    // DB level (migration 0007). Used by every existing-review lookup in
    // lib/reviews/server-actions.ts (draftStart, regenerateSection, save,
    // publish, getReviewBySlug); Postgres uses the unique for equality
    // lookups so we don't need a separate non-unique index.
    userGameIdx: uniqueIndex("reviews_user_game_uniq").on(table.userId, table.gameId),
    // (userId, publishedAt DESC) WHERE publishedAt IS NOT NULL — drives the
    // public per-user review list at /u/[username]/reviews. Partial because
    // unpublished drafts dominate the row count.
    userPublishedAtIdx: index("reviews_user_published_at_idx")
      .on(table.userId, desc(table.publishedAt))
      .where(sql`${table.publishedAt} IS NOT NULL`),
  }),
);

export const reviewQuestions = pgTable(
  "review_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    question: text("question").notNull(),
    answer: text("answer"),
  },
  (table) => ({
    // (reviewId, position) is unique so the four-paragraph render order is
    // deterministic. Without it, dup positions render in arbitrary order.
    reviewPositionIdx: uniqueIndex("review_questions_review_position_uniq").on(
      table.reviewId,
      table.position,
    ),
  }),
);

// ─────────────────────────────────────────────────────────────
// AI taste fingerprint + recommendations — Phase 4
// ─────────────────────────────────────────────────────────────
export const tasteFingerprints = pgTable("taste_fingerprints", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  genreVector: jsonb("genre_vector").notNull().default(sql`'{}'::jsonb`),
  themeVector: jsonb("theme_vector").notNull().default(sql`'{}'::jsonb`),
  mechanicVector: jsonb("mechanic_vector").notNull().default(sql`'{}'::jsonb`),
  lengthPreference: jsonb("length_preference").notNull().default(sql`'{}'::jsonb`),
  difficultyPreference: jsonb("difficulty_preference").notNull().default(sql`'{}'::jsonb`),
  narrativeSummary: text("narrative_summary"),
  // Snapshot of vectors at the moment narrativeSummary was generated.
  // Used by the daily drift cron to decide whether to re-narrate.
  // Shape: { genre: Record<string, number>, theme: ..., mechanic: ... }
  narrativeSnapshotVectors: jsonb("narrative_snapshot_vectors"),
  totalLogsAtGeneration: integer("total_logs_at_generation").notNull().default(0),
  // narrative_model_version = which AI generated narrativeSummary (e.g.
  // "cerebras-qwen3-480b/narrative-v1"). Vector math is deterministic so
  // it has no model version.
  narrativeModelVersion: varchar("narrative_model_version", { length: 64 }),
  vectorsGeneratedAt: timestamp("vectors_generated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  narrativeGeneratedAt: timestamp("narrative_generated_at", { withTimezone: true }),
});

export const recommendations = pgTable(
  "recommendations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    score: numeric("score", { precision: 5, scale: 4 }).notNull(),
    reason: text("reason"),
    algorithm: recAlgorithmEnum("algorithm").notNull(),
    // Cache key = hash(userId + sortedMoods + time + sortedPlatforms).
    // Null for one-shot/legacy rows. Per-key cardinality is bounded — see
    // lib/recs/cache.ts.
    cacheKey: text("cache_key"),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    dismissed: boolean("dismissed").notNull().default(false),
  },
  (table) => ({
    // Cache-hit lookup: same (user, cacheKey, freshness ordering) for live recs.
    userCacheKeyIdx: index("recommendations_user_cache_key_idx")
      .on(table.userId, table.cacheKey, desc(table.generatedAt))
      .where(sql`${table.dismissed} = false`),
    // Negative-context lookup: most-recent dismissed by user (for rerank prompt).
    userDismissedIdx: index("recommendations_user_dismissed_idx")
      .on(table.userId, desc(table.generatedAt))
      .where(sql`${table.dismissed} = true`),
    // One live row per (user, cacheKey, gameId). Concurrent cache misses
    // previously produced duplicate rec rows for the same game; this
    // collapses them and lets ON CONFLICT do the right thing.
    userCacheGameUniq: uniqueIndex("recommendations_user_cache_game_uniq")
      .on(table.userId, table.cacheKey, table.gameId)
      .where(sql`${table.dismissed} = false`),
  }),
);

// ─────────────────────────────────────────────────────────────
// Social — Forward-looking (Phase 5)
// Tables exist in DB; no app reads yet. Will fill in Phase 5 (weeks 21-26).
// Exception: `likes` IS used by Phase 2 (review like-count + heart toggle).
// ─────────────────────────────────────────────────────────────
export const follows = pgTable(
  "follows",
  {
    followerId: uuid("follower_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    followedId: uuid("followed_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.followerId, table.followedId] }),
    // Block self-follows at the DB level so the activity-feed generator
    // (Phase 5) can't produce actor=target rows even via a bug.
    noSelf: check("follows_no_self", sql`${table.followerId} <> ${table.followedId}`),
    // PK leads with follower_id so WHERE followed_id = X can't use it.
    // FK constraints don't auto-create indexes in PG; this closes the gap.
    followedIdIdx: index("follows_followed_id_idx").on(table.followedId),
  }),
);

export const likes = pgTable(
  "likes",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.reviewId] }),
    // reviewId alone — used by the like-count aggregate on the canonical
    // review page. The PK leads with userId, so a filter on reviewId alone
    // can't use it; without this index the query degrades to a seq-scan
    // once likes counts climb.
    reviewIdIdx: index("likes_review_id_idx").on(table.reviewId),
  }),
);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    // Self-referencing FK (migration 0007). The same-review invariant
    // (child.review_id = parent.review_id) is enforced by a BEFORE INSERT/UPDATE
    // trigger that lives in migration 0007 — Postgres CHECK can't reference
    // another row, so a trigger is the right level. Drizzle doesn't emit
    // triggers, so keep the trigger SQL and the schema in lock-step.
    parentId: uuid("parent_id").references((): AnyPgColumn => comments.id, {
      onDelete: "cascade",
    }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    // Phase 5: auto-flag pipeline sets true; read predicate hides from non-author.
    isHidden: boolean("is_hidden").notNull().default(false),
  },
  (table) => ({
    reviewCreatedIdx: index("comments_review_created_idx").on(
      table.reviewId,
      desc(table.createdAt),
    ),
    userIdx: index("comments_user_idx").on(table.userId),
  }),
);

export const lists = pgTable(
  "lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    isPublic: boolean("is_public").notNull().default(true),
    // Phase 5: stable URL slug derived from title. Backfilled on migration.
    slug: text("slug").notNull().default(""),
    // Phase 5: timestamp of first publish (kept stable on subsequent edits).
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // /u/{name}/lists/{slug} must be unique per user.
    userSlugUniq: uniqueIndex("lists_user_slug_uniq").on(table.userId, table.slug),
    // Feed pull: filter published lists by user, order by publish time.
    userPublishedIdx: index("lists_user_published_idx")
      .on(table.userId, desc(table.publishedAt))
      .where(sql`${table.publishedAt} IS NOT NULL`),
  }),
);

export const listItems = pgTable(
  "list_items",
  {
    listId: uuid("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    note: text("note"),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.listId, table.gameId] }),
  }),
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    targetId: uuid("target_id"),
    actorId: uuid("actor_id").references(() => authUsers.id, { onDelete: "set null" }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Inbox feed + unread count both hit (user_id, read_at, created_at DESC).
    // read_at IS NULL filters unread; created_at orders the inbox.
    userUnreadIdx: index("notifications_user_unread_idx").on(
      table.userId,
      table.readAt,
      desc(table.createdAt),
    ),
    // Phase 5: ON CONFLICT chokepoint in lib/social/notifications/emit.ts
    // collapses repeat (user, type, target, actor) into one bumped row.
    dedupeUniq: uniqueIndex("notifications_dedupe_uniq").on(
      table.userId,
      table.type,
      table.targetId,
      table.actorId,
    ),
  }),
);

// ─────────────────────────────────────────────────────────────
// Phase 5: blocks graph (bidirectional w/ logged-out exception)
// ─────────────────────────────────────────────────────────────
export const blocks = pgTable(
  "blocks",
  {
    blockerId: uuid("blocker_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    blockedId: uuid("blocked_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.blockerId, table.blockedId] }),
    // Self-block prevention. App-side check is the friendly UX path; this CHECK
    // is defense-in-depth same as follows_no_self in migration 0007.
    noSelf: check("blocks_no_self", sql`${table.blockerId} <> ${table.blockedId}`),
    // Reverse lookup for "is X blocked by anyone I am?" — used by
    // withBlockedFilter's notExists subquery on the author side.
    blockedBlockerIdx: index("blocks_blocked_blocker_idx").on(
      table.blockedId,
      table.blockerId,
    ),
  }),
);

// ─────────────────────────────────────────────────────────────
// Phase 5: list reactions (parallel to review likes — kept separate)
// ─────────────────────────────────────────────────────────────
export const listLikes = pgTable(
  "list_likes",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    listId: uuid("list_id")
      .notNull()
      .references(() => lists.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.listId] }),
    // Like-count aggregation on list detail page filters by listId alone; PK
    // leads with userId so an index helps.
    listIdIdx: index("list_likes_list_id_idx").on(table.listId),
  }),
);

// ─────────────────────────────────────────────────────────────
// Phase 5: moderation reports (polymorphic target — no FK)
// ─────────────────────────────────────────────────────────────
export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable so a deleted account doesn't kill the report; ON DELETE SET NULL.
    reporterId: uuid("reporter_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    targetType: reportTargetTypeEnum("target_type").notNull(),
    // Polymorphic — discriminator is targetType. No FK because of the 4-target
    // shape. Lookup queries always carry targetType.
    targetId: uuid("target_id").notNull(),
    reason: text("reason").notNull(), // 'spam' | 'harassment' | 'spoiler' | 'off_topic' | 'other'
    details: text("details"),
    status: reportStatusEnum("status").notNull().default("pending"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    resolverNote: text("resolver_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Admin queue: pending newest first.
    statusCreatedIdx: index("reports_status_created_idx").on(
      table.status,
      desc(table.createdAt),
    ),
  }),
);

// ─────────────────────────────────────────────────────────────
// Library imports
// ─────────────────────────────────────────────────────────────
export const platformConnections = pgTable(
  "platform_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    platform: platformEnum("platform").notNull(),
    externalId: text("external_id").notNull(),
    // Cached human-readable gamertag (Steam personaname, Xbox Gamertag).
    // Populated by sync; nullable for legacy rows that predate this column.
    displayName: varchar("display_name", { length: 64 }),
    accessTokenEncrypted: text("access_token_encrypted"),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userPlatformIdx: uniqueIndex("platform_connections_user_platform_uniq").on(
      table.userId,
      table.platform,
    ),
  }),
);

export const imports = pgTable(
  "imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    platform: platformEnum("platform").notNull(),
    status: importStatusEnum("status").notNull().default("queued"),
    importedCount: integer("imported_count").notNull().default(0),
    totalCount: integer("total_count").notNull().default(0),
    errorMessage: text("error_message"),
    conflictsJsonb: jsonb("conflicts_jsonb").notNull().default(sql`'[]'::jsonb`),
    unmatchedJsonb: jsonb("unmatched_jsonb").notNull().default(sql`'[]'::jsonb`),
    surfaced: boolean("surfaced").notNull().default(true),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // /api/imports/latest polls during active imports — without this index
    // it seq-scans by user. (user_id, status, created_at DESC) matches the
    // ORDER BY created_at DESC LIMIT 1 lookup pattern.
    userStatusCreatedIdx: index("imports_user_status_created_idx").on(
      table.userId,
      table.status,
      desc(table.createdAt),
    ),
  }),
);

// ─────────────────────────────────────────────────────────────
// AI cost telemetry
// ─────────────────────────────────────────────────────────────
export const aiCalls = pgTable("ai_calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => authUsers.id, { onDelete: "set null" }),
  feature: aiFeatureEnum("feature").notNull(),
  provider: varchar("provider", { length: 32 }).notNull(),
  model: varchar("model", { length: 64 }).notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
  latencyMs: integer("latency_ms"),
  success: boolean("success").notNull().default(true),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────
// Year-in-review — Forward-looking (Phase 6)
// Table exists in DB; no app reads yet. Will fill in Phase 6 (weeks 27-30).
// ─────────────────────────────────────────────────────────────
export const yearInReviews = pgTable(
  "year_in_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    payload: jsonb("payload").notNull(),
    shareImageUrl: text("share_image_url"),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userYearIdx: uniqueIndex("year_in_reviews_user_year_uniq").on(table.userId, table.year),
  }),
);
