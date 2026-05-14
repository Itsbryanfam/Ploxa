import { Mascot } from "@/components/mascot/mascot";
import type { MascotMood } from "@/components/mascot/states";

/**
 * Speech-bubble wrapper that pairs a Mascot pose with arbitrary content.
 *
 * Callers pass a `MascotMood` directly (not a recs-specific vocabulary).
 * The `silent` prop on Mascot suppresses its global-store speech bubble
 * so the only bubble visible is the one we render here.
 *
 * Used by /play-next for each step of the filter flow + the results
 * header. T13 will animate the mood transitions during the rerank wait.
 */
export function MascotPrompt({
  mood,
  children,
}: {
  mood: MascotMood;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start gap-4">
      <Mascot mood={mood} size="md" silent />
      <div className="flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] p-4">
        {children}
      </div>
    </div>
  );
}
