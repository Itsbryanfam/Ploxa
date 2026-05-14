import "server-only";
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
  const clientId = process.env.IGDB_CLIENT_ID;
  if (!clientId) {
    // status 0 = not an HTTP error; signals a configuration problem before
    // any request was made. Callers checking err.status for HTTP semantics
    // should also handle status === 0 as a config failure.
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
