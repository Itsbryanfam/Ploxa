import { Mascot } from "@/components/mascot/mascot";
import type { MascotMood } from "@/components/mascot/states";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  mood?: MascotMood;
  /** Heading element. Defaults to h1 for full-page (size="lg") empty states, h2 for inline. */
  as?: "h1" | "h2" | "h3";
  title: string;
  body?: string;
  action?: React.ReactNode;
  size?: "md" | "lg";
  className?: string;
}

export function EmptyState({
  mood = "pointing",
  as,
  title,
  body,
  action,
  size = "lg",
  className,
}: EmptyStateProps) {
  const Heading = as ?? (size === "lg" ? "h1" : "h2");
  return (
    <div
      className={cn(
        "flex flex-col items-center text-center gap-4",
        size === "lg" ? "py-16 px-6" : "py-8 px-4",
        className,
      )}
    >
      <Mascot size={size === "lg" ? "xl" : "lg"} mood={mood} silent />
      <div className="space-y-1.5">
        <Heading className="text-xl font-semibold text-[var(--text)]">{title}</Heading>
        {body && <p className="text-sm text-[var(--text-dim)] max-w-md mx-auto">{body}</p>}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
