"use client";
import { useState } from "react";

import { CommentCard } from "./comment-card";
import { CommentComposer } from "./comment-composer";

export type ThreadComment = {
  id: string;
  body: string;
  userId: string;
  parentId: string | null;
  createdAt: Date;
  editedAt: Date | null;
  isHidden: boolean;
  author: {
    username: string;
    displayName: string | null;
    profilePictureUrl: string | null;
  };
};

export function CommentThread(props: {
  reviewId: string;
  comments: ThreadComment[];
  viewerId: string | null;
}) {
  const [replyingTo, setReplyingTo] = useState<string | null>(null);

  // Build tree: parent_id null = top-level; otherwise indent under parent.
  const topLevel = props.comments.filter((c) => c.parentId === null);
  const repliesBy = new Map<string, ThreadComment[]>();
  for (const c of props.comments) {
    if (c.parentId !== null) {
      const list = repliesBy.get(c.parentId) ?? [];
      list.push(c);
      repliesBy.set(c.parentId, list);
    }
  }

  return (
    <section className="space-y-2 divide-y divide-[var(--border)] mt-8">
      <h3 className="font-semibold pt-4">Comments</h3>
      {props.viewerId && replyingTo === null && (
        <CommentComposer reviewId={props.reviewId} parentId={null} />
      )}
      {topLevel.length === 0 && (
        <p className="py-4 text-sm text-[var(--text-dim)]">No comments yet.</p>
      )}
      {topLevel.map((c) => (
        <div key={c.id}>
          <CommentCard
            comment={c}
            author={c.author}
            viewerId={props.viewerId}
            onReply={props.viewerId ? setReplyingTo : undefined}
          />
          {(repliesBy.get(c.id) ?? []).map((reply) => (
            <div key={reply.id} className="ml-8 border-l border-[var(--border)] pl-4">
              <CommentCard comment={reply} author={reply.author} viewerId={props.viewerId} />
            </div>
          ))}
          {replyingTo === c.id && props.viewerId && (
            <div className="ml-8 border-l border-[var(--border)] pl-4 mt-2">
              <CommentComposer
                reviewId={props.reviewId}
                parentId={c.id}
                onSubmitted={() => setReplyingTo(null)}
              />
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
