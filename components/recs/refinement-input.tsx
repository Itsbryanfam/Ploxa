"use client";

import { useState } from "react";

import { MascotPrompt } from "@/components/recs/mascot-prompt";
import { cn } from "@/lib/utils";

export const MAX_ACTIVE = 5;
export const CHAR_CAP = 140;
export const QUICK_CHIPS = [
  "less grindy",
  "more story",
  "solo only",
  "newer",
  "shorter",
  "something cozy",
  "surprise me",
] as const;

/**
 * Pure transform: given the active refinements + a raw entry, return the
 * next active array. No-op (returns the SAME `active` reference) when the
 * cleaned entry is empty or already present, so callers can skip onChange.
 * Clamps to CHAR_CAP, collapses newlines, caps at MAX_ACTIVE by dropping
 * the OLDEST. Exported for unit tests (the component is interaction-only
 * under the repo's no-DOM test setup).
 */
export function applyRefinement(active: string[], raw: string): string[] {
  const cleaned = raw.replace(/\n/g, " ").trim().slice(0, CHAR_CAP);
  if (cleaned.length === 0) return active;
  if (active.includes(cleaned)) return active;
  const withNew = [...active, cleaned];
  return withNew.length > MAX_ACTIVE ? withNew.slice(1) : withNew;
}

type Props = { active: string[]; onChange: (next: string[]) => void };

/**
 * Freeform refinement input for the /play-next redesign (T17).
 *
 * Composes the established `MascotPrompt` (mood="pointing" — the documented
 * "calling attention to a CTA" mood) so the mascot + bordered container are
 * provided by the shared wrapper; this component owns ONLY the inner content:
 * a prompt line, a text input + "Try" submit, a row of quick-pick chips, and
 * the active dismissable refinement pills.
 *
 * The bug-prone clamp/dedupe/cap transform is extracted to the pure exported
 * `applyRefinement` so it is unit-testable without a DOM (the repo's vitest
 * runs in a Node env with no RTL). Interaction (typing, Enter, chip click,
 * pill remove, clear-all) is INTENTIONALLY deferred to T20 Playwright; the
 * data-testids here exist for that suite. Name-free copy by design — the
 * mascot is nameless in-product.
 *
 * T18 wires this onto /play-next and feeds `active` into getRecs'
 * `refinements` param.
 */
export function RefinementInput({ active, onChange }: Props) {
  const [text, setText] = useState("");

  const commit = (raw: string) => {
    const next = applyRefinement(active, raw);
    if (next === active) return; // no-op (empty/dupe)
    onChange(next);
    setText("");
  };
  const remove = (s: string) => onChange(active.filter((x) => x !== s));
  const clearAll = () => onChange([]);

  return (
    <MascotPrompt mood="pointing">
      <div className="space-y-3">
        <p className="text-sm">Not landing? Tell us what to try:</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, CHAR_CAP))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit(text);
              }
            }}
            placeholder={'e.g. "less grindy"'}
            maxLength={CHAR_CAP}
            data-testid="refinement-input"
            className="flex-1 rounded border border-[var(--border)] bg-[var(--bg-elev)] px-2 py-1 text-xs text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--border-hover)] focus:outline-none"
          />
          <button
            type="button"
            onClick={() => commit(text)}
            data-testid="refinement-submit"
            className="rounded bg-[var(--accent)] px-3 py-1 text-xs text-[var(--accent-fg)] hover:bg-[var(--accent)]/90"
          >
            Try →
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="self-center text-xs text-[var(--text-faint)]">
            Quick:
          </span>
          {QUICK_CHIPS.map((chip) => {
            const used = active.includes(chip);
            return (
              <button
                key={chip}
                type="button"
                onClick={() => commit(chip)}
                disabled={used}
                data-testid={`refinement-quick-${chip}`}
                className={cn(
                  "rounded-full border border-[var(--border)] px-2.5 py-0.5 text-xs text-[var(--text-dim)] hover:border-[var(--border-hover)]",
                  used && "cursor-not-allowed opacity-50",
                )}
              >
                {chip}
              </button>
            );
          })}
        </div>
        {active.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-[var(--text-faint)]">
              Active refinements:
            </span>
            {active.map((r) => (
              <span
                key={r}
                className="inline-flex items-center gap-1 rounded-md bg-[var(--accent)]/10 px-2 py-0.5 text-xs text-[var(--accent)]"
              >
                {r}
                <button
                  type="button"
                  onClick={() => remove(r)}
                  aria-label={`Remove "${r}"`}
                  data-testid={`refinement-remove-${r}`}
                  className="rounded px-0.5 hover:bg-[var(--accent)]/20"
                >
                  ×
                </button>
              </span>
            ))}
            {active.length >= 2 && (
              <button
                type="button"
                onClick={clearAll}
                data-testid="refinement-clear-all"
                className="text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
              >
                Clear all
              </button>
            )}
          </div>
        )}
      </div>
    </MascotPrompt>
  );
}
