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
  gameMode: SparseVector;
  playerPerspective: SparseVector;
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
 * Max cosine distance across the five vector fields between the current
 * snapshot and the snapshot taken at last narrative generation.
 *
 * Returns Infinity when no snapshot exists (forces a regen).
 *
 * Threshold guidance: 0.25 = significant taste shift; 0.1 = noisy churn.
 * Tune in W2 once we have a few real users to calibrate against.
 *
 * Per-axis semantics: an axis where BOTH current and snapshot are empty
 * (e.g. gameMode/playerPerspective on legacy fingerprints saved before the
 * IGDB integration) contributes 0 distance — both sides agree there's no
 * signal yet. An axis where one side has signal and the other doesn't
 * contributes the full max distance (1.0) — that's a real shift.
 */
export function drift(
  current: VectorBundle,
  snapshot: VectorBundle | null,
): number {
  if (!snapshot) return Infinity;
  const axisDistance = (a: SparseVector, b: SparseVector): number => {
    if (Object.keys(a).length === 0 && Object.keys(b).length === 0) return 0;
    return 1 - cosineSim(a, b);
  };
  return Math.max(
    axisDistance(current.genre, snapshot.genre),
    axisDistance(current.theme, snapshot.theme),
    axisDistance(current.mechanic, snapshot.mechanic),
    axisDistance(current.gameMode, snapshot.gameMode),
    axisDistance(current.playerPerspective, snapshot.playerPerspective),
  );
}
