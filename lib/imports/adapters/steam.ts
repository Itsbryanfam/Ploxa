import "server-only";
import { requireEnv } from "@/lib/env";
import type {
  ConnectInput, ConnectResult, ImportedGame, LibraryImporter, PlatformConnection,
} from "./types";

const STEAM_API = "https://api.steampowered.com";

class SteamRateLimitError extends Error { name = "SteamRateLimitError"; }
class SteamPrivateProfileError extends Error { name = "SteamPrivateProfileError"; }
class SteamApiError extends Error { name = "SteamApiError"; }

interface SteamOwnedGame {
  appid: number;
  name: string;
  playtime_forever: number;     // minutes
  playtime_2weeks?: number;
  rtime_last_played?: number;   // unix seconds
}

class SteamAdapter implements LibraryImporter {
  async connect(input: ConnectInput): Promise<ConnectResult> {
    if (input.kind !== "steam") throw new Error("SteamAdapter expects kind='steam'");
    const apiKey = requireEnv("STEAM_API_KEY");
    // Best-effort persona lookup
    let displayHandle: string | null = null;
    try {
      const url = `${STEAM_API}/ISteamUser/GetPlayerSummaries/v2/?key=${apiKey}&steamids=${input.steamId}`;
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        const json = await res.json() as { response: { players: Array<{ personaname?: string; communityvisibilitystate?: number }> } };
        displayHandle = json.response.players[0]?.personaname ?? null;
      }
    } catch {
      // Swallow — displayHandle is optional
    }
    return { externalId: input.steamId, accessTokenPlaintext: null, displayHandle };
  }

  async fetchLibrary(
    connection: PlatformConnection,
    options: { cursor?: string; since?: Date },
  ): Promise<{ games: ImportedGame[]; nextCursor: string | null }> {
    const apiKey = requireEnv("STEAM_API_KEY");
    const url =
      `${STEAM_API}/IPlayerService/GetOwnedGames/v1/?key=${apiKey}` +
      `&steamid=${connection.externalId}` +
      `&include_appinfo=1&include_played_free_games=1`;

    const res = await fetch(url, { cache: "no-store" });
    if (res.status === 429) throw new SteamRateLimitError("Steam Web API rate-limited");
    if (!res.ok) throw new SteamApiError(`Steam API ${res.status}`);

    const json = (await res.json()) as { response: { games?: SteamOwnedGame[] } };
    const rawGames = json.response.games ?? [];

    // Private profile heuristic: GetOwnedGames returns no games property at all
    // for fully-private profiles. Detect via GetPlayerSummaries fallback.
    if (rawGames.length === 0 && !("games" in json.response)) {
      const probe = await fetch(
        `${STEAM_API}/ISteamUser/GetPlayerSummaries/v2/?key=${apiKey}&steamids=${connection.externalId}`,
      );
      if (probe.ok) {
        const p = (await probe.json()) as { response: { players: Array<{ communityvisibilitystate?: number }> } };
        const vis = p.response.players[0]?.communityvisibilitystate;
        if (vis !== undefined && vis < 3) throw new SteamPrivateProfileError("Steam profile is not public");
      }
    }

    // Delta mode: keep only games with recent 2-week activity. New-appid detection
    // is the engine's job (it checks against existing logs).
    let games = rawGames;
    if (options.since) {
      games = rawGames.filter((g) => (g.playtime_2weeks ?? 0) > 0);
    }

    const imported: ImportedGame[] = games.map((g) => ({
      externalId: String(g.appid),
      title: g.name,
      hoursPlayed: g.playtime_forever > 0 ? +(g.playtime_forever / 60).toFixed(1) : null,
      lastPlayedAt: g.rtime_last_played ? new Date(g.rtime_last_played * 1000) : null,
      releaseYear: null,
    }));

    // Steam GetOwnedGames is one-shot — no pagination needed.
    return { games: imported, nextCursor: null };
  }

  async disconnect(_connection: PlatformConnection): Promise<void> {
    // No-op — Steam has no token to revoke; we only stored the SteamID.
  }
}

export const steamAdapter: LibraryImporter = new SteamAdapter();
