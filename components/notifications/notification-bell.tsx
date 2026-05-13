"use client";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";

import { getUnreadCount } from "@/lib/social/notifications/server-actions";

const POLL_INTERVAL_MS = 60_000;

/**
 * Bell badge with 60-second polling. Fetches the viewer's unread count
 * via the getUnreadCount server action (which internally resolves the
 * viewer via getCachedUser — no userId prop needed).
 *
 * Silent failure: the bell badge isn't critical; if the poll errors we
 * keep the last value rather than surfacing a UI error.
 *
 * Uses lucide-react Bell (SVG) — the project memory bans emojis in
 * product UI so the plan's 🔔 span is replaced with an icon.
 */
export function NotificationBell() {
  const [count, setCount] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const n = await getUnreadCount();
        if (!cancelled) setCount(n);
      } catch {
        // Silent failure — keep last value.
      }
    }

    void poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <a
      href="/notifications"
      className="relative inline-flex items-center p-2 rounded hover:bg-[var(--bg-card)] transition"
      aria-label={`Notifications${count > 0 ? `, ${count} unread` : ""}`}
    >
      <Bell size={18} aria-hidden />
      {count > 0 && (
        <span className="absolute top-0 right-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-medium rounded-full bg-[var(--accent)] text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </a>
  );
}
