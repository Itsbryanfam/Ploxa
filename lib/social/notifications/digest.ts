import "server-only";
import { and, desc, eq, gt, inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db";

const { notifications, profiles, reviews, lists, comments, games, logs } = schema;

/**
 * Pure payload builder for the email digest (T20 → T21 → T22 cron).
 *
 * Loads the recipient's notifications + own log activity in the cadence window,
 * groups by notification type into the 5 digest sections, and hydrates target
 * titles via batched IN-array lookups.
 *
 * Null contract: returns null when
 *  - profile not found
 *  - cadence === 'off' (user opted out)
 *  - all 5 sections are empty after grouping (no social signals AND no own activity)
 *
 * Section cap: each section is sliced to SECTION_CAP (10) items. The digest
 * template is responsible for rendering "and N more" if it cares about
 * overflow counts; this builder doesn't surface the pre-slice length.
 *
 * Forward-looking note (wishlistTriggers): no emit path currently produces
 * `wishlist_logged_by_friend` notifications — the type exists in the enum and
 * in inbox copy, but lib/ doesn't fire it anywhere yet. This builder
 * defensively groups by it (in case the emit path lands without updating
 * here) but skips title hydration since the targetId convention isn't
 * locked. When the emit path ships, hydration should be added here in
 * lock-step.
 */

const SECTION_CAP = 10;

export type DigestPayload = {
  since: Date;
  recipient: { username: string; displayName: string | null };
  newFollowers: Array<{ username: string; displayName: string | null }>;
  reactions: Array<{
    actor: string;
    kind: "review_liked" | "list_liked";
    targetTitle: string;
  }>;
  comments: Array<{
    actor: string;
    kind: "review_commented" | "comment_replied";
    targetTitle: string;
    excerpt: string;
  }>;
  wishlistTriggers: Array<{ actor: string; gameTitle: string }>;
  yourWeek: Array<{ kind: "log_completed" | "log_started"; gameTitle: string }>;
};

// Internal carrier shapes used during grouping. We attach the source
// targetId (and parentCommentId for comment_replied) so the hydration
// walk can fill titles without re-walking the raw notifications list.
type ReactionItem = DigestPayload["reactions"][number] & { targetId: string };
type CommentItem = DigestPayload["comments"][number] & { targetId: string };

export async function buildDigest(userId: string): Promise<DigestPayload | null> {
  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.userId, userId),
    columns: {
      userId: true,
      username: true,
      displayName: true,
      lastDigestSentAt: true,
      emailDigestCadence: true,
    },
  });
  if (!profile) return null;
  if (profile.emailDigestCadence === "off") return null;

  // Cadence window: daily=24h, weekly=7d. If lastDigestSentAt is more recent
  // than the cadence window's start, prefer that (don't double-send items
  // that landed in a prior digest).
  const cadenceHours = profile.emailDigestCadence === "daily" ? 24 : 24 * 7;
  const cadenceStart = new Date(Date.now() - cadenceHours * 60 * 60 * 1000);
  const since =
    profile.lastDigestSentAt && profile.lastDigestSentAt > cadenceStart
      ? profile.lastDigestSentAt
      : cadenceStart;

  // Parallel: notifications + viewer's own log activity. Independent reads.
  const [notes, yourLogRows] = await Promise.all([
    db
      .select({
        type: notifications.type,
        targetId: notifications.targetId,
        actorId: notifications.actorId,
        createdAt: notifications.createdAt,
        actorUsername: profiles.username,
      })
      .from(notifications)
      .leftJoin(profiles, eq(profiles.userId, notifications.actorId))
      .where(
        and(eq(notifications.userId, userId), gt(notifications.createdAt, since)),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(200), // headroom; section caps applied after grouping
    db
      .select({
        status: logs.status,
        lastEventType: logs.lastEventType,
        lastEventAt: logs.lastEventAt,
        gameTitle: games.title,
      })
      .from(logs)
      .innerJoin(games, eq(games.id, logs.gameId))
      .where(and(eq(logs.userId, userId), gt(logs.lastEventAt, since)))
      .orderBy(desc(logs.lastEventAt))
      .limit(SECTION_CAP),
  ]);

  // Group notifications by type, carrying targetId on each item for hydration.
  const newFollowers: DigestPayload["newFollowers"] = [];
  const reactions: ReactionItem[] = [];
  const commentsList: CommentItem[] = [];
  const wishlistTriggers: DigestPayload["wishlistTriggers"] = [];

  for (const n of notes) {
    if (!n.actorUsername || !n.targetId) continue; // skip orphaned actor or null targetId
    if (n.type === "new_follower") {
      newFollowers.push({ username: n.actorUsername, displayName: null });
    } else if (n.type === "review_liked") {
      reactions.push({
        actor: n.actorUsername,
        kind: "review_liked",
        targetTitle: "",
        targetId: n.targetId,
      });
    } else if (n.type === "list_liked") {
      reactions.push({
        actor: n.actorUsername,
        kind: "list_liked",
        targetTitle: "",
        targetId: n.targetId,
      });
    } else if (n.type === "review_commented") {
      commentsList.push({
        actor: n.actorUsername,
        kind: "review_commented",
        targetTitle: "",
        excerpt: "",
        targetId: n.targetId,
      });
    } else if (n.type === "comment_replied") {
      commentsList.push({
        actor: n.actorUsername,
        kind: "comment_replied",
        targetTitle: "",
        excerpt: "",
        targetId: n.targetId, // here targetId is parentCommentId
      });
    } else if (n.type === "wishlist_logged_by_friend") {
      // Forward-looking: hydration deferred until emit path lands. See JSDoc.
      wishlistTriggers.push({ actor: n.actorUsername, gameTitle: "a game" });
    }
  }

  // Build yourWeek: filter completed/playing logs in window.
  const yourWeek: DigestPayload["yourWeek"] = yourLogRows
    .filter((r) => r.status === "completed" || r.status === "playing")
    .map((r) => ({
      kind:
        r.status === "completed" ? ("log_completed" as const) : ("log_started" as const),
      gameTitle: r.gameTitle,
    }));

  // Slice each section before hydration so we don't look up titles for items
  // we'll throw away.
  const newFollowersCapped = newFollowers.slice(0, SECTION_CAP);
  const reactionsCapped = reactions.slice(0, SECTION_CAP);
  const commentsCapped = commentsList.slice(0, SECTION_CAP);
  const wishlistCapped = wishlistTriggers.slice(0, SECTION_CAP);
  const yourWeekCapped = yourWeek.slice(0, SECTION_CAP);

  // Null when all sections are empty post-cap.
  if (
    newFollowersCapped.length === 0 &&
    reactionsCapped.length === 0 &&
    commentsCapped.length === 0 &&
    wishlistCapped.length === 0 &&
    yourWeekCapped.length === 0
  ) {
    return null;
  }

  // Collect surviving IDs for batch hydration.
  const reviewIds: string[] = [];
  const listIds: string[] = [];
  const parentCommentIds: string[] = [];

  for (const r of reactionsCapped) {
    if (r.kind === "review_liked") reviewIds.push(r.targetId);
    else listIds.push(r.targetId);
  }
  for (const c of commentsCapped) {
    if (c.kind === "review_commented") reviewIds.push(c.targetId);
    else parentCommentIds.push(c.targetId);
  }

  // Three parallel batch lookups. Skip the query entirely when the id list
  // is empty — Postgres tolerates empty IN-lists but we save a roundtrip.
  const [reviewRows, listRows, parentCommentRows] = await Promise.all([
    reviewIds.length > 0
      ? db
          .select({ id: reviews.id, gameTitle: games.title })
          .from(reviews)
          .innerJoin(games, eq(games.id, reviews.gameId))
          .where(inArray(reviews.id, reviewIds))
      : Promise.resolve([] as { id: string; gameTitle: string }[]),
    listIds.length > 0
      ? db
          .select({ id: lists.id, title: lists.title })
          .from(lists)
          .where(inArray(lists.id, listIds))
      : Promise.resolve([] as { id: string; title: string }[]),
    parentCommentIds.length > 0
      ? db
          .select({ id: comments.id, gameTitle: games.title })
          .from(comments)
          .innerJoin(reviews, eq(reviews.id, comments.reviewId))
          .innerJoin(games, eq(games.id, reviews.gameId))
          .where(inArray(comments.id, parentCommentIds))
      : Promise.resolve([] as { id: string; gameTitle: string }[]),
  ]);

  const reviewTitleMap = new Map(reviewRows.map((r) => [r.id, r.gameTitle]));
  const listTitleMap = new Map(listRows.map((r) => [r.id, r.title]));
  const parentCommentMap = new Map(parentCommentRows.map((r) => [r.id, r.gameTitle]));

  // Walk grouped arrays (NOT raw notes) — fragile shared-index walks were
  // the plan's original bug.
  for (const r of reactionsCapped) {
    if (r.kind === "review_liked") {
      r.targetTitle = reviewTitleMap.get(r.targetId) ?? "a review";
    } else {
      r.targetTitle = listTitleMap.get(r.targetId) ?? "a list";
    }
  }
  for (const c of commentsCapped) {
    if (c.kind === "review_commented") {
      c.targetTitle = reviewTitleMap.get(c.targetId) ?? "a review";
    } else {
      c.targetTitle = parentCommentMap.get(c.targetId) ?? "a review";
    }
  }

  // Strip internal targetId from the public payload.
  const reactionsPublic: DigestPayload["reactions"] = reactionsCapped.map((r) => ({
    actor: r.actor,
    kind: r.kind,
    targetTitle: r.targetTitle,
  }));
  const commentsPublic: DigestPayload["comments"] = commentsCapped.map((c) => ({
    actor: c.actor,
    kind: c.kind,
    targetTitle: c.targetTitle,
    excerpt: c.excerpt,
  }));

  return {
    since,
    recipient: { username: profile.username, displayName: profile.displayName },
    newFollowers: newFollowersCapped,
    reactions: reactionsPublic,
    comments: commentsPublic,
    wishlistTriggers: wishlistCapped,
    yourWeek: yourWeekCapped,
  };
}
