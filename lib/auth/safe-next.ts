/**
 * Sanitize a `next=` / `redirect=` query-string value so it can be passed
 * to `redirect()` or `NextResponse.redirect()` without enabling
 * open-redirect attacks via crafted URLs.
 *
 * Browsers treat `//host` and `/\host` as protocol-relative or
 * backslash-protocol URLs that navigate cross-origin. A naive
 * `startsWith("/")` check accepts both, so `?next=//evil.com` would
 * forward the user to attacker-controlled origin after login.
 *
 * Accepts: a value starting with a single `/` that is NOT `//` or `/\`.
 * Returns the path on success, or the supplied fallback (default `/home`).
 */
export function safeRedirectPath(
  rawNext: string | null | undefined,
  fallback = "/home",
): string {
  if (!rawNext) return fallback;
  if (!rawNext.startsWith("/")) return fallback;
  if (rawNext.startsWith("//") || rawNext.startsWith("/\\")) return fallback;
  return rawNext;
}
