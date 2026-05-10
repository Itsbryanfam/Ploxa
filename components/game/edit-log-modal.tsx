"use client";

import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { LibraryItem } from "@/lib/logs/server-actions";
import { updateLogFull, deleteLog } from "@/lib/logs/server-actions";
import { LOG_STATUSES, STATUS_LABELS, type LogStatus } from "@/lib/db/schema-types";
import { COLORS, STATUS_ICONS } from "@/components/pixel/status-icons";
import { HeartRating } from "@/components/ui/heart-rating";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const dateToInput = (d: Date | null): string =>
  d ? new Date(d).toISOString().slice(0, 10) : "";

export function EditLogModal({ item, onClose }: { item: LibraryItem; onClose: () => void }) {
  const [status, setStatus] = useState<LogStatus>(item.status);
  const [rating, setRating] = useState(item.rating ?? 0);
  const [startedAt, setStartedAt] = useState(dateToInput(item.startedAt));
  const [finishedAt, setFinishedAt] = useState(dateToInput(item.finishedAt));
  const [hours, setHours] = useState(item.hoursPlayed?.toString() ?? "");
  const [platform, setPlatform] = useState("");
  const [isReplay, setIsReplay] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [notes, setNotes] = useState(item.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const queryClient = useQueryClient();
  const router = useRouter();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updateLogFull({
        logId: item.logId,
        status,
        rating: rating > 0 ? rating : null,
        startedAt: startedAt || null,
        finishedAt: finishedAt || null,
        hoursPlayed: hours ? Number(hours) : null,
        platformPlayedOn: platform || null,
        isReplay,
        isPrivate,
        notes,
      });
      if (!result.ok) {
        setError(result.error ?? "Failed to save");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["library"] });
      router.refresh();
      onClose();
    });
  }

  function handleDelete() {
    if (!confirm("Delete this log? This cannot be undone.")) return;
    startTransition(async () => {
      const result = await deleteLog(item.logId);
      if (!result.ok) {
        setError(result.error ?? "Failed to delete");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["library"] });
      router.refresh();
      onClose();
    });
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">Edit log</h2>
          <button onClick={onClose} aria-label="Close" className="text-[var(--text-dim)] text-2xl leading-none">×</button>
        </header>

        {/* Status */}
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
                      : "border-[var(--border)] text-[var(--text-dim)]",
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
          <p className="text-xs uppercase tracking-wide text-[var(--text-faint)] mb-2">
            Rating <span className="font-mono">{rating > 0 ? rating : "—"}</span>
          </p>
          <HeartRating value={rating} onChange={setRating} size={22} disabled={pending} />
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Started">
            <input type="date" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} disabled={pending} className={inputCls} />
          </Field>
          <Field label="Finished">
            <input type="date" value={finishedAt} onChange={(e) => setFinishedAt(e.target.value)} disabled={pending} className={inputCls} />
          </Field>
        </div>

        {/* Hours + platform */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Hours played">
            <input
              type="number" min="0" step="0.1" value={hours}
              onChange={(e) => setHours(e.target.value)} disabled={pending} className={inputCls}
            />
          </Field>
          <Field label="Platform">
            <input
              type="text" value={platform} placeholder="Steam Deck, PS5..."
              onChange={(e) => setPlatform(e.target.value)} disabled={pending} className={inputCls}
            />
          </Field>
        </div>

        {/* Toggles */}
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={isReplay} onChange={(e) => setIsReplay(e.target.checked)} disabled={pending} />
            Replay
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} disabled={pending} />
            Private
          </label>
        </div>

        {/* Notes */}
        <Field label="Notes">
          <textarea
            value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} maxLength={2000}
            disabled={pending} className={cn(inputCls, "resize-y")}
          />
        </Field>

        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

        <div className="flex justify-between pt-2 border-t border-[var(--border-soft)]">
          <Button variant="ghost" onClick={handleDelete} disabled={pending}>Delete log</Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button onClick={save} disabled={pending}>{pending ? "Saving..." : "Save"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full bg-[var(--bg-elev)] border border-[var(--border-soft)] rounded-md px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent-soft)] disabled:opacity-50";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-[var(--text-faint)] mb-1.5">{label}</p>
      {children}
    </div>
  );
}
