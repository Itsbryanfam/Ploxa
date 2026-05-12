"use client";

import { cn } from "@/lib/utils";

/**
 * Pill-button selector used by every /play-next step.
 *
 * Single-select (`multi={false}`, default): clicking any option replaces
 * the selection. Multi-select: clicks toggle and respect a `max` cap so
 * the moods step can be limited to 2 picks per Q7 of the spec.
 *
 * Generic over `T extends string` so the caller can pass a `readonly`
 * tuple type (e.g. `typeof MOODS`) and keep narrow string-literal types
 * in the onChange payload.
 */
export function FilterChips<T extends string>({
  options,
  selected,
  onChange,
  multi = false,
  max = 1,
}: {
  options: ReadonlyArray<T>;
  selected: T[];
  onChange: (next: T[]) => void;
  multi?: boolean;
  max?: number;
}) {
  function toggle(v: T) {
    if (!multi) {
      onChange([v]);
      return;
    }
    if (selected.includes(v)) {
      onChange(selected.filter((x) => x !== v));
    } else if (selected.length < max) {
      onChange([...selected, v]);
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = selected.includes(o);
        return (
          <button
            key={o}
            type="button"
            onClick={() => toggle(o)}
            className={cn(
              "rounded-full border px-4 py-2 font-mono text-sm transition-colors",
              active
                ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
                : "border-zinc-800 text-zinc-400 hover:border-zinc-700",
            )}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}
