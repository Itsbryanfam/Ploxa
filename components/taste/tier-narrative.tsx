import { Mascot } from "@/components/mascot/mascot";
import type { TasteTier } from "@/lib/taste/tier";

import { ChartGrid } from "./chart-grid";
import { RefreshButton } from "./refresh-button";
import { ShareModal } from "./share-modal";

/**
 * Shared render for the two AI-narrative-eligible tiers (sharpening + full).
 * Mascot is in `thinking` pose — the "narrating while reading the player"
 * vibe. The narrative bubble shows a placeholder when the DB row hasn't
 * been backfilled yet (refresh button or T7 milestone trigger will fill
 * it). The "sharpening" hint banner shows only at the in-between tier;
 * full-tier renders without it because there's nothing to sharpen.
 */
export function TierNarrative({
  tier,
  narrative,
  narrativeGeneratedAt,
  vectors,
  lengthPreference,
  isOwner,
  isPublic,
  username,
  origin,
}: {
  tier: Exclude<TasteTier, "empty" | "sparse">;
  narrative: string | null;
  narrativeGeneratedAt: Date | null;
  vectors: {
    genre: Record<string, number>;
    theme: Record<string, number>;
    mechanic: Record<string, number>;
    gameMode: Record<string, number>;
    playerPerspective: Record<string, number>;
  };
  lengthPreference: Record<string, number>;
  isOwner: boolean;
  isPublic: boolean;
  username: string;
  origin: string;
}) {
  return (
    <>
      <div className="mb-8 flex items-start gap-4">
        <Mascot mood="thinking" size="md" silent />
        <div className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 p-4">
          <p className="text-sm leading-relaxed">
            {narrative ?? (
              <em className="text-zinc-500">Generating your read…</em>
            )}
          </p>
          {isOwner && (
            <div className="mt-3 flex gap-2">
              <RefreshButton />
              {isPublic ? (
                <ShareModal
                  username={username}
                  narrativeGeneratedAt={narrativeGeneratedAt}
                  origin={origin}
                />
              ) : (
                <button
                  type="button"
                  disabled
                  title="Make your profile public to share your taste card."
                  className="rounded border border-zinc-800 px-3 py-1 text-xs disabled:cursor-not-allowed disabled:text-zinc-600"
                >
                  Share →
                </button>
              )}
            </div>
          )}
          {narrativeGeneratedAt && (
            <p className="mt-2 text-[10px] uppercase tracking-wider text-zinc-600">
              Last refreshed{" "}
              {narrativeGeneratedAt.toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </p>
          )}
        </div>
      </div>

      {tier === "sharpening" && (
        <div className="mb-6 rounded-md border border-zinc-800 bg-zinc-950/50 p-3 text-xs text-zinc-400">
          Your taste is still sharpening — log more for refinement.
        </div>
      )}

      <ChartGrid vectors={vectors} lengthPreference={lengthPreference} />
    </>
  );
}
