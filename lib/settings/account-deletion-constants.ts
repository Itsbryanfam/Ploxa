/**
 * Single source of truth for the soft-delete grace window. Lives in its own
 * module (no `"use server"` directive) because Next.js 16 Turbopack only
 * allows async-function exports from `"use server"` files.
 *
 * Used by:
 *   - app/auth/callback/route.ts (within-grace → /cancel-deletion)
 *   - app/(app)/cancel-deletion/page.tsx (compute restoreBy = deletedAt + grace)
 *   - app/account-deleted/page.tsx (estimate restoreBy from now())
 *   - supabase/functions/account-purge/index.ts uses INTERVAL '30 days' literal —
 *     keep that in lock-step if this constant ever changes.
 */
export const DELETION_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
