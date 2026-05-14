import "server-only";
import { requireEnv } from "@/lib/env";
import type {
  ConnectInput, ConnectResult, LibraryConnector, PlatformConnection,
} from "./types";

const STEAM_API = "https://api.steampowered.com";

class SteamAdapter implements LibraryConnector {
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

  async disconnect(_connection: PlatformConnection): Promise<void> {
    // No-op — Steam has no token to revoke; we only stored the SteamID.
  }
}

export const steamAdapter: LibraryConnector = new SteamAdapter();
