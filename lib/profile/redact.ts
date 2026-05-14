/**
 * Defense-in-depth profile redaction helper. Pulled out of `server-actions.ts`
 * so non-`"use server"` callers (e.g. RSC page components like
 * `/u/[username]/lists/[listSlug]`) can import the same logic without going
 * through a server-action RPC round trip.
 *
 * Next.js 16 Turbopack only permits async-function exports from `"use server"`
 * files; this synchronous helper has to live in a sibling file. Same pattern
 * as `lib/auth/reauth-errors.ts` and `lib/profile/errors.ts`.
 *
 * Originally introduced in commit `d2dd478` (T01 of audit-fixes-2026-05-14).
 */

/**
 * Returns the profile with `displayName` + `bio` blanked when the viewer is
 * not the owner and the profile is private. Username is preserved (already
 * public via the URL). Returning the row (with redacted fields) rather than
 * null preserves the "indistinguishable 404" contract for page-level callers,
 * which still see `isPublic: false` and decide whether to call `notFound()`.
 *
 * Callers that don't project `bio` (e.g. the lists detail page only reads
 * `displayName`) can pass a row without `bio` — the field is only blanked if
 * it was present. `displayName` is always blanked when redaction fires.
 */
export function redactPrivateProfile<
  T extends {
    userId: string;
    displayName: string | null;
    isPublic: boolean;
    bio?: string | null;
  },
>(profile: T, viewerId: string | null): T {
  const isOwner = viewerId === profile.userId;
  if (!isOwner && !profile.isPublic) {
    // Spread original first so any extra fields (e.g. `bio` when present)
    // are carried through; then overwrite the PII fields. `bio` is set
    // explicitly to null only when the caller actually projected it, to
    // preserve the type-narrowing for callers that pass rows without it.
    const redacted = { ...profile, displayName: null } as T;
    if ("bio" in profile) {
      (redacted as { bio: string | null }).bio = null;
    }
    return redacted;
  }
  return profile;
}
