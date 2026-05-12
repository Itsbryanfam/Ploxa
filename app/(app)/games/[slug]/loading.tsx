/**
 * Streaming skeleton for /games/[slug] — the LCP-critical detail page.
 * Pre-rendering the hero shape (192px tall full-width slab) gives the
 * browser an immediate paint target so the percieved LCP arrives before
 * the actual cover image loads. Server component — zero client JS.
 */
export default function GameLoading() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="space-y-6">
        {/* Hero — matches the real .h-72 negative-margin hero */}
        <div className="relative h-72 -mt-6 -mx-6 overflow-hidden bg-[var(--bg-card)] animate-pulse">
          <div className="absolute bottom-0 left-0 right-0 p-6 space-y-2">
            <div className="h-9 w-2/3 max-w-md rounded bg-[var(--bg-card-hover)] animate-pulse" />
            <div className="h-4 w-16 rounded bg-[var(--bg-card-hover)]/60 animate-pulse" />
          </div>
        </div>

        {/* Meta strip — genre chips + platform icons + score */}
        <div className="flex flex-wrap gap-2 items-center">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-6 w-16 rounded-md border border-[var(--border)] bg-[var(--bg-card)] animate-pulse"
            />
          ))}
          <div className="ml-auto h-4 w-16 rounded bg-[var(--bg-card)]/60 animate-pulse" />
        </div>

        {/* Log card / "Not logged" CTA placeholder */}
        <div className="h-24 rounded-lg border-2 border-dashed border-[var(--border)] bg-[var(--bg-card)]/40 animate-pulse" />

        {/* Description placeholder */}
        <div className="space-y-2">
          <div className="h-4 w-3/4 rounded bg-[var(--bg-card)]/60 animate-pulse" />
          <div className="h-4 w-full rounded bg-[var(--bg-card)]/60 animate-pulse" />
          <div className="h-4 w-2/3 rounded bg-[var(--bg-card)]/60 animate-pulse" />
        </div>

        {/* Screenshots row */}
        <div className="space-y-3">
          <div className="h-4 w-28 rounded bg-[var(--bg-card)] animate-pulse" />
          <div className="flex gap-2 overflow-x-hidden">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="flex-shrink-0 w-72 aspect-video rounded-md bg-[var(--bg-elev)] border border-[var(--border-soft)] animate-pulse"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
