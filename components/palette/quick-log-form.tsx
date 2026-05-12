"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { useQueryClient } from "@tanstack/react-query";
import { usePaletteStore } from "@/lib/palette/palette-store";
import { HeartRating } from "@/components/ui/heart-rating";
import { COLORS, STATUS_ICONS } from "@/components/pixel/status-icons";
import { LOG_STATUSES, STATUS_LABELS, type LogStatus } from "@/lib/db/schema-types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createLog } from "@/lib/logs/server-actions";
import { toast } from "sonner";
import { LogSuccessToast } from "@/components/ui/log-success-toast";
import { useMascotStore } from "@/components/mascot/mascot-store";
import { logSuccessCopy } from "@/lib/mascot/copy";

export function QuickLogForm() {
  const selectedGame = usePaletteStore((s) => s.selectedGame);
  const reset = usePaletteStore((s) => s.reset);
  const close = usePaletteStore((s) => s.close);
  const [status, setStatus] = useState<LogStatus | null>(null);
  const [rating, setRating] = useState(0);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const celebrate = useMascotStore((s) => s.celebrate);

  if (!selectedGame) return null;

  function handleSubmit() {
    if (!status) {
      setError("Pick a status first.");
      return;
    }
    // Defensive: re-check selectedGame inside the closure. The component-level
    // early return guarantees this is non-null by the time handleSubmit can
    // run, but TS narrowing doesn't carry across the function boundary.
    if (!selectedGame) return;
    setError(null);
    // Snapshot form values before entering the transition. Once Task 13 swaps
    // in `await createLog(...)`, the await point is a re-render boundary —
    // capturing here keeps the submission stable against any concurrent state
    // change between submit and resolution.
    const snapshot = {
      rawgId: selectedGame.rawgId,
      title: selectedGame.title,
      coverUrl: selectedGame.coverUrl,
      status,
      rating,
      note,
    };
    startTransition(async () => {
      const result = await createLog({
        rawgId: snapshot.rawgId,
        status: snapshot.status,
        rating: snapshot.rating,
        note: snapshot.note,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Invalidate library + dashboard queries so they refetch.
      queryClient.invalidateQueries({ queryKey: ["library"] });
      queryClient.invalidateQueries({ queryKey: ["status-shelf"] });
      queryClient.invalidateQueries({ queryKey: ["recent-activity"] });
      const message = logSuccessCopy(snapshot.status, snapshot.rating, snapshot.title);
      toast.custom(() => <LogSuccessToast title={snapshot.title} status={snapshot.status} />, {
        duration: 3500,
      });
      celebrate(message);
      close();
    });
  }

  return (
    <div className="px-5 py-4 space-y-5">
      {/* Selected game preview */}
      <div className="flex items-center gap-3">
        {(selectedGame.posterUrl ?? selectedGame.coverUrl) ? (
          <div className="relative w-12 h-16 rounded overflow-hidden bg-[var(--bg-elev)]">
            <Image
              src={(selectedGame.posterUrl ?? selectedGame.coverUrl)!}
              alt={selectedGame.title}
              fill
              sizes="48px"
              className="object-cover"
            />
          </div>
        ) : (
          <div className="w-12 h-16 rounded bg-[var(--bg-elev)] border border-[var(--border-soft)]" />
        )}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[var(--text)] truncate">{selectedGame.title}</p>
          <button
            type="button"
            onClick={reset}
            className="text-xs text-[var(--text-faint)] hover:text-[var(--text-dim)] transition-colors"
          >
            ← Change game
          </button>
        </div>
      </div>

      {/* Status chips */}
      <div>
        <p className="text-xs uppercase tracking-wide text-[var(--text-faint)] mb-2">Status</p>
        <div className="grid grid-cols-3 gap-2">
          {LOG_STATUSES.map((s) => {
            const Icon = STATUS_ICONS[s];
            const isActive = status === s;
            const color = COLORS[s];
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                disabled={pending}
                style={isActive ? { borderColor: color, color } : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-all",
                  isActive
                    ? "bg-[var(--bg-elev)]"
                    : "border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--border-soft)]",
                )}
              >
                <Icon size={14} />
                {STATUS_LABELS[s]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Rating */}
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-xs uppercase tracking-wide text-[var(--text-faint)]">Rating</p>
          <span className="text-sm font-mono text-[var(--text-dim)]">
            {rating > 0 ? `${rating} / 10` : "—"}
          </span>
        </div>
        <HeartRating value={rating} onChange={setRating} size={22} disabled={pending} />
      </div>

      {/* Note */}
      <div>
        <p className="text-xs uppercase tracking-wide text-[var(--text-faint)] mb-2">
          One-line thought (optional)
        </p>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
          disabled={pending}
          placeholder="loved the soundtrack..."
          className="w-full bg-[var(--bg-elev)] border border-[var(--border-soft)] rounded-md px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] outline-none focus:border-[var(--accent-soft)] disabled:opacity-50"
        />
      </div>

      {/* Error */}
      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-soft)]">
        <Button variant="ghost" onClick={close} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={pending || !status}>
          {pending ? "Logging..." : "Log it"}
        </Button>
      </div>
    </div>
  );
}
