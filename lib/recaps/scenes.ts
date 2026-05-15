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
];

export function filterScenes(catalog: SceneDefinition[], mode: RecapMode): SceneDefinition[] {
  if (mode === "monthly") return catalog.filter((s) => !s.yearOnly);
  return catalog;
}

export function getScene(id: SceneDefinition["id"]): SceneDefinition | undefined {
  return SCENE_CATALOG.find((s) => s.id === id);
}
