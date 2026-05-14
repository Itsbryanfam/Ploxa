/**
 * Streaming skeleton for /u/[username]/taste. Matches ChartGrid's
 * 1/2/3-col responsive layout with 5 chart cards (genres, themes,
 * mechanics, modes, perspectives) plus a length-preference card.
 * Each card shows 5 ScoreBar rows — those are the bone-coloured bars
 * here. Server component — zero client JS.
 */
export default function TasteLoading() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="h-7 w-48 rounded bg-[var(--bg-card)] animate-pulse" />
          <div className="h-4 w-80 max-w-full rounded bg-[var(--bg-card)]/60 animate-pulse" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-24 rounded-md border border-[var(--border-soft)] bg-[var(--bg-card)] animate-pulse" />
          <div className="h-9 w-9 rounded-md border border-[var(--border-soft)] bg-[var(--bg-card)] animate-pulse" />
        </div>
      </header>

      {/* 6-card chart grid: 5 vector charts + length-preference card */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-card)] p-4 space-y-3"
          >
            <div className="h-4 w-28 rounded bg-[var(--bg-elev)] animate-pulse" />
            <div className="space-y-2 pt-1">
              {Array.from({ length: 5 }).map((__, j) => (
                <div key={j} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="h-3 w-20 rounded bg-[var(--bg-elev)]/80 animate-pulse" />
                    <div className="h-3 w-8 rounded bg-[var(--bg-elev)]/60 animate-pulse" />
                  </div>
                  <div className="h-2 w-full rounded bg-[var(--bg-elev)] animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
