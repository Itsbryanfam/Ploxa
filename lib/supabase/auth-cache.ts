import "server-only";
import { cache } from "react";
import { createSupabaseServerClient } from "./server";

/**
 * Per-request memoized wrapper around supabase.auth.getUser(). React's
 * cache() ensures that multiple server actions or Server Components in
 * the same request share one JWT verification round-trip instead of
 * verifying independently.
 *
 * Do NOT use this in middleware — middleware runs before the React tree
 * and has its own session-refresh lifecycle.
 */
export const getCachedUser = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
