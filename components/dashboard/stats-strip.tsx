import type { UserStats } from "@/lib/logs/server-actions";
import { STATUS_LABELS } from "@/lib/db/schema-types";
import { HeartFull } from "@/components/pixel";

export function StatsStrip({ stats }: { stats: UserStats }) {
  const { total, byStatus, averageRating } = stats;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Stat label="Total" value={String(total)} />
      <Stat label={STATUS_LABELS.playing} value={String(byStatus.playing)} accent="#7c5cff" />
      <Stat label={STATUS_LABELS.completed} value={String(byStatus.completed)} accent="#4ade80" />
      <Stat
        label="Avg rating"
        value={averageRating != null ? String(averageRating) : "—"}
        icon={<HeartFull size={14} />}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  icon,
}: {
  label: string;
  value: string;
  accent?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-card)] px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-[var(--text-faint)]">{label}</p>
      <p
        className="text-2xl font-bold mt-0.5 flex items-center gap-2"
        style={accent ? { color: accent } : undefined}
      >
        {icon}
        {value}
      </p>
    </div>
  );
}
