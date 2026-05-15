import type { LogStatus } from "@/lib/db/schema-types";

export type RecapMode = "yearly" | "monthly";

export type SceneId =
  | "opening"
  | "stats_total"
  | "top_games"
  | "goty"
  | "genre_dominance"
  | "mechanic_love"
  | "surprise"
  | "taste_evolution"
  | "longest_game"
  | "most_replayed" // substitute for longest_game when no Steam playtime
  | "top_theme" // substitute for mechanic_love when <3 mechanics
  | "completion_ratio" // substitute for taste_evolution when single-quarter
  | "mood_themes" // substitute for surprise when no outlier
  | "reviews"
  | "closing";

export interface SceneDefinition {
  id: SceneId;
  aiCaption: boolean;
  yearOnly?: boolean;
  holdDurationMs?: number; // override default 8000 ms
  fallbackTemplate: (payload: RecapPayload) => string;
}

export type RecapTier = "ok" | "too_sparse";

export interface TopGameRef {
  gameId: string;
  rawgId: number | null;
  title: string;
  coverUrl: string | null;
  rating: number; // 0-5
  status: LogStatus;
}

export interface RecapPayload {
  tier: RecapTier;
  mode: RecapMode;
  windowStart: string; // ISO
  windowEnd: string; // ISO
  scenes: SceneId[]; // ordered list of scenes to render (after substitution)
  totals: {
    totalGames: number;
    totalHoursPlayed: number | null;
    completedCount: number;
    droppedCount: number;
    replayingCount: number;
    reviewCount: number;
  };
  topGames: TopGameRef[]; // up to 5
  goty?: TopGameRef; // single highest-rated
  topGenre?: { name: string; pct: number; secondName: string | null; secondPct: number };
  topMechanic?: { name: string };
  topTheme?: { name: string }; // substitution
  surprise?: { game: TopGameRef; surpriseGenre: string; baselineAvg: number };
  tasteEvolution?: { q1Vibe: string; q4Vibe: string };
  completionRatio?: { completedPct: number; droppedPct: number }; // substitution
  moodThemes?: { themes: string[] }; // substitution
  longestGame?: { game: TopGameRef; hoursPlayed: number };
  mostReplayed?: { game: TopGameRef; replayCount: number }; // substitution
  favoriteReviewSnippet?: { reviewId: string; gameTitle: string; snippet: string };
  // Filled in by captions module after AI generation; empty before:
  captions: Partial<Record<SceneId, string>>;
}
