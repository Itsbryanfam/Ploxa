import { cn } from "@/lib/utils";

/**
 * Pixel-art 8-cell horizontal score bar.
 *
 * value semantics depend on caller:
 * - Signed [-1, +1]: taste-vector preference. Negative renders greyed with
 *   a leading "−" indicator; cells still fill (visually we want to show
 *   "this person actively dislikes 5/8 of this trait" rather than hiding it).
 * - Unsigned [0, 1]: frequency / distribution (e.g. session-length histogram).
 *   The negative branch is unreachable for these — `negative = value < 0` is
 *   always false.
 * Cells fill left-to-right based on |value| × 8. Near-zero: empty bar.
 */
export function ScoreBar({ value, label }: { value: number; label: string }) {
  const negative = value < 0;
  const magnitude = Math.min(1, Math.abs(value));
  const filled = Math.round(magnitude * 8);

  return (
    <div className="flex items-center gap-2 font-mono text-xs">
      {negative ? (
        <span className="w-3 text-center text-[var(--text-faint)]" aria-label="negative score">
          −
        </span>
      ) : (
        <span className="w-3" />
      )}
      <div className="flex gap-[2px]" role="presentation" aria-hidden>
        {Array.from({ length: 8 }, (_, i) => (
          <div
            key={i}
            className={cn(
              "h-3 w-2 rounded-[1px]",
              i < filled
                ? negative
                  ? "bg-[var(--text-faint)]"
                  : "bg-[var(--success)]"
                : "bg-[var(--border)]",
            )}
          />
        ))}
      </div>
      <span className={cn("flex-1 truncate", negative && "text-[var(--text-faint)]")}>
        {label}
      </span>
    </div>
  );
}
