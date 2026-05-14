/**
 * Streaming skeleton for /discover/people. Matches SimilarUsersRow's
 * 1/2/3/4-col grid of avatar + name + tier-badge + follow-button cards.
 * 8 placeholders ≈ 2 rows on lg. Server component — zero client JS.
 */
export default function DiscoverPeopleLoading() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <header className="space-y-2">
        <div className="h-9 w-72 max-w-full rounded bg-[var(--bg-card)] animate-pulse" />
        <div className="h-4 w-80 max-w-full rounded bg-[var(--bg-card)]/60 animate-pulse" />
      </header>

      <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
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
    </div>
  );
}
