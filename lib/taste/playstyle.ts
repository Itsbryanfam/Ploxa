/**
 * Map a user's mechanic vector to a single playstyle label for the share card.
 *
 * The highest-scoring mechanic in PLAYSTYLE_MAP wins; ties break by
 * declaration order. Falls back to "Curator" when nothing scores positive
 * (brand-new user, or none of their top mechanics map to a labeled style).
 */
const PLAYSTYLE_MAP: Array<[string, string]> = [
  ["Turn-based", "Tactician"],
  ["Real-Time Strategy", "Commander"],
  ["Permadeath", "Survivor"],
  ["Roguelike", "Survivor"],
  ["Puzzle", "Solver"],
  ["Stealth", "Operative"],
  ["Open World", "Wanderer"],
  ["Crafting", "Builder"],
  ["Co-op", "Companion"],
  ["Competitive", "Contender"],
  ["Souls-like", "Pilgrim"],
  ["Visual Novel", "Reader"],
  ["Sandbox", "Sandboxer"],
  ["Simulation", "Caretaker"],
];

export function playstyleFromMechanics(mechanics: Record<string, number>): string {
  let best: string | null = null;
  let bestScore = 0;
  for (const [mechanic, label] of PLAYSTYLE_MAP) {
    const score = mechanics[mechanic] ?? 0;
    if (score > bestScore) {
      best = label;
      bestScore = score;
    }
  }
  return best ?? "Curator";
}
