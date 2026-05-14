/**
 * Streaming skeleton for the /settings tree. The settings layout renders
 * a 12-col grid with a 3-col sidebar and a 9-col content panel — we
 * mirror that here so first paint slots the chrome in immediately and
 * any deep route swaps just the right-hand panel. Server component —
 * zero client JS.
 */
export default function SettingsLoading() {
  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 h-8 w-32 rounded bg-[var(--bg-card)] animate-pulse" />
      <div className="grid grid-cols-12 gap-8">
        {/* Sidebar — 6 nav items matching SettingsSidebarNav */}
        <aside className="col-span-12 md:col-span-3 space-y-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-9 w-full rounded bg-[var(--bg-card)] animate-pulse"
            />
          ))}
        </aside>

        {/* Content panel — title + 4 form sections (label + input pairs) */}
        <main className="col-span-12 md:col-span-9 space-y-6">
          <div className="h-6 w-48 rounded bg-[var(--bg-card)] animate-pulse" />
          {Array.from({ length: 4 }).map((_, i) => (
            <section key={i} className="space-y-2">
              <div className="h-4 w-32 rounded bg-[var(--bg-card)] animate-pulse" />
              <div className="h-10 w-full rounded-md border border-[var(--border-soft)] bg-[var(--bg-card)] animate-pulse" />
            </section>
          ))}
        </main>
      </div>
    </div>
  );
}
