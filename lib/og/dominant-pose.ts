import type { MascotMood } from "@/components/mascot/states";
import type { SparseVector, VectorBundle } from "@/lib/taste/vectors";

/**
 * Mascot poses used by the taste-fingerprint share card.
 *
 * These are share-card-specific names (distinct from MascotMood). Phase 7
 * will commission proper art for the 5 cluster-themed poses
 * (tactician/lantern/cozy/ready/wary); until then mascotMoodForPose()
 * remaps each pose to an existing MascotMood PNG so the card renders.
 */
export type MascotPose =
  | "narrating"
  | "tactician"
  | "lantern"
  | "cozy"
  | "ready"
  | "wary"
  | "celebrating";

const POSE_KEYWORDS: Array<{ pose: MascotPose; tokens: string[] }> = [
  {
    pose: "tactician",
    tokens: ["Strategy", "Turn-based Strategy", "Tactics", "Tactical RPG", "Real-Time Strategy"],
  },
  {
    pose: "lantern",
    tokens: ["Narrative", "Story-driven", "Adventure", "RPG", "Visual Novel"],
  },
  {
    pose: "cozy",
    tokens: ["Casual", "Cozy", "Life Sim", "Simulation", "Puzzle"],
  },
  {
    pose: "ready",
    tokens: ["Action", "Shooter", "FPS", "Platformer", "Hack and Slash"],
  },
  {
    pose: "wary",
    tokens: ["Horror", "Survival", "Survival Horror", "Roguelike", "Souls-like"],
  },
];

/**
 * Pick the dominant mascot pose from the user's vectors.
 *
 * Looks across all three vectors (genre/theme/mechanic) for any token
 * that matches a pose's keyword list, weighted by the token's score.
 * Highest-scoring pose wins. Ties broken by POSE_KEYWORDS order.
 *
 * Falls back to "narrating" when no keyword matches (e.g. brand-new user
 * with empty vectors). "celebrating" is reserved for future contexts
 * (e.g. year-recap card) and is never produced by this function today.
 */
export function dominantPose(vectors: VectorBundle): MascotPose {
  const scores: Record<MascotPose, number> = {
    narrating: 0,
    tactician: 0,
    lantern: 0,
    cozy: 0,
    ready: 0,
    wary: 0,
    celebrating: 0,
  };

  function scan(vec: SparseVector) {
    for (const [token, value] of Object.entries(vec)) {
      if (value <= 0) continue;
      for (const { pose, tokens } of POSE_KEYWORDS) {
        if (tokens.some((t) => t.toLowerCase() === token.toLowerCase())) {
          scores[pose] += value;
        }
      }
    }
  }
  scan(vectors.genre);
  scan(vectors.theme);
  scan(vectors.mechanic);

  let best: MascotPose = "narrating";
  let bestScore = 0;
  for (const { pose } of POSE_KEYWORDS) {
    if (scores[pose] > bestScore) {
      best = pose;
      bestScore = scores[pose];
    }
  }
  return best;
}

/**
 * Map share-card poses to existing MascotMood PNGs in /public/mascot/.
 * Phase 7 will commission proper art for the share-card-specific poses
 * (tactician/lantern/cozy/ready/wary); until then we fall back to the
 * closest existing mood sprite so the card renders without broken-image
 * holes.
 */
export function mascotMoodForPose(pose: MascotPose): MascotMood {
  switch (pose) {
    case "tactician":
      return "pointing"; // strategic gesture
    case "lantern":
      return "thinking"; // narrative voice
    case "cozy":
      return "idle"; // resting
    case "ready":
      return "waving"; // greeting / action
    case "wary":
      return "confused"; // uncertain
    case "celebrating":
      return "celebrating"; // exact match
    case "narrating":
      return "thinking"; // matches T6's narrative mascot
  }
}
