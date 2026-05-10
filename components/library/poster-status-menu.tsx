"use client";

import { useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { updateLogStatus } from "@/lib/logs/server-actions";
import { LOG_STATUSES, STATUS_LABELS, type LogStatus } from "@/lib/db/schema-types";
import { STATUS_ICONS } from "@/components/pixel";
import { cn } from "@/lib/utils";

interface Props {
  logId: string;
  currentStatus: LogStatus;
  onClose: () => void;
}

export function PosterStatusMenu({ logId, currentStatus, onClose }: Props) {
  const [pending, startTransition] = useTransition();
  const queryClient = useQueryClient();

  function handlePick(status: LogStatus) {
    if (status === currentStatus) {
      onClose();
      return;
    }
    startTransition(async () => {
      const result = await updateLogStatus({ logId, status });
      if (result.ok) {
        await queryClient.invalidateQueries({ queryKey: ["library"] });
        await queryClient.invalidateQueries({ queryKey: ["status-shelf"] });
      }
      onClose();
    });
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      className="absolute top-2 right-2 z-10 bg-[var(--bg-card)] border border-[var(--border)] rounded-md shadow-[var(--shadow-elev)] py-1 min-w-[140px]"
      onClick={(e) => e.stopPropagation()}
    >
      {LOG_STATUSES.map((s) => {
        const Icon = STATUS_ICONS[s];
        const isCurrent = s === currentStatus;
        return (
          <button
            key={s}
            type="button"
            onClick={() => handlePick(s)}
            disabled={pending}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors",
              isCurrent
                ? "text-[var(--accent)] cursor-default"
                : "text-[var(--text-dim)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text)]",
            )}
          >
            <Icon size={12} />
            {STATUS_LABELS[s]}
            {isCurrent && <span className="ml-auto">•</span>}
          </button>
        );
      })}
    </motion.div>
  );
}
