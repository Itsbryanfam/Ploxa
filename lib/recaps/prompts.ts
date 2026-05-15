const SHARED_CONSTRAINTS = `Constraints:
- No emojis
- No exclamation marks
- Address user as "you"
- One sentence
- 140 chars max
- Voice: knowing observer — warmer than analytics, less performative than a marketing tagline

Output ONLY JSON matching schema: { "caption": string }`;

export interface PromptOutput {
  system: string;
  user: string;
}

export function buildOpeningPrompt(input: {
  totalGames: number;
  year: number;
  reviewCount: number;
  topGenre: string | null;
}): PromptOutput {
  return {
    system: `You write the opening hook line for a personalized year-in-review for a video game tracker. ${SHARED_CONSTRAINTS}`,
    user: `User logged ${input.totalGames} games in ${input.year}. They wrote ${input.reviewCount} reviews. Dominant genre: ${input.topGenre ?? "varied"}. Write one hook line that sets up the recap.`,
  };
}

export function buildGotyPrompt(input: {
  title: string;
  rating: number;
  status: string;
}): PromptOutput {
  return {
    system: `You write the reveal line for the user's top-rated game of the year. ${SHARED_CONSTRAINTS}`,
    user: `Game: ${input.title}. Rating: ${input.rating}/5. Status: ${input.status}. Voice: celebratory but grounded.`,
  };
}

export function buildGenreDominancePrompt(input: {
  topGenre: string;
  topGenrePct: number;
  secondGenre: string | null;
  secondGenrePct: number;
}): PromptOutput {
  return {
    system: `You write the observation line for the user's dominant genre of the year. ${SHARED_CONSTRAINTS}`,
    user: `Top genre: ${input.topGenre} (${input.topGenrePct}%). Second: ${input.secondGenre ?? "none"} (${input.secondGenrePct}%). Caption the observation.`,
  };
}

export function buildMechanicLovePrompt(input: { topMechanic: string }): PromptOutput {
  return {
    system: `You write the "love language" line for the user's top game mechanic. ${SHARED_CONSTRAINTS}`,
    user: `Top mechanic: ${input.topMechanic}. Example shape: "Roguelite progression was your love language this year."`,
  };
}

export function buildSurprisePrompt(input: {
  game: string;
  surpriseGenre: string;
  rating: number;
  baselineAvg: number;
}): PromptOutput {
  return {
    system: `You write the reveal line for the user's "surprise of the year" — a game they rated unexpectedly highly in a genre they usually rate lower. ${SHARED_CONSTRAINTS}`,
    user: `Game: ${input.game}. Genre: ${input.surpriseGenre}. Rating: ${input.rating}/5. Their typical ${input.surpriseGenre} rating: ${input.baselineAvg.toFixed(1)}/5. Voice: warm reveal.`,
  };
}

export function buildTasteEvolutionPrompt(input: {
  q1Vibe: string;
  q4Vibe: string;
}): PromptOutput {
  return {
    system: `You write the line describing how the user's gaming taste shifted from Q1 to Q4. ${SHARED_CONSTRAINTS}`,
    user: `Q1 dominant vibe: ${input.q1Vibe}. Q4 dominant vibe: ${input.q4Vibe}. Reflective tone.`,
  };
}

export function buildClosingPrompt(input: {
  topGame: string;
  topGenre: string;
  surpriseGame: string | null;
  year: number;
  mode: "yearly" | "monthly";
}): PromptOutput {
  return {
    system: `You write the closing share line for the user's recap pageant. ${SHARED_CONSTRAINTS}`,
    user: `Window: ${input.mode === "yearly" ? input.year : `${input.mode} recap`}. Top game: ${input.topGame}. Top genre: ${input.topGenre}. Surprise: ${input.surpriseGame ?? "none"}. Designed to be shared on social.`,
  };
}
