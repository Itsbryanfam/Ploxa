/**
 * Vector math for the taste fingerprint.
 *
 * Vectors are sparse maps from token (genre name, theme name, mechanic name)
 * to score in [-1, +1]. Missing keys are treated as 0.
 *
 * The drift function is what powers the daily cron's "should we re-narrate?"
 * decision. Cosine similarity is direction-only — a vector that scales 2x
 * has drift 0. That's what we want: "shape of taste changed" matters more
 * than "more games logged in the same genres."
 */

export type SparseVector = Record<string, number>;

export type VectorBundle = {
  genre: SparseVector;
  theme: SparseVector;
  mechanic: SparseVector;
};

/**
 * Cosine similarity over sparse vectors. Result in [-1, 1].
 * Two empty vectors → 0 (treated as "no shared signal").
 */
export function cosineSim(a: SparseVector, b: SparseVector): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const av = a[key] ?? 0;
    const bv = b[key] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Max cosine distance across the three vector fields between the current
 * snapshot and the snapshot taken at last narrative generation.
 *
 * Returns Infinity when no snapshot exists (forces a regen).
 *
 * Threshold guidance: 0.25 = significant taste shift; 0.1 = noisy churn.
 * Tune in W2 once we have a few real users to calibrate against.
 */
export function drift(
  current: VectorBundle,
  snapshot: VectorBundle | null,
): number {
  if (!snapshot) return Infinity;
  return Math.max(
    1 - cosineSim(current.genre, snapshot.genre),
    1 - cosineSim(current.theme, snapshot.theme),
    1 - cosineSim(current.mechanic, snapshot.mechanic),
  );
}
