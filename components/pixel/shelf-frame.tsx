import { Mascot } from "@/components/mascot/mascot";
import { cn } from "@/lib/utils";

/**
 * Decorative shelf with optional corner mascot.
 *
 * `showMascot` defaults to `false` because both current callsites
 * conflict with it: the library shelf has a toolbar (filter chips,
 * sort, view switcher) directly above it, which the absolutely-
 * positioned mascot at `-top-12 right-2` overlaps; and the profile
 * page already renders a larger header mascot, making the corner
 * sprite a redundant duplicate. Opt back in per-callsite when a
 * future surface uses a bare shelf with no competing chrome.
 */
export function ShelfFrame({
  children,
  className,
  showMascot = false,
}: {
  children: React.ReactNode;
  className?: string;
  showMascot?: boolean;
}) {
  return (
    <div className={cn("relative", className)}>
      <ShelfPlank position="top" />
      <div className="px-2 py-6 sm:px-4">{children}</div>
      <ShelfPlank position="bottom" />
      {showMascot && (
        <div className="absolute -top-12 right-2 sm:right-6 pointer-events-none select-none">
          <Mascot size="sm" mood="idle" silent />
        </div>
      )}
    </div>
  );
}

/**
 * The wooden plank used at the top, bottom, and between rows of a shelf.
 *
 * - `top`     — content sits below: shadow under the plank + inset bottom edge.
 * - `bottom`  — content sits above: shadow above the plank + inset top edge.
 * - `middle`  — content above AND below: shadows on both sides + both inset
 *   edges, so the plank reads as a divider you could rest items on either way.
 */
const PLANK_SHADOWS: Record<"top" | "bottom" | "middle", string> = {
  top: "inset 0 -2px 0 #3d1f08, 0 2px 0 #3d1f08",
  bottom: "inset 0 2px 0 #3d1f08, 0 -2px 0 #3d1f08",
  middle:
    "inset 0 -2px 0 #3d1f08, inset 0 2px 0 #3d1f08, 0 2px 0 #3d1f08, 0 -2px 0 #3d1f08",
};

export function ShelfPlank({ position }: { position: "top" | "bottom" | "middle" }) {
  return (
    <div
      className="relative h-3 w-full overflow-hidden"
      style={{
        backgroundImage:
          "repeating-linear-gradient(90deg, #8b4513 0 4px, #6b3410 4px 8px, #8b4513 8px 12px, #5a2d0c 12px 16px)",
        boxShadow: PLANK_SHADOWS[position],
      }}
      aria-hidden
    />
  );
}
