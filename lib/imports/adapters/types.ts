import "server-only";

/** Stable internal platform identifiers. Matches lib/games/platform-mapping.ts. */
export type PlatformKey = "steam" | "xbox" | "psn" | "switch" | "pc";

/** What the user platform identifier looks like after a successful connect. */
export type ConnectInput =
  | { kind: "steam"; steamId: string }
  | { kind: "xbox"; openxblKey: string };

export interface ConnectResult {
  /** Steam: SteamID64. Xbox: XUID. */
  externalId: string;
  /** Xbox: the OpenXBL key (caller encrypts before storing). Steam: null. */
  accessTokenPlaintext: string | null;
  /** Cached for UI ("@gamertag · 207 games"). Best-effort. */
  displayHandle: string | null;
}

export interface ImportedGame {
  /** Steam appid as string / Xbox titleId. */
  externalId: string;
  title: string;
  /** Steam: playtime_forever / 60. Xbox: null (no playtime concept). */
  hoursPlayed: number | null;
  lastPlayedAt: Date | null;
  /** Optional hint to rawg-match. Year of original release. */
  releaseYear: number | null;
}

/** Persisted row from platform_connections we pass to adapters. */
export interface PlatformConnection {
  id: string;
  userId: string;
  platform: "steam" | "xbox" | "psn";
  externalId: string;
  /** Decrypted plaintext token; null for Steam. Caller decrypts before passing. */
  accessTokenPlaintext: string | null;
  lastSyncedAt: Date | null;
}

export interface LibraryImporter {
  /** Authenticate + return what we persist. */
  connect(input: ConnectInput): Promise<ConnectResult>;

  /**
   * Returns a chunk of games. With `since`, returns deltas only.
   * `nextCursor` is null when no more pages remain.
   */
  fetchLibrary(
    connection: PlatformConnection,
    options: { cursor?: string; since?: Date },
  ): Promise<{ games: ImportedGame[]; nextCursor: string | null }>;

  /** Revokes tokens / cleans up. No-op for Steam; clears stored key for Xbox. */
  disconnect(connection: PlatformConnection): Promise<void>;
}
