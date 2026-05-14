"use client";

import { useTransition } from "react";
import { toast } from "sonner";

interface Props {
  /** Absolute URL to the list (https://host/u/.../lists/...) */
  url: string;
  /** Title used as the tweet hook. */
  title: string;
}

/**
 * Two-button share affordance: Copy link + Tweet intent. Modeled on
 * components/taste/share-modal.tsx but trimmed: no preview image (the OG
 * card is generated on demand via the unfurler when the link is pasted),
 * no Radix Dialog wrapper. The taste modal needs the preview because the
 * OG card is the *primary* artifact users share; for lists the artifact
 * is the curated game order and the OG card is supplemental.
 *
 * Clipboard graceful fallback: if clipboard API throws (insecure context
 * or permission denied) we surface a toast instructing the user to
 * long-press the URL bar — same fallback pattern as ShareModal.
 */
export function ListShareButton({ url, title }: Props) {
  const [pending, startTransition] = useTransition();

  function onTweet() {
    const text = `${title} →`;
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
        aria-label="Copy link to list"
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
        aria-label="Share list on Twitter"
      >
        Tweet
      </button>
    </div>
  );
}
