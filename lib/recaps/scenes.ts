import type { RecapMode, SceneDefinition } from "./types";

export const SCENE_CATALOG: SceneDefinition[] = [
  {
    id: "opening",
    aiCaption: true,
    fallbackTemplate: (p) =>
      `Welcome to your ${p.mode === "yearly" ? "year" : "month"} in games — ${p.totals.totalGames} to look back on.`,
  },
  {
    id: "stats_total",
    aiCaption: false,
    fallbackTemplate: (p) => `${p.totals.totalGames} games · ${p.totals.completedCount} completed`,
  },
  {
    id: "top_games",
    aiCaption: false,
    holdDurationMs: 10_000,
    fallbackTemplate: (p) => `Your top ${p.mode === "yearly" ? "5" : "3"}.`,
  },
  {
    id: "goty",
    aiCaption: true,
    fallbackTemplate: (p) =>
      p.goty ? `Your top-rated game: ${p.goty.title}, ${p.goty.rating}/5.` : "No clear winner this time.",
  },
  {
    id: "genre_dominance",
    aiCaption: true,
    fallbackTemplate: (p) =>
      p.topGenre
        ? `${p.topGenre.name} owned your ${p.mode === "yearly" ? "year" : "month"} — ${p.topGenre.pct}% of your library.`
        : "Your tastes were balanced this time.",
  },
  {
    id: "mechanic_love",
    aiCaption: true,
    fallbackTemplate: (p) =>
      p.topMechanic ? `Your love language: ${p.topMechanic.name}.` : "Many mechanics, no clear favorite.",
  },
  {
    id: "surprise",
    aiCaption: true,
    yearOnly: true,
    fallbackTemplate: (p) =>
      p.surprise
        ? `Your biggest surprise: ${p.surprise.game.title}, rated ${p.surprise.game.rating}/5.`
        : "No standout surprises this year.",
  },
  {
    id: "taste_evolution",
    aiCaption: true,
    yearOnly: true,
    fallbackTemplate: (p) =>
      p.tasteEvolution ? `From ${p.tasteEvolution.q1Vibe} to ${p.tasteEvolution.q4Vibe}.` : "Steady taste all year.",
  },
  {
    id: "longest_game",
    aiCaption: false,
    fallbackTemplate: (p) =>
      p.longestGame ? `${p.longestGame.game.title} owned you for ${p.longestGame.hoursPlayed}h.` : "Brief sessions only.",
  },
  {
    id: "reviews",
    aiCaption: false,
    yearOnly: true,
    fallbackTemplate: (p) =>
      p.totals.reviewCount > 0 ? `You wrote ${p.totals.reviewCount} reviews this year.` : "No reviews this year.",
  },
  {
    id: "closing",
    aiCaption: true,
    fallbackTemplate: (p) => `That was your ${p.mode === "yearly" ? "year" : "month"}. Share it?`,
  },
  // -----------------------------------------------------------------------
  // Substitute scenes — added in T14 to close the gap T6's reviewer flagged.
  //
  // Each substitute mirrors its primary's shape but uses different data
  // (replays for longest_game, themes for mechanic_love, etc.). We mark
  // them as `aiCaption: false` for v1 because:
  //   1. Substitutes are rare paths (a user with no Steam playtime + a
  //      fingerprint-driven theme replacement) and the deterministic
  //      template reads well enough.
  //   2. Adding AI prompts for each substitute would double the prompt
  //      count for not much gain — the substitute is already a fallback.
  // A future task can flip these to `true` and add per-substitute prompts.
  // -----------------------------------------------------------------------
  {
    id: "most_replayed",
    aiCaption: false,
    isSubstitute: true,
    fallbackTemplate: (p) =>
      p.mostReplayed
        ? `Your most replayed: ${p.mostReplayed.game.title}, ${p.mostReplayed.replayCount} times.`
        : "No standout replays this time.",
  },
  {
    id: "top_theme",
    aiCaption: false,
    isSubstitute: true,
    fallbackTemplate: (p) =>
      p.topTheme ? `Your year's vibe: ${p.topTheme.name}.` : "Eclectic taste, no single theme.",
  },
  {
    id: "completion_ratio",
    aiCaption: false,
    yearOnly: true,
    isSubstitute: true,
    fallbackTemplate: (p) =>
      p.completionRatio
        ? `You completed ${p.completionRatio.completedPct}% of what you logged.`
        : "Your completion rate was hard to pin down.",
  },
  {
    id: "mood_themes",
    aiCaption: false,
    yearOnly: true,
    isSubstitute: true,
    fallbackTemplate: (p) =>
      p.moodThemes && p.moodThemes.themes.length > 0
        ? `Your year's moods: ${p.moodThemes.themes.join(", ")}.`
        : "Many moods, no single throughline.",
  },
];

export function filterScenes(catalog: SceneDefinition[], mode: RecapMode): SceneDefinition[] {
  // Substitute scenes (most_replayed, top_theme, completion_ratio, mood_themes)
  // are never in the base list — they're inserted by `applySubstitutions` only
  // when a primary scene's data is missing.
  const primaries = catalog.filter((s) => !s.isSubstitute);
  if (mode === "monthly") return primaries.filter((s) => !s.yearOnly);
  return primaries;
}

export function getScene(id: SceneDefinition["id"]): SceneDefinition | undefined {
  return SCENE_CATALOG.find((s) => s.id === id);
}
