import "server-only";
import { and, eq, gte, inArray, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export type DataExport = {
  profile: unknown;
  logs: unknown[];
  reviews: unknown[];
  lists: unknown[];
  comments_authored: unknown[];
  comments_received: Array<{
    id: string;
    body: string;
    author: { username: string; display_name: string };
  }>;
  notifications: unknown[];
};

const NOTIF_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

export async function exportUserData(userId: string): Promise<DataExport> {
  const profile = await db.query.profiles.findFirst({
    where: eq(schema.profiles.userId, userId),
    // Exclude deletedAt: if a user requests their export mid-grace window,
    // the row's deletedAt is non-null and would reveal their pending-deletion
    // state via the JSON output before any UI has confirmed it back to them.
    columns: { deletedAt: false },
  });
  if (!profile) throw new Error("Profile not found");

  // Parallel-fetch the user's own content.
  const [logs, reviews, lists, commentsAuthoredRaw] = await Promise.all([
    db.query.logs.findMany({ where: eq(schema.logs.userId, userId) }),
    db.query.reviews.findMany({ where: eq(schema.reviews.userId, userId) }),
    db.query.lists.findMany({ where: eq(schema.lists.userId, userId) }),
    db.query.comments.findMany({ where: eq(schema.comments.userId, userId) }),
  ]);

  // Strip `isHidden` from authored comments — leaking moderation state to the
  // user reveals silent auto-flag decisions they were never notified about.
  // The body, id, reviewId, parentId, createdAt, editedAt all stay verbatim.
  const commentsAuthored = (commentsAuthoredRaw as Array<Record<string, unknown>>).map((c) => {
    const { isHidden: _isHidden, ...safe } = c;
    return safe;
  });

  // comments_received: comments left BY OTHERS on this user's reviews.
  // Note: comments are only attached to reviews (no listId column in schema).
  // Two-step: collect the user's review IDs (already loaded above) then SELECT
  // comments where reviewId IN userReviews AND userId != this user.
  const userReviewIds = (reviews as Array<{ id: string }>).map((r) => r.id);

  const commentsReceivedRaw =
    userReviewIds.length > 0
      ? await db
          .select({
            id: schema.comments.id,
            body: schema.comments.body,
            authorUserId: schema.comments.userId,
            authorDisplayName: schema.profiles.displayName,
            authorUsername: schema.profiles.username,
          })
          .from(schema.comments)
          .innerJoin(
            schema.profiles,
            eq(schema.profiles.userId, schema.comments.userId),
          )
          .where(
            and(
              ne(schema.comments.userId, userId),
              inArray(schema.comments.reviewId, userReviewIds),
            ),
          )
      : [];

  // PII redaction: keep only the commenter's PRESENTATIONAL identifiers
  // (username + display_name), which are already public via their profile URL.
  // The internal user_id (UUID) is NEVER included — exposing it would let
  // an export download enumerate valid target UUIDs against authenticated
  // server actions (e.g., getFingerprint / ensureLog). Emails, IPs, and any
  // other commenter metadata also never leave the DB. Display name falls
  // back to username if the commenter never set a display name.
  const commentsReceived: DataExport["comments_received"] = (
    commentsReceivedRaw as Array<{
      id: string;
      body: string;
      authorUserId: string;
      authorDisplayName: string | null;
      authorUsername: string;
    }>
  ).map((c) => ({
    id: c.id,
    body: c.body,
    author: {
      username: c.authorUsername,
      display_name: c.authorDisplayName ?? c.authorUsername,
    },
  }));

  const cutoff = new Date(Date.now() - NOTIF_LOOKBACK_MS);
  const notifications = await db.query.notifications.findMany({
    where: and(
      eq(schema.notifications.userId, userId),
      gte(schema.notifications.createdAt, cutoff),
    ),
  });

  return {
    profile,
    logs,
    reviews,
    lists,
    comments_authored: commentsAuthored,
    comments_received: commentsReceived,
    notifications,
  };
}
