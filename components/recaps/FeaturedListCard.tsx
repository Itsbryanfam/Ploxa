import Link from "next/link";

import type { FeaturedListSummary } from "@/lib/recaps/featured-read";

/**
 * FeaturedListCard — Phase 6 T9.
 *
 * Public-facing render of the currently-pinned featured list on /discover.
 * Pure presentational server component: takes a `FeaturedListSummary` and
 * renders a poster-grid composite + title + author meta, linking to the
 * canonical list URL.
 *
 * Design notes:
 * - Uses plain `<img>` (not `next/image`) because cover URLs come from
 *   RAWG / Supabase Storage and are not declared in `remotePatterns`. This
 *   matches `components/lists/list-card.tsx` and the admin preview in
 *   `components/admin/featured-current-pin.tsx`.
 * - The cover composite is a 2x2 grid that gracefully degrades when fewer
 *   than 4 covers are available — empty slots become neutral panels so the
 *   shape stays consistent. Mirrors the admin `CoverComposite` pattern.
 * - Eyebrow / title / count use the same `var(--*)` CSS variables as the
 *   rest of the site theme.
 * - Wrapping `<article>` carries semantic meaning for the public list
 *   feature, and the `<Link>` covers the whole card surface (matches the
 *   established list-card behavior).
 */
export function FeaturedListCard({ pin }: { pin: FeaturedListSummary }) {
  const href = `/u/${pin.authorUsername}/lists/${pin.listSlug}`;
  const covers = pin.coverUrls.slice(0, 4);
  return (
    <article className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-6 hover:bg-[var(--bg-card-hover)] hover:border-[var(--accent)] transition-colors">
      <Link href={href} className="block">
        <div className="flex gap-4">
          <CoverComposite urls={covers} />
          <div className="flex-1 min-w-0">
            <p className="text-xs uppercase tracking-wider text-[var(--accent)]">
              Picked by us
            </p>
            <h3 className="text-lg font-semibold text-[var(--text)] mt-1 break-words">
              {pin.listTitle}
            </h3>
            <p className="text-sm text-[var(--text-dim)] mt-1">
              {pin.itemCount} {pin.itemCount === 1 ? "game" : "games"}
            </p>
          </div>
        </div>
      </Link>
    </article>
  );
}

/**
 * Compact 2x2 cover composite. Empty slots render as neutral panels so the
 * grid keeps a stable shape regardless of how many covers the list has.
 * Aria-hidden because the wrapping link already labels the destination.
 */
function CoverComposite({ urls }: { urls: string[] }) {
  const slots = [0, 1, 2, 3].map((i) => urls[i] ?? null);
  return (
    <div
      className="grid grid-cols-2 grid-rows-2 gap-0.5 shrink-0 rounded-lg overflow-hidden"
      style={{ width: 96, height: 96 }}
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
