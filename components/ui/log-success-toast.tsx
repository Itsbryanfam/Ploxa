import { PixelCheckmark } from "@/components/pixel";
import { STATUS_LABELS, type LogStatus } from "@/lib/db/schema-types";

export function LogSuccessToast({ title, status }: { title: string; status: LogStatus }) {
  return (
    <div className="flex items-start gap-3 py-1">
      <PixelCheckmark size={20} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--text)] truncate">{title}</p>
        <p className="text-xs text-[var(--text-dim)]">Logged as {STATUS_LABELS[status]}</p>
      </div>
    </div>
  );
}
