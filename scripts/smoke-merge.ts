/**
 * Exhaustive smoke for lib/imports/merge.ts. The single highest-risk pure
 * function in Phase 3 — a bug here = user data clobbered.
 *
 * Run: pnpm tsx --conditions react-server scripts/smoke-merge.ts
 * Exit 0 = all pass; exit 1 = any fail.
 *
 * --conditions react-server is required because lib/imports/merge.ts imports
 * "server-only" and transitively imports lib/imports/adapters/types.ts which
 * also has "server-only". In plain Node/tsx the react-server export condition
 * resolves to the empty shim instead of the throwing default.
 */
import {
  mergeImportedGame,
  type ExistingLog,
  type MergeResult,
} from "../lib/imports/merge";
import type { ImportedGame, PlatformKey } from "../lib/imports/adapters/types";

function ig(o: Partial<ImportedGame & { gameId: number }> = {}): ImportedGame & { gameId: number } {
  return { gameId: 1, externalId: "100", title: "Hades", hoursPlayed: 12.5, lastPlayedAt: null, releaseYear: 2020, ...o };
}
function el(o: Partial<ExistingLog> = {}): ExistingLog {
  return { id: "log-uuid-1", platforms: ["pc"], platformPlayedOn: "pc", hoursPlayed: 30, ...o };
}

interface Case {
  name: string;
  imported: ImportedGame & { gameId: number };
  existing: ExistingLog | null;
  platform: PlatformKey;
  check: (r: MergeResult) => void;
}

const cases: Case[] = [
  {
    name: "no existing → insert at backlog with dual-write platforms",
    imported: ig({ hoursPlayed: 5 }), existing: null, platform: "steam",
    check: (r) => {
      if (r.action !== "insert") throw new Error("expected insert");
      if (r.row.status !== "backlog") throw new Error("status not backlog");
      if (r.row.platforms.join(",") !== "steam") throw new Error("platforms wrong");
      if (r.row.platformPlayedOn !== "steam") throw new Error("platformPlayedOn wrong");
      if (r.row.hoursPlayed !== 5) throw new Error("hoursPlayed lost");
    },
  },
  {
    name: "manual log (PC) + steam import → update with unioned platforms, max hours",
    imported: ig({ hoursPlayed: 12 }), existing: el({ platforms: ["pc"], platformPlayedOn: "pc", hoursPlayed: 30 }), platform: "steam",
    check: (r) => {
      if (r.action !== "update") throw new Error("expected update");
      if (!r.set.platforms.includes("pc") || !r.set.platforms.includes("steam")) throw new Error("missing platform");
      if (r.set.platforms.length !== 2) throw new Error("dedup failed");
      if (r.set.hoursPlayed !== 30) throw new Error("should take max 30");
      if (r.rule !== "platform_merge") throw new Error("wrong rule");
    },
  },
  {
    name: "existing on steam + steam re-import → no platform duplication",
    imported: ig(), existing: el({ platforms: ["steam"], platformPlayedOn: "steam" }), platform: "steam",
    check: (r) => {
      if (r.action !== "update") throw new Error("expected update");
      if (r.set.platforms.length !== 1 || r.set.platforms[0] !== "steam") throw new Error("dedup wrong");
    },
  },
  {
    name: "existing platforms=null + platformPlayedOn → migrates legacy to array on merge",
    imported: ig(), existing: el({ platforms: null, platformPlayedOn: "pc" }), platform: "steam",
    check: (r) => {
      if (r.action !== "update") throw new Error("expected update");
      if (!r.set.platforms.includes("pc") || !r.set.platforms.includes("steam")) throw new Error("missing platform");
    },
  },
  {
    name: "existing both null + import platform → result [platform]",
    imported: ig(), existing: el({ platforms: null, platformPlayedOn: null, hoursPlayed: null }), platform: "xbox",
    check: (r) => {
      if (r.action !== "update") throw new Error("expected update");
      if (r.set.platforms.join(",") !== "xbox") throw new Error("platforms wrong");
    },
  },
  {
    name: "hours: existing 30, imported 12 → keep 30",
    imported: ig({ hoursPlayed: 12 }), existing: el({ hoursPlayed: 30 }), platform: "steam",
    check: (r) => { if (r.action !== "update" || r.set.hoursPlayed !== 30) throw new Error(`got ${r.action === "update" ? r.set.hoursPlayed : "insert"}`); },
  },
  {
    name: "hours: existing 5, imported 50 → take 50",
    imported: ig({ hoursPlayed: 50 }), existing: el({ hoursPlayed: 5 }), platform: "steam",
    check: (r) => { if (r.action !== "update" || r.set.hoursPlayed !== 50) throw new Error("hours not promoted"); },
  },
  {
    name: "hours: existing null, imported 7 → take 7",
    imported: ig({ hoursPlayed: 7 }), existing: el({ hoursPlayed: null }), platform: "steam",
    check: (r) => { if (r.action !== "update" || r.set.hoursPlayed !== 7) throw new Error("hours wrong"); },
  },
  {
    name: "hours: existing 7, imported null → keep 7",
    imported: ig({ hoursPlayed: null }), existing: el({ hoursPlayed: 7 }), platform: "steam",
    check: (r) => { if (r.action !== "update" || r.set.hoursPlayed !== 7) throw new Error("hours wrong"); },
  },
  {
    name: "hours: both null → result null (NOT 0)",
    imported: ig({ hoursPlayed: null }), existing: el({ hoursPlayed: null }), platform: "steam",
    check: (r) => { if (r.action !== "update" || r.set.hoursPlayed !== null) throw new Error(`expected null, got ${r.action === "update" ? r.set.hoursPlayed : "insert"}`); },
  },
  {
    name: "insert with null hoursPlayed → null preserved (not 0)",
    imported: ig({ hoursPlayed: null }), existing: null, platform: "xbox",
    check: (r) => { if (r.action !== "insert" || r.row.hoursPlayed !== null) throw new Error("hours not null"); },
  },
  {
    name: "merge set contains ONLY platforms + hoursPlayed (status/rating/notes never touched)",
    imported: ig(), existing: el(), platform: "steam",
    check: (r) => {
      if (r.action !== "update") throw new Error("expected update");
      const keys = Object.keys(r.set).sort();
      const expected = ["hoursPlayed", "platforms"].sort();
      if (keys.length !== expected.length || !keys.every((k, i) => k === expected[i])) {
        throw new Error(`unexpected set keys: ${keys.join(",")}`);
      }
    },
  },
];

let pass = 0, fail = 0;
for (const c of cases) {
  try { c.check(mergeImportedGame(c.imported, c.existing, c.platform)); pass++; console.log(`  PASS  ${c.name}`); }
  catch (err) { fail++; console.log(`  FAIL  ${c.name}  —  ${(err as Error).message}`); }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
