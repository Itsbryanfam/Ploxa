// supabase/functions/_shared/taste-engine.ts
// Mirror of lib/taste/aggregate.ts for the Deno Edge runtime.
// Keep these implementations identical — same weight × sign math.

export type LogStatus =
  | "backlog"
  | "wishlist"
  | "playing"
  | "completed"
  | "on_hold"
  | "dropped";

export type AggregateRow = {
  status: LogStatus;
  rating: number | null;
  has_published_review: boolean;
  genres: string[] | null;
  themes: string[] | null;
  mechanics: string[] | null;
  playtime_avg_hours: number | null;
};

export type SparseVector = Record<string, number>;

export type AggregateResult = {
  genre: SparseVector;
  theme: SparseVector;
  mechanic: SparseVector;
  length_preference: Record<string, number>;
  total_logs_at_generation: number;
};

export function weight(row: AggregateRow): number {
  let w: number;
  if (row.rating != null) {
    const intensity = Math.abs(row.rating - 5.0) / 5.0;
    w = 1.0 * (1 + 0.3 * intensity);
  } else if (
    row.status === "playing" ||
    row.status === "completed" ||
    row.status === "on_hold" ||
    row.status === "dropped"
  ) {
    w = 0.6;
  } else if (row.status === "backlog" || row.status === "wishlist") {
    w = 0.2;
  } else {
    // Exhaustiveness check — every LogStatus must be handled above.
    assertNever(row.status);
  }
  if (row.has_published_review) w *= 1.15;
  return w;
}

function assertNever(x: never): never {
  throw new Error(`Unexpected status: ${String(x)}`);
}

export function sign(row: AggregateRow): -1 | 0 | 1 {
  if (row.rating != null) {
    if (row.rating < 4) return -1;
    if (row.rating > 6) return 1;
    return 0;
  }
  if (row.status === "dropped") return -1;
  return 1;
}

function bucket(hours: number): "<5h" | "5-10h" | "10-30h" | "30-60h" | "60h+" {
  if (hours < 5) return "<5h";
  if (hours < 10) return "5-10h";
  if (hours < 30) return "10-30h";
  if (hours < 60) return "30-60h";
  return "60h+";
}

export function aggregate(rows: AggregateRow[]): AggregateResult {
  const genreRaw: SparseVector = {};
  const themeRaw: SparseVector = {};
  const mechanicRaw: SparseVector = {};
  const lengthRaw: Record<string, number> = {
    "<5h": 0,
    "5-10h": 0,
    "10-30h": 0,
    "30-60h": 0,
    "60h+": 0,
  };

  let totalW = 0;
  let totalLengthW = 0;

  for (const row of rows) {
    const w = weight(row);
    if (w === 0) continue;
    const s = sign(row);
    totalW += w;
    const signed = s * w;
    for (const g of row.genres ?? []) genreRaw[g] = (genreRaw[g] ?? 0) + signed;
    for (const t of row.themes ?? []) themeRaw[t] = (themeRaw[t] ?? 0) + signed;
    for (const m of row.mechanics ?? []) mechanicRaw[m] = (mechanicRaw[m] ?? 0) + signed;

    if (row.playtime_avg_hours != null && row.playtime_avg_hours > 0) {
      lengthRaw[bucket(row.playtime_avg_hours)] += w;
      totalLengthW += w;
    }
  }

  const norm = Math.max(1, totalW);
  const normalize = (v: SparseVector): SparseVector => {
    const out: SparseVector = {};
    for (const [k, val] of Object.entries(v)) out[k] = val / norm;
    return out;
  };
  const length_preference: Record<string, number> = {
    "<5h": 0,
    "5-10h": 0,
    "10-30h": 0,
    "30-60h": 0,
    "60h+": 0,
  };
  if (totalLengthW > 0) {
    for (const k of Object.keys(lengthRaw)) {
      length_preference[k] = lengthRaw[k] / totalLengthW;
    }
  }
  return {
    genre: normalize(genreRaw),
    theme: normalize(themeRaw),
    mechanic: normalize(mechanicRaw),
    length_preference,
    total_logs_at_generation: rows.length,
  };
}
