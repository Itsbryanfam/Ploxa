import { STATUS_ICONS } from "@/components/pixel";
import { STATUS_LABELS, type LogStatus } from "@/lib/db/schema-types";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: LogStatus;
  size?: "sm" | "md" | "lg";
  iconOnly?: boolean;
  className?: string;
}

const SIZE_PX = { sm: 12, md: 16, lg: 20 };
const TEXT_CLASS = { sm: "text-xs", md: "text-sm", lg: "text-base" };

const STATUS_TEXT_COLOR: Record<LogStatus, string> = {
  backlog: "text-[#9494a8]",
  playing: "text-[#7c5cff]",
  completed: "text-[#4ade80]",
  dropped: "text-[#f87171]",
  on_hold: "text-[#fbbf24]",
  wishlist: "text-[#ffb84a]",
};

export function StatusBadge({ status, size = "md", iconOnly, className }: StatusBadgeProps) {
  const Icon = STATUS_ICONS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5",
        TEXT_CLASS[size],
        STATUS_TEXT_COLOR[status],
        className,
      )}
      title={STATUS_LABELS[status]}
    >
      <Icon size={SIZE_PX[size]} />
      {!iconOnly && <span className="font-medium">{STATUS_LABELS[status]}</span>}
    </span>
  );
}
