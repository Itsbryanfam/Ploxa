import "server-only";

import type { VectorBundle, SparseVector } from "@/lib/taste/vectors";
import type { TasteTier } from "@/lib/taste/tier";

/** Bump on any prompt-text change. Logged in narrativeModelVersion for traceability. */
export const NARRATIVE_PROMPT_VERSION = "v1";
export const RERANK_PROMPT_VERSION = "v1"; // Used by T11.

export type NarrativePromptInput = {
  vectors: VectorBundle;
  lengthPreference: Record<string, number>;
  recentLikedGames: Array<{ title: string; genres: string[]; rating: number }>;
  recentDislikedGames: Array<{ title: string; genres: string[]; status: string; rating: number | null }>;
  tier: TasteTier;
  totalLogs: number;
};

function topN(vec: SparseVector, n: number): Array<[string, number]> {
  return Object.entries(vec)
    .filter(([, v]) => Math.abs(v) >= 0.05) // skip near-zero noise
    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
    .slice(0, n);
}

function fmtVector(name: string, vec: SparseVector): string {
  const top = topN(vec, 8);
  if (top.length === 0) return `${name}: (no signal yet)`;
  const lines = top.map(([k, v]) => `  ${k.padEnd(24)} ${v.toFixed(2)}`);
  return `${name}:\n${lines.join("\n")}`;
}

function fmtLength(pref: Record<string, number>): string {
  const entries = Object.entries(pref).filter(([, v]) => v > 0);
  if (entries.length === 0) return "Length preference: (no playtime data)";
  const lines = entries
    .sort(([, a], [, b]) => b - a)
    .map(([k, v]) => `  ${k.padEnd(8)} ${(v * 100).toFixed(0)}%`);
  return `Length preference (% of weighted logs):\n${lines.join("\n")}`;
}

/**
 * Render the per-user fingerprint into a (system, user) prompt pair for
 * the narrative model. The system prompt encodes voice + style guards
 * (no emoji, no hedging, no quoted titles) plus a tier-aware confidence
 * hint. The user prompt formats top-8 vectors per field, length
 * distribution, and the most recent liked/disliked games.
 *
 * Prompt-text changes MUST bump NARRATIVE_PROMPT_VERSION so the resulting
 * narrative_model_version on disk reflects the new prompt and the daily
 * drift cron can re-narrate users with stale prompts.
 */
export function buildNarrativePrompt(input: NarrativePromptInput): {
  system: string;
  user: string;
} {
  // The third arm fires for sparse/empty tiers. In production the Edge
  // function short-circuits both before calling buildNarrativePrompt
  // (sparse → vectors-only path; empty → no rows at all), so this branch
  // only fires when called from a context that bypasses those guards
  // (e.g. unit tests, future callers, or local prompt iteration). Kept
  // for safety — better to render a tentative narrative than to throw.
  const confidenceHint =
    input.tier === "full"
      ? "Write with confident specificity — name concrete patterns."
      : input.tier === "sharpening"
      ? "Write specifically, but acknowledge the picture is still forming."
      : "Write tentatively — only ~few logs to go on. Hint at directions, don't make strong claims.";

  const system = [
    "You write 2–3 sentence taste summaries for video-game players.",
    "Voice: playful, observant, specific. Reference 1–2 concrete genres or themes that dominate.",
    "Forbidden: emoji; hedging words like \"might\", \"perhaps\", \"tends to\"; quotation marks around game titles; the phrases \"you love\" or \"you enjoy\" (overused).",
    "Required: name actual genres/themes/mechanics from the data; address the user as \"you\".",
    confidenceHint,
  ].join(" ");

  const liked =
    input.recentLikedGames.length === 0
      ? "(no recent rated-high games)"
      : input.recentLikedGames
          .map((g) => `  ${g.title} (${g.rating}/10) — ${g.genres.slice(0, 2).join(", ")}`)
          .join("\n");

  const disliked =
    input.recentDislikedGames.length === 0
      ? "(no recent rated-low or dropped games)"
      : input.recentDislikedGames
          .map((g) =>
            g.rating != null
              ? `  ${g.title} (${g.rating}/10) — ${g.genres.slice(0, 2).join(", ")}`
              : `  ${g.title} (${g.status}) — ${g.genres.slice(0, 2).join(", ")}`,
          )
          .join("\n");

  const user = [
    `Tier: ${input.tier} (${input.totalLogs} total logs).`,
    "",
    fmtVector("Genres (preference -1 to +1)", input.vectors.genre),
    "",
    fmtVector("Themes", input.vectors.theme),
    "",
    fmtVector("Mechanics", input.vectors.mechanic),
    "",
    fmtLength(input.lengthPreference),
    "",
    "Recent rated-high (7+):",
    liked,
    "",
    "Recent rejected (rated low or dropped):",
    disliked,
    "",
    "Write 2–3 sentences capturing this taste profile.",
  ].join("\n");

  return { system, user };
}
