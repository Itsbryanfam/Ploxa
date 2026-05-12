import "server-only";
import { ilike, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { gameAliases, games } from "@/lib/db/schema";

import type { ImportedGame } from "./adapters/types";

const EDITION_PATTERNS = [
  /\s*[-–:]\s*(definitive|complete|deluxe|game of the year|goty|gold|remastered|enhanced|director'?s cut|special|premium|legendary|ultimate)\s+edition$/i,
  /\s+(definitive|complete|deluxe|game of the year|goty|gold|remastered|enhanced|director'?s cut|special|premium|legendary|ultimate)\s+edition$/i,
  /\s*\(remastered\)$/i,
  /\s*\(goty\)$/i,
];

export function normalizeTitle(raw: string): string {
  let t = raw.toLowerCase().trim();
  for (const pattern of EDITION_PATTERNS) t = t.replace(pattern, "");
  t = t.replace(/[\p{P}\p{S}]/gu, " ").replace(/\s+/g, " ").trim();
  return t;
}

export async function matchToRawg(imported: ImportedGame): Promise<number | null> {
  const normalized = normalizeTitle(imported.title);
  if (!normalized) return null;

  // 1. Exact match on normalized title
  const exact = await db.select({ id: games.id }).from(games)
    .where(sql`lower(${games.title}) = ${normalized}`).limit(1);
  if (exact.length > 0) return exact[0].id;

  // 2. Alias match
  const alias = await db.select({ id: gameAliases.gameId }).from(gameAliases)
    .where(sql`lower(${gameAliases.alias}) = ${normalized}`).limit(1);
  if (alias.length > 0) return alias[0].id;

  // 3. ILIKE prefix
  const prefix = await db.select({ id: games.id, title: games.title, released: games.released })
    .from(games).where(ilike(games.title, `${normalized}%`)).limit(5);
  if (prefix.length === 1) return prefix[0].id;

  // 4. Disambiguate by releaseYear
  if (imported.releaseYear && prefix.length > 1) {
    const byYear = prefix.find((row) => row.released?.getFullYear() === imported.releaseYear);
    if (byYear) return byYear.id;
  }

  return null;
}

export const __testing__ = { normalizeTitle };
