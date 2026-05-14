/**
 * Streaming skeleton for /u/[username]/lists. Matches ListCard's
 * thumbnail + title + meta row, in a vertical stack (the live page uses
 * `space-y-3` between cards, not a grid). Server component — zero
 * client JS.
 */
export default function ListsLoading() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-8 space-y-6">
      <header className="space-y-2">
        <div className="h-7 w-32 rounded bg-[var(--bg-card)] animate-pulse" />
        <div className="h-4 w-64 max-w-full rounded bg-[var(--bg-card)]/60 animate-pulse" />
      </header>

      <ul className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <li
            key={i}
            className="flex gap-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4"
          >
            <div className="h-20 w-16 rounded bg-[var(--bg-elev)] animate-pulse shrink-0" />
            <div className="flex-1 min-w-0 space-y-2">
              <div className="h-4 w-1/2 rounded bg-[var(--bg-elev)] animate-pulse" />
              <div className="h-3 w-1/4 rounded bg-[var(--bg-elev)]/70 animate-pulse" />
              <div className="h-3 w-4/5 rounded bg-[var(--bg-elev)]/70 animate-pulse" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
