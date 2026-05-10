import Link from "next/link";
import type { ActivityEvent } from "@/lib/logs/server-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { HeartFull } from "@/components/pixel";

export function ActivityTimeline({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) return null;
  return (
    <ul className="space-y-2">
      {events.map((e) => (
        <li
          key={e.logId}
          className="flex items-center gap-3 rounded-md border border-[var(--border-soft)] bg-[var(--bg-card)] px-3 py-2"
        >
          <StatusBadge status={e.status} size="sm" iconOnly />
          <Link
            href={`/games/${e.gameSlug}`}
            className="flex-1 text-sm text-[var(--text)] hover:text-[var(--accent)] truncate"
          >
            {e.gameTitle}
          </Link>
          {e.rating != null && (
            <span className="text-xs font-mono text-[var(--text-dim)] flex items-center gap-1">
              <HeartFull size={10} />
              {e.rating}
            </span>
          )}
          <span className="text-xs text-[var(--text-faint)]">{relativeTime(e.at)}</span>
        </li>
      ))}
    </ul>
  );
}

function relativeTime(d: Date): string {
  const ms = Date.now() - new Date(d).getTime();
  const min = ms / 60_000;
  const hr = min / 60;
  const day = hr / 24;
  if (min < 1) return "just now";
  if (min < 60) return `${Math.floor(min)}m ago`;
  if (hr < 24) return `${Math.floor(hr)}h ago`;
  if (day < 7) return `${Math.floor(day)}d ago`;
  return new Date(d).toLocaleDateString();
}
