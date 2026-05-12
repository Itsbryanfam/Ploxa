/**
 * Streaming skeleton for /library. Matches the live page chrome
 * (header text, filter chips row, sort + view toggle) plus a shelf-view
 * placeholder grid sized to the same `auto-fill, minmax(120px, 1fr)`
 * track the real grid uses — so when the data lands there's zero
 * horizontal layout shift. Server component — zero client JS.
 */
export default function LibraryLoading() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <header className="space-y-2">
        <div className="h-7 w-28 rounded bg-[var(--bg-card)] animate-pulse" />
        <div className="h-4 w-44 rounded bg-[var(--bg-card)]/60 animate-pulse" />
      </header>

      <div className="space-y-6">
        {/* Filter chips + sort + view toggle row */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-2 flex-wrap">
            {Array.from({ length: 7 }).map((_, i) => (
              <div
                key={i}
                className="h-8 w-20 rounded-md border border-[var(--border-soft)] bg-[var(--bg-card)] animate-pulse"
              />
            ))}
          </div>
          <div className="flex items-center gap-3">
            <div className="h-8 w-32 rounded-md border border-[var(--border-soft)] bg-[var(--bg-card)] animate-pulse" />
            <div className="h-8 w-44 rounded-md border border-[var(--border)] bg-[var(--bg-card)] animate-pulse" />
          </div>
        </div>

        {/* Shelf grid — matches the real grid's track sizing exactly. */}
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))" }}
        >
          {Array.from({ length: 18 }).map((_, i) => (
            <div
              key={i}
              className="aspect-[2/3] rounded-md border border-[var(--border-soft)] bg-[var(--bg-elev)] animate-pulse"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
