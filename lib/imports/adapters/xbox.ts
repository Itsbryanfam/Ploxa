import "server-only";
import { createHash } from "node:crypto";

import { redis } from "@/lib/cache/redis";
import type {
  ConnectInput, ConnectResult, ImportedGame, LibraryImporter, PlatformConnection,
} from "./types";

const XBL_BASE = "https://xbl.io/api/v2";
const DELTA_CACHE_TTL_S = 25 * 60 * 60; // 25h — daily sync is every 23h

export class XboxKeyInvalidError extends Error { name = "XboxKeyInvalidError"; }
export class XboxRateLimitError extends Error { name = "XboxRateLimitError"; }
export class XboxApiError extends Error { name = "XboxApiError"; }

interface XblTitle {
  titleId: string;
  name: string;
  // OpenXBL responses vary; the executor checks the live shape and adjusts.
  // Common fields: titleHistory.lastTimePlayed, achievement.currentAchievements
}

async function xblFetch(path: string, key: string): Promise<unknown> {
  const res = await fetch(`${XBL_BASE}${path}`, { headers: { "X-Authorization": key }, cache: "no-store" });
  if (res.status === 401) throw new XboxKeyInvalidError("OpenXBL rejected the key");
  if (res.status === 429) throw new XboxRateLimitError("OpenXBL rate-limited");
  if (!res.ok) throw new XboxApiError(`OpenXBL ${res.status}`);
  return res.json();
}

function hashResponse(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

class XboxAdapter implements LibraryImporter {
  async connect(input: ConnectInput): Promise<ConnectResult> {
    if (input.kind !== "xbox") throw new Error("XboxAdapter expects kind='xbox'");
    const account = (await xblFetch("/account", input.openxblKey)) as {
      profileUsers?: Array<{ id: string; settings: Array<{ id: string; value: string }> }>;
    };
    const user = account.profileUsers?.[0];
    if (!user) throw new XboxKeyInvalidError("OpenXBL returned no account");
    const gamertag = user.settings.find((s) => s.id === "Gamertag")?.value ?? null;
    return { externalId: user.id, accessTokenPlaintext: input.openxblKey, displayHandle: gamertag };
  }

  async fetchLibrary(
    connection: PlatformConnection,
    options: { cursor?: string; since?: Date },
  ): Promise<{ games: ImportedGame[]; nextCursor: string | null }> {
    if (!connection.accessTokenPlaintext) throw new XboxKeyInvalidError("No OpenXBL key on connection");
    const key = connection.accessTokenPlaintext;

    // Endpoint choice: OpenXBL exposes player-title history at /achievements/player/{xuid}.
    // The executor verifies the live response shape (OpenXBL has changed endpoints
    // in the past) and adjusts the parser. If a 401 returns here, the key was
    // revoked since connect — propagate as XboxKeyInvalidError.
    const raw = (await xblFetch(`/achievements/player/${connection.externalId}`, key)) as {
      titles?: XblTitle[];
    };

    const titles = raw.titles ?? [];
    const games: ImportedGame[] = titles.map((t) => ({
      externalId: String(t.titleId),
      title: t.name,
      hoursPlayed: null,
      lastPlayedAt: null,
      releaseYear: null,
    }));

    // Delta mode: hash + compare cached prior response.
    if (options.since) {
      const cacheKey = `imports:xbox:last:${connection.userId}`;
      const newHash = hashResponse(raw);
      const prevHash = await redis.get<string>(cacheKey);
      // Always refresh the cache (whether or not we return data)
      await redis.set(cacheKey, newHash, { ex: DELTA_CACHE_TTL_S });
      if (prevHash === newHash) return { games: [], nextCursor: null };
    } else {
      // First-import: prime the cache so the next delta has a baseline
      await redis.set(`imports:xbox:last:${connection.userId}`, hashResponse(raw), { ex: DELTA_CACHE_TTL_S });
    }

    return { games, nextCursor: null };
  }

  async disconnect(_connection: PlatformConnection): Promise<void> {
    // OpenXBL has no revocation endpoint. The caller sets isActive=false +
    // clears accessTokenEncrypted in the DB.
  }
}

export const xboxAdapter: LibraryImporter = new XboxAdapter();
