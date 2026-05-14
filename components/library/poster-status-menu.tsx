"use client";

import { useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { updateLogStatus } from "@/lib/logs/server-actions";
import { LOG_STATUSES, STATUS_LABELS, type LogStatus } from "@/lib/db/schema-types";
import { STATUS_ICONS } from "@/components/pixel";
import { cn } from "@/lib/utils";

interface Props {
  logId: string;
  currentStatus: LogStatus;
  /**
   * Called when the user picks a status (or re-picks the current one) — the
   * parent uses this to drop its `open` state. Radix already handles
   * Esc + outside-click + focus restore for us, so this is only fired on
   * intentional selection.
   */
  onSelected: () => void;
}

/**
 * Status-picker payload rendered inside `DropdownMenu.Content` from
 * `library-poster.tsx`. The trigger lives in the parent so the Radix root
 * sees both halves and can wire up focus trap + outside-click + Esc + focus
 * restore for us.
 *
 * The previous implementation was a bespoke absolutely-positioned `<div>`
 * with no escape, no outside-click, and no focus restore — moving to
 * `@radix-ui/react-dropdown-menu` gives all three for free, plus arrow-key
 * roving focus through the items.
 */
export function PosterStatusMenu({ logId, currentStatus, onSelected }: Props) {
  const [pending, startTransition] = useTransition();
  const queryClient = useQueryClient();

  function handlePick(status: LogStatus) {
    if (status === currentStatus) {
      onSelected();
      return;
    }
    startTransition(async () => {
      const result = await updateLogStatus({ logId, status });
      if (result.ok) {
        await queryClient.invalidateQueries({ queryKey: ["library"] });
        await queryClient.invalidateQueries({ queryKey: ["status-shelf"] });
      }
      onSelected();
    });
  }

  return (
    <>
      {LOG_STATUSES.map((s) => {
        const Icon = STATUS_ICONS[s];
        const isCurrent = s === currentStatus;
        return (
          <DropdownMenu.Item
            key={s}
            // Radix calls this on Enter/Space/click. We use `onSelect` (not
            // `onClick`) so keyboard activation works the same as click.
            onSelect={(e) => {
              // Prevent Radix from auto-closing before our async transition
              // completes — we close manually in handlePick to keep the menu
              // open during the in-flight write.
              if (pending) e.preventDefault();
              handlePick(s);
            }}
            disabled={pending}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 text-xs cursor-default outline-none rounded-sm",
              isCurrent
                ? "text-[var(--accent)]"
                : "text-[var(--text-dim)] focus:bg-[var(--bg-card-hover)] focus:text-[var(--text)]",
            )}
          >
            <Icon size={12} />
            {STATUS_LABELS[s]}
            {isCurrent && <span className="ml-auto">•</span>}
          </DropdownMenu.Item>
        );
      })}
    </>
  );
}
