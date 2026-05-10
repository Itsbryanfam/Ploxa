"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { LOG_STATUSES, STATUS_LABELS, type LogStatus } from "@/lib/db/schema-types";
import { COLORS, STATUS_ICONS } from "@/components/pixel/status-icons";
import { cn } from "@/lib/utils";

const ROTATIONS = ["-rotate-1", "rotate-1", "-rotate-[0.5deg]", "rotate-[0.5deg]"];

export function FilterChips() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = (params.get("status") ?? "all") as LogStatus | "all";

  function setStatus(s: LogStatus | "all") {
    const next = new URLSearchParams(params);
    if (s === "all") next.delete("status");
    else next.set("status", s);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  const allChips: Array<LogStatus | "all"> = ["all", ...LOG_STATUSES];

  return (
    <div className="flex flex-wrap gap-2">
      {allChips.map((s, i) => {
        const isActive = current === s;
        const Icon = s === "all" ? null : STATUS_ICONS[s];
        const color = s === "all" ? null : COLORS[s];
        const activeStyle = isActive && color ? { borderColor: color, color } : undefined;

        return (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            style={activeStyle}
            className={cn(
              "flex items-center gap-1.5 rounded-md border-2 border-dashed px-3 py-1.5 text-xs font-medium transition-all",
              ROTATIONS[i % ROTATIONS.length],
              isActive
                ? s === "all"
                  ? "border-[var(--text-dim)] text-[var(--text)] bg-[var(--bg-card)] shadow-[var(--shadow-card)]"
                  : "bg-[var(--bg-card)] shadow-[var(--shadow-card)]"
                : "border-[var(--border)] text-[var(--text-faint)] hover:border-[var(--border-soft)] hover:text-[var(--text-dim)]",
            )}
          >
            {Icon && <Icon size={12} />}
            {s === "all" ? "All" : STATUS_LABELS[s]}
          </button>
        );
      })}
    </div>
  );
}
