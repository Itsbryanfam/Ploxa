"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HeartFull, HeartEmpty } from "@/components/pixel/hearts";
import { likeList, unlikeList } from "@/lib/social/reactions/server-actions";

interface Props {
  listId: string;
  initialLiked: boolean;
  initialCount: number;
  /** When true, click triggers a login redirect instead of action. */
  loggedOut: boolean;
}

/**
 * Heart toggle for a single list. Mirrors components/reviews/like-button.tsx
 * — optimistic flip, revert on ok:false, login redirect when logged out.
 *
 * Why a parallel component instead of a generic LikeButton: each variant
 * imports its own server action ('use server' modules can't be passed as
 * function values from server components into client components without an
 * async boundary, and a generic dispatcher would force a runtime kind check
 * on every render). The duplication cost is ~40 lines; isolated regressions
 * are worth it. See review like-button.tsx header for the same note.
 */
export function ListLikeButton({ listId, initialLiked, initialCount, loggedOut }: Props) {
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
      const result = willLike ? await likeList(listId) : await unlikeList(listId);
      if (!result.ok) {
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
      aria-label={liked ? "Unlike list" : "Like list"}
    >
      {liked ? <HeartFull size={20} /> : <HeartEmpty size={20} />}
      <span className="tabular-nums">{count}</span>
    </button>
  );
}
