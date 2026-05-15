import { describe, expect, it } from "vitest";
import { applyMMR, type MMRItem } from "@/lib/recs/diversity-mmr";

const sim = (a: number[], b: number[]) => {
  const dot = a.reduce((s, x, i) => s + x * b[i], 0);
  const magA = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
  const magB = Math.sqrt(b.reduce((s, x) => s + x * x, 0));
  return magA && magB ? dot / (magA * magB) : 0;
};

const itemsClustered: MMRItem<string>[] = [
  // Two tight clusters of high-score items; one outlier
  { id: "a1", score: 0.95, embedding: [1, 0, 0] },
  { id: "a2", score: 0.94, embedding: [0.98, 0.05, 0] },
  { id: "a3", score: 0.93, embedding: [0.96, 0.1, 0] },
  { id: "b1", score: 0.92, embedding: [0, 1, 0] },
  { id: "b2", score: 0.91, embedding: [0.05, 0.98, 0] },
  { id: "c1", score: 0.85, embedding: [0, 0, 1] },
];

describe("applyMMR", () => {
  it("with λ=1.0 returns top-N in score order", () => {
    const out = applyMMR(itemsClustered, { lambda: 1.0, topN: 4, similarity: sim });
    expect(out.map((i) => i.id)).toEqual(["a1", "a2", "a3", "b1"]);
  });

  it("with λ=0.7 promotes diversity over pure score", () => {
    const out = applyMMR(itemsClustered, { lambda: 0.7, topN: 4, similarity: sim });
    const ids = out.map((i) => i.id);
    // First pick is still the top-scored
    expect(ids[0]).toBe("a1");
    // But "b1" (different cluster) should outrank "a2" (same cluster as a1)
    expect(ids.indexOf("b1")).toBeLessThan(ids.indexOf("a2"));
  });

  it("handles topN larger than input length", () => {
    const out = applyMMR(itemsClustered.slice(0, 3), {
      lambda: 0.7,
      topN: 10,
      similarity: sim,
    });
    expect(out.length).toBe(3);
  });

  it("returns empty array for empty input", () => {
    expect(applyMMR([], { lambda: 0.7, topN: 5, similarity: sim })).toEqual([]);
  });
});
