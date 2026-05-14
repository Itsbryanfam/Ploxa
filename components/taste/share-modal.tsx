"use client";

import { useState } from "react";
import Image from "next/image";
import { toast } from "sonner";

/**
 * Owner-only share affordance for the taste page. Renders a Share button that
 * opens a dialog with a live preview of the OG endpoint plus Tweet / Copy
 * link / Download buttons.
 *
 * The OG preview URL is cache-busted via `narrativeGeneratedAt` so refreshing
 * the fingerprint immediately surfaces the new card. `next/image` runs with
 * `unoptimized` here because the OG endpoint already returns a PNG sized for
 * social cards — re-running Next's image optimizer adds latency without
 * meaningfully shrinking the dynamic payload.
 *
 * The button itself is rendered only when the profile is public (see
 * `TierNarrative`); the OG endpoint also 404s for private profiles per T16,
 * so this client gate is for UX, not security.
 */
export function ShareModal({
  username,
  narrativeGeneratedAt,
  origin,
}: {
  username: string;
  narrativeGeneratedAt: Date | null;
  origin: string;
}) {
  const [open, setOpen] = useState(false);

  const profileUrl = `${origin}/u/${username}/taste`;
  // Cache-bust the OG preview by the narrative timestamp so a fresh refresh
  // immediately surfaces the new card. When no narrative has been generated
  // yet, fall back to a stable string rather than `Date.now()` — calling an
  // impure function in render trips React's purity lint and would also force
  // the <Image> to refetch on every modal open.
  const versionKey = narrativeGeneratedAt?.getTime() ?? "latest";
  const ogUrl = `${origin}/api/og/taste/${username}?v=${versionKey}`;

  function onTweet() {
    const text = `Read my gaming taste →`;
    const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(profileUrl)}`;
    window.open(intent, "_blank", "noopener,noreferrer");
  }

  async function onCopyLink() {
    try {
      await navigator.clipboard.writeText(profileUrl);
      toast.success("Link copied.");
    } catch {
      toast.error("Couldn't copy. Long-press the URL to copy manually.");
    }
  }

  async function onDownload() {
    try {
      const resp = await fetch(ogUrl);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${username}-taste.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Couldn't download. Try right-click → Save As on the preview.");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-[var(--border)] px-3 py-1 text-xs hover:bg-[var(--bg-card-hover)]"
      >
        Share →
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-w-2xl rounded-lg border border-[var(--border)] bg-[var(--bg)] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 font-mono text-lg">Share your taste card</h2>
            <div className="mb-4 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--bg-elev)]">
              <Image
                src={ogUrl}
                alt="Taste card preview"
                width={1200}
                height={630}
                unoptimized
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onTweet}
                className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-[var(--accent-fg)] hover:bg-[var(--accent)]/90"
              >
                Tweet
              </button>
              <button
                type="button"
                onClick={onCopyLink}
                className="rounded border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--bg-card-hover)]"
              >
                Copy link
              </button>
              <button
                type="button"
                onClick={onDownload}
                className="rounded border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--bg-card-hover)]"
              >
                Download image
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="ml-auto text-xs text-[var(--text-faint)] hover:text-[var(--text)]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
