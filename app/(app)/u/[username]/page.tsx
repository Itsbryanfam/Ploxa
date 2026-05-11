import { notFound } from "next/navigation";
import { and, eq, desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getProfileByUsername } from "@/lib/profile/server-actions";
import { LibraryShelf } from "@/components/library/library-shelf";
import { ShelfFrame } from "@/components/pixel/shelf-frame";
import { StatsStrip } from "@/components/dashboard/stats-strip";
import { Mascot } from "@/components/mascot/mascot";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import {
  mapRowToLibraryItem,
  computeUserStatsFromLibrary,
  type LibraryItem,
} from "@/lib/logs/library-item";
import { LOG_GAME_SELECT } from "@/lib/logs/select";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;

  // Profile lookup and current-user check are independent — fire in parallel.
  const [profile, user] = await Promise.all([
    getProfileByUsername(username),
    getCachedUser(),
  ]);
  if (!profile) notFound();
  const isOwn = user?.id === profile.userId;

  // Load library — own profile sees everything, public sees only non-private logs
  const rows = await db
    .select(LOG_GAME_SELECT)
    .from(schema.logs)
    .innerJoin(schema.games, eq(schema.logs.gameId, schema.games.id))
    .where(
      and(
        eq(schema.logs.userId, profile.userId),
        isOwn ? undefined : eq(schema.logs.isPrivate, false),
      ),
    )
    .orderBy(desc(schema.logs.updatedAt));

  const items: LibraryItem[] = rows.map((r) =>
    mapRowToLibraryItem(r.log, r.game),
  );
  const stats = computeUserStatsFromLibrary(items);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-8">
      <header className="flex items-center gap-6">
        <Mascot size="xl" mood="idle" silent />
        <div>
          <h1 className="text-3xl font-bold">{profile.displayName ?? profile.username}</h1>
          <p className="text-sm text-[var(--text-dim)]">@{profile.username}</p>
          {profile.bio && <p className="mt-2 text-sm text-[var(--text)] max-w-md">{profile.bio}</p>}
        </div>
      </header>

      <StatsStrip stats={stats} />

      <ShelfFrame>
        <LibraryShelf items={items} filter="all" />
      </ShelfFrame>
    </div>
  );
}
