import {
  canonicalizeGenreTerm,
  canonicalizeMechanicTerm,
} from "@/lib/igdb/vocabulary";
import type { Mood } from "@/lib/recs/moods";

type AffinityEntry = {
  boostGenres: string[];
  boostMechanics: string[];
  penalizeMechanics: string[];
};

// Fixed table — hand-maintained. Tokens are hyphenated / abbreviated and
// do NOT literally equal the curated catalog vocabulary. They are bridged
// to the real `games.genres` (RAWG names) / `games.mechanics` (IGDB set)
// values at match time via the canonicalizers in `lib/igdb/vocabulary.ts`
// (Task 8). Add a new token's real-term mapping THERE, not a parallel map
// here. Tokens with no genuine catalog equivalent are intentionally left
// unmapped (they stay inert rather than mis-matching).
export const MOOD_AFFINITY: Record<Mood, AffinityEntry> = {
  chill: {
    boostGenres: ["puzzle", "life-sim", "casual", "indie"],
    boostMechanics: ["relaxing", "no-pressure", "low-stakes", "cozy", "exploration"],
    penalizeMechanics: ["competitive", "twitch", "time-pressure", "permadeath"],
  },
  challenged: {
    boostGenres: ["roguelike", "soulslike", "strategy", "fighting"],
    boostMechanics: ["skill-based", "difficult", "competitive", "permadeath"],
    penalizeMechanics: ["casual", "story-only", "no-fail"],
  },
  "story-driven": {
    boostGenres: ["rpg", "adventure", "narrative", "visual-novel"],
    boostMechanics: ["choices-matter", "branching-narrative", "voice-acted"],
    penalizeMechanics: ["pvp-only", "sandbox-no-narrative", "multiplayer-only"],
  },
  mindless: {
    boostGenres: ["clicker", "casual", "runner"],
    boostMechanics: ["idle", "repetitive", "low-stakes", "auto-play"],
    penalizeMechanics: ["complex-systems", "deep-strategy", "permadeath"],
  },
  multiplayer: {
    boostGenres: ["competitive", "party", "fighting", "mmo"],
    boostMechanics: ["pvp", "co-op", "online-multiplayer"],
    penalizeMechanics: ["single-player-only", "narrative-only"],
  },
};

type CandidateForMood = {
  genres: string[] | null;
  mechanics: string[] | null;
};

export function moodMatchScore(mood: Mood, c: CandidateForMood): number {
  const entry = MOOD_AFFINITY[mood];
  // Canonicalize BOTH sides through the shared vocabulary bridge so the
  // hyphenated affinity tokens compare equal to the real catalog terms.
  // Genres use the RAWG-name map; mechanics use the IGDB-set map. Terms
  // with no alias canonicalize to their own lowercased self, so the
  // single-word IGDB matches that already worked (permadeath/exploration/
  // competitive/pvp/…) are preserved.
  const genres = new Set((c.genres ?? []).map(canonicalizeGenreTerm));
  const mechanics = new Set((c.mechanics ?? []).map(canonicalizeMechanicTerm));

  const genreHits = entry.boostGenres.filter((g) =>
    genres.has(canonicalizeGenreTerm(g)),
  ).length;
  const mechBoostHits = entry.boostMechanics.filter((m) =>
    mechanics.has(canonicalizeMechanicTerm(m)),
  ).length;
  const mechPenaltyHits = entry.penalizeMechanics.filter((m) =>
    mechanics.has(canonicalizeMechanicTerm(m)),
  ).length;

  const budget = entry.boostGenres.length + entry.boostMechanics.length;
  if (budget === 0) return 0;

  // Normalize by the candidate's own tag count, not the full mood vocabulary:
  // real games carry only ~2-4 tags, so dividing by the entire boost budget
  // (~9 terms for chill) would cap even a 4-hit perfect match at ~0.44 and
  // silently weaken the mood axis. denom approximates achievable signal via
  // total candidate tag count; tag-rich games are slightly under-scored,
  // which is acceptable for a 0.25-weighted axis.
  const matched = genreHits + mechBoostHits;
  const denom = Math.max(1, Math.min(budget, genres.size + mechanics.size));
  const raw = (matched - mechPenaltyHits) / denom;
  return Math.max(0, Math.min(1, raw));
}
