import { desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import { db } from "@/lib/db";
import { imports } from "@/lib/db/schema";
import { listConnections } from "@/lib/imports/server-actions";
import { PlatformCard } from "@/components/imports/platform-card";

export const metadata = { title: "Connections — Settings" };

// ---------------------------------------------------------------------------
// ConnectionsSettingsPage — migrated from _sections/connections-section.tsx
// ---------------------------------------------------------------------------

export default async function ConnectionsSettingsPage() {
  const user = await getCachedUser();
  if (!user) redirect("/login");

  const connections = await listConnections();
  const byPlatform = Object.fromEntries(connections.map((c) => [c.platform, c]));

  // Manual count: logs where platforms is null/empty AND platform_played_on isn't 'steam'/'xbox'
  const manualCountRows = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count FROM logs
    WHERE user_id = ${user.id}
      AND (platforms IS NULL OR cardinality(platforms) = 0)
      AND (platform_played_on IS NULL OR platform_played_on NOT IN ('steam', 'xbox'))
  `);
  const manualCount = Number(
    (manualCountRows as unknown as Array<{ count: number }>)[0]?.count ?? 0,
  );

  // Last 10 imports for the history drawer
  const history = await db
    .select()
    .from(imports)
    .where(eq(imports.userId, user.id))
    .orderBy(desc(imports.createdAt))
    .limit(10);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Connected platforms</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Auto-import your library from where you play.
        </p>
      </div>

      <div className="space-y-2">
        <PlatformCard platform="steam" summary={byPlatform["steam"] ?? null} />
        <PlatformCard platform="xbox" summary={byPlatform["xbox"] ?? null} />
        <PlatformCard
          platform="manual"
          summary={null}
          manualGameCount={manualCount}
        />
      </div>

      {history.length > 0 && (
        <details className="text-xs mt-4">
          <summary className="cursor-pointer text-[var(--text-muted)] hover:text-[var(--text)] text-right">
            Sync history ({history.length}) ▾
          </summary>
          <ul className="mt-2 space-y-1">
            {history.map((row) => (
              <li
                key={row.id}
                className="flex gap-2 items-center py-1 border-b border-[var(--border)]/40"
              >
                <Link
                  href={`/library/import/${row.id}`}
                  className="text-[var(--accent)] hover:underline"
                >
                  {row.platform}
                </Link>
                <span>·</span>
                <span>{row.status}</span>
                <span>·</span>
                <span>
                  {row.importedCount}/{row.totalCount} games
                </span>
                <span className="ml-auto text-[var(--text-muted)]">
                  {new Date(row.createdAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
