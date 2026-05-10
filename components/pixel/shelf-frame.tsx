import { Mascot } from "@/components/mascot/mascot";
import { cn } from "@/lib/utils";

export function ShelfFrame({
  children,
  className,
  showMascot = true,
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

function ShelfPlank({ position }: { position: "top" | "bottom" }) {
  const isTop = position === "top";
  return (
    <div
      className="relative h-3 w-full overflow-hidden"
      style={{
        backgroundImage:
          "repeating-linear-gradient(90deg, #8b4513 0 4px, #6b3410 4px 8px, #8b4513 8px 12px, #5a2d0c 12px 16px)",
        boxShadow: isTop
          ? "inset 0 -2px 0 #3d1f08, 0 2px 0 #3d1f08"
          : "inset 0 2px 0 #3d1f08, 0 -2px 0 #3d1f08",
      }}
      aria-hidden
    />
  );
}
