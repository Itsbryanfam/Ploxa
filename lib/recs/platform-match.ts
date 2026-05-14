import { rawgPlatformToKey } from "@/lib/games/platform-mapping";

/**
 * Returns true if a game's RAWG-format platform array overlaps the user's
 * picker selection. Used by the /play-next candidate filter.
 *
 * Why this exists: `games.platforms` is populated directly from the RAWG
 * detail endpoint (see `lib/games/server-actions.ts`) and stores names like
 * `"PC"`, `"PlayStation 4"`, `"Xbox Series S/X"`, `"Nintendo Switch"`. The
 * picker, by contrast, lets the user pick from connected platforms which
 * are stored as the `platform_kind` enum (`"steam"`, `"xbox"`, `"psn"`). A
 * naive `.some((p) => userSet.has(p))` always returned false, so the picker
 * filtered every candidate out and surfaced "no-candidates" for every combo.
 *
 * Mapping rules:
 * - Run each RAWG name through `rawgPlatformToKey` (the same translator the
 *   game-detail icons use) to get one of `"pc" | "steam" | "xbox" | "psn" |
 *   "switch"` or null.
 * - Treat `"pc"` as also satisfying a `"steam"` connection — Steam is the
 *   dominant PC distribution channel and a Steam-connected user can install
 *   anything tagged "PC" on RAWG. The reverse is NOT true: a Steam game is
 *   not necessarily on Xbox/PSN.
 * - Null/empty `gamePlatforms` → keep the candidate. The catalog is missing
 *   platform data for legacy seed rows, and we'd rather show a relevant
 *   game than drop it on a metadata gap. Same as the prior behavior.
 */
export function gamePlatformsMatchUserFilter(
  gamePlatforms: string[] | null,
  userFilter: readonly string[],
): boolean {
  if (!gamePlatforms || gamePlatforms.length === 0) return true;
  const userSet = new Set(userFilter);
  for (const rawg of gamePlatforms) {
    const key = rawgPlatformToKey(rawg);
    if (!key) continue;
    if (userSet.has(key)) return true;
    // Steam ↔ PC bridge: PC games are playable through Steam.
    if (key === "pc" && userSet.has("steam")) return true;
  }
  return false;
}
