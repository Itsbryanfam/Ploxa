/**
 * Streaming skeleton for /discover/games. Matches PopularGamesGrid's
 * responsive 2/3/4/6-col grid with 24 tile placeholders (a touch over a
 * laptop viewport on lg). Server component — zero client JS.
 */
export default function DiscoverGamesLoading() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <header className="space-y-2">
        <div className="h-9 w-56 rounded bg-[var(--bg-card)] animate-pulse" />
        <div className="h-4 w-80 max-w-full rounded bg-[var(--bg-card)]/60 animate-pulse" />
      </header>

      <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {Array.from({ length: 24 }).map((_, i) => (
          <li key={i} className="space-y-2">
            <div className="aspect-[3/4] rounded-md border border-[var(--border-soft)] bg-[var(--bg-elev)] animate-pulse" />
            <div className="h-3 w-3/4 rounded bg-[var(--bg-card)]/60 animate-pulse" />
          </li>
        ))}
      </ul>
    </div>
  );
}
