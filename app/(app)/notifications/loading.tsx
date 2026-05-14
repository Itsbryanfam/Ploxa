/**
 * Streaming skeleton for /notifications. Matches NotificationRow's shape
 * (40x40 avatar circle + two-line text) plus the page header + filter
 * tabs strip the real page renders. Server component — zero client JS.
 */
export default function NotificationsLoading() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-8 space-y-6">
      {/* Header — title + unread count strip */}
      <header className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-7 w-44 rounded bg-[var(--bg-card)] animate-pulse" />
          <div className="h-4 w-20 rounded bg-[var(--bg-card)]/60 animate-pulse" />
        </div>
        <div className="h-9 w-32 rounded-md border border-[var(--border-soft)] bg-[var(--bg-card)] animate-pulse" />
      </header>

      {/* Filter tabs — 5 chips matching the FILTERS constant */}
      <div className="flex gap-2 flex-wrap">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-8 w-20 rounded-md border border-[var(--border-soft)] bg-[var(--bg-card)] animate-pulse"
          />
        ))}
      </div>

      {/* Notification rows */}
      <ul className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <li
            key={i}
            className="flex items-center gap-3 p-3 rounded"
          >
            <div className="h-10 w-10 rounded-full bg-[var(--bg-card)] animate-pulse shrink-0" />
            <div className="flex-1 min-w-0 space-y-2">
              <div className="h-4 w-2/3 rounded bg-[var(--bg-card)] animate-pulse" />
              <div className="h-3 w-16 rounded bg-[var(--bg-card)]/60 animate-pulse" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
