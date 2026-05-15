"use client";

import { useState } from "react";

import type { Mood, TimeBudget } from "@/lib/recs/moods";
import { cn } from "@/lib/utils";

// Mirrors rec-card.tsx's local union (rec-card.tsx:21). Intentionally NOT
// imported from @/lib/games/types (which doesn't export it) so this stays in
// lockstep with rec-card + the T18 callsite passing `connectedPlatforms`.
type Platform = "steam" | "xbox" | "psn";

type TimeProps = {
  variant: "time";
  value: TimeBudget;
  onChange: (next: TimeBudget) => void;
};
type MoodProps = {
  variant: "mood";
  value: Mood[];
  onChange: (next: Mood[]) => void;
};
type PlatformProps = {
  variant: "platform";
  value: Platform[];
  options: Platform[];
  onChange: (next: Platform[]) => void;
};
type Props = TimeProps | MoodProps | PlatformProps;

// Typed option tables — `value`s are pinned to the Mood/TimeBudget unions so a
// drift in @/lib/recs/moods is a compile error here, not a silent label gap.
const TIME_OPTIONS: Array<{ value: TimeBudget; label: string }> = [
  { value: "15min", label: "15 min" },
  { value: "1hr", label: "1 hour" },
  { value: "3hr+", label: "3+ hours" },
  { value: "multi-session", label: "Multi-session" },
];
const MOOD_OPTIONS: Array<{ value: Mood; label: string }> = [
  { value: "chill", label: "Chill" },
  { value: "challenged", label: "Challenged" },
  { value: "story-driven", label: "Story-driven" },
  { value: "mindless", label: "Mindless" },
  { value: "multiplayer", label: "Multiplayer" },
];
const PLATFORM_LABELS: Record<Platform, string> = {
  steam: "Steam",
  xbox: "Xbox",
  psn: "PlayStation",
};

/** Derive the chip's at-a-glance label from the current filter value. */
function renderChipLabel(props: Props): string {
  if (props.variant === "time") {
    return TIME_OPTIONS.find((o) => o.value === props.value)?.label ?? "Time";
  }
  if (props.variant === "mood") {
    if (props.value.length === 0) return "Mood";
    return props.value
      .map((v) => MOOD_OPTIONS.find((o) => o.value === v)?.label ?? v)
      .join(" + ");
  }
  if (props.value.length === 0) return "Platform";
  return props.value.map((v) => PLATFORM_LABELS[v]).join(", ");
}

/**
 * Interactive filter chip for the /play-next redesign (T16).
 *
 * Shows the current filter value; clicking opens an inline popover to edit it.
 * Three discriminated variants:
 *   - `time`     — single-select; picking auto-closes the popover.
 *   - `mood`     — multi-select, max 2 (non-selected rows disable once the cap
 *                  is hit); does NOT auto-close so a 2nd pick is possible.
 *   - `platform` — multi-select from `props.options` (the viewer's connected
 *                  platforms); no cap; does NOT auto-close.
 *
 * Built on the recs-family local-state popover idiom (mirrors rec-card.tsx's
 * `PlayThisButton`): a `relative` wrapper, a trigger `<button>` toggling a
 * `useState` flag, and an absolutely-positioned panel rendered only when open.
 * Intentionally icon-free (text `▾` caret; the selected affordance is accent
 * color only — no icon, no emoji) to match the rest of the recs family.
 *
 * T18 wires three of these onto the /play-next page to replace the wizard;
 * interaction is covered by T20 Playwright (no DOM in the unit env).
 */
export function FilterChipPopover(props: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        data-testid={`filter-chip-${props.variant}`}
        className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--text-dim)] hover:border-[var(--border-hover)]"
      >
        {renderChipLabel(props)} ▾
      </button>
      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 w-56 rounded-md border border-[var(--border)] bg-[var(--bg-elev)] p-1 shadow-lg">
          {props.variant === "time" &&
            TIME_OPTIONS.map((o) => {
              const selected = props.value === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => {
                    props.onChange(o.value);
                    setOpen(false);
                  }}
                  data-testid={`filter-chip-option-${o.value}`}
                  className={cn(
                    "block w-full rounded px-2 py-1 text-left text-xs hover:bg-[var(--bg-card)]",
                    selected
                      ? "font-medium text-[var(--accent)]"
                      : "text-[var(--text-dim)]",
                  )}
                >
                  {o.label}
                </button>
              );
            })}

          {props.variant === "mood" &&
            MOOD_OPTIONS.map((o) => {
              const selected = props.value.includes(o.value);
              const disabled = !selected && props.value.length >= 2;
              return (
                <button
                  key={o.value}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    const next = selected
                      ? props.value.filter((v) => v !== o.value)
                      : [...props.value, o.value];
                    props.onChange(next);
                    // multi-select: keep the popover open so the user can pick
                    // a 2nd mood (or deselect) without re-opening.
                  }}
                  data-testid={`filter-chip-option-${o.value}`}
                  className={cn(
                    "block w-full rounded px-2 py-1 text-left text-xs hover:bg-[var(--bg-card)]",
                    selected
                      ? "font-medium text-[var(--accent)]"
                      : "text-[var(--text-dim)]",
                    disabled && "cursor-not-allowed opacity-50",
                  )}
                >
                  {o.label}
                </button>
              );
            })}

          {props.variant === "platform" &&
            props.options.map((p) => {
              const selected = props.value.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    const next = selected
                      ? props.value.filter((v) => v !== p)
                      : [...props.value, p];
                    props.onChange(next);
                    // multi-select: no auto-close (matches mood).
                  }}
                  data-testid={`filter-chip-option-${p}`}
                  className={cn(
                    "block w-full rounded px-2 py-1 text-left text-xs hover:bg-[var(--bg-card)]",
                    selected
                      ? "font-medium text-[var(--accent)]"
                      : "text-[var(--text-dim)]",
                  )}
                >
                  {PLATFORM_LABELS[p]}
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
