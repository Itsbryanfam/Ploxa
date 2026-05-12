import { cn } from "@/lib/utils";

/**
 * Pixel-art 8-cell horizontal score bar.
 *
 * value is in [-1, +1].
 * Positive: cells fill left-to-right based on |value| × 8.
 * Negative: bar renders greyed with a leading "−" indicator. Cells still
 * fill (visually we want to show "this person actively dislikes 5/8 of
 * this trait" rather than hiding it).
 * Near-zero: empty bar.
 */
export function ScoreBar({ value, label }: { value: number; label: string }) {
  const negative = value < 0;
  const magnitude = Math.min(1, Math.abs(value));
  const filled = Math.round(magnitude * 8);

  return (
    <div className="flex items-center gap-2 font-mono text-xs">
      {negative ? (
        <span className="w-3 text-center text-zinc-500" aria-label="negative score">
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
                  ? "bg-zinc-500"
                  : "bg-emerald-500"
                : "bg-zinc-800",
            )}
          />
        ))}
      </div>
      <span className={cn("flex-1 truncate", negative && "text-zinc-500")}>
        {label}
      </span>
    </div>
  );
}
