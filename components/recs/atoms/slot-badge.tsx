import { cn } from "@/lib/utils";

/**
 * Stratified-rail label shown on the redesigned RecCard (T15).
 *
 * The union matches T12's `RecCard.slot`
 * (`"comfort" | "backlog" | "friends" | "wildcard"`) so the card can pass
 * that field straight through. Pure presentational — server-renderable.
 *
 * Tokens use the repo's CSS-variable arbitrary-value convention (locked
 * theme in `app/globals.css`; no `tailwind.config`). Each slot is a
 * visually distinct chip; `wildcard` is loudest — it uses the locked
 * pixel-art amber accent (`--pixel`) plus a ring so the surprise pick
 * reads strongest, consistent with the app's pixel-accent aesthetic.
 */
type Slot = "comfort" | "backlog" | "friends" | "wildcard";

const LABELS: Record<Slot, string> = {
  comfort: "Comfort",
  backlog: "Backlog",
  friends: "Friend pick",
  wildcard: "Wildcard",
};

const STYLES: Record<Slot, string> = {
  comfort: "bg-[var(--bg-elev)] text-[var(--text-dim)]",
  backlog: "bg-[var(--accent)]/10 text-[var(--accent)]",
  friends: "bg-[#3b82f6]/15 text-[#7aa7ff]",
  wildcard:
    "bg-[var(--pixel)]/15 text-[var(--pixel)] ring-1 ring-[var(--pixel)]/40",
};

export function SlotBadge({ slot }: { slot: Slot }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide",
        STYLES[slot],
      )}
    >
      {LABELS[slot]}
    </span>
  );
}
