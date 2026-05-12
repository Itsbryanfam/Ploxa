/**
 * Smoke test for lib/recs/cache.ts.
 *
 * Run:
 *   pnpm tsx --conditions react-server scripts/smoke-recs-cache.ts
 *
 * --conditions react-server is REQUIRED because lib/recs/cache.ts has
 * `import "server-only"`. In plain Node/tsx, "server-only" throws at import
 * time. The react-server export condition resolves it to the empty shim.
 */
import { cacheKey } from "@/lib/recs/cache";

type Case = { name: string; fn: () => boolean };

const cases: Case[] = [
  {
    name: "cacheKey: deterministic (same input → same hash)",
    fn: () => {
      const k1 = cacheKey({ userId: "u1", moods: ["chill"], time: "1hr", platforms: ["steam"] });
      const k2 = cacheKey({ userId: "u1", moods: ["chill"], time: "1hr", platforms: ["steam"] });
      return k1 === k2 && k1.length === 24;
    },
  },
  {
    name: "cacheKey: moods sort-stable (order doesn't matter)",
    fn: () => {
      const k1 = cacheKey({ userId: "u1", moods: ["chill", "multiplayer"], time: "1hr", platforms: ["steam"] });
      const k2 = cacheKey({ userId: "u1", moods: ["multiplayer", "chill"], time: "1hr", platforms: ["steam"] });
      return k1 === k2;
    },
  },
  {
    name: "cacheKey: platforms sort-stable",
    fn: () => {
      const k1 = cacheKey({ userId: "u1", moods: ["chill"], time: "1hr", platforms: ["xbox", "steam"] });
      const k2 = cacheKey({ userId: "u1", moods: ["chill"], time: "1hr", platforms: ["steam", "xbox"] });
      return k1 === k2;
    },
  },
  {
    name: "cacheKey: different users → different keys",
    fn: () => {
      const k1 = cacheKey({ userId: "u1", moods: ["chill"], time: "1hr", platforms: ["steam"] });
      const k2 = cacheKey({ userId: "u2", moods: ["chill"], time: "1hr", platforms: ["steam"] });
      return k1 !== k2;
    },
  },
  {
    name: "cacheKey: different time → different keys",
    fn: () => {
      const k1 = cacheKey({ userId: "u1", moods: ["chill"], time: "1hr", platforms: ["steam"] });
      const k2 = cacheKey({ userId: "u1", moods: ["chill"], time: "3hr+", platforms: ["steam"] });
      return k1 !== k2;
    },
  },
  {
    name: "cacheKey: different mood set → different keys",
    fn: () => {
      const k1 = cacheKey({ userId: "u1", moods: ["chill"], time: "1hr", platforms: ["steam"] });
      const k2 = cacheKey({ userId: "u1", moods: ["challenged"], time: "1hr", platforms: ["steam"] });
      return k1 !== k2;
    },
  },
];

let failed = 0;
for (const c of cases) {
  const ok = c.fn();
  console.log(`${ok ? "✓" : "✗"} ${c.name}`);
  if (!ok) failed++;
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed === 0 ? 0 : 1);
