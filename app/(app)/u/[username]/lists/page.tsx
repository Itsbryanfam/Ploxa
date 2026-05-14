import { notFound } from "next/navigation";
import Link from "next/link";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { ListCard } from "@/components/lists/list-card";

interface Props {
  params: Promise<{ username: string }>;
}

/**
 * /u/[username]/lists — grid of a user's public lists (or all lists for owner).
 *
 * Capped at 50 lists; cursor-based pagination is a future enhancement once
 * power users hit the cap (no one has yet).
 */
export default async function UserListsPage({ params }: Props) {
  const { username } = await params;

  const profile = await db.query.profiles.findFirst({
    where: and(eq(schema.profiles.username, username), isNull(schema.profiles.deletedAt)),
    columns: { userId: true, username: true, displayName: true, isPublic: true },
  });
  if (!profile) notFound();

  const viewer = await getCachedUser();
  const isOwner = viewer?.id === profile.userId;
  if (!profile.isPublic && !isOwner) notFound();

  // Build WHERE clause: public+published OR owner's all lists.
  const whereClause = isOwner
    ? eq(schema.lists.userId, profile.userId)
    : and(
        eq(schema.lists.userId, profile.userId),
        eq(schema.lists.isPublic, true),
        isNotNull(schema.lists.publishedAt),
      );

  const listRows = await db
    .select({
      id: schema.lists.id,
      title: schema.lists.title,
      slug: schema.lists.slug,
      description: schema.lists.description,
      isPublic: schema.lists.isPublic,
      publishedAt: schema.lists.publishedAt,
      updatedAt: schema.lists.updatedAt,
    })
    .from(schema.lists)
    .where(whereClause)
    .orderBy(
      // Published at DESC NULLS LAST, then updatedAt DESC.
      sql`${schema.lists.publishedAt} DESC NULLS LAST`,
      desc(schema.lists.updatedAt),
    )
    .limit(50);

  // Load item counts + first cover URL for each list in one go.
  // Using a separate query per-list is fine at the 50-limit cap; a lateral
  // JOIN would be cleaner but requires raw SQL for Drizzle compatibility.
  const listIds = listRows.map((l) => l.id);

  type CountRow = { listId: string; count: number };
  type CoverRow = { listId: string; coverUrl: string | null };

  let countRows: CountRow[] = [];
  let coverRows: CoverRow[] = [];

  if (listIds.length > 0) {
    const countResult = await db
      .select({
        listId: schema.listItems.listId,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.listItems)
      .where(inArray(schema.listItems.listId, listIds))
      .groupBy(schema.listItems.listId);
    countRows = countResult;

    // First cover per list: item at position=1 joined to games.
    const coverResult = await db
      .select({
        listId: schema.listItems.listId,
        coverUrl: schema.games.coverUrl,
      })
      .from(schema.listItems)
      .innerJoin(schema.games, eq(schema.games.id, schema.listItems.gameId))
      .where(
        and(
          inArray(schema.listItems.listId, listIds),
          eq(schema.listItems.position, 1),
        ),
      );
    coverRows = coverResult;
  }

  const countMap = new Map(countRows.map((r) => [r.listId, r.count]));
  const coverMap = new Map(coverRows.map((r) => [r.listId, r.coverUrl]));

  const listsWithMeta = listRows.map((l) => ({
    ...l,
    itemCount: countMap.get(l.id) ?? 0,
    firstCoverUrl: coverMap.get(l.id) ?? null,
  }));

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          @{profile.username}&apos;s lists
        </h1>
        {isOwner && (
          <Link
            href="/lists/new"
            className="px-3 py-1.5 text-sm rounded-md border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
          >
            + New list
          </Link>
        )}
      </div>

      {listsWithMeta.length === 0 ? (
        <p className="text-sm text-[var(--text-dim)]">
          {isOwner ? "No lists yet. Create your first list above." : "No public lists yet."}
        </p>
      ) : (
        <div className="space-y-3">
          {listsWithMeta.map((list) => (
            <ListCard key={list.id} list={list} username={profile.username} />
          ))}
        </div>
      )}
    </div>
  );
}
