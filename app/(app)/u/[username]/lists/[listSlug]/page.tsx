import { cache } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { ListDetail } from "@/components/lists/list-detail";
import { ReportModal } from "@/components/moderation/report-modal";
import { redactPrivateProfile } from "@/lib/profile/redact";

interface Props {
  params: Promise<{ username: string; listSlug: string }>;
}

/**
 * Shared (profile, viewer, list, items) loader wrapped in React's cache() so
 * generateMetadata and the page body collapse to one set of queries per
 * request instead of two parallel-but-duplicated chains. Same pattern as the
 * canonical review page (lib/social/_shared/profile-summary.ts caller).
 *
 * Returns null for the same conditions the page-body 404s on:
 *   - profile not found (or soft-deleted)
 *   - list not found for (userId, slug)
 *   - list private + non-owner
 *   - list public-but-unpublished + non-owner
 * Both metadata and the page body see null and fall back identically.
 */
const getListPageData = cache(async (username: string, listSlug: string) => {
  const profileRow = await db.query.profiles.findFirst({
    where: and(eq(schema.profiles.username, username), isNull(schema.profiles.deletedAt)),
    columns: { userId: true, username: true, displayName: true, isPublic: true },
  });
  if (!profileRow) return null;

  const viewer = await getCachedUser();
  const isOwner = viewer?.id === profileRow.userId;
  // Same defense-in-depth blanking as the page body: a private profile with a
  // public+published list shouldn't leak displayName via the list detail card.
  const profile = redactPrivateProfile(profileRow, viewer?.id ?? null);

  const list = await db.query.lists.findFirst({
    where: and(eq(schema.lists.userId, profile.userId), eq(schema.lists.slug, listSlug)),
  });
  if (!list) return null;

  // Privacy gate matches the page body: must be (isPublic AND publishedAt IS NOT NULL) OR owner.
  if (!isOwner) {
    if (!list.isPublic || list.publishedAt === null) return null;
  }

  // Items + count run in parallel. Items are needed for the page body; count
  // is needed for both the metadata description AND the page body (we hand
  // it back to ListDetail rather than recounting).
  const [itemRows, [countRow]] = await Promise.all([
    db
      .select({
        gameId: schema.listItems.gameId,
        position: schema.listItems.position,
        note: schema.listItems.note,
        slug: schema.games.slug,
        title: schema.games.title,
        coverUrl: schema.games.coverUrl,
      })
      .from(schema.listItems)
      .innerJoin(schema.games, eq(schema.games.id, schema.listItems.gameId))
      .where(eq(schema.listItems.listId, list.id))
      .orderBy(asc(schema.listItems.position)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.listItems)
      .where(eq(schema.listItems.listId, list.id)),
  ]);

  const items = itemRows.map((r) => ({
    gameId: r.gameId,
    position: r.position,
    note: r.note,
    game: { slug: r.slug, title: r.title, coverUrl: r.coverUrl },
  }));

  return {
    profile,
    viewer,
    isOwner,
    list,
    items,
    itemCount: countRow?.count ?? items.length,
  };
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username, listSlug } = await params;
  const data = await getListPageData(username, listSlug);
  if (!data) return { title: "Letterboxd for Games" };
  const { profile, list, itemCount } = data;
  const subject = profile.displayName ?? profile.username;
  const title = `${list.title} · ${subject}`;
  // Prefer the list's own description if the curator wrote one — that's the
  // intent-laden text. Fall back to "X games by Y" when description is null.
  const description = list.description?.trim().length
    ? list.description.trim().slice(0, 200)
    : `A list of ${itemCount} game${itemCount === 1 ? "" : "s"} by ${subject}`;
  const ogImage = `/og/list/${list.id}`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [ogImage],
      type: "article",
      url: `/u/${profile.username}/lists/${list.slug}`,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

/**
 * /u/[username]/lists/[listSlug] — canonical list detail page.
 *
 * Privacy gate (all branches return 404 to avoid leaking existence):
 *   - profile not found → 404
 *   - list not found for (userId, slug) → 404
 *   - list is private (isPublic=false) AND viewer is not owner → 404
 *   - list is public but not published (publishedAt IS NULL) AND viewer is not owner → 404
 */
export default async function ListDetailPage({ params }: Props) {
  const { username, listSlug } = await params;

  // Shared loader — generateMetadata already ran getListPageData() for this
  // (username, listSlug), so cache() returns the memoized result.
  const data = await getListPageData(username, listSlug);
  if (!data) notFound();
  const { profile, viewer, isOwner, list, items } = data;

  return (
    <>
      <ListDetail
        list={{
          id: list.id,
          title: list.title,
          description: list.description,
          publishedAt: list.publishedAt,
        }}
        items={items}
        author={{
          username: profile.username,
          displayName: profile.displayName ?? null,
        }}
      />
      {viewer && !isOwner && (
        <div className="mx-auto max-w-3xl px-6 pb-8 flex justify-end">
          <ReportModal targetType="list" targetId={list.id} />
        </div>
      )}
    </>
  );
}
