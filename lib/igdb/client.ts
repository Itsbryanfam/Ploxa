import "server-only";
import { requireEnv } from "@/lib/env";
import { getAppAccessToken } from "./twitch-oauth";

const IGDB_BASE = "https://api.igdb.com/v4";
const MAX_ERROR_BODY_PREVIEW = 300;

export class IgdbApiError extends Error {
  constructor(public status: number, public bodyText: string) {
    super(`IGDB HTTP ${status}: ${bodyText.slice(0, MAX_ERROR_BODY_PREVIEW)}`);
    this.name = "IgdbApiError";
  }
}

/**
 * Single entry point to the IGDB v4 API.
 *
 * IGDB queries are GraphQL-like text strings — `fields name,games_count;
 * sort games_count desc; limit 500;` — passed as the request body. The
 * endpoint determines the table queried; results return as an array.
 *
 * Caller is responsible for typing the result. We pass-through the JSON
 * shape unchanged.
 */
export async function igdbQuery<T>(endpoint: string, body: string): Promise<T> {
  let clientId: string;
  try {
    clientId = requireEnv("IGDB_CLIENT_ID");
  } catch {
    // status 0 = not an HTTP error; signals a configuration problem before
    // any request was made. Callers checking err.status for HTTP semantics
    // should also handle status === 0 as a config failure. We translate
    // requireEnv()'s generic message into the IGDB-specific error shape so
    // existing catch sites (lib/igdb/resolver, supabase/_shared/igdb-engine)
    // continue to match on `IgdbApiError`.
    throw new IgdbApiError(0, "IGDB_CLIENT_ID env var not set");
  }
  const token = await getAppAccessToken();
  const res = await fetch(`${IGDB_BASE}/${endpoint}`, {
    method: "POST",
    headers: {
      "Client-ID": clientId,
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/plain",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "<unreadable>");
    throw new IgdbApiError(res.status, text);
  }
  return (await res.json()) as T;
}
