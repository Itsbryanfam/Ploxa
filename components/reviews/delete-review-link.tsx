"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteReview } from "@/lib/reviews/server-actions";

interface Props {
  reviewId: string;
  username: string;
}

export function DeleteReviewLink({ reviewId, username }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteReview({ reviewId });
      if (result.ok) {
        router.push(`/u/${username}/reviews`);
      }
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-[var(--text-dim)] hover:text-red-500"
      >
        Delete
      </button>
    );
  }
  return (
    <span className="text-xs text-[var(--text-dim)]">
      Sure?{" "}
      <button onClick={handleDelete} disabled={pending} className="text-red-500 hover:underline">
        Yes
      </button>{" "}
      &middot;{" "}
      <button onClick={() => setConfirming(false)} className="hover:underline">
        Cancel
      </button>
    </span>
  );
}
