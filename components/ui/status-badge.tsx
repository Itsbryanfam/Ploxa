import { memo } from "react";
import { COLORS, STATUS_ICONS } from "@/components/pixel/status-icons";
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

export const StatusBadge = memo(function StatusBadge({ status, size = "md", iconOnly, className }: StatusBadgeProps) {
  const Icon = STATUS_ICONS[status];
  return (
    <span
      className={cn("inline-flex items-center gap-1.5", TEXT_CLASS[size], className)}
      style={{ color: COLORS[status] }}
      title={STATUS_LABELS[status]}
    >
      <Icon size={SIZE_PX[size]} />
      {!iconOnly && <span className="font-medium">{STATUS_LABELS[status]}</span>}
    </span>
  );
});
