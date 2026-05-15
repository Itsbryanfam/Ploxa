export type WildcardCandidate = {
  gameId: number;
  composite: number;
  genres: string[];
};

// PRECONDITION: `exploredGenres` members and `genreFrequency` keys MUST be
// lowercased by the caller. Lookups here lowercase the candidate genre, but
// games.genres is mixed-case (RAWG/IGDB) — a mixed-case Set/Map silently
// misclassifies every genre as unexplored and Bucket A swallows the pool.
type WildcardOpts = {
  exploredGenres: Set<string>;
  genreFrequency?: Map<string, number>; // user's log count per genre
  minScore?: number;
  seed?: number;
};

// Deterministic PRNG (mulberry32) so tests are stable
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickWildcard(
  candidates: WildcardCandidate[],
  opts: WildcardOpts,
): WildcardCandidate | null {
  if (candidates.length === 0) return null;
  const minScore = opts.minScore ?? 0.4;
  const filtered = candidates.filter((c) => c.composite >= minScore);
  if (filtered.length === 0) return null;

  // Bucket A: from genres user has NEVER logged
  const unexplored = filtered.filter((c) =>
    c.genres.some((g) => !opts.exploredGenres.has(g.toLowerCase())),
  );

  // Bucket B: from least-frequent explored genres (if no unexplored)
  let pool: WildcardCandidate[];
  if (unexplored.length > 0) {
    pool = unexplored;
  } else if (opts.genreFrequency) {
    // Rank by each candidate's least-explored genre (min log-frequency
    // across its genres), then keep only the globally-least-explored.
    // `?? Infinity` is a sentinel: a genre absent from genreFrequency
    // (caller-inconsistent with exploredGenres) sorts as most-explored.
    const scored = filtered.map((c) => {
      const freqs = c.genres.map((g) => opts.genreFrequency!.get(g.toLowerCase()) ?? Infinity);
      const minFreq = Math.min(...freqs);
      return { c, minFreq };
    });
    const cutoff = Math.min(...scored.map((s) => s.minFreq));
    pool = scored.filter((s) => s.minFreq === cutoff).map((s) => s.c);
  } else {
    pool = filtered;
  }

  // Constrained random within pool. With a seed → deterministic (Task 12
  // passes a per-request seed for reproducible recs). No seed → wall-clock
  // entropy by design: a fresh wildcard each call. Not for client/SSR paths.
  const rand = mulberry32(opts.seed ?? Date.now());
  const idx = Math.floor(rand() * pool.length);
  return pool[idx];
}
