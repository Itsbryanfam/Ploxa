"use client";
import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";

import { ModerationActions } from "./moderation-actions";

type Report = {
  id: string;
  reporterId: string | null;
  targetType: string;
  targetId: string;
  reason: string;
  details: string | null;
  status: string;
  createdAt: Date | string;
  /**
   * Resolved canonical URL for the reported content. Null when the target was
   * hard-deleted or its author was soft-deleted (lib/social/moderation/queue.ts
   * builds this via the per-target_type batched JOINs in getReportQueue).
   */
  targetUrl: string | null;
};

type Filter = "all" | "auto_flagged" | "user_reported";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "auto_flagged", label: "Auto-flagged" },
  { value: "user_reported", label: "User-reported" },
];

/**
 * Client component. Renders the admin queue list with:
 *   - per-row link to the actual reported content (no more bare UUID — see
 *     T10 of audit-fixes-2026-05-14)
 *   - filter chip to separate the auto-flag firehose from human reports
 *   - optimistic per-row removal on resolve, so the row vanishes the instant
 *     the action returns rather than waiting for router.refresh() to land
 *
 * Was previously a server component (just rendered `<p>id: {targetId}</p>`).
 * Promoted to client so we can hold filter state + the optimistic
 * "just-resolved" set without round-tripping the server. The actual
 * resolveReport call still runs server-side via the action passed to
 * ModerationActions.
 */
export function ReportsQueue({ reports }: { reports: Report[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(() => new Set());

  const filtered = useMemo(() => {
    return reports.filter((r) => {
      if (resolvedIds.has(r.id)) return false;
      if (filter === "auto_flagged") return r.status === "auto_flagged";
      if (filter === "user_reported") return r.status !== "auto_flagged";
      return true;
    });
  }, [reports, filter, resolvedIds]);

  function handleResolved(reportId: string) {
    setResolvedIds((prev) => {
      const next = new Set(prev);
      next.add(reportId);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <nav className="flex gap-2 overflow-x-auto" aria-label="Report filters">
        {FILTERS.map((f) => {
          const active = filter === f.value;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={`px-3 py-1.5 text-sm rounded-full whitespace-nowrap transition-colors ${
                active
                  ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                  : "border border-[var(--border)] hover:border-[var(--border-hover)] text-[var(--text-dim)]"
              }`}
              aria-pressed={active}
            >
              {f.label}
            </button>
          );
        })}
      </nav>

      {filtered.length === 0 ? (
        <p className="text-sm text-[var(--text-dim)]">
          {filter === "all"
            ? "No pending reports. Quiet day."
            : `No ${filter === "auto_flagged" ? "auto-flagged" : "user-reported"} items.`}
        </p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((r) => (
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
              {r.targetUrl ? (
                <a
                  href={r.targetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-[var(--accent)] hover:underline"
                >
                  View content
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
              ) : (
                <p className="text-sm text-[var(--text-faint)] italic">
                  (target deleted — review by id only)
                </p>
              )}
              {r.details && (
                <p className="text-sm text-[var(--text-dim)] leading-relaxed">{r.details}</p>
              )}
              <ModerationActions
                reportId={r.id}
                targetType={r.targetType}
                onResolved={() => handleResolved(r.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
