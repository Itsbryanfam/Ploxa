import { cn } from "@/lib/utils";

/**
 * Coarse confidence band shown on the redesigned RecCard (T15).
 *
 * The union matches T12's `RecCard.confidence`
 * (`"strong" | "good" | "worth-a-try"`) so the card can pass that field
 * straight through. Pure presentational — no state, server-renderable.
 *
 * Tokens use the repo's CSS-variable arbitrary-value convention (the
 * project has no `tailwind.config`; the locked theme is defined in
 * `app/globals.css`). Visual intent: solid accent fill = strong,
 * outlined accent = good, muted outline = worth-a-try.
 */
type Confidence = "strong" | "good" | "worth-a-try";

const LABELS: Record<Confidence, string> = {
  strong: "Strong match",
  good: "Good match",
  "worth-a-try": "Worth a try",
};

const STYLES: Record<Confidence, string> = {
  strong:
    "bg-[var(--accent)] text-[var(--accent-fg)] border border-[var(--accent)]",
  good: "border border-[var(--accent)] text-[var(--accent)] bg-transparent",
  "worth-a-try":
    "border border-[var(--text-dim)]/40 text-[var(--text-dim)] bg-transparent",
};

export function ConfidencePill({ confidence }: { confidence: Confidence }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        STYLES[confidence],
      )}
    >
      {LABELS[confidence]}
    </span>
  );
}
