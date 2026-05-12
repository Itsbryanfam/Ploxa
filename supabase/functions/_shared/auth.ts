/**
 * Constant-time equality check for the service-role key compare.
 * String `!==` is fast-path on first byte mismatch → leaks the key one
 * byte at a time under a precise timing-side-channel. Practically
 * infeasible over network jitter for a 256-bit random key, but
 * defense-in-depth: cheap helper, no downside.
 *
 * Length mismatches still short-circuit (length is not the secret), but
 * compare-loops over equal lengths run in constant time regardless of
 * where the first differing byte is.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = new TextEncoder().encode(a);
  const bBuf = new TextEncoder().encode(b);
  if (aBuf.byteLength !== bBuf.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < aBuf.byteLength; i++) {
    diff |= aBuf[i] ^ bBuf[i];
  }
  return diff === 0;
}

/**
 * Validate the `apikey` header against `SUPABASE_SERVICE_ROLE_KEY`.
 * Supabase's `sb_secret_*` keys aren't JWTs — Edge Functions deploy
 * with `--no-verify-jwt` and validate via this header. See:
 *   https://supabase.com/docs/guides/api/api-keys
 *
 * Returns null on success; returns a `Response` with status 401 on
 * failure for the caller to return as-is.
 */
export function requireServiceRole(req: Request): Response | null {
  const apikey = req.headers.get("apikey");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!apikey || !serviceRoleKey || !constantTimeEqual(apikey, serviceRoleKey)) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}
