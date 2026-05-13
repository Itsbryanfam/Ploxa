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
  UNSUBSCRIBE_SECRET: optionalString,
  RESEND_DIGEST_FROM_ADDRESS: optionalString,
  CRON_SECRET: optionalString,
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
        UNSUBSCRIBE_SECRET: process.env.UNSUBSCRIBE_SECRET,
        RESEND_DIGEST_FROM_ADDRESS: process.env.RESEND_DIGEST_FROM_ADDRESS,
        CRON_SECRET: process.env.CRON_SECRET,
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
