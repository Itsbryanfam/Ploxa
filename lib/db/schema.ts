import { desc, sql } from "drizzle-orm";
import {
  boolean,
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

export const notificationTypeEnum = pgEnum("notification_type", [
  "new_follower",
  "review_liked",
  "review_commented",
  "list_liked",
  "wishlist_logged_by_friend",
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
  isPublic: boolean("is_public").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────
// Games (RAWG-cached catalog)
// ─────────────────────────────────────────────────────────────
export const games = pgTable("games", {
  id: integer("id").primaryKey(), // RAWG id
  slug: varchar("slug", { length: 200 }).notNull().unique(),
  title: text("title").notNull(),
  released: timestamp("released", { withTimezone: false, mode: "date" }),
  coverUrl: text("cover_url"),
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
    platformPlayedOn: text("platform_played_on"),
    platforms: text("platforms").array(),
    isReplay: boolean("is_replay").notNull().default(false),
    isPrivate: boolean("is_private").notNull().default(false),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userGameIdx: uniqueIndex("logs_user_game_replay_uniq").on(table.userId, table.gameId, table.isReplay),
    userUpdatedAtIdx: index("logs_user_updated_at_idx").on(table.userId, desc(table.updatedAt)),
    userStatusUpdatedIdx: index("logs_user_status_updated_at_idx").on(table.userId, table.status, desc(table.updatedAt)),
  }),
);

// ─────────────────────────────────────────────────────────────
// Reviews
// ─────────────────────────────────────────────────────────────
export const reviews = pgTable("reviews", {
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
});

export const reviewQuestions = pgTable("review_questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  reviewId: uuid("review_id")
    .notNull()
    .references(() => reviews.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  question: text("question").notNull(),
  answer: text("answer"),
});

// ─────────────────────────────────────────────────────────────
// AI taste fingerprint + recommendations
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
  totalLogsAtGeneration: integer("total_logs_at_generation").notNull().default(0),
  modelVersion: varchar("model_version", { length: 64 }),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const recommendations = pgTable("recommendations", {
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
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  dismissed: boolean("dismissed").notNull().default(false),
});

// ─────────────────────────────────────────────────────────────
// Social
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
  }),
);

export const comments = pgTable("comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  reviewId: uuid("review_id")
    .notNull()
    .references(() => reviews.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  editedAt: timestamp("edited_at", { withTimezone: true }),
});

export const lists = pgTable("lists", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  isPublic: boolean("is_public").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  type: notificationTypeEnum("type").notNull(),
  targetId: uuid("target_id"),
  actorId: uuid("actor_id").references(() => authUsers.id, { onDelete: "set null" }),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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

export const imports = pgTable("imports", {
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
});

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
// Year-in-review
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
