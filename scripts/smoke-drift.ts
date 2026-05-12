import { cosineSim, drift, type SparseVector, type VectorBundle } from "@/lib/taste/vectors";
import { tierForUser, isAtLeast } from "@/lib/taste/tier";

type Case = { name: string; fn: () => boolean };

const cases: Case[] = [
  {
    name: "tierForUser: 0 → empty",
    fn: () => tierForUser(0) === "empty",
  },
  {
    name: "tierForUser: 1 → sparse",
    fn: () => tierForUser(1) === "sparse",
  },
  {
    name: "tierForUser: 9 → sparse",
    fn: () => tierForUser(9) === "sparse",
  },
  {
    name: "tierForUser: 10 → sharpening",
    fn: () => tierForUser(10) === "sharpening",
  },
  {
    name: "tierForUser: 29 → sharpening",
    fn: () => tierForUser(29) === "sharpening",
  },
  {
    name: "tierForUser: 30 → full",
    fn: () => tierForUser(30) === "full",
  },
  {
    name: "tierForUser: 500 → full",
    fn: () => tierForUser(500) === "full",
  },
  {
    name: "isAtLeast(sharpening, sparse) === true",
    fn: () => isAtLeast("sharpening", "sparse") === true,
  },
  {
    name: "isAtLeast(sparse, sharpening) === false",
    fn: () => isAtLeast("sparse", "sharpening") === false,
  },
  {
    name: "cosineSim: identical vectors === 1",
    fn: () => {
      const v: SparseVector = { a: 1, b: 2, c: 3 };
      return Math.abs(cosineSim(v, v) - 1) < 1e-10;
    },
  },
  {
    name: "cosineSim: scaled vectors === 1 (direction only)",
    fn: () => {
      const a: SparseVector = { a: 1, b: 2 };
      const b: SparseVector = { a: 2, b: 4 };
      return Math.abs(cosineSim(a, b) - 1) < 1e-10;
    },
  },
  {
    name: "cosineSim: orthogonal vectors === 0",
    fn: () => {
      const a: SparseVector = { x: 1 };
      const b: SparseVector = { y: 1 };
      return Math.abs(cosineSim(a, b)) < 1e-10;
    },
  },
  {
    name: "cosineSim: opposite vectors === -1",
    fn: () => {
      const a: SparseVector = { x: 1, y: 1 };
      const b: SparseVector = { x: -1, y: -1 };
      return Math.abs(cosineSim(a, b) - -1) < 1e-10;
    },
  },
  {
    name: "cosineSim: empty vector returns 0 (no NaN)",
    fn: () => {
      const a: SparseVector = {};
      const b: SparseVector = { x: 1 };
      return cosineSim(a, b) === 0;
    },
  },
  {
    name: "drift: null snapshot → Infinity",
    fn: () => {
      const current: VectorBundle = { genre: { a: 1 }, theme: {}, mechanic: {} };
      return drift(current, null) === Infinity;
    },
  },
  {
    name: "drift: identical snapshot → 0",
    fn: () => {
      const current: VectorBundle = { genre: { a: 1 }, theme: { b: 1 }, mechanic: { c: 1 } };
      return Math.abs(drift(current, current)) < 1e-10;
    },
  },
  {
    name: "drift: orthogonal genre shift → 1",
    fn: () => {
      const current: VectorBundle = { genre: { y: 1 }, theme: { b: 1 }, mechanic: { c: 1 } };
      const snap: VectorBundle = { genre: { x: 1 }, theme: { b: 1 }, mechanic: { c: 1 } };
      return Math.abs(drift(current, snap) - 1) < 1e-10;
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
