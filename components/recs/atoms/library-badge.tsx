import { cn } from "@/lib/utils";

/**
 * Overlay badge shown on a RecCard poster when the recommended game is
 * already in the viewer's library (T15). Pure presentational — no props,
 * no state, server-renderable.
 *
 * Tokens use the repo's CSS-variable arbitrary-value convention (locked
 * theme in `app/globals.css`; no `tailwind.config`). Accent fill at 80%
 * with a blur so it sits legibly over poster art.
 */
export function LibraryBadge() {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md bg-[var(--accent)]/80 px-2 py-0.5 text-[11px] font-medium text-[var(--accent-fg)] backdrop-blur-sm",
      )}
    >
      In your library
    </span>
  );
}
