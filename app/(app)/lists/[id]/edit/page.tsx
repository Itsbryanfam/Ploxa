import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { ListEditor } from "@/components/lists/list-editor";

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * /lists/[id]/edit — list editor. Owner-only; 404 for all other viewers
 * (including authenticated non-owners) to avoid leaking draft existence.
 */
export default async function EditListPage({ params }: Props) {
  const { id } = await params;

  const user = await getCachedUser();
  if (!user) {
    notFound();
  }

  const list = await db.query.lists.findFirst({
    where: and(eq(schema.lists.id, id), eq(schema.lists.userId, user.id)),
  });
  if (!list) notFound();

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
    .where(eq(schema.listItems.listId, id))
    .orderBy(asc(schema.listItems.position));

  const items = itemRows.map((r) => ({
    gameId: r.gameId,
    position: r.position,
    note: r.note,
    game: { slug: r.slug, title: r.title, coverUrl: r.coverUrl },
  }));

  return (
    <ListEditor
      list={{
        id: list.id,
        title: list.title,
        description: list.description,
        isPublic: list.isPublic,
        publishedAt: list.publishedAt,
      }}
      initialItems={items}
    />
  );
}
