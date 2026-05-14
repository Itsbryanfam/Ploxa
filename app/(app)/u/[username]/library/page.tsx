import { cache } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, desc, eq, isNull } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { LibraryShelf } from "@/components/library/library-shelf";
import { ShelfFrame } from "@/components/pixel/shelf-frame";
import { LOG_GAME_SELECT } from "@/lib/logs/select";
import { mapRowToLibraryItem, type LibraryItem } from "@/lib/logs/library-item";
import { isBlockedBetween } from "@/lib/social/_shared/visibility";

/**
 * Per-user public library page. Linked from the profile overview's
 * "Library — See all →" affordance. Mirrors the profile page's
 * privacy invariants: indistinguishable 404 for not-found / private +
 * non-owner / blocked-pair.
 *
 * Non-owners only see logs where is_private=false; the owner sees
 * everything. No filter/sort UI yet — that can be a follow-up (the
 * owner's own /library page already has filter/sort URL params).
 */
const getUserLibraryPageData = cache(async (username: string) => {
  const viewer = await getCachedUser();
  const profile = await db.query.profiles.findFirst({
    where: and(eq(schema.profiles.username, username), isNull(schema.profiles.deletedAt)),
    columns: { userId: true, username: true, displayName: true, isPublic: true },
  });
  if (!profile) return null;

  const isOwner = viewer?.id === profile.userId;
  if (!profile.isPublic && !isOwner) return null;

  if (viewer && !isOwner) {
    if (await isBlockedBetween(viewer.id, profile.userId)) return null;
  }

  const visibilityWhere = and(
    eq(schema.logs.userId, profile.userId),
    isOwner ? undefined : eq(schema.logs.isPrivate, false),
  );

  const rows = await db
    .select(LOG_GAME_SELECT)
    .from(schema.logs)
    .innerJoin(schema.games, eq(schema.logs.gameId, schema.games.id))
    .where(visibilityWhere)
    .orderBy(desc(schema.logs.updatedAt));

  const items: LibraryItem[] = rows.map((r) => mapRowToLibraryItem(r.log, r.game));
  return { profile, items };
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const data = await getUserLibraryPageData(username);
  if (!data) return { title: "Ploxa" };
  const subject = data.profile.displayName ?? data.profile.username;
  return {
    title: `${subject}'s library`,
    description: `${subject} has logged ${data.items.length} game${data.items.length === 1 ? "" : "s"}.`,
  };
}

export default async function UserLibraryPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const data = await getUserLibraryPageData(username);
  if (!data) notFound();
  const { profile, items } = data;
  const subject = profile.displayName ?? profile.username;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <header>
        <p className="text-sm text-[var(--text-dim)]">
          @{profile.username}
        </p>
        <h1 className="text-3xl font-bold mt-1">{subject}'s library</h1>
        <p className="text-sm text-[var(--text-dim)] mt-2">
          {items.length} game{items.length === 1 ? "" : "s"} logged.
        </p>
      </header>
      {items.length > 0 ? (
        <ShelfFrame>
          <LibraryShelf items={items} filter="all" />
        </ShelfFrame>
      ) : (
        <p className="text-sm text-[var(--text-dim)]">No games logged yet.</p>
      )}
    </div>
  );
}
