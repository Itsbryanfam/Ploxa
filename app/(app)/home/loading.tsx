/**
 * Streaming skeleton for the cockpit. Renders instantly while
 * CockpitDashboard's library + activity queries resolve, so the user sees
 * the page shape (no layout shift) instead of a blank panel below the
 * header. Matches the live layout: greeting strip, stats grid, three
 * status shelves, activity timeline. Server component — zero client JS.
 */
export default function HomeLoading() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-10">
      {/* Mascot greeting — matches MascotGreeting's flex layout */}
      <div className="flex items-center gap-6">
        <div className="h-48 w-48 rounded-md bg-[var(--bg-card)] animate-pulse" />
        <div className="flex-1 space-y-3">
          <div className="h-6 w-72 max-w-full rounded bg-[var(--bg-card)] animate-pulse" />
          <div className="h-4 w-56 max-w-full rounded bg-[var(--bg-card)]/60 animate-pulse" />
        </div>
      </div>

      {/* Stats strip — 4 boxes */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-[68px] rounded-lg border border-[var(--border-soft)] bg-[var(--bg-card)] animate-pulse"
          />
        ))}
      </div>

      {/* Three status shelves */}
      {Array.from({ length: 3 }).map((_, i) => (
        <section key={i} className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <div className="h-4 w-4 rounded-sm bg-[var(--bg-card)] animate-pulse" />
            <div className="h-4 w-32 rounded bg-[var(--bg-card)] animate-pulse" />
          </div>
          <div className="flex gap-3 overflow-x-hidden pb-2">
            {Array.from({ length: 6 }).map((_, j) => (
              <div
                key={j}
                className="flex-shrink-0 w-[140px] space-y-1.5"
              >
                <div className="aspect-[2/3] rounded-md border border-[var(--border-soft)] bg-[var(--bg-elev)] animate-pulse" />
                <div className="h-3 w-24 rounded bg-[var(--bg-card)]/60 animate-pulse" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
