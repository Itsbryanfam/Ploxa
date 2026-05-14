/**
 * Streaming skeleton for /u/[username]. Matches ProfileOverviewHeader
 * (avatar + name block + follow/block buttons) followed by the stats
 * strip, taste snippet, and the truncated library shelf the page renders.
 * Server component — zero client JS.
 */
export default function ProfileLoading() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-10">
      {/* Header — avatar + name + follow buttons */}
      <header className="flex items-start gap-6">
        <div className="h-32 w-32 rounded-md bg-[var(--bg-card)] animate-pulse shrink-0" />
        <div className="flex-1 space-y-3">
          <div className="h-7 w-48 max-w-full rounded bg-[var(--bg-card)] animate-pulse" />
          <div className="h-4 w-32 rounded bg-[var(--bg-card)]/60 animate-pulse" />
          <div className="flex gap-2 pt-2">
            <div className="h-9 w-24 rounded-md border border-[var(--border-soft)] bg-[var(--bg-card)] animate-pulse" />
            <div className="h-9 w-24 rounded-md border border-[var(--border-soft)] bg-[var(--bg-card)] animate-pulse" />
          </div>
        </div>
      </header>

      {/* Stats strip — 4 boxes */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-[68px] rounded-lg border border-[var(--border-soft)] bg-[var(--bg-card)] animate-pulse"
          />
        ))}
      </div>

      {/* Taste snippet — two short chart strips */}
      <section className="space-y-3">
        <div className="h-5 w-40 rounded bg-[var(--bg-card)] animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-card)] p-4 space-y-2"
            >
              {Array.from({ length: 3 }).map((__, j) => (
                <div
                  key={j}
                  className="h-3 w-full rounded bg-[var(--bg-elev)] animate-pulse"
                />
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* Library shelf preview */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="h-5 w-32 rounded bg-[var(--bg-card)] animate-pulse" />
          <div className="h-4 w-16 rounded bg-[var(--bg-card)]/60 animate-pulse" />
        </div>
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))" }}
        >
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="aspect-[2/3] rounded-md border border-[var(--border-soft)] bg-[var(--bg-elev)] animate-pulse"
            />
          ))}
        </div>
      </section>
    </div>
  );
}
