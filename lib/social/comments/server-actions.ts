"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { isBlockedBetween } from "@/lib/social/_shared/visibility";
import { checkSpamRules } from "@/lib/social/moderation/rules";
import { onComment } from "./triggers";

const { comments, reviews, profiles } = schema;

/**
 * Shared helper: revalidate the canonical review listing path for the author
 * of a given review. Called by createComment, editComment, and softDeleteComment
 * so all three mutations invalidate the server cache symmetrically.
 * Fire-and-forget style — revalidation failures do not surface to callers.
 *
 * Single JOIN: fetches the review's author username in one round-trip rather
 * than two (reviews.findFirst → profiles.findFirst). Orphaned reviews (author
 * deleted) skip silently via inner-join semantics.
 */
async function revalidateAuthorReviewListing(reviewId: string): Promise<void> {
  const rows = await db
    .select({ username: profiles.username })
    .from(reviews)
    .innerJoin(profiles, eq(profiles.userId, reviews.userId))
    .where(eq(reviews.id, reviewId))
    .limit(1);
  const username = rows[0]?.username;
  if (username) revalidatePath(`/u/${username}/reviews`);
}

const createSchema = z.object({
  reviewId: z.string().uuid(),
  body: z.string().min(1).max(5000),
  parentId: z.string().uuid().nullable().optional(),
});

export type CommentResult =
  | { ok: true; commentId: string; isFlagged: boolean }
  | {
      ok: false;
      reason:
        | "not-authenticated"
        | "invalid-input"
        | "blocked"
        | "review-not-found"
        | "parent-not-found";
    };

export async function createComment(input: unknown): Promise<CommentResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid-input" };
  const { reviewId, body, parentId } = parsed.data;

  const user = await getCachedUser();
  if (!user) return { ok: false, reason: "not-authenticated" };

  // Load the review to verify it exists + get its author for block check.
  const review = await db.query.reviews.findFirst({
    where: eq(reviews.id, reviewId),
    columns: { id: true, userId: true },
  });
  if (!review) return { ok: false, reason: "review-not-found" };

  // Block check both directions.
  if (await isBlockedBetween(user.id, review.userId)) {
    return { ok: false, reason: "blocked" };
  }

  // Parent context (for comment_replied notification + same-review pre-check).
  //
  // We pre-validate the same-review invariant in app code even though the
  // 0007 trigger (`comments_parent_same_review_trg`) enforces it at the
  // DB level. Reason: the trigger RAISES EXCEPTION on violation, which
  // surfaces as an unhandled error in Next.js server actions. Pre-checking
  // returns a clean { ok: false, reason } and avoids the throw path
  // entirely. The trigger remains the source of truth for data integrity
  // (e.g., concurrent writes), but the app-level check covers the normal
  // request flow.
  let parentAuthorId: string | null = null;
  if (parentId) {
    const parent = await db.query.comments.findFirst({
      where: eq(comments.id, parentId),
      columns: { userId: true, reviewId: true },
    });
    if (!parent) return { ok: false, reason: "parent-not-found" };
    if (parent.reviewId !== reviewId) return { ok: false, reason: "invalid-input" };
    parentAuthorId = parent.userId;
  }

  // Auto-flag: rule-based pre-check (see lib/social/moderation/rules.ts).
  const flagCheck = checkSpamRules(body);

  const inserted = await db
    .insert(comments)
    .values({
      reviewId,
      userId: user.id,
      parentId: parentId ?? null,
      body,
      isHidden: flagCheck.isFlagged,
    })
    .returning({ id: comments.id });
  const commentId = inserted[0].id;

  // Auto-flag → reports row with auto_flagged status.
  if (flagCheck.isFlagged) {
    await db.insert(schema.reports).values({
      reporterId: null, // system-generated
      targetType: "comment",
      targetId: commentId,
      reason: flagCheck.reasons[0] ?? "unknown",
      details: flagCheck.reasons.join(", "),
      status: "auto_flagged",
    });
  }

  // Side-effects: notifications.
  await onComment({
    commenterId: user.id,
    commentId,
    reviewId,
    reviewAuthorId: review.userId,
    parentCommentId: parentId ?? null,
    parentCommentAuthorId: parentAuthorId,
    body,
  });

  // Revalidate the canonical review listing so the new comment appears.
  await revalidateAuthorReviewListing(reviewId);

  return { ok: true, commentId, isFlagged: flagCheck.isFlagged };
}

const editSchema = z.object({
  commentId: z.string().uuid(),
  body: z.string().min(1).max(5000),
});

export async function editComment(input: unknown): Promise<CommentResult> {
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid-input" };
  const { commentId, body } = parsed.data;

  const user = await getCachedUser();
  if (!user) return { ok: false, reason: "not-authenticated" };

  // Only author can edit. WHERE clause carries the userId predicate so a
  // non-author hitting this action gets 0 rows updated — no error leakage.
  // `.returning({ id })` lets us detect the no-op so we can skip the
  // moderation-report insert below: without that guard, an attacker could
  // pollute the mod queue with `auto_flagged` reports against any comment
  // by posting an edit with spammy content (the UPDATE no-ops on userId
  // mismatch, but the report INSERT would still fire).
  const flagCheck = checkSpamRules(body);
  const result = await db
    .update(comments)
    .set({ body, editedAt: new Date(), isHidden: flagCheck.isFlagged })
    .where(and(eq(comments.id, commentId), eq(comments.userId, user.id)))
    .returning({ id: comments.id });

  // Auto-flag → reports row (parity with createComment). Dedupe by
  // (target_type='comment', target_id, status='auto_flagged'): without this
  // guard, every edit of an already-flagged comment would stack duplicate
  // mod-queue entries. auto_flagged is the unresolved bucket — once a mod
  // resolves it (resolved_action_taken or resolved_no_action), a fresh
  // re-edit flagging again WILL surface as a new report, which is the
  // intended escalation path.
  if (result.length > 0 && flagCheck.isFlagged) {
    const existing = await db.query.reports.findFirst({
      where: and(
        eq(schema.reports.targetType, "comment"),
        eq(schema.reports.targetId, commentId),
        eq(schema.reports.status, "auto_flagged"),
      ),
      columns: { id: true },
    });
    if (!existing) {
      await db.insert(schema.reports).values({
        reporterId: null, // system-generated
        targetType: "comment",
        targetId: commentId,
        reason: flagCheck.reasons[0] ?? "unknown",
        details: flagCheck.reasons.join(", "),
        status: "auto_flagged",
      });
    }
  }

  // Revalidate the review listing. editComment only has commentId in scope,
  // so we fetch the comment to retrieve its reviewId before delegating to
  // the shared helper. One extra round-trip is acceptable for consistency.
  const comment = await db.query.comments.findFirst({
    where: eq(comments.id, commentId),
    columns: { reviewId: true },
  });
  if (comment) await revalidateAuthorReviewListing(comment.reviewId);

  return { ok: true, commentId, isFlagged: flagCheck.isFlagged };
}

const softDeleteSchema = z.object({
  commentId: z.string().uuid(),
});

export async function softDeleteComment(input: unknown): Promise<{ ok: boolean }> {
  const parsed = softDeleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false };

  const user = await getCachedUser();
  if (!user) return { ok: false };

  // Original author only for now; admin path lands in T24 (moderation queue).
  await db
    .update(comments)
    .set({ body: "[deleted]", editedAt: new Date() })
    .where(and(eq(comments.id, parsed.data.commentId), eq(comments.userId, user.id)));

  // Revalidate the review listing. Same pattern as editComment — fetch the
  // comment for its reviewId, then delegate to the shared helper.
  const comment = await db.query.comments.findFirst({
    where: eq(comments.id, parsed.data.commentId),
    columns: { reviewId: true },
  });
  if (comment) await revalidateAuthorReviewListing(comment.reviewId);

  return { ok: true };
}
