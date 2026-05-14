/**
 * Streaming skeleton for the /discover landing hub. Matches the three-
 * section layout of the live page: Popular this week (6-cover row),
 * Trending reviews (4 vertical rows), Similar users (4-card grid).
 * Server component — zero client JS.
 */
export default function DiscoverLoading() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-12">
      <header className="space-y-2">
        <div className="h-9 w-40 rounded bg-[var(--bg-card)] animate-pulse" />
        <div className="h-4 w-80 max-w-full rounded bg-[var(--bg-card)]/60 animate-pulse" />
      </header>

      {/* Popular games — 6-cover row */}
      <section className="space-y-4">
        <div className="flex items-baseline justify-between gap-4">
          <div className="h-6 w-48 rounded bg-[var(--bg-card)] animate-pulse" />
          <div className="h-4 w-16 rounded bg-[var(--bg-card)]/60 animate-pulse" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="aspect-[3/4] rounded-md border border-[var(--border-soft)] bg-[var(--bg-elev)] animate-pulse"
            />
          ))}
        </div>
      </section>

      {/* Trending reviews — 4 row cards */}
      <section className="space-y-4">
        <div className="flex items-baseline justify-between gap-4">
          <div className="h-6 w-44 rounded bg-[var(--bg-card)] animate-pulse" />
          <div className="h-4 w-16 rounded bg-[var(--bg-card)]/60 animate-pulse" />
        </div>
        <ul className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <li
              key={i}
              className="grid grid-cols-[80px_1fr] gap-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4"
            >
              <div className="aspect-[3/4] rounded bg-[var(--bg-elev)] animate-pulse" />
              <div className="space-y-2">
                <div className="h-4 w-2/3 rounded bg-[var(--bg-elev)] animate-pulse" />
                <div className="h-3 w-1/3 rounded bg-[var(--bg-elev)]/70 animate-pulse" />
                <div className="h-3 w-full rounded bg-[var(--bg-elev)]/70 animate-pulse" />
                <div className="h-3 w-5/6 rounded bg-[var(--bg-elev)]/70 animate-pulse" />
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Similar users — 4-card grid */}
      <section className="space-y-4">
        <div className="flex items-baseline justify-between gap-4">
          <div className="h-6 w-56 rounded bg-[var(--bg-card)] animate-pulse" />
          <div className="h-4 w-16 rounded bg-[var(--bg-card)]/60 animate-pulse" />
        </div>
        <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <li
              key={i}
              className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4 flex flex-col items-center gap-3"
            >
              <div className="h-16 w-16 rounded-full bg-[var(--bg-elev)] animate-pulse" />
              <div className="h-4 w-24 rounded bg-[var(--bg-elev)] animate-pulse" />
              <div className="h-3 w-16 rounded bg-[var(--bg-elev)]/70 animate-pulse" />
              <div className="h-8 w-full rounded-md border border-[var(--border-soft)] bg-[var(--bg-elev)] animate-pulse mt-2" />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
