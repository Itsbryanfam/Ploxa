import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSecrets } from "@/lib/db/schema";

const TOKEN_KEY = "igdb_app_token";
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export class TwitchTokenUnavailableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "TwitchTokenUnavailableError";
  }
}

/**
 * Returns a valid Twitch app-access-token, transparently refreshing when
 * within REFRESH_MARGIN_MS of expiry. Cached in app_secrets so all
 * processes (Next-side server actions, scripts, Edge Function via mirror)
 * share the same token until expiry.
 *
 * Twitch tokens for client-credentials flow last ~60 days; the 5-minute
 * margin means we refresh ~1 day's worth of seconds before actual expiry,
 * giving wide safety against clock skew.
 */
export async function getAppAccessToken(): Promise<string> {
  // Cache check.
  const rows = await db
    .select({ value: appSecrets.value, expiresAt: appSecrets.expiresAt })
    .from(appSecrets)
    .where(eq(appSecrets.key, TOKEN_KEY))
    .limit(1);

  if (rows.length > 0) {
    const expiresInMs = rows[0].expiresAt.getTime() - Date.now();
    if (expiresInMs > REFRESH_MARGIN_MS) {
      return rows[0].value;
    }
  }

  // Refresh from Twitch.
  const clientId = process.env.IGDB_CLIENT_ID;
  const clientSecret = process.env.IGDB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new TwitchTokenUnavailableError(
      "IGDB_CLIENT_ID / IGDB_CLIENT_SECRET not set",
    );
  }

  const fetchToken = async (): Promise<{ access_token: string; expires_in: number }> => {
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    });
    const res = await fetch(
      `https://id.twitch.tv/oauth2/token?${params.toString()}`,
      { method: "POST" },
    );
    if (!res.ok) {
      throw new Error(`Twitch HTTP ${res.status}`);
    }
    return (await res.json()) as { access_token: string; expires_in: number };
  };

  let payload: { access_token: string; expires_in: number };
  try {
    payload = await fetchToken();
  } catch (firstErr) {
    // One retry — Twitch 5xx is transient.
    try {
      await new Promise((r) => setTimeout(r, 1000));
      payload = await fetchToken();
    } catch (secondErr) {
      throw new TwitchTokenUnavailableError(
        `Twitch token endpoint failed after retry: ${(secondErr as Error).message}`,
        secondErr,
      );
    }
  }

  // Bake in the safety margin: store expires_at as (now + expires_in - 300s).
  const expiresAt = new Date(
    Date.now() + (payload.expires_in - 300) * 1000,
  );
  // Concurrent refreshes are benign: Twitch's client-credentials flow issues
  // multiple valid tokens simultaneously. Whichever upsert lands last wins;
  // both tokens are equally valid until their respective expiry times.
  await db
    .insert(appSecrets)
    .values({
      key: TOKEN_KEY,
      value: payload.access_token,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: appSecrets.key,
      set: { value: payload.access_token, expiresAt, updatedAt: new Date() },
    });

  return payload.access_token;
}
