"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mascot } from "@/components/mascot/mascot";
import { Button } from "@/components/ui/button";
import { useMascotStore } from "@/components/mascot/mascot-store";
import { submitAnswer, generateDraft } from "@/lib/reviews/server-actions";

interface Props {
  interviewId: string;
  gameSlug: string;
  initialQ1: string;
}

type Turn = { question: string; answer?: string; streaming?: boolean };

const MAX_TURNS = 4;

async function readAccumulatedStream(
  stream: ReadableStream<string>,
  onChunk: (latest: string) => void,
): Promise<string> {
  const reader = stream.getReader();
  let last = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value !== undefined) {
        last = value;
        onChunk(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return last;
}

export function ReviewInterview({ interviewId, gameSlug, initialQ1 }: Props) {
  const router = useRouter();
  const setMood = useMascotStore((s) => s.setMood);

  const [turns, setTurns] = useState<Turn[]>(() => {
    if (typeof window !== "undefined") {
      const cached = window.localStorage.getItem(`phase2-interview:${interviewId}`);
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as Turn[];
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        } catch {
          /* fall through */
        }
      }
    }
    return [{ question: initialQ1 }];
  });
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    window.localStorage.setItem(`phase2-interview:${interviewId}`, JSON.stringify(turns));
  }, [interviewId, turns]);

  const activeIdx = turns.findIndex((t) => t.answer === undefined);
  const currentTurnIdx = activeIdx === -1 ? turns.length - 1 : activeIdx;
  const canSubmit = draft.trim().length > 0 && !pending;

  async function handleSubmit() {
    if (!canSubmit) return;
    const turnNumber = currentTurnIdx + 1;
    const text = draft.trim();
    setError(null);
    setMood("thinking");

    // Optimistically mark this turn as answered and truncate downstream turns
    setTurns((prev) => {
      const next = prev.slice(0, currentTurnIdx);
      next[currentTurnIdx] = { ...prev[currentTurnIdx], answer: text };
      return next;
    });
    setDraft("");

    startTransition(async () => {
      const result = await submitAnswer({ interviewId, turn: turnNumber, text });
      if (!result.ok) {
        setError(result.error);
        setMood("confused", { message: result.error });
        return;
      }
      if (result.ready) {
        await launchDraft();
        return;
      }
      // Begin streaming the next question
      setTurns((prev) => [...prev, { question: "", streaming: true }]);
      try {
        const finalText = await readAccumulatedStream(result.stream, (latest) => {
          setTurns((prev) => {
            const next = [...prev];
            next[next.length - 1] = { question: latest, streaming: true };
            return next;
          });
        });
        setTurns((prev) => {
          const next = [...prev];
          next[next.length - 1] = { question: finalText, streaming: false };
          return next;
        });
        setMood("idle");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Stream failed");
        setMood("confused", { message: "Let me catch my breath — your answers are saved. Try again?" });
      }
    });
  }

  async function launchDraft() {
    setMood("thinking", { message: "Drafting your review…" });
    const result = await generateDraft({ interviewId });
    if (!result.ok) {
      if (result.existingReviewId) {
        // Already reviewed — bounce to editor
        router.push(`/games/${gameSlug}/review?reviewId=${result.existingReviewId}`);
        return;
      }
      setError(result.error);
      setMood("confused", { message: result.error });
      return;
    }
    // Drain the draft stream so the server-side IIFE finishes writing the
    // final body to reviews.body before we navigate. Otherwise the editor
    // route would load with an empty body. We ignore intermediate chunks
    // (the editor renders the final body from the DB on navigation).
    try {
      await readAccumulatedStream(result.stream, () => {
        /* no UI update — mascot 'thinking' caption is enough */
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Drafting failed");
      setMood("confused", { message: "Let me catch my breath. Try again?" });
      return;
    }
    window.localStorage.removeItem(`phase2-interview:${interviewId}`);
    router.push(`/games/${gameSlug}/review?reviewId=${result.reviewId}`);
  }

  function handleEditAnswer(idx: number) {
    setDraft(turns[idx]?.answer ?? "");
    setTurns((prev) =>
      prev.slice(0, idx + 1).map((t, i) => (i === idx ? { ...t, answer: undefined } : t)),
    );
  }

  const canSkip = turns.length > 1 && currentTurnIdx >= 1;
  const isAtLastTurn = currentTurnIdx + 1 === MAX_TURNS;

  return (
    <div className="space-y-6 px-6 py-8 max-w-2xl mx-auto">
      <div className="flex items-center gap-4">
        <Mascot size="md" />
        <p className="text-sm text-[var(--text-dim)]">
          Answer {Math.min(currentTurnIdx + 1, MAX_TURNS)} of {MAX_TURNS}
        </p>
      </div>

      <div className="space-y-5">
        {turns.map((turn, idx) => (
          <div key={idx} className="space-y-2">
            <p className="text-base text-[var(--text)] whitespace-pre-wrap">
              {turn.question}
              {turn.streaming && <span className="animate-pulse">&#x258C;</span>}
            </p>
            {turn.answer !== undefined && idx !== currentTurnIdx ? (
              <button
                type="button"
                onClick={() => handleEditAnswer(idx)}
                className="block text-left text-sm text-[var(--text-dim)] bg-[var(--bg-card)] border border-[var(--border)] rounded-lg px-3 py-2 hover:border-[var(--accent)] transition"
              >
                {turn.answer}
                <span className="ml-2 text-xs text-[var(--text-faint)]">(edit)</span>
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {activeIdx !== -1 && (
        <div className="space-y-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full min-h-24 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            placeholder="Your answer&hellip;"
            disabled={pending}
          />
          <div className="flex justify-between gap-2">
            {canSkip && !isAtLastTurn && (
              <Button variant="ghost" onClick={launchDraft} disabled={pending}>
                Skip the rest
              </Button>
            )}
            <Button onClick={handleSubmit} disabled={!canSubmit} className="ml-auto">
              {isAtLastTurn ? "Draft my review" : "Next"}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-500" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
