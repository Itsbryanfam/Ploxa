import "server-only";

/**
 * Feed cursor: (eventAt, kind, actorId) triplet base64-encoded.
 *
 * Tiebreak fields prevent missed rows when multiple events share an
 * eventAt timestamp (rare but possible if a user transitions two logs
 * within the same millisecond). The kind+actorId secondary sort makes
 * the order deterministic and the cursor advance correct.
 *
 * Format: base64url(JSON.stringify({ at, k, a }))
 */
export type FeedCursor = {
  eventAt: Date;
  kind: "log" | "review" | "list";
  actorId: string;
};

const KIND_ORDER: Record<FeedCursor["kind"], number> = { log: 0, review: 1, list: 2 };

export function encodeCursor(cursor: FeedCursor): string {
  const payload = JSON.stringify({
    at: cursor.eventAt.toISOString(),
    k: cursor.kind,
    a: cursor.actorId,
  });
  return Buffer.from(payload, "utf8").toString("base64url");
}

export function decodeCursor(s: string | null | undefined): FeedCursor | null {
  if (!s) return null;
  try {
    const raw = Buffer.from(s, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as { at: string; k: FeedCursor["kind"]; a: string };
    if (!parsed.at || !parsed.k || !parsed.a) return null;
    if (!(parsed.k in KIND_ORDER)) return null;
    const eventAt = new Date(parsed.at);
    if (Number.isNaN(eventAt.getTime())) return null;
    return {
      eventAt,
      kind: parsed.k,
      actorId: parsed.a,
    };
  } catch {
    return null;
  }
}

/**
 * Compare two feed rows in the canonical sort order (event_at DESC,
 * kind ASC, actor_id ASC). Returns -1, 0, 1. Used by post-hoc block
 * filtering when we need to re-sort after dropping rows.
 */
export function compareFeedRows(
  a: { eventAt: Date; kind: FeedCursor["kind"]; actorId: string },
  b: { eventAt: Date; kind: FeedCursor["kind"]; actorId: string },
): number {
  const dt = b.eventAt.getTime() - a.eventAt.getTime();
  if (dt !== 0) return dt > 0 ? 1 : -1;
  const dk = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  if (dk !== 0) return dk;
  return a.actorId < b.actorId ? -1 : a.actorId > b.actorId ? 1 : 0;
}
