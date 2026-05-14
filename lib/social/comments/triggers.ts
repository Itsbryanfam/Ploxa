import "server-only";

import { emit } from "@/lib/social/notifications/emit";
import { resolveMentionedUserIds, parseMentions } from "./mentions";

/**
 * Comment notification orchestrator. Called from createComment after the
 * INSERT. Emits up to 1 + N notifications (recipient + mentioned users),
 * each deduped by emit() against the same actor+target tuple.
 *
 * Type matrix:
 *   - Top-level comment    → review_commented to review author
 *   - Reply (parentId set) → comment_replied to parent author
 *   - Mention in either    → review_commented to mentioned user
 *
 * Mention notifications use review_commented (not a separate type) so the
 * inbox shows "@actor mentioned you in a comment on @author's review" via
 * row-rendering logic, not a distinct enum value.
 */
export async function onComment(args: {
  commenterId: string;
  commentId: string;
  reviewId: string;
  reviewAuthorId: string;
  parentCommentId: string | null;
  parentCommentAuthorId: string | null;
  body: string;
}): Promise<void> {
  // Primary notification: review_commented OR comment_replied
  if (args.parentCommentId && args.parentCommentAuthorId) {
    // Don't self-notify even on replies — replying to your own comment is fine
    // but shouldn't ping yourself.
    if (args.parentCommentAuthorId !== args.commenterId) {
      await emit({
        type: "comment_replied",
        recipientUserId: args.parentCommentAuthorId,
        actorUserId: args.commenterId,
        targetId: args.parentCommentId,
      });
    }
  } else if (args.reviewAuthorId !== args.commenterId) {
    // Don't notify the review author when they comment on their own review.
    await emit({
      type: "review_commented",
      recipientUserId: args.reviewAuthorId,
      actorUserId: args.commenterId,
      targetId: args.reviewId,
    });
  }

  // Mention notifications. Dedupe is T22's job via emit's ON CONFLICT
  // (user, type, target, actor) — a mentioned user who is also the review
  // author will receive only one row.
  //
  // Each emit() does an independent block-check + INSERT; fan them out
  // in parallel so M mentions cost one round-trip per mention, not M.
  const mentions = parseMentions(args.body);
  if (mentions.length > 0) {
    const userMap = await resolveMentionedUserIds(mentions);
    await Promise.all(
      Array.from(userMap.values())
        .filter((userId) => userId !== args.commenterId) // never self-notify
        .map((userId) =>
          emit({
            type: "review_commented",
            recipientUserId: userId,
            actorUserId: args.commenterId,
            targetId: args.reviewId,
          }),
        ),
    );
  }
}
