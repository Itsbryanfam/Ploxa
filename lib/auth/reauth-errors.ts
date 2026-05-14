/**
 * ReauthFailedError lives in its own module (no `"use server"` directive)
 * because Next.js 16 Turbopack only allows async-function exports from
 * `"use server"` files. This class is thrown by `lib/auth/reauth-actions.ts`
 * and caught by every consuming form (T7 ReauthChallenge, T10 change-password,
 * T11 change-email, T13 delete-account).
 *
 * Rate-limit hits inside reauth-actions are also rewrapped as
 * ReauthFailedError so callers only have to catch one type.
 */
export class ReauthFailedError extends Error {
  constructor(message = "Reauthentication failed") {
    super(message);
    this.name = "ReauthFailedError";
  }
}
