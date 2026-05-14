import "server-only";

import type {
  ConnectInput, ConnectResult, LibraryConnector, PlatformConnection,
} from "./types";

const XBL_BASE = "https://xbl.io/api/v2";

export class XboxKeyInvalidError extends Error { name = "XboxKeyInvalidError"; }
class XboxRateLimitError extends Error { name = "XboxRateLimitError"; }
class XboxApiError extends Error { name = "XboxApiError"; }

async function xblFetch(path: string, key: string): Promise<unknown> {
  const res = await fetch(`${XBL_BASE}${path}`, { headers: { "X-Authorization": key }, cache: "no-store" });
  if (res.status === 401) throw new XboxKeyInvalidError("OpenXBL rejected the key");
  if (res.status === 429) throw new XboxRateLimitError("OpenXBL rate-limited");
  if (!res.ok) throw new XboxApiError(`OpenXBL ${res.status}`);
  return res.json();
}

class XboxAdapter implements LibraryConnector {
  async connect(input: ConnectInput): Promise<ConnectResult> {
    if (input.kind !== "xbox") throw new Error("XboxAdapter expects kind='xbox'");
    // OpenXBL wraps responses under `content`. Verified against the live API
    // 2026-05-11: /api/v2/account returns { content: { profileUsers: [...] } }.
    const response = (await xblFetch("/account", input.openxblKey)) as {
      content?: { profileUsers?: Array<{ id: string; settings: Array<{ id: string; value: string }> }> };
      profileUsers?: Array<{ id: string; settings: Array<{ id: string; value: string }> }>;
    };
    const profileUsers = response.content?.profileUsers ?? response.profileUsers;
    const user = profileUsers?.[0];
    if (!user) throw new XboxKeyInvalidError("OpenXBL returned no account");
    const gamertag = user.settings.find((s) => s.id === "Gamertag")?.value ?? null;
    return { externalId: user.id, accessTokenPlaintext: input.openxblKey, displayHandle: gamertag };
  }

  async disconnect(_connection: PlatformConnection): Promise<void> {
    // OpenXBL has no revocation endpoint. The caller sets isActive=false +
    // clears accessTokenEncrypted in the DB.
  }
}

export const xboxAdapter: LibraryConnector = new XboxAdapter();
