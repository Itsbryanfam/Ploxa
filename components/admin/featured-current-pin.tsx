"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";

import { unpinFeaturedListFormAction } from "@/lib/recaps/featured";
import type { FeaturedListSummary } from "@/lib/recaps/featured-read";
import { Button } from "@/components/ui/button";

/**
 * Renders the currently-pinned featured list (or an empty state when no row
 * is pinned). Includes an Unpin button that calls `unpinFeaturedList` via a
 * `useActionState` wrapper so server-side errors surface inline rather than
 * vanishing into the form-action fire-and-forget hole.
 *
 * Display is a self-contained inline preview (cover composite + title +
 * author + item count) rather than the public `FeaturedListCard` (T9) so
 * this component renders before T9 lands and stays usable in admin context.
 * If/when we want pixel-parity between admin preview and the public render,
 * swap this for `<FeaturedListCard>` once it exists.
 */
export function FeaturedCurrentPin({
  pin,
}: {
  pin: FeaturedListSummary | null;
}) {
  const [state, action, pending] = useActionState<
    { error: string | null },
    FormData
  >(unpinFeaturedListFormAction, { error: null });

  if (!pin) {
    return (
      <section
        aria-labelledby="current-pin-heading"
        className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-6"
      >
        <h2 id="current-pin-heading" className="text-lg font-semibold">
          Current pin
        </h2>
        <p className="mt-2 text-sm text-[var(--text-dim)]">
          No active pin. Use the form below to pin a list to /discover.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="current-pin-heading"
      className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-6 space-y-4"
    >
      <h2 id="current-pin-heading" className="text-lg font-semibold">
        Current pin
      </h2>

      <div className="flex gap-4">
        <CoverComposite urls={pin.coverUrls} />
        <div className="flex-1 min-w-0 space-y-1">
          <Link
            href={`/u/${pin.authorUsername}/lists/${pin.listSlug}`}
            className="font-semibold text-base hover:text-[var(--accent)] transition-colors break-words"
          >
            {pin.listTitle}
          </Link>
          <p className="text-sm text-[var(--text-dim)]">
            by{" "}
            <Link
              href={`/u/${pin.authorUsername}`}
              className="hover:text-[var(--accent)] transition-colors"
            >
              @{pin.authorUsername}
            </Link>
          </p>
          <p className="text-xs text-[var(--text-faint)]">
            {pin.itemCount} {pin.itemCount === 1 ? "game" : "games"}
          </p>
        </div>
      </div>

      <form action={action}>
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? (
            <>
              <Loader2 className="animate-spin" aria-hidden="true" />
              Unpinning…
            </>
          ) : (
            "Unpin"
          )}
        </Button>
      </form>

      {state.error && (
        <p
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]"
        >
          {state.error}
        </p>
      )}
    </section>
  );
}

/**
 * Compact 2x2 cover composite. Empty slots get a neutral panel so the grid
 * keeps its shape regardless of how many covers the list has.
 */
function CoverComposite({ urls }: { urls: string[] }) {
  const slots = [0, 1, 2, 3].map((i) => urls[i] ?? null);
  return (
    <div
      className="grid grid-cols-2 grid-rows-2 gap-0.5 shrink-0 rounded overflow-hidden"
      style={{ width: 72, height: 96 }}
      aria-hidden="true"
    >
      {slots.map((url, i) =>
        url ? (
          // eslint-disable-next-line @next/next/no-img-element -- RAWG/Supabase covers aren't in remotePatterns
          <img
            key={i}
            src={url}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          <div key={i} className="w-full h-full bg-[var(--bg)]" />
        ),
      )}
    </div>
  );
}
