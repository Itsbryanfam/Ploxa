/**
 * Smoke test for normalizeTitle() in lib/imports/rawg-match.ts (pure, no DB).
 * DB-backed matchToRawg is verified via Task 11's import test.
 *
 * Run: pnpm tsx --conditions react-server --env-file=.env scripts/smoke-rawg-match.ts
 * Exit 0 = all pass; exit 1 = any fail.
 *
 * --conditions react-server is required because lib/imports/rawg-match.ts
 * imports "server-only" (a Next.js guard), which transitively comes through
 * lib/imports/adapters/types.ts. In plain Node/tsx the react-server export
 * condition resolves to the empty shim instead of the throwing default.
 *
 * --env-file=.env is required because importing rawg-match.ts triggers
 * lib/db/index.ts which calls requireEnv("DATABASE_URL") at module-load
 * time. tsx does not auto-load .env files; the flag supplies them.
 */
import { __testing__ } from "../lib/imports/rawg-match";
const { normalizeTitle } = __testing__;

const checks = [
  { name: "basic lowercase", input: "Hades", expect: "hades" },
  { name: "trim", input: "  Hades  ", expect: "hades" },
  { name: "strip punctuation", input: "Half-Life 2: Lost Coast", expect: "half life 2 lost coast" },
  { name: "edition: definitive", input: "Hades - Definitive Edition", expect: "hades" },
  { name: "edition: GOTY", input: "Skyrim: Game of the Year Edition", expect: "skyrim" },
  { name: "edition: legendary", input: "Mass Effect Legendary Edition", expect: "mass effect" },
  { name: "edition: parens GOTY", input: "Fallout: New Vegas (GOTY)", expect: "fallout new vegas" },
  { name: "unicode preserved", input: "Pokémon Red", expect: "pokémon red" },
  { name: "collapse whitespace", input: "Half   Life   2", expect: "half life 2" },
  { name: "all-punct → empty", input: "!!!", expect: "" },
];

let pass = 0, fail = 0;
for (const { name, input, expect } of checks) {
  const got = normalizeTitle(input);
  if (got === expect) { pass++; console.log(`  PASS  ${name}  →  "${got}"`); }
  else { fail++; console.log(`  FAIL  ${name}  →  expected "${expect}", got "${got}"`); }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
