import "server-only";

/**
 * List publish trigger. Phase 5 ships this as an intentional no-op — list
 * publishes are surfaced via the feed query in lib/social/feed/queries.ts
 * which already SELECTs from lists WHERE published_at IS NOT NULL.
 *
 * Kept as a separate file because Phase 6+ may add side effects (e.g.
 * notify followers who have wishlisted any game on the list).
 */
export async function onListPublish(_args: {
  listId: string;
  authorId: string;
}): Promise<void> {
  // Intentional no-op for Phase 5.
}
