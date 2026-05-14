"use client";

import { useState, useTransition } from "react";
import { toggleProfileVisibility } from "@/lib/settings/visibility-actions";

interface Props {
  initial: boolean;
}

export function VisibilityToggle({ initial }: Props) {
  const [isPublic, setIsPublic] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleChange(next: boolean) {
    setError(null);
    setIsPublic(next);
    startTransition(async () => {
      const res = await toggleProfileVisibility(next);
      if (!res.ok) {
        // Roll back optimistic update on failure
        setIsPublic(!next);
        setError(res.error);
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        {/* Public option */}
        <button
          type="button"
          onClick={() => !isPublic && handleChange(true)}
          disabled={pending}
          aria-pressed={isPublic}
          className={[
            "px-4 py-2 rounded-md text-sm font-medium border transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
            isPublic
              ? "bg-[var(--accent)] text-white border-[var(--accent)]"
              : "bg-[var(--bg-card)] text-[var(--text-dim)] border-[var(--border)] hover:border-[var(--border-hover)]",
            pending ? "opacity-60 cursor-not-allowed" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          Public
        </button>

        {/* Private option */}
        <button
          type="button"
          onClick={() => isPublic && handleChange(false)}
          disabled={pending}
          aria-pressed={!isPublic}
          className={[
            "px-4 py-2 rounded-md text-sm font-medium border transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
            !isPublic
              ? "bg-[var(--accent)] text-white border-[var(--accent)]"
              : "bg-[var(--bg-card)] text-[var(--text-dim)] border-[var(--border)] hover:border-[var(--border-hover)]",
            pending ? "opacity-60 cursor-not-allowed" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          Private
        </button>

        {pending && (
          <span className="text-xs text-[var(--text-dim)]" aria-live="polite">
            Saving…
          </span>
        )}
      </div>

      <p className="text-xs text-[var(--text-dim)]" aria-live="polite">
        {!pending &&
          (isPublic
            ? "Your profile is public — anyone can see your library and reviews."
            : "Your profile is private — only approved followers can see your content.")}
      </p>

      {error && (
        <p className="text-sm text-red-500" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
