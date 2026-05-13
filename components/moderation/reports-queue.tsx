import { ModerationActions } from "./moderation-actions";

type Report = {
  id: string;
  reporterId: string | null;
  targetType: string;
  targetId: string;
  reason: string;
  details: string | null;
  status: string;
  createdAt: Date;
};

/**
 * Server component. Renders the admin queue list. Each row carries the
 * `ModerationActions` client component for resolve buttons.
 */
export function ReportsQueue({ reports }: { reports: Report[] }) {
  if (reports.length === 0) {
    return <p className="text-sm text-[var(--text-dim)]">No pending reports. Quiet day.</p>;
  }
  return (
    <ul className="space-y-3">
      {reports.map((r) => (
        <li
          key={r.id}
          className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4 space-y-2"
        >
          <header className="flex items-center justify-between gap-2 text-xs text-[var(--text-dim)]">
            <span className="font-mono">
              {r.targetType} · {r.reason}
              {r.status === "auto_flagged" ? " · auto-flagged" : ""}
            </span>
            <span>{new Date(r.createdAt).toLocaleString()}</span>
          </header>
          <p className="text-sm font-mono text-[var(--text-faint)] break-all">
            id: {r.targetId}
          </p>
          {r.details && (
            <p className="text-sm text-[var(--text-dim)] leading-relaxed">{r.details}</p>
          )}
          <ModerationActions reportId={r.id} targetType={r.targetType} />
        </li>
      ))}
    </ul>
  );
}
