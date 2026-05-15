import type { Mood } from "@/lib/recs/moods";

type AffinityEntry = {
  boostGenres: string[];
  boostMechanics: string[];
  penalizeMechanics: string[];
};

// Fixed table — hand-maintained. Strings should match the canonical
// IGDB/RAWG vocabulary used in `games.genres` / `games.mechanics`.
// During implementation, audit these against actual DB values and
// reconcile any drift.
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
  const genres = new Set((c.genres ?? []).map((g) => g.toLowerCase()));
  const mechanics = new Set((c.mechanics ?? []).map((m) => m.toLowerCase()));

  const genreHits = entry.boostGenres.filter((g) => genres.has(g.toLowerCase())).length;
  const mechBoostHits = entry.boostMechanics.filter((m) => mechanics.has(m.toLowerCase())).length;
  const mechPenaltyHits = entry.penalizeMechanics.filter((m) => mechanics.has(m.toLowerCase())).length;

  const budget = entry.boostGenres.length + entry.boostMechanics.length;
  if (budget === 0) return 0;

  // Normalize by the candidate's own matchable signal, not the full mood
  // vocabulary: real games carry only ~2-4 tags, so dividing by the entire
  // boost budget would cap even a perfect match at ~0.4 and silently weaken
  // the mood axis. denom is the achievable hit count given this candidate.
  const matched = genreHits + mechBoostHits;
  const denom = Math.max(1, Math.min(budget, genres.size + mechanics.size));
  const raw = (matched - mechPenaltyHits) / denom;
  return Math.max(0, Math.min(1, raw));
}
