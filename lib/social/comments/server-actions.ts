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

  // Auto-flag: rule-based pre-check. checkSpamRules is pure (no IO) and
  // returns reason codes that the report row's `details` field surfaces
  // for the mod queue (T24).
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
  // We don't have gameSlug in this scope without another lookup; revalidate
  // the user's reviews root which is the cheaper hit. The canonical
  // review page is RSC-revalidated per-request via the published_at index.
  const authorProfile = await db.query.profiles.findFirst({
    where: eq(profiles.userId, review.userId),
    columns: { username: true },
  });
  if (authorProfile) {
    revalidatePath(`/u/${authorProfile.username}/reviews`);
  }

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
  const flagCheck = checkSpamRules(body);
  await db
    .update(comments)
    .set({ body, editedAt: new Date(), isHidden: flagCheck.isFlagged })
    .where(and(eq(comments.id, commentId), eq(comments.userId, user.id)));

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

  return { ok: true };
}
