export type MMRItem<T> = {
  id: T;
  score: number;
  embedding: number[];
};

type MMROptions<T> = {
  lambda: number; // 0 = pure diversity; 1 = pure relevance
  topN: number;
  similarity: (a: number[], b: number[]) => number;
};

export function applyMMR<T>(items: MMRItem<T>[], opts: MMROptions<T>): MMRItem<T>[] {
  if (items.length === 0) return [];
  const remaining = [...items];
  const picked: MMRItem<T>[] = [];

  // First pick: highest relevance
  remaining.sort((a, b) => b.score - a.score);
  picked.push(remaining.shift()!);

  while (picked.length < opts.topN && remaining.length > 0) {
    let bestIdx = 0;
    let bestVal = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      // Max similarity to anything already picked
      let maxSim = 0;
      for (const p of picked) {
        const s = opts.similarity(cand.embedding, p.embedding);
        if (s > maxSim) maxSim = s;
      }
      const mmrVal = opts.lambda * cand.score - (1 - opts.lambda) * maxSim;
      if (mmrVal > bestVal) {
        bestVal = mmrVal;
        bestIdx = i;
      }
    }

    picked.push(remaining.splice(bestIdx, 1)[0]);
  }

  return picked;
}
