/**
 * Streaming skeleton for /u/[username]/lists/[listSlug]. The live page
 * shows a header (title + author chip + description) followed by an
 * ordered grid of game tiles. We approximate that with a header block
 * + a 6-col cover grid sized like PopularGamesGrid. Server component —
 * zero client JS.
 */
export default function ListDetailLoading() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-8">
      <header className="space-y-3">
        <div className="h-8 w-64 max-w-full rounded bg-[var(--bg-card)] animate-pulse" />
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-[var(--bg-card)] animate-pulse" />
          <div className="h-4 w-32 rounded bg-[var(--bg-card)]/60 animate-pulse" />
        </div>
        <div className="space-y-2 pt-2">
          <div className="h-3 w-full max-w-2xl rounded bg-[var(--bg-card)]/60 animate-pulse" />
          <div className="h-3 w-5/6 max-w-2xl rounded bg-[var(--bg-card)]/60 animate-pulse" />
        </div>
      </header>

      <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {Array.from({ length: 18 }).map((_, i) => (
          <li key={i} className="space-y-2">
            <div className="aspect-[3/4] rounded-md border border-[var(--border-soft)] bg-[var(--bg-elev)] animate-pulse" />
            <div className="h-3 w-3/4 rounded bg-[var(--bg-card)]/60 animate-pulse" />
          </li>
        ))}
      </ul>
    </div>
  );
}
