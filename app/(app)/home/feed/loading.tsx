/**
 * Streaming skeleton for /home/feed. Matches FeedList's row shape: a
 * 40x40 avatar circle, a one-line action sentence, a relative-time line,
 * and an optional right-aligned 48x64 cover. Five rows is roughly one
 * viewport on a typical desktop and matches the perceived density of a
 * real feed. Server component — zero client JS.
 */
export default function FeedLoading() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8 space-y-3">
      <div className="h-7 w-24 rounded bg-[var(--bg-card)] animate-pulse" />
      <div className="space-y-3 pt-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <article
            key={i}
            className="flex items-center gap-3 p-4 rounded-lg border border-[var(--border)]"
          >
            <div className="h-10 w-10 rounded-full bg-[var(--bg-card)] animate-pulse shrink-0" />
            <div className="flex-1 min-w-0 space-y-2">
              <div className="h-4 w-3/4 max-w-xs rounded bg-[var(--bg-card)] animate-pulse" />
              <div className="h-3 w-20 rounded bg-[var(--bg-card)]/60 animate-pulse" />
            </div>
            <div className="h-16 w-12 rounded bg-[var(--bg-elev)] animate-pulse shrink-0" />
          </article>
        ))}
      </div>
    </div>
  );
}
