import {
  aggregateFingerprint,
  weight,
  sign,
  type AggregateInputRow,
} from "@/lib/taste/aggregate";

function row(partial: Partial<AggregateInputRow>): AggregateInputRow {
  return {
    status: "playing",
    rating: null,
    hasPublishedReview: false,
    genres: [],
    themes: [],
    mechanics: [],
    gameModes: [],
    playerPerspectives: [],
    playtimeAvgHours: null,
    ...partial,
  };
}

type Case = { name: string; fn: () => boolean };

const cases: Case[] = [
  {
    name: "weight: rating=9 → 1.0 × (1 + 0.3 × 0.8) = 1.24",
    fn: () => Math.abs(weight(row({ rating: 9 })) - 1.24) < 1e-6,
  },
  {
    name: "weight: rating=5 (neutral intensity 0) → 1.0",
    fn: () => Math.abs(weight(row({ rating: 5 })) - 1.0) < 1e-6,
  },
  {
    name: "weight: rating=10 (max intensity 1) → 1.3",
    fn: () => Math.abs(weight(row({ rating: 10 })) - 1.3) < 1e-6,
  },
  {
    name: "weight: status=completed, no rating → 0.6",
    fn: () => Math.abs(weight(row({ status: "completed" })) - 0.6) < 1e-6,
  },
  {
    name: "weight: status=backlog, no rating → 0.2",
    fn: () => Math.abs(weight(row({ status: "backlog" })) - 0.2) < 1e-6,
  },
  {
    name: "weight: status=on_hold, no rating → 0.6 (engaged tier)",
    fn: () => Math.abs(weight(row({ status: "on_hold" })) - 0.6) < 1e-6,
  },
  {
    name: "weight: review bonus stacks (rating=8, hasReview=true)",
    fn: () => {
      const w = weight(row({ rating: 8, hasPublishedReview: true }));
      // 1.0 × (1 + 0.3 × 0.6) = 1.18, × 1.15 = 1.357
      return Math.abs(w - 1.357) < 1e-3;
    },
  },
  {
    name: "sign: rating=8 → +1",
    fn: () => sign(row({ rating: 8 })) === 1,
  },
  {
    name: "sign: rating=2 → -1 (active dislike)",
    fn: () => sign(row({ rating: 2 })) === -1,
  },
  {
    name: "sign: rating=5 → 0 (neutral, no directional signal)",
    fn: () => sign(row({ rating: 5 })) === 0,
  },
  {
    name: "sign: no rating, dropped → -1",
    fn: () => sign(row({ status: "dropped" })) === -1,
  },
  {
    name: "sign: no rating, backlog → +1 (weak positive interest)",
    fn: () => sign(row({ status: "backlog" })) === 1,
  },
  {
    name: "sign: no rating, on_hold → +1 (engaged, not dropped)",
    fn: () => sign(row({ status: "on_hold" })) === 1,
  },
  {
    name: "aggregate: empty → empty vectors",
    fn: () => {
      const r = aggregateFingerprint({ rows: [] });
      return (
        Object.keys(r.genre).length === 0 &&
        Object.keys(r.theme).length === 0 &&
        Object.keys(r.mechanic).length === 0 &&
        r.totalLogsAtGeneration === 0
      );
    },
  },
  {
    name: "aggregate: single rated-9 Roguelike → genre['Roguelike'] ≥ 0.99",
    fn: () => {
      const r = aggregateFingerprint({
        rows: [row({ rating: 9, genres: ["Roguelike"] })],
      });
      return r.genre["Roguelike"] >= 0.99;
    },
  },
  {
    name: "aggregate: rated-2 Roguelike → negative entry",
    fn: () => {
      const r = aggregateFingerprint({
        rows: [row({ rating: 2, genres: ["Roguelike"] })],
      });
      return r.genre["Roguelike"] < -0.5;
    },
  },
  {
    name: "aggregate: backlog dilutes rated signal (3 backlog Strategy + 1 rated-8 Roguelike → Roguelike entry < 1)",
    fn: () => {
      const r = aggregateFingerprint({
        rows: [
          row({ status: "backlog", genres: ["Strategy"] }),
          row({ status: "backlog", genres: ["Strategy"] }),
          row({ status: "backlog", genres: ["Strategy"] }),
          row({ rating: 8, genres: ["Roguelike"] }),
        ],
      });
      // totalW = 0.2×3 + 1.18 ≈ 1.78; Roguelike raw = +1.18; score = 1.18/1.78 ≈ 0.66
      return r.genre["Roguelike"] < 0.8 && r.genre["Roguelike"] > 0.5;
    },
  },
  {
    name: "aggregate: lengthPreference sums to ~1 when any length data present",
    fn: () => {
      const r = aggregateFingerprint({
        rows: [
          row({ rating: 8, playtimeAvgHours: 4 }),
          row({ rating: 8, playtimeAvgHours: 25 }),
        ],
      });
      const sum = Object.values(r.lengthPreference).reduce((a, b) => a + b, 0);
      return Math.abs(sum - 1.0) < 1e-6;
    },
  },
  {
    name: "aggregate: lengthPreference is all 0 when no playtime data",
    fn: () => {
      const r = aggregateFingerprint({
        rows: [row({ rating: 8, playtimeAvgHours: null })],
      });
      const sum = Object.values(r.lengthPreference).reduce((a, b) => a + b, 0);
      return sum === 0;
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
