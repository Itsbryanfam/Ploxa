import "server-only";

import type { ImportedGame, PlatformKey } from "./adapters/types";

export type ConflictRule = "platform_merge";

export interface NewLogPayload {
  gameId: number;
  status: "backlog";
  platforms: string[];
  platformPlayedOn: string;
  hoursPlayed: number | null;
}

export interface ExistingLog {
  id: string;
  platforms: string[] | null;
  platformPlayedOn: string | null;
  hoursPlayed: number | null;
}

export type MergeResult =
  | { action: "insert"; row: NewLogPayload }
  | {
      action: "update";
      logId: string;
      set: { platforms: string[]; hoursPlayed: number | null };
      rule: ConflictRule;
    };

/**
 * Pure conflict-merge. User data wins; platforms union; hoursPlayed max.
 * See spec § Flow C for the rule table.
 */
export function mergeImportedGame(
  imported: ImportedGame & { gameId: number },
  existing: ExistingLog | null,
  platform: PlatformKey,
): MergeResult {
  if (!existing) {
    return {
      action: "insert",
      row: {
        gameId: imported.gameId,
        status: "backlog",
        platforms: [platform],
        platformPlayedOn: platform,
        hoursPlayed: imported.hoursPlayed,
      },
    };
  }

  const existingPlatforms =
    existing.platforms ??
    (existing.platformPlayedOn ? [existing.platformPlayedOn] : []);
  const mergedPlatforms = Array.from(new Set([...existingPlatforms, platform]));

  const bothNull = existing.hoursPlayed == null && imported.hoursPlayed == null;
  const mergedHours = bothNull
    ? null
    : Math.max(existing.hoursPlayed ?? 0, imported.hoursPlayed ?? 0);

  return {
    action: "update",
    logId: existing.id,
    set: { platforms: mergedPlatforms, hoursPlayed: mergedHours },
    rule: "platform_merge",
  };
}
