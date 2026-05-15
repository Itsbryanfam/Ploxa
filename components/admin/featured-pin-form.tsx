"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";

import { pinFeaturedListFormAction } from "@/lib/recaps/featured";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Pin form — admin pastes a list UUID + optional expiry, and the wrapper
 * server action `pinFeaturedListFormAction` performs the validation
 * (list exists, is public) and the transactional swap. Errors are surfaced
 * inline via `useActionState`.
 *
 * The plan suggests "list URL or admin's own public lists dropdown" — we
 * accept the raw UUID for now (simplest path: admin opens DevTools on any
 * list page and copies the `lists.id`). A future polish item is parsing
 * full list URLs of shape `/u/:user/lists/:slug` server-side, or rendering
 * a dropdown of the admin's own public lists.
 *
 * On success the underlying `pinFeaturedList` calls `revalidatePath` on
 * both /discover and /admin/featured, so the parent page re-renders and
 * the "current pin" block flips to the new row. We don't need to reset
 * the form ourselves — the action returning `{ error: null }` plus the
 * page revalidation is enough signal that things landed.
 */
export function FeaturedPinForm() {
  const [state, action, pending] = useActionState<
    { error: string | null },
    FormData
  >(pinFeaturedListFormAction, { error: null });

  return (
    <section
      aria-labelledby="pin-form-heading"
      className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-6 space-y-4"
    >
      <div>
        <h2 id="pin-form-heading" className="text-lg font-semibold">
          Pin a list
        </h2>
        <p className="text-sm text-[var(--text-dim)] mt-1">
          The list must be public. Pinning a new list automatically unpins
          the previous one.
        </p>
      </div>

      <form action={action} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="listId">List ID</Label>
          <Input
            id="listId"
            name="listId"
            type="text"
            required
            placeholder="UUID (e.g. 5dc7f97c-…)"
            autoComplete="off"
            spellCheck={false}
            disabled={pending}
          />
          <p className="text-xs text-[var(--text-faint)]">
            Paste the `lists.id` UUID. Public lists only.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="pinnedUntil">Expires at (optional)</Label>
          <Input
            id="pinnedUntil"
            name="pinnedUntil"
            type="datetime-local"
            disabled={pending}
          />
          <p className="text-xs text-[var(--text-faint)]">
            Leave blank to pin indefinitely (until manually unpinned).
          </p>
        </div>

        {state.error && (
          <p
            role="alert"
            className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]"
          >
            {state.error}
          </p>
        )}

        <Button
          type="submit"
          variant="primary"
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? (
            <>
              <Loader2 className="animate-spin" aria-hidden="true" />
              Pinning…
            </>
          ) : (
            "Pin to /discover"
          )}
        </Button>
      </form>
    </section>
  );
}
