import type { SparseVector, VectorBundle } from "@/lib/taste/vectors";

/** Status enum mirroring lib/db/schema.ts:logStatusEnum. */
type LogStatus = "backlog" | "wishlist" | "playing" | "completed" | "played" | "dropped";

export type AggregateInputRow = {
  /** Required */
  status: LogStatus;
  /** Numeric in [0, 10] or null. Maps to numeric(3,1) on disk. */
  rating: number | null;
  /** Whether a published review exists for this log. */
  hasPublishedReview: boolean;
  /** Game metadata (joined from games table). */
  genres: string[];
  themes: string[];
  mechanics: string[];
  /** numeric(5,1) on disk → number | null in TS. */
  playtimeAvgHours: number | null;
};

export type AggregateInput = {
  rows: AggregateInputRow[];
};

export type LengthBucket = "<5h" | "5-10h" | "10-30h" | "30-60h" | "60h+";
export type LengthPreference = Record<LengthBucket, number>;

export type AggregateResult = VectorBundle & {
  lengthPreference: LengthPreference;
  totalLogsAtGeneration: number;
};

/**
 * Q1 — per-log weight.
 *
 * - Rating dominates: 1.0 baseline + intensity bonus (up to ×1.3 when |r-5|/5 = 1).
 * - Engaged (status ∈ {playing, completed, played, dropped}) without rating: 0.6.
 * - Backlog / wishlist: 0.2 (implicit interest, e.g. bought in a bundle).
 * - Review-bearing logs get an extra ×1.15 because the user spent the most
 *   effort on them.
 */
export function weight(row: AggregateInputRow): number {
  let w: number;
  if (row.rating != null) {
    const intensity = Math.abs(row.rating - 5.0) / 5.0; // 0..1
    w = 1.0 * (1 + 0.3 * intensity); // 1.0 .. 1.3
  } else if (
    row.status === "playing" ||
    row.status === "completed" ||
    row.status === "played" ||
    row.status === "dropped"
  ) {
    w = 0.6;
  } else if (row.status === "backlog" || row.status === "wishlist") {
    w = 0.2;
  } else {
    w = 0;
  }
  if (row.hasPublishedReview) w *= 1.15;
  return w;
}

/**
 * Q1 — per-log sign.
 *
 * Rating 4-6 returns 0 (neutral — no directional signal). Below 4 = active
 * dislike, above 6 = active like. Without rating, "dropped" is implicit
 * dislike; everything else is weak positive interest.
 *
 * A 0 sign means the log's weight goes into totalW (the denominator) but
 * contributes 0 to raw[G] — so it doesn't push the vector either way.
 */
export function sign(row: AggregateInputRow): -1 | 0 | 1 {
  if (row.rating != null) {
    if (row.rating < 4) return -1;
    if (row.rating > 6) return 1;
    return 0;
  }
  if (row.status === "dropped") return -1;
  return 1;
}

function lengthBucket(hours: number): LengthBucket {
  if (hours < 5) return "<5h";
  if (hours < 10) return "5-10h";
  if (hours < 30) return "10-30h";
  if (hours < 60) return "30-60h";
  return "60h+";
}

function emptyLengthPreference(): LengthPreference {
  return { "<5h": 0, "5-10h": 0, "10-30h": 0, "30-60h": 0, "60h+": 0 };
}

/**
 * Aggregate per-log signal into the three sparse vectors + length distribution.
 *
 * For each metadata field G:
 *   raw[G]   = Σ ( sign × weight × indicator(log has G) )
 *   totalW   = Σ weight
 *   score[G] = raw[G] / max(1, totalW)   // → [-1, +1]
 *
 * Length preference is a frequency distribution (no sign — length is
 * descriptive, not preferential) normalized to sum to 1.0.
 */
export function aggregateFingerprint(input: AggregateInput): AggregateResult {
  const genreRaw: SparseVector = {};
  const themeRaw: SparseVector = {};
  const mechanicRaw: SparseVector = {};
  const lengthRaw: LengthPreference = emptyLengthPreference();

  let totalW = 0;
  let totalLengthW = 0;

  for (const row of input.rows) {
    const w = weight(row);
    if (w === 0) continue;
    const s = sign(row);
    totalW += w;

    const signedWeight = s * w;
    for (const g of row.genres) genreRaw[g] = (genreRaw[g] ?? 0) + signedWeight;
    for (const t of row.themes) themeRaw[t] = (themeRaw[t] ?? 0) + signedWeight;
    for (const m of row.mechanics) mechanicRaw[m] = (mechanicRaw[m] ?? 0) + signedWeight;

    if (row.playtimeAvgHours != null && row.playtimeAvgHours > 0) {
      const bucket = lengthBucket(row.playtimeAvgHours);
      lengthRaw[bucket] += w; // unsigned for length distribution
      totalLengthW += w;
    }
  }

  const norm = Math.max(1, totalW);
  const normalize = (vec: SparseVector): SparseVector => {
    const out: SparseVector = {};
    for (const [k, v] of Object.entries(vec)) out[k] = v / norm;
    return out;
  };
  const lengthPreference: LengthPreference = emptyLengthPreference();
  if (totalLengthW > 0) {
    for (const k of Object.keys(lengthRaw) as LengthBucket[]) {
      lengthPreference[k] = lengthRaw[k] / totalLengthW;
    }
  }

  return {
    genre: normalize(genreRaw),
    theme: normalize(themeRaw),
    mechanic: normalize(mechanicRaw),
    lengthPreference,
    totalLogsAtGeneration: input.rows.length,
  };
}
