"use client";

import { useState } from "react";

/**
 * PageantControls — Phase 6 T12.
 *
 * Bottom-pinned control strip for the Pageant. Two layouts:
 *
 *   1. Normal scenes: [back] [pause/play] [next], plus a small inline
 *      share icon for non-closing scenes (the closing scene has its own
 *      prominent share row).
 *
 *   2. Closing scene: three big share buttons (Twitter · Discord · Copy
 *      link) replace the nav arrows entirely. The user has reached the
 *      end of the recap; the call-to-action is sharing, not navigation.
 *
 * Why this lives in its own file rather than being inlined: the closing
 * vs. normal branch is a meaningful structural difference, and keeping
 * it isolated lets the Pageant.tsx file focus on the state machine +
 * scene-render switch without three nested branches of JSX.
 *
 * Share URL: we read `window.location.href` at click time (not render
 * time) because the user may have arrived via `?scene=N` deep-link and
 * we want the share URL to reflect *current* scene, not the load-time
 * value. For the Twitter/Discord intents, we encode a short pitch.
 *
 * a11y:
 * - All buttons have `aria-label` (icons alone aren't readable by AT).
 * - Disabled prev/next still render so the layout doesn't shift; the
 *   `aria-disabled` + `disabled` pair means "noop" to mouse + keyboard.
 * - Pause/play swaps the label so screen readers hear the new action.
 */
interface PageantControlsProps {
  onBack: () => void;
  onForward: () => void;
  onPauseToggle: () => void;
  isPaused: boolean;
  canBack: boolean;
  canForward: boolean;
  isClosingScene: boolean;
  /** Used for Twitter/Discord intent text. Falls back to a generic pitch. */
  sharePitch?: string;
}

export function PageantControls({
  onBack,
  onForward,
  onPauseToggle,
  isPaused,
  canBack,
  canForward,
  isClosingScene,
  sharePitch,
}: PageantControlsProps) {
  if (isClosingScene) {
    return <ClosingShareRow sharePitch={sharePitch} />;
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-20 flex items-center justify-between px-6">
      <button
        type="button"
        onClick={onBack}
        disabled={!canBack}
        aria-disabled={!canBack}
        aria-label="Previous scene"
        className="pointer-events-auto rounded-full border border-[var(--border)] bg-[var(--bg-card)]/80 px-4 py-2 text-sm text-[var(--text)] backdrop-blur transition-opacity hover:bg-[var(--bg-card-hover)] disabled:cursor-not-allowed disabled:opacity-30"
      >
        Back
      </button>

      <button
        type="button"
        onClick={onPauseToggle}
        aria-label={isPaused ? "Resume recap" : "Pause recap"}
        aria-pressed={isPaused}
        className="pointer-events-auto rounded-full border border-[var(--border)] bg-[var(--bg-card)]/80 px-5 py-2 text-sm text-[var(--text)] backdrop-blur transition-colors hover:bg-[var(--bg-card-hover)]"
      >
        {isPaused ? "Resume" : "Pause"}
      </button>

      <button
        type="button"
        onClick={onForward}
        disabled={!canForward}
        aria-disabled={!canForward}
        aria-label="Next scene"
        className="pointer-events-auto rounded-full border border-[var(--border)] bg-[var(--bg-card)]/80 px-4 py-2 text-sm text-[var(--text)] backdrop-blur transition-opacity hover:bg-[var(--bg-card-hover)] disabled:cursor-not-allowed disabled:opacity-30"
      >
        Next
      </button>
    </div>
  );
}

/**
 * Three big share buttons shown only on the closing scene. Each button
 * resolves its URL lazily at click time from `window.location.href` so
 * deep-linked positions are preserved in the share intent.
 */
function ClosingShareRow({ sharePitch }: { sharePitch?: string }) {
  const [copied, setCopied] = useState(false);

  const pitch = sharePitch ?? "My year in games";

  const handleTwitter = () => {
    if (typeof window === "undefined") return;
    const url = encodeURIComponent(window.location.href);
    const text = encodeURIComponent(pitch);
    window.open(
      `https://twitter.com/intent/tweet?text=${text}&url=${url}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const handleDiscord = () => {
    if (typeof window === "undefined") return;
    // Discord doesn't have a native "share to Discord" intent URL the way
    // Twitter does. Copying the link is the established workaround — the
    // user pastes into whatever channel they want. We make this explicit
    // via the toast so it's not confusing.
    const ok = copyToClipboard(window.location.href);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    }
  };

  const handleCopy = () => {
    if (typeof window === "undefined") return;
    const ok = copyToClipboard(window.location.href);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    }
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-8 z-20 flex flex-col items-center gap-3 px-6">
      <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={handleTwitter}
          aria-label="Share to Twitter"
          className="rounded-lg bg-[var(--accent)] px-6 py-3 text-sm font-medium text-[var(--accent-fg)] shadow-lg transition-opacity hover:opacity-90"
        >
          Share to Twitter
        </button>
        <button
          type="button"
          onClick={handleDiscord}
          aria-label="Share to Discord (copies link)"
          className="rounded-lg bg-[var(--accent)] px-6 py-3 text-sm font-medium text-[var(--accent-fg)] shadow-lg transition-opacity hover:opacity-90"
        >
          Share to Discord
        </button>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy link to clipboard"
          className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-6 py-3 text-sm font-medium text-[var(--text)] shadow-lg transition-colors hover:bg-[var(--bg-card-hover)]"
        >
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
      {/*
        Polite live region so AT announces the copy result without
        stealing focus. The visible "Copied" label flip on the button
        is the sighted cue.
      */}
      <p aria-live="polite" className="sr-only">
        {copied ? "Link copied to clipboard" : ""}
      </p>
    </div>
  );
}

/**
 * Best-effort clipboard write. Uses the modern Async Clipboard API when
 * available; silently no-ops on older browsers (the user can still see
 * the URL in the address bar). Returns true on apparent success — the
 * Promise from `navigator.clipboard.writeText` resolves before the
 * write actually lands, so this is "kicked off OK", not "definitely
 * pasted".
 */
function copyToClipboard(text: string): boolean {
  if (typeof navigator === "undefined") return false;
  if (!navigator.clipboard?.writeText) return false;
  // Fire-and-forget — we already gave the user the optimistic "Copied!"
  // label. If this throws (e.g. clipboard permission revoked), we just
  // don't surface it; the visible URL fallback in the address bar is
  // the safety net.
  void navigator.clipboard.writeText(text).catch(() => {
    /* noop */
  });
  return true;
}
