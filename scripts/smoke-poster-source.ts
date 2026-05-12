/**
 * Smoke the lib/games/poster-source.ts resolver against real titles.
 *
 * Run:
 *   pnpm tsx --conditions react-server --env-file=.env scripts/smoke-poster-source.ts
 *
 * No DB writes. Hits live Steam Storefront API and (if SGDB_API_KEY is set)
 * the SteamGridDB API. Logs the resolved URL + source per case.
 */
import { resolvePoster, __internal } from "../lib/games/poster-source";

interface Case {
  title: string;
  expectSource?: "steam" | "sgdb" | "any" | "null";
  knownSteamAppId?: number;
  note?: string;
}

const cases: Case[] = [
  { title: "Portal 2", knownSteamAppId: 620, expectSource: "steam", note: "fast path: known appid" },
  { title: "Portal 2", expectSource: "steam", note: "slow path: title-only resolve" },
  { title: "Hades", expectSource: "steam" },
  { title: "Stardew Valley", expectSource: "steam" },
  { title: "DOOM Eternal", expectSource: "steam", note: "edition normalization" },
  { title: "The Witcher 3: Wild Hunt - Game of the Year Edition", expectSource: "steam", note: "edition stripping" },
  { title: "Super Mario Odyssey", expectSource: "any", note: "Switch-exclusive; expect SGDB or null" },
  { title: "Bloodborne", expectSource: "any", note: "PS-exclusive; expect SGDB or null" },
  { title: "qzxqzx_not_a_real_game_xyz_2026", expectSource: "null" },
];

async function main() {
  console.log("Smoke: lib/games/poster-source.ts");
  console.log(`  SGDB_API_KEY: ${process.env.SGDB_API_KEY ? "set" : "absent (SGDB fallback skipped)"}`);
  console.log("");

  let pass = 0;
  let fail = 0;

  for (const c of cases) {
    const start = Date.now();
    const result = await resolvePoster({
      title: c.title,
      knownSteamAppId: c.knownSteamAppId,
    });
    const ms = Date.now() - start;

    const actualSource = result?.source ?? "null";
    const expected = c.expectSource ?? "any";
    const ok =
      expected === "any"
        ? true
        : expected === "null"
        ? result === null
        : actualSource === expected;

    const status = ok ? "✓" : "✗";
    pass += ok ? 1 : 0;
    fail += ok ? 0 : 1;

    console.log(`  ${status} [${ms}ms] ${c.title}`);
    console.log(`      expect=${expected}  got=${actualSource}${result?.url ? `  ${result.url.slice(0, 80)}` : ""}`);
    if (c.note) console.log(`      ${c.note}`);
  }

  console.log("");
  console.log(`Normalize sanity:`);
  for (const s of [
    "DOOM Eternal",
    "The Witcher 3: Wild Hunt - Game of the Year Edition",
    "Hades II",
  ]) {
    console.log(`  "${s}" → "${__internal.normalizeTitle(s)}"`);
  }

  console.log("");
  console.log(`Results: ${pass} pass, ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

void main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
