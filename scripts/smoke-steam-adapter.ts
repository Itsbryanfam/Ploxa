/**
 * Live smoke for lib/imports/adapters/steam.ts.
 *
 * Required environment variables:
 *   STEAM_API_KEY  — Steam Web API key (32-char hex from https://steamcommunity.com/dev/apikey)
 *   SMOKE_STEAMID  — a known public SteamID64 (your own works, e.g. from steamid.io)
 *
 * Run:
 *   pnpm tsx --conditions react-server --env-file=.env scripts/smoke-steam-adapter.ts
 *
 * --conditions react-server is REQUIRED because:
 *   - lib/imports/adapters/steam.ts has `import "server-only"`
 *   - lib/imports/adapters/types.ts also has `import "server-only"`
 *   In plain Node/tsx, "server-only" throws at import time. The react-server
 *   export condition resolves it to the empty shim instead of the throw.
 *
 * If STEAM_API_KEY or SMOKE_STEAMID are absent, the script exits with a clear
 * message. Live smoke is deferred to Task 20 verification gate when env is
 * not configured.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

const { steamAdapter } = await import("../lib/imports/adapters/steam");

const steamId = process.env.SMOKE_STEAMID;
if (!steamId) { console.error("Set SMOKE_STEAMID env"); process.exit(1); }

const connect = await steamAdapter.connect({ kind: "steam", steamId });
console.log("connect:", connect);

const lib = await steamAdapter.fetchLibrary(
  { id: "x", userId: "x", platform: "steam", externalId: steamId, accessTokenPlaintext: null, lastSyncedAt: null },
  {},
);
console.log(`fetchLibrary full: ${lib.games.length} games`);
console.log("sample:", lib.games.slice(0, 3));

const delta = await steamAdapter.fetchLibrary(
  { id: "x", userId: "x", platform: "steam", externalId: steamId, accessTokenPlaintext: null, lastSyncedAt: new Date() },
  { since: new Date() },
);
console.log(`fetchLibrary delta (2-week active): ${delta.games.length} games`);

if (lib.games.length === 0) { console.error("FAIL: expected ≥1 game"); process.exit(1); }
console.log("\nPASS");
