import { z } from "zod";

// Treat empty-string env vars (e.g. `CEREBRAS_API_KEY=` in .env) as absent.
// Zod's `.min(1)` / `.url()` would otherwise reject them at build time even
// though `.optional()` is set, because the value is "" rather than undefined.
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === "" ? undefined : v));

const optionalUrl = z
  .string()
  .url()
  .optional()
  .or(z.literal("").transform(() => undefined));

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  DATABASE_URL: optionalUrl,
  RAWG_API_KEY: optionalString,
  UPSTASH_REDIS_REST_URL: optionalUrl,
  UPSTASH_REDIS_REST_TOKEN: optionalString,
  CEREBRAS_API_KEY: optionalString,
  GROQ_API_KEY: optionalString,
  CLOUDFLARE_ACCOUNT_ID: optionalString,
  CLOUDFLARE_API_TOKEN: optionalString,
  DEEPSEEK_API_KEY: optionalString,
  RESEND_API_KEY: optionalString,
  STEAM_API_KEY: optionalString,
  SUPABASE_FUNCTIONS_URL: optionalUrl,
  IMPORT_ENCRYPTION_KEY: optionalString,
  // Optional. When set, lib/games/poster-source.ts uses SteamGridDB as the
  // long-tail fallback after Steam CDN. Free key:
  // https://www.steamgriddb.com/profile/preferences/api
  SGDB_API_KEY: optionalString,
  // IGDB v4 API access — Twitch OAuth client-credentials flow gates the
  // mechanics + vocab refresh paths. Register at
  // https://dev.twitch.tv/console/apps to mint an ID + Secret. Token
  // refresh logic in lib/igdb/twitch-oauth.ts.
  IGDB_CLIENT_ID: optionalString,
  IGDB_CLIENT_SECRET: optionalString,
  // OpenAI key for scripts/backfill-mechanics-ai.ts (not in serving path).
  // https://platform.openai.com/api-keys
  OPENAI_API_KEY: optionalString,
  UNSUBSCRIBE_SECRET: optionalString,
  RESEND_DIGEST_FROM_ADDRESS: optionalString,
  CRON_SECRET: optionalString,
  // Admin allowlist for /admin/reports (comma-separated UUIDs).
  // Transformed at parse time into a string[] for direct membership checks
  // via lib/social/moderation/admin.ts. Beta-scale (1-3 admins); if the
  // operator pool grows, migrate to a user_roles(user_id, role) table.
  ADMIN_USER_IDS: z
    .string()
    .optional()
    .transform((s) => (s ?? "").split(",").map((id) => id.trim()).filter(Boolean)),
  // Feature flag: v2 /play-next pipeline. Empty/unset → dev/test default
  // (true off-prod) via lib/recs/feature-flag.ts; "true"/"false" force it.
  RECS_V2_ENABLED: optionalString,
  // Comma-separated user IDs that get v2 even when the global flag is off
  // (canary rollout). Split + trimmed in feature-flag.ts.
  RECS_V2_USERS: optionalString,
});

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
});

const clientEnv = clientSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});

const serverEnv =
  typeof window === "undefined"
    ? serverSchema.parse({
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
        DATABASE_URL: process.env.DATABASE_URL,
        RAWG_API_KEY: process.env.RAWG_API_KEY,
        UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
        UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
        CEREBRAS_API_KEY: process.env.CEREBRAS_API_KEY,
        GROQ_API_KEY: process.env.GROQ_API_KEY,
        CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
        CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
        DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
        RESEND_API_KEY: process.env.RESEND_API_KEY,
        STEAM_API_KEY: process.env.STEAM_API_KEY,
        SUPABASE_FUNCTIONS_URL: process.env.SUPABASE_FUNCTIONS_URL,
        IMPORT_ENCRYPTION_KEY: process.env.IMPORT_ENCRYPTION_KEY,
        SGDB_API_KEY: process.env.SGDB_API_KEY,
        IGDB_CLIENT_ID: process.env.IGDB_CLIENT_ID,
        IGDB_CLIENT_SECRET: process.env.IGDB_CLIENT_SECRET,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        UNSUBSCRIBE_SECRET: process.env.UNSUBSCRIBE_SECRET,
        RESEND_DIGEST_FROM_ADDRESS: process.env.RESEND_DIGEST_FROM_ADDRESS,
        CRON_SECRET: process.env.CRON_SECRET,
        ADMIN_USER_IDS: process.env.ADMIN_USER_IDS,
        RECS_V2_ENABLED: process.env.RECS_V2_ENABLED,
        RECS_V2_USERS: process.env.RECS_V2_USERS,
      })
    : ({} as z.infer<typeof serverSchema>);

export const env = {
  ...clientEnv,
  ...serverEnv,
};

export function requireEnv<K extends keyof typeof env>(key: K): NonNullable<(typeof env)[K]> {
  const value = env[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(
      `Missing required environment variable: ${String(key)}. Check your .env.local file (see .env.example for the full list).`,
    );
  }
  return value as NonNullable<(typeof env)[K]>;
}
