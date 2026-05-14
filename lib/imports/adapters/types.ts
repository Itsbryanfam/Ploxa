import "server-only";

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

/**
 * Node-side adapter contract used by the App Router (auth callback +
 * disconnect server action). Library fetching itself runs in the Edge
 * Function (supabase/functions/_shared/import-engine.ts), which has its
 * own platform fetch implementations — keeping this interface narrowly
 * scoped to the Node-only operations.
 */
export interface LibraryConnector {
  /** Authenticate + return what we persist. */
  connect(input: ConnectInput): Promise<ConnectResult>;

  /** Revokes tokens / cleans up. No-op for Steam; clears stored key for Xbox. */
  disconnect(connection: PlatformConnection): Promise<void>;
}
