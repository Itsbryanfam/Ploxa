"use client";

import { useTransition } from "react";
import { toast } from "sonner";

interface Props {
  url: string;
  title: string;
  author: string;
}

export function ReviewShareButton({ url, title, author }: Props) {
  const [pending, startTransition] = useTransition();

  function onTweet() {
    const text = `${title} — review by @${author}`;
    const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    window.open(intent, "_blank", "noopener,noreferrer");
  }

  function onCopyLink() {
    if (pending) return;
    startTransition(async () => {
      try {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied.");
      } catch {
        toast.error("Couldn't copy. Long-press the URL to copy manually.");
      }
    });
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onCopyLink}
        disabled={pending}
        className="text-sm text-[var(--text-dim)] hover:text-[var(--accent)] transition disabled:opacity-50"
        aria-label="Copy link to review"
      >
        Copy link
      </button>
      <span className="text-[var(--text-faint)]" aria-hidden>
        ·
      </span>
      <button
        type="button"
        onClick={onTweet}
        className="text-sm text-[var(--text-dim)] hover:text-[var(--accent)] transition"
        aria-label="Share review on Twitter"
      >
        Tweet
      </button>
    </div>
  );
}
