import { notFound } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { ListDetail } from "@/components/lists/list-detail";
import { ReportModal } from "@/components/moderation/report-modal";
import { redactPrivateProfile } from "@/lib/profile/redact";

interface Props {
  params: Promise<{ username: string; listSlug: string }>;
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

  const profileRow = await db.query.profiles.findFirst({
    where: and(eq(schema.profiles.username, username), isNull(schema.profiles.deletedAt)),
    columns: { userId: true, username: true, displayName: true, isPublic: true },
  });
  if (!profileRow) notFound();

  const viewer = await getCachedUser();
  const isOwner = viewer?.id === profileRow.userId;

  // Defense-in-depth: if the profile is private but the list itself is
  // public+published (a deliberate configuration), a non-owner viewer can
  // still hit this page — we must blank the displayName so it doesn't leak.
  // Mirrors the redaction inside getProfileByUsername (T01 / commit d2dd478).
  const profile = redactPrivateProfile(profileRow, viewer?.id ?? null);

  // Load list by (userId, slug).
  const list = await db.query.lists.findFirst({
    where: and(
      eq(schema.lists.userId, profile.userId),
      eq(schema.lists.slug, listSlug),
    ),
  });
  if (!list) notFound();

  // Privacy gate: must be (isPublic AND publishedAt IS NOT NULL) OR owner.
  if (!isOwner) {
    if (!list.isPublic || list.publishedAt === null) notFound();
  }

  const itemRows = await db
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
    .orderBy(asc(schema.listItems.position));

  const items = itemRows.map((r) => ({
    gameId: r.gameId,
    position: r.position,
    note: r.note,
    game: { slug: r.slug, title: r.title, coverUrl: r.coverUrl },
  }));

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
