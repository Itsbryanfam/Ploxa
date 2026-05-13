"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HeartFull, HeartEmpty } from "@/components/pixel/hearts";
import { likeReview, unlikeReview } from "@/lib/social/reactions/server-actions";

interface Props {
  reviewId: string;
  initialLiked: boolean;
  initialCount: number;
  /** When true, click triggers a login redirect instead of action. */
  loggedOut: boolean;
}

export function LikeButton({ reviewId, initialLiked, initialCount, loggedOut }: Props) {
  const router = useRouter();
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [pending, startTransition] = useTransition();

  function handleClick() {
    if (loggedOut) {
      router.push("/login");
      return;
    }
    if (pending) return;
    const willLike = !liked;
    setLiked(willLike);
    setCount((c) => c + (willLike ? 1 : -1));
    startTransition(async () => {
      const result = willLike ? await likeReview(reviewId) : await unlikeReview(reviewId);
      if (!result.ok) {
        // Revert on failure
        setLiked(!willLike);
        setCount((c) => c + (willLike ? -1 : 1));
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-2 text-sm text-[var(--text-dim)] hover:text-[var(--accent)] transition"
      aria-pressed={liked}
      aria-label={liked ? "Unlike" : "Like"}
    >
      {liked ? <HeartFull size={20} /> : <HeartEmpty size={20} />}
      <span className="tabular-nums">{count}</span>
    </button>
  );
}
