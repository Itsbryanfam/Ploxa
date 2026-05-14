/**
 * Streaming skeleton for /discover/reviews. Matches TrendingReviewsList:
 * a vertical stack of grid-cols-[80px_1fr] cards — game cover on the
 * left, hook + author block on the right. 6 placeholders feels close to
 * the first real-content viewport. Server component — zero client JS.
 */
export default function DiscoverReviewsLoading() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <header className="space-y-2">
        <div className="h-9 w-56 rounded bg-[var(--bg-card)] animate-pulse" />
        <div className="h-4 w-80 max-w-full rounded bg-[var(--bg-card)]/60 animate-pulse" />
      </header>

      <ul className="space-y-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <li
            key={i}
            className="grid grid-cols-[80px_1fr] gap-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4"
          >
            <div className="aspect-[3/4] rounded bg-[var(--bg-elev)] animate-pulse" />
            <div className="space-y-2">
              <div className="h-4 w-2/3 rounded bg-[var(--bg-elev)] animate-pulse" />
              <div className="h-3 w-1/3 rounded bg-[var(--bg-elev)]/70 animate-pulse" />
              <div className="h-3 w-full rounded bg-[var(--bg-elev)]/70 animate-pulse" />
              <div className="h-3 w-11/12 rounded bg-[var(--bg-elev)]/70 animate-pulse" />
              <div className="h-3 w-3/4 rounded bg-[var(--bg-elev)]/70 animate-pulse" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
