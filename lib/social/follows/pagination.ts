/**
 * Pagination constants + types for getFollowers / getFollowing.
 *
 * Lives in its own module rather than `server-actions.ts` because that
 * file is `"use server"`-marked, and Next.js 16 only allows async
 * function exports from `"use server"` files. A const + type re-export
 * out of a `"use server"` file errors at build time with "Only async
 * functions are allowed to be exported in a 'use server' file" —
 * caught when the settings overhaul deploy ate it on prod (see
 * pnpm_build_canonical_gate memory note).
 */

/**
 * Default per-page size for follower/following lists. 100 covers most
 * real users; large fan-outs paginate via the page handlers.
 */
export const FOLLOWS_PAGE_SIZE = 100;

/**
 * Pagination input shared by getFollowers/getFollowing. `limit` is
 * clamped server-side to FOLLOWS_PAGE_SIZE so a malicious caller can't
 * pass `?limit=10_000`. `offset` is unbounded — the underlying indexes
 * make deep offsets cheap relative to the legacy "load everything"
 * behavior this replaces.
 */
export type FollowsPage = { limit?: number; offset?: number };
