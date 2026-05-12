import { eq, and, gte, sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import { db } from "@/lib/db";
import { imports, logs, games } from "@/lib/db/schema";
import { ImportSummary } from "@/components/imports/import-summary";
import { loadGamesForSummary } from "@/lib/imports/summary-data";

interface PageProps {
  params: Promise<{ importId: string }>;
}

/** Shape stored in conflicts_jsonb by the import worker. */
interface ConflictEntry {
  logId: string;
  gameId: number;
  rule: string;
}

export default async function ImportSummaryPage({ params }: PageProps) {
  const user = await getCachedUser();
  if (!user) redirect("/login");
  const { importId } = await params;

  const [row] = await db
    .select()
    .from(imports)
    .where(and(eq(imports.id, importId), eq(imports.userId, user.id)))
    .limit(1);
  if (!row || (row.platform !== "steam" && row.platform !== "xbox")) notFound();

  // Extract gameIds for merged (conflict) games from the JSONB column.
  const conflictEntries = (row.conflictsJsonb as ConflictEntry[] | null) ?? [];
  const mergedGameIds = conflictEntries.map((c) => c.gameId).filter(Boolean);

  // Heuristic: newly imported logs = logs for this user created at or after
  // (import.createdAt - 30s) that include the import platform.
  // We JOIN games to get cover metadata in one query.
  const importCreatedAt = new Date(row.createdAt);
  const windowStart = new Date(importCreatedAt.getTime() - 30_000);
  const platform = row.platform;

  const newLogRows = await db
    .select({
      id: games.id,
      slug: games.slug,
      title: games.title,
      coverUrl: games.coverUrl,
      posterUrl: games.posterUrl,
    })
    .from(logs)
    .innerJoin(games, eq(logs.gameId, games.id))
    .where(
      and(
        eq(logs.userId, user.id),
        gte(logs.createdAt, windowStart),
        // platform = ANY(logs.platforms) OR logs.platformPlayedOn = platform
        sql`(${logs.platforms} @> ARRAY[${platform}]::text[] OR ${logs.platformPlayedOn} = ${platform})`,
      ),
    )
    .limit(100);

  // Don't include merged games in the new-covers grid (they were updates, not inserts).
  const mergedSet = new Set(mergedGameIds);
  const filteredNewRows = newLogRows.filter((r) => !mergedSet.has(r.id));

  const [mergedCovers, newCovers] = await Promise.all([
    loadGamesForSummary(mergedGameIds),
    Promise.resolve(filteredNewRows),
  ]);

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <ImportSummary
        importId={importId}
        platform={platform}
        mergedCovers={mergedCovers}
        newCovers={newCovers}
      />
    </div>
  );
}
