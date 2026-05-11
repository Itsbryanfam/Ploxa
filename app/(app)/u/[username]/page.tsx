import { notFound } from "next/navigation";
import { and, eq, desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getProfileByUsername } from "@/lib/profile/server-actions";
import { LibraryShelf } from "@/components/library/library-shelf";
import { ShelfFrame } from "@/components/pixel/shelf-frame";
import { StatsStrip } from "@/components/dashboard/stats-strip";
import { Mascot } from "@/components/mascot/mascot";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { mapRowToLibraryItem, type LibraryItem } from "@/lib/logs/library-item";
import type { LogStatus } from "@/lib/db/schema-types";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const profile = await getProfileByUsername(username);
  if (!profile) notFound();

  // Determine if viewing own profile
  const user = await getCachedUser();
  const isOwn = user?.id === profile.userId;

  // Load library — own profile sees everything, public sees only non-private logs
  const rows = await db
    .select({
      log: {
        id: schema.logs.id,
        status: schema.logs.status,
        rating: schema.logs.rating,
        startedAt: schema.logs.startedAt,
        finishedAt: schema.logs.finishedAt,
        hoursPlayed: schema.logs.hoursPlayed,
        platformPlayedOn: schema.logs.platformPlayedOn,
        isReplay: schema.logs.isReplay,
        isPrivate: schema.logs.isPrivate,
        notes: schema.logs.notes,
        createdAt: schema.logs.createdAt,
        updatedAt: schema.logs.updatedAt,
      },
      game: {
        id: schema.games.id,
        slug: schema.games.slug,
        title: schema.games.title,
        coverUrl: schema.games.coverUrl,
        released: schema.games.released,
        genres: schema.games.genres,
        platforms: schema.games.platforms,
      },
    })
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

  // Stats from visible items
  const byStatus: Record<LogStatus, number> = {
    backlog: 0, playing: 0, completed: 0, dropped: 0, on_hold: 0, wishlist: 0,
  };
  let ratingSum = 0;
  let ratingCount = 0;
  for (const i of items) {
    byStatus[i.status]++;
    if (i.rating != null) {
      ratingSum += i.rating;
      ratingCount++;
    }
  }
  const stats = {
    total: items.length,
    byStatus,
    averageRating:
      ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : null,
  };

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
