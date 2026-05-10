import { notFound } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getProfileByUsername } from "@/lib/profile/server-actions";
import { LibraryGrid } from "@/components/library/library-grid";
import { ShelfFrame } from "@/components/pixel/shelf-frame";
import { StatsStrip } from "@/components/dashboard/stats-strip";
import { Mascot } from "@/components/mascot/mascot";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { LibraryItem } from "@/lib/logs/server-actions";
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
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isOwn = user?.id === profile.userId;

  // Load library — own profile sees everything, public sees only non-private logs
  const rows = await db
    .select({
      logId: schema.logs.id,
      status: schema.logs.status,
      rating: schema.logs.rating,
      startedAt: schema.logs.startedAt,
      finishedAt: schema.logs.finishedAt,
      hoursPlayed: schema.logs.hoursPlayed,
      platformPlayedOn: schema.logs.platformPlayedOn,
      isReplay: schema.logs.isReplay,
      notes: schema.logs.notes,
      isPrivate: schema.logs.isPrivate,
      createdAt: schema.logs.createdAt,
      updatedAt: schema.logs.updatedAt,
      game_id: schema.games.id,
      game_slug: schema.games.slug,
      game_title: schema.games.title,
      game_coverUrl: schema.games.coverUrl,
      game_released: schema.games.released,
      game_genres: schema.games.genres,
      game_platforms: schema.games.platforms,
    })
    .from(schema.logs)
    .innerJoin(schema.games, eq(schema.logs.gameId, schema.games.id))
    .where(eq(schema.logs.userId, profile.userId))
    .orderBy(desc(schema.logs.updatedAt));

  const items: LibraryItem[] = rows
    .filter((r) => isOwn || !r.isPrivate)
    .map((r) => ({
      logId: r.logId, status: r.status as LogStatus,
      rating: r.rating ? Number(r.rating) : null,
      startedAt: r.startedAt, finishedAt: r.finishedAt,
      hoursPlayed: r.hoursPlayed ? Number(r.hoursPlayed) : null,
      platformPlayedOn: r.platformPlayedOn,
      isReplay: r.isReplay,
      isPrivate: r.isPrivate,
      notes: r.notes, createdAt: r.createdAt, updatedAt: r.updatedAt,
      game: {
        id: r.game_id, slug: r.game_slug, title: r.game_title,
        coverUrl: r.game_coverUrl, released: r.game_released,
        genres: r.game_genres ?? [], platforms: r.game_platforms ?? [],
      },
    }));

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
        <LibraryGrid items={items} filter="all" />
      </ShelfFrame>
    </div>
  );
}
