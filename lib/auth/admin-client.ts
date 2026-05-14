import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

/**
 * Service-role Supabase client. NEVER import this from a client component
 * or pass results to one — the service-role key bypasses RLS.
 *
 * Both env vars are validated via requireEnv (throws a descriptive error
 * pointing to .env.example if either is missing) — matches the pattern
 * used by lib/supabase/server.ts and lib/supabase/client.ts.
 *
 * Used by:
 *  - lib/auth/user-has-password.ts (read auth.users.encrypted_password)
 *  - lib/settings/account-deletion-actions.ts (purge-time auth.admin.deleteUser)
 *  - supabase/functions/account-purge/ (Deno equivalent — separate file)
 */

let cached: SupabaseClient | null = null;

export function getAdminClient(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  return cached;
}
