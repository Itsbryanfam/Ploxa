import { Mascot } from "@/components/mascot/mascot";

import { ChartGrid } from "./chart-grid";

/**
 * Sparse-tier render — 1–9 logs. Mascot in pointing pose nudges the user
 * toward the 10-log narrative threshold. Charts render at 50% opacity to
 * communicate "data is here but not yet a confident read." Refresh + Share
 * are disabled until the narrative tier kicks in.
 *
 * Note: `Math.max(1, 10 - logCount)` keeps the copy grammatically sane at
 * logCount === 9 (would otherwise read "0 more logs"). The tier function
 * promotes to "sharpening" once logCount hits 10, so this clamp only
 * affects the bottom-edge case.
 */
export function TierSparse({
  logCount,
  vectors,
  lengthPreference,
}: {
  logCount: number;
  vectors: {
    genre: Record<string, number>;
    theme: Record<string, number>;
    mechanic: Record<string, number>;
    gameMode: Record<string, number>;
    playerPerspective: Record<string, number>;
  };
  lengthPreference: Record<string, number>;
}) {
  const remaining = Math.max(1, 10 - logCount);
  return (
    <>
      <div className="mb-8 flex items-start gap-4">
        <Mascot mood="pointing" size="md" silent />
        <div className="flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] p-4">
          <p className="text-sm">
            I need about <strong>{remaining}</strong> more{" "}
            {remaining === 1 ? "log" : "logs"} before I can write you a proper
            taste read. Here&apos;s what I&apos;ve got so far.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled
              className="rounded border border-[var(--border)] px-3 py-1 text-xs text-[var(--text-faint)]"
              title="Available once you reach 10 logs"
            >
              Refresh fingerprint
            </button>
            <button
              type="button"
              disabled
              className="rounded border border-[var(--border)] px-3 py-1 text-xs text-[var(--text-faint)]"
              title="Available once you reach 10 logs"
            >
              Share →
            </button>
          </div>
        </div>
      </div>
      <div className="opacity-50">
        <ChartGrid vectors={vectors} lengthPreference={lengthPreference} />
      </div>
    </>
  );
}
