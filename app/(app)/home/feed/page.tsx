import { redirect } from "next/navigation";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import { getFeed } from "@/lib/social/feed/server-actions";
import { FeedList } from "@/components/feed/feed-list";
import { FeedEmptyState } from "@/components/feed/feed-empty-state";
import { db, schema } from "@/lib/db";
import { inArray } from "drizzle-orm";

export const metadata = { title: "Feed — Letterboxd for Games" };

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const user = await getCachedUser();
  if (!user) redirect("/login?next=/home/feed");
  const { cursor } = await searchParams;

  // viewerId is derived from session inside getFeed (it's a "use server"
  // RPC; accepting a caller-supplied id let attackers probe block state).
  const { items, nextCursor, hasFollowees } = await getFeed({
    cursor: cursor ?? null,
    limit: 50,
  });

  if (items.length === 0) {
    let mode: "no-followees" | "no-events" | "no-more";
    if (cursor) {
      mode = "no-more";
    } else if (!hasFollowees) {
      mode = "no-followees";
    } else {
      mode = "no-events";
    }
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <FeedEmptyState mode={mode} />
      </div>
    );
  }

  // Hydrate references in parallel:
  //  - gameIds from log + review payloads → game.coverUrl + title + slug
  //  - actorIds → profile.username + profilePictureUrl
  const gameIds = Array.from(
    new Set(
      items
        .map((i) => (i.payload as { gameId?: number }).gameId)
        .filter((g): g is number => typeof g === "number"),
    ),
  );
  const actorIds = Array.from(new Set(items.map((i) => i.actorId)));

  const [games, actors] = await Promise.all([
    gameIds.length > 0
      ? db
          .select({
            id: schema.games.id,
            slug: schema.games.slug,
            title: schema.games.title,
            coverUrl: schema.games.coverUrl,
          })
          .from(schema.games)
          .where(inArray(schema.games.id, gameIds))
      : Promise.resolve([]),
    db
      .select({
        userId: schema.profiles.userId,
        username: schema.profiles.username,
        displayName: schema.profiles.displayName,
        profilePictureUrl: schema.profiles.profilePictureUrl,
      })
      .from(schema.profiles)
      .where(inArray(schema.profiles.userId, actorIds)),
  ]);

  const gameMap = new Map(games.map((g) => [g.id, g]));
  const actorMap = new Map(actors.map((a) => [a.userId, a]));

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <FeedList
        items={items}
        gameMap={gameMap}
        actorMap={actorMap}
        nextCursor={nextCursor}
      />
    </div>
  );
}
