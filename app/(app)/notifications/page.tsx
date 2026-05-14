import { redirect } from "next/navigation";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import {
  getInbox,
  getUnreadCount,
  markAllRead,
  type InboxFilter,
} from "@/lib/social/notifications/server-actions";
import { NotificationRow } from "@/components/notifications/notification-row";
import { Mascot } from "@/components/mascot/mascot";

export const metadata = { title: "Notifications" };

const FILTERS: Array<{ value: InboxFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "follows", label: "Follows" },
  { value: "reactions", label: "Reactions" },
  { value: "comments", label: "Comments" },
  { value: "wishlist", label: "Wishlist" },
];

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: InboxFilter }>;
}) {
  const user = await getCachedUser();
  if (!user) redirect("/login?next=/notifications");

  const { filter = "all" } = await searchParams;

  // Parallel — both queries are user-scoped and don't depend on each other.
  const [items, unreadCount] = await Promise.all([
    getInbox({ filter }),
    getUnreadCount(),
  ]);

  async function handleMarkAllRead() {
    "use server";
    await markAllRead();
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="text-sm text-[var(--text-dim)] mt-1">{unreadCount} unread</p>
        </div>
        {unreadCount > 0 && (
          <form action={handleMarkAllRead}>
            <button
              type="submit"
              className="px-3 py-1.5 text-sm rounded-md border border-[var(--border)] hover:border-[var(--border-hover)]"
            >
              Mark all read
            </button>
          </form>
        )}
      </header>

      <nav className="flex gap-2 overflow-x-auto" aria-label="Notification filters">
        {FILTERS.map((f) => (
          <a
            key={f.value}
            href={f.value === "all" ? "/notifications" : `/notifications?filter=${f.value}`}
            className={`px-3 py-1.5 text-sm rounded-full whitespace-nowrap ${
              filter === f.value
                ? "bg-[var(--accent)] text-white"
                : "border border-[var(--border)] hover:border-[var(--border-hover)]"
            }`}
          >
            {f.label}
          </a>
        ))}
      </nav>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Mascot size="lg" mood="idle" silent />
          <p className="text-sm text-[var(--text-dim)]">
            No notifications yet. Try saying hi to someone.
          </p>
        </div>
      ) : (
        <ul className="space-y-1">
          {items.map((row) => (
            <NotificationRow key={row.id} row={row} />
          ))}
        </ul>
      )}
    </div>
  );
}
