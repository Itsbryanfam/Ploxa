import "server-only";

import type { VectorBundle, SparseVector } from "@/lib/taste/vectors";
import type { TasteTier } from "@/lib/taste/tier";

/** Bump on any prompt-text change. Logged in narrativeModelVersion for traceability. */
export const NARRATIVE_PROMPT_VERSION = "v2";
export const RERANK_PROMPT_VERSION = "v3"; // v3: pick 6 (was 5) to fill the 6-card grid

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
    "Required: name actual genres/themes/mechanics/modes/perspectives from the data; address the user as \"you\".",
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
    fmtVector("Game Modes", input.vectors.gameMode),
    "",
    fmtVector("Player Perspectives", input.vectors.playerPerspective),
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

/**
 * Input shape for the AI rerank prompt (T11). The Edge function pulls all
 * of these from Postgres before calling buildRerankPrompt — `narrative`
 * may be null for sparse-tier users who never got a narrative summary.
 */
export type RerankPromptInput = {
  narrative: string | null;
  vectors: VectorBundle;
  filters: {
    moods: string[];
    time: string;
    platforms: string[];
  };
  candidates: Array<{
    id: number;
    title: string;
    genres: string[];
    themes: string[];
    mechanics: string[];
    playtimeAvgHours: number | null;
    description: string | null;
  }>;
  dismissedGames: Array<{ title: string; genres: string[] }>;
  currentlyPlaying: Array<{ title: string }>;
  libraryTitles?: string[];
  userRefinements?: string[];
};

/**
 * Render the (user fingerprint + filter context + candidate pool) into a
 * (system, user) prompt pair for the AI rerank model. The system prompt
 * constrains the model to pick exactly 5 candidates, score each in [0,1],
 * and write one filter-aware sentence of reasoning per pick. Output is
 * strict JSON ({ recs: [{gameId, score, reason}, ...] }) — the Edge
 * function defensively strips code fences and validates gameIds against
 * the candidate set, but a clean prompt keeps that fallback rare.
 *
 * Prompt-text changes MUST bump RERANK_PROMPT_VERSION so the resulting
 * model_version logged with each rec generation reflects the prompt.
 */
const REFINEMENT_MAX = 5;
const REFINEMENT_CHAR_CAP = 140;
// Strip ALL line/control chars (not just \n) and collapse whitespace runs:
// userRefinements is user-controlled free text injected into a line-
// structured prompt. A surviving \r / \v /   etc. could forge prompt
// structure; the delimited block + "filter wins" framing is the next layer.
function sanitizeRefinement(s: string): string {
  return s
    .replace(/[\r\n\t\v\f  ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, REFINEMENT_CHAR_CAP);
}

export function buildRerankPrompt(input: RerankPromptInput): {
  system: string;
  user: string;
} {
  const moodList = input.filters.moods.join(" + ");
  const system = [
    "You are recommending the next game for a player from a candidate list.",
    "Pick exactly 6 from the candidates. Score each in [0, 1].",
    `Write ONE sentence of reasoning per game (max 25 words) that EXPLICITLY references the player's filter context (mood: ${moodList}; time: ${input.filters.time}).`,
    "Reasoning style: concrete and observed (e.g. 'Quick puzzle loops with no fail state — fits your half-hour window.'). Forbidden: emoji, hedging, the phrases 'you love' / 'you enjoy', quotation marks around titles.",
    "Output ONLY valid JSON matching this exact schema:",
    `{ "recs": [{ "gameId": <int>, "score": <0..1>, "reason": "<one sentence>" }, ... 6 items] }`,
    "No prose before or after the JSON. No code fences. Just the object.",
  ].join("\n");

  const candidateList = input.candidates
    .map((c) => {
      const meta = [
        c.genres.slice(0, 3).join("/"),
        c.themes.slice(0, 2).join("/"),
        c.mechanics.slice(0, 2).join("/"),
      ]
        .filter(Boolean)
        .join(" · ");
      const lenStr = c.playtimeAvgHours != null ? `~${c.playtimeAvgHours.toFixed(0)}h` : "?h";
      const desc = c.description ? " — " + c.description.slice(0, 80) : "";
      return `  [${c.id}] ${c.title} (${meta}, ${lenStr})${desc}`;
    })
    .join("\n");

  const userBlocks: string[] = [
    `Filter: mood=${moodList}; time=${input.filters.time}; platforms=${input.filters.platforms.join(",")}`,
    "",
  ];

  if (input.narrative) {
    userBlocks.push("Their taste read:", input.narrative, "");
  }

  // Top-5 genre signal (compressed). Reuses the same sort-by-|v| ordering
  // as topN() above but inlines it here because we need a comma-joined
  // single-line representation rather than the multi-line fmtVector form.
  const topGenres = Object.entries(input.vectors.genre)
    .filter(([, v]) => Math.abs(v) >= 0.05)
    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
    .slice(0, 5)
    .map(([k, v]) => `${k}:${v.toFixed(2)}`)
    .join(", ");
  if (topGenres) userBlocks.push(`Top genre signal: ${topGenres}`, "");

  userBlocks.push(`Candidate games (id, metadata, playtime):\n${candidateList}`, "");

  if (input.dismissedGames.length > 0) {
    const dismissed = input.dismissedGames
      .map((g) => `${g.title} (${g.genres.slice(0, 2).join(",")})`)
      .join("; ");
    userBlocks.push(
      `The player has REJECTED these (avoid recommending unless a strong match outweighs the signal): ${dismissed}`,
      "",
    );
  }

  if (input.currentlyPlaying.length > 0) {
    const playing = input.currentlyPlaying.map((g) => g.title).join("; ");
    userBlocks.push(`Currently playing (do not recommend these): ${playing}`, "");
  }

  if (input.userRefinements && input.userRefinements.length > 0) {
    const cleaned = input.userRefinements
      .slice(0, REFINEMENT_MAX)
      .map(sanitizeRefinement)
      .filter((s) => s.length > 0);
    if (cleaned.length > 0) {
      userBlocks.push(
        `ADDITIONAL USER REQUESTS:\n${cleaned.map((r) => `- ${r}`).join("\n")}\n\nApply these when selecting picks AND when writing reasoning. If a request conflicts with a hard filter, the filter wins. Reference the request explicitly in the reason when relevant.`,
        "",
      );
    }
  }

  if (input.libraryTitles && input.libraryTitles.length > 0) {
    const sample = input.libraryTitles.slice(0, 10).join(", ");
    userBlocks.push(
      `USER'S LIBRARY (sample): ${sample}\n\nWhen writing reasoning, cite specific games from the user's library that this pick resembles when the comparison is honest. Prefer "Like Stardew Valley, this is..." over generic "matches your love of..." phrasing.`,
      "",
    );
  }

  userBlocks.push("Return the JSON object now.");

  return { system, user: userBlocks.join("\n") };
}
