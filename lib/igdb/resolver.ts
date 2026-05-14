import "server-only";
import { igdbQuery } from "./client";

export type GameToResolve = {
  id: number;
  title: string;
  releaseYear: number | null;
  steamAppid: number | null;
};

export type ResolvedRow = {
  igdbId: number | null;
  steamAppid: number | null; // unchanged from input, OR newly discovered via external_games
};

const NAME_FALLBACK_CONCURRENCY = 2;
const WAVE_INTERVAL_MS = 1000;

/**
 * Resolve a batch of RAWG-ids to IGDB-ids.
 *
 * Bucket A: games with steamAppid known → one POST to /external_games.
 *   Returns up to 500 mappings in one round-trip; we look up by the
 *   matching `uid` (Steam appid).
 *
 * Bucket B: games with no steamAppid → per-game POST to /games with a
 *   name + first_release_date window match. Throttled to
 *   NAME_FALLBACK_CONCURRENCY in-flight per wave + WAVE_INTERVAL_MS
 *   delay between waves. With concurrency=2 + 1s wave gap, the effective
 *   rate is ~2 RPS which sits well under IGDB's 4 RPS sustained cap and
 *   leaves headroom for the surrounding Bucket A + facets calls in the
 *   backfill loop. Earlier values (concurrency=4, no inter-wave delay)
 *   triggered IGDB 429 cascades on the first batch — see
 *   memory/igdb_rate_limit_2026_05_14.md for the postmortem.
 *
 * Returns a Map<rawgId, ResolvedRow>; every input id appears in the map.
 */
export async function resolveIgdbIds(
  games: GameToResolve[],
): Promise<Map<number, ResolvedRow>> {
  const result = new Map<number, ResolvedRow>();
  for (const g of games) {
    result.set(g.id, { igdbId: null, steamAppid: g.steamAppid });
  }

  // Bucket A: Steam-appid resolution.
  const steamGames = games.filter((g) => g.steamAppid != null);
  if (steamGames.length > 0) {
    const appidToRawgId = new Map<number, number>();
    for (const g of steamGames) {
      if (appidToRawgId.has(g.steamAppid!)) {
        console.warn(
          `[igdb-resolver] Duplicate steamAppid ${g.steamAppid} on rawgId ${g.id}; first entry wins (this game will fall to Bucket B name lookup).`,
        );
        continue;
      }
      appidToRawgId.set(g.steamAppid!, g.id);
    }

    const uidList = steamGames.map((g) => `"${g.steamAppid}"`).join(",");
    const rows = await igdbQuery<Array<{ game: number; uid: string }>>(
      "external_games",
      `fields game,uid; where uid = (${uidList}) & category = 1; limit 500;`,
    );
    for (const r of rows) {
      const rawgId = appidToRawgId.get(Number(r.uid));
      if (rawgId == null) continue;
      result.set(rawgId, { igdbId: r.game, steamAppid: Number(r.uid) });
    }
  }

  // Bucket B: name+year fallback for everything still unresolved.
  const fallbackGames = games.filter((g) => result.get(g.id)?.igdbId == null);
  for (let i = 0; i < fallbackGames.length; i += NAME_FALLBACK_CONCURRENCY) {
    const wave = fallbackGames.slice(i, i + NAME_FALLBACK_CONCURRENCY);
    const waveResults = await Promise.all(
      wave.map(async (g) => {
        try {
          const igdbRows = await fallbackByNameYear(g);
          return { id: g.id, igdbId: igdbRows[0]?.id ?? null };
        } catch {
          return { id: g.id, igdbId: null };
        }
      }),
    );
    for (const r of waveResults) {
      // Safe non-null: every input id was pre-seeded in the initialization
      // loop at the top of resolveIgdbIds.
      const existing = result.get(r.id)!;
      result.set(r.id, { igdbId: r.igdbId, steamAppid: existing.steamAppid });
    }
    // Pace waves so the effective Bucket B rate stays under 4 RPS, leaving
    // headroom for the caller's Bucket A + facets calls. Skip the wait on
    // the last wave (no follow-up request from this function).
    if (i + NAME_FALLBACK_CONCURRENCY < fallbackGames.length) {
      await new Promise((resolve) => setTimeout(resolve, WAVE_INTERVAL_MS));
    }
  }

  return result;
}

async function fallbackByNameYear(g: GameToResolve): Promise<Array<{ id: number }>> {
  // Escape double quotes in the title for IGDB's query syntax.
  const safeTitle = g.title.replace(/"/g, '\\"');
  let where = `name = "${safeTitle}"`;
  if (g.releaseYear) {
    // 36-month window centered on releaseYear: a release tagged 2021 in
    // RAWG might appear as 2020 or 2022 in IGDB depending on edition.
    const start = Math.floor(new Date(`${g.releaseYear - 1}-01-01`).getTime() / 1000);
    const end = Math.floor(new Date(`${g.releaseYear + 1}-12-31`).getTime() / 1000);
    where += ` & first_release_date > ${start} & first_release_date < ${end}`;
  }
  return await igdbQuery<Array<{ id: number }>>(
    "games",
    `fields id; where ${where}; limit 1;`,
  );
}
