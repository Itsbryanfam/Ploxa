/**
 * Streaming skeleton for /play-next. The page enters at the "time" step
 * by default (three pill buttons stacked under a prompt), but the URL
 * can deep-link to the "done" results view directly — which renders a
 * 3-card rec grid. We render a shape that fits the most-common first
 * paint (the filter-chip flow), since that's what unprimed visitors hit.
 * Server component — zero client JS.
 */
export default function PlayNextLoading() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 space-y-8">
      <header className="space-y-2">
        <div className="h-7 w-72 max-w-full rounded bg-[var(--bg-card)] animate-pulse" />
      </header>

      {/* Mascot prompt — left-aligned avatar + question copy */}
      <div className="flex items-start gap-4">
        <div className="h-20 w-20 rounded-md bg-[var(--bg-card)] animate-pulse shrink-0" />
        <div className="flex-1 space-y-2 pt-2">
          <div className="h-5 w-2/3 rounded bg-[var(--bg-card)] animate-pulse" />
          <div className="h-3 w-1/3 rounded bg-[var(--bg-card)]/60 animate-pulse" />
        </div>
      </div>

      {/* Filter pills — three large stacked options */}
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-14 w-full rounded-lg border border-[var(--border-soft)] bg-[var(--bg-card)] animate-pulse"
          />
        ))}
      </div>
    </main>
  );
}
