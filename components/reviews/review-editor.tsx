"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { HeartRating } from "@/components/ui/heart-rating";
import { useMascotStore } from "@/components/mascot/mascot-store";
import { publishReview, updateReview } from "@/lib/reviews/server-actions";
import { SectionCard } from "./section-card";

interface Props {
  reviewId: string;
  gameSlug: string;
  initialBody: string;
  initialRating: number | null;
  initialIsPublic: boolean;
}

const LABELS = ["Hook", "Highs", "Lows", "Verdict"] as const;

function splitToSections(body: string): [string, string, string, string] {
  const parts = body.split("\n\n");
  return [parts[0] ?? "", parts[1] ?? "", parts[2] ?? "", parts[3] ?? ""];
}

export function ReviewEditor({
  reviewId,
  gameSlug,
  initialBody,
  initialRating,
  initialIsPublic,
}: Props) {
  const router = useRouter();
  const celebrate = useMascotStore((s) => s.celebrate);

  const [sections, setSections] = useState<[string, string, string, string]>(() =>
    splitToSections(initialBody),
  );
  const [rating, setRating] = useState<number>(initialRating ?? 0);
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // gameSlug is reserved for future use (e.g. a "back to /games/{slug}" link).
  void gameSlug;

  function updateSection(idx: 0 | 1 | 2 | 3, next: string) {
    setSections((prev) => {
      const out = [...prev] as [string, string, string, string];
      out[idx] = next;
      return out;
    });
  }

  const canPublish = sections.every((s) => s.trim().length > 0) && rating > 0;

  function handlePublish() {
    if (!canPublish || pending) return;
    setError(null);
    startTransition(async () => {
      // Flush manual section edits via updateReview, then publish.
      const join = sections.join("\n\n");
      const upd = await updateReview({ reviewId, body: join, rating, isPublic });
      if (!upd.ok) {
        setError(upd.error);
        return;
      }
      const result = await publishReview({ reviewId, rating, isPublic });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      celebrate("Live!");
      // Give the celebration animation a beat before navigating (matches 1500ms celebrate duration).
      setTimeout(
        () => router.push(`/u/${result.username}/reviews/${result.gameSlug}`),
        1200,
      );
    });
  }

  return (
    <div className="space-y-5 px-6 py-8 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-[var(--text-faint)]">Rating</p>
          <HeartRating value={rating} onChange={setRating} size={24} />
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--text-dim)]">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          Public
        </label>
      </div>

      <div className="space-y-3">
        {LABELS.map((label, idx) => (
          <SectionCard
            key={label}
            label={label}
            sectionIndex={idx as 0 | 1 | 2 | 3}
            reviewId={reviewId}
            text={sections[idx]}
            onChange={(next) => updateSection(idx as 0 | 1 | 2 | 3, next)}
          />
        ))}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={handlePublish} disabled={!canPublish || pending}>
          {pending ? "Publishing…" : "Publish"}
        </Button>
      </div>

      {error && (
        <p className="text-sm text-red-500" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
