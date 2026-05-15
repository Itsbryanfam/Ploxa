"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";

import { ConfidencePill } from "@/components/recs/atoms/confidence-pill";
import { LibraryBadge } from "@/components/recs/atoms/library-badge";
import { SlotBadge } from "@/components/recs/atoms/slot-badge";
import {
  neverAgainRec,
  playRec,
  saveRecForLater,
  snoozeRec,
  type RecCard as RecCardData,
} from "@/lib/recs/server-actions";
import { cn } from "@/lib/utils";

type Platform = "steam" | "xbox" | "psn";

/**
 * Interactive rec card for the /play-next results grid.
 *
 * Play-next redesign (T15): the card now surfaces the stratified-rail
 * affordances on top of the preserved T15 feedback wiring.
 *
 *   - "Play this" — variant depends on `gamePlatforms ∩ connectedPlatforms`:
 *       • 0 overlap → no platform hint; the server action redirects to
 *         `/games/{slug}` so the user can pick where to play manually.
 *       • 1 overlap → "Play on {p}" — single-tap; creates `playing` log on `p`.
 *       • 2+ overlap → dropdown picker; tapping a platform creates a log there.
 *   - "Save for later" — creates a `backlog` log + dismisses the rec.
 *   - Dismiss split (replaces the old single "Not for me"): a popover with
 *       • "Not for me" → `snoozeRec` (30-day soft snooze; T13)
 *       • "Never show this again" → `neverAgainRec` (permanent exclusion; T13)
 *     Both route through `doDismiss` so the optimistic hide + framer exit
 *     still fire identically to the pre-v2 dismissal.
 *
 * Optimistic dismiss: the card hides immediately (parent's `dismissedIds` set
 * drops it from `visibleRecs`), AnimatePresence runs the exit animation, and
 * the server action completes in the background. Toast confirms success or
 * surfaces a structured failure.
 *
 * v2 cover overlays replace the old decorative "AI pick" / "basic match"
 * corner badge (intentional spec change — confidence is the meaningful
 * signal; the algorithm string was decorative): `<LibraryBadge>` top-left
 * when the game is already in the viewer's library, and `<ConfidencePill>`
 * top-right EXCEPT for `wildcard` slots, where a confidence band would be
 * misleading on an intentionally out-of-distribution surprise pick.
 */
export function RecCard({
  rec,
  connectedPlatforms,
  gamePlatforms,
  onDismissed,
}: {
  rec: RecCardData;
  connectedPlatforms: Platform[];
  gamePlatforms: Platform[];
  onDismissed: (recId: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [openDismiss, setOpenDismiss] = useState(false);

  const overlap = gamePlatforms.filter((p) => connectedPlatforms.includes(p));

  // Wrap each action in a single helper: notify the parent first (drives the
  // AnimatePresence exit) and run the server action in the background. The
  // parent has already removed the rec from `visibleRecs` by the time the
  // server action resolves, so toast is the only post-resolution signal.
  function doDismiss(action: () => Promise<void>) {
    onDismissed(rec.id);
    startTransition(action);
  }

  function onSnooze() {
    setOpenDismiss(false);
    doDismiss(async () => {
      const r = await snoozeRec(rec.id);
      if (r.ok) toast("Snoozed for 30 days.");
      else toast.error("Couldn't snooze this one.");
    });
  }

  function onNeverAgain() {
    setOpenDismiss(false);
    doDismiss(async () => {
      const r = await neverAgainRec(rec.id);
      if (r.ok) toast("Won't show this again.");
      else toast.error("Couldn't update this one.");
    });
  }

  function onSave() {
    doDismiss(async () => {
      const r = await saveRecForLater(rec.id);
      if (r.ok) toast.success(r.message);
      else toast.error("Couldn't save this one.");
    });
  }

  function onPlayWithPlatform(p?: Platform) {
    doDismiss(async () => {
      const r = await playRec(rec.id, p);
      if (!r.ok) {
        toast.error(
          r.reason === "platform-not-connected"
            ? "That platform isn't connected."
            : "Couldn't mark as playing.",
        );
        return;
      }
      if (r.redirect) {
        router.push(`/games/${r.slug}`);
      } else {
        toast.success(r.message);
      }
    });
  }

  const art = rec.posterUrl ?? rec.coverUrl;
  const { timeFit, moodMatches, inLibrary, friendsCount } = rec.fitChips;
  const timeFitLabel =
    timeFit === "perfect"
      ? "Perfect length"
      : timeFit === "close"
        ? "Close fit"
        : "Loose fit";

  return (
    <motion.div
      layout
      data-testid="rec-card"
      data-slot={rec.slot}
      initial={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
      className="overflow-hidden rounded-md border border-[var(--border)] bg-[var(--bg)]"
    >
      <div className="relative aspect-[2/3] w-full bg-[var(--bg-elev)]">
        {art ? (
          <Image
            src={art}
            alt={rec.title}
            fill
            className="object-cover"
            sizes="240px"
          />
        ) : null}
        {inLibrary ? (
          <span className="absolute left-1 top-1">
            <LibraryBadge />
          </span>
        ) : null}
        {rec.slot !== "wildcard" ? (
          <span className="absolute right-1 top-1">
            <ConfidencePill confidence={rec.confidence} />
          </span>
        ) : null}
      </div>
      <div className="space-y-2 p-3">
        <h3 className="text-sm font-medium leading-tight">
          {rec.title}
          {rec.releasedYear ? (
            <span className="ml-1 font-normal text-[var(--text-faint)]">
              &apos;{String(rec.releasedYear).slice(-2)}
            </span>
          ) : null}
        </h3>
        <p className="text-xs leading-snug text-[var(--text-dim)]">
          {rec.reason}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <SlotBadge slot={rec.slot} />
          {timeFit ? (
            <span
              className={cn(
                "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium",
                timeFit === "perfect"
                  ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                  : "bg-[var(--bg-elev)] text-[var(--text-dim)]",
              )}
            >
              {timeFitLabel}
            </span>
          ) : null}
          {moodMatches.map((m) => (
            <span
              key={m}
              className="inline-flex items-center rounded-md bg-[var(--accent)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--accent)]"
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </span>
          ))}
          {/* friends: literal blue — no blue theme token; matches SlotBadge's documented exception */}
          {friendsCount > 0 ? (
            <span className="inline-flex items-center rounded-md bg-[#3b82f6]/15 px-2 py-0.5 text-[11px] font-medium text-[#7aa7ff]">
              {friendsCount} played
            </span>
          ) : null}
        </div>
        <div className="flex flex-col gap-1 pt-2">
          <PlayThisButton
            overlap={overlap}
            pending={pending}
            onPlay={onPlayWithPlatform}
          />
          <button
            type="button"
            disabled={pending}
            onClick={onSave}
            data-testid="rec-card-save"
            className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-dim)] hover:border-[var(--border-hover)] disabled:opacity-50"
          >
            Save for later
          </button>
          <div className="relative">
            <button
              type="button"
              aria-label="Dismiss"
              disabled={pending}
              onClick={() => setOpenDismiss((o) => !o)}
              data-testid="rec-card-dismiss"
              className="w-full rounded border border-[var(--border-soft)] px-2 py-1 text-xs text-[var(--text-faint)] hover:border-[var(--border)] hover:text-[var(--text-dim)] disabled:opacity-50"
            >
              Not interested ▾
            </button>
            {openDismiss && (
              <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-md border border-[var(--border)] bg-[var(--bg-elev)] p-1 shadow-lg">
                <button
                  type="button"
                  onClick={onSnooze}
                  data-testid="rec-card-snooze"
                  className="block w-full rounded px-2 py-1 text-left text-xs text-[var(--text-dim)] hover:bg-[var(--bg-card)]"
                >
                  Not for me
                </button>
                <button
                  type="button"
                  onClick={onNeverAgain}
                  data-testid="rec-card-never"
                  className="block w-full rounded px-2 py-1 text-left text-xs text-[var(--text-dim)] hover:bg-[var(--bg-card)]"
                >
                  Never show this again
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Platform-aware "Play this" button. Three render modes:
 *   - 0 overlap → "Play this →" (no platform; server redirects to /games/{slug})
 *   - 1 overlap → "Play on {p} →" (single-tap; logs playing on `p`)
 *   - 2+ overlap → "Play this ▾" + popover with one row per overlap
 *
 * Picker uses a local `openPicker` state — simpler than a ref + outside-click
 * handler at this scale; the action button itself toggles `openPicker` and
 * picking a platform fires through to the parent's `onPlay` immediately.
 */
function PlayThisButton({
  overlap,
  pending,
  onPlay,
}: {
  overlap: Platform[];
  pending: boolean;
  onPlay: (p?: Platform) => void;
}) {
  const [openPicker, setOpenPicker] = useState(false);

  if (overlap.length === 0) {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => onPlay(undefined)}
        data-testid="rec-card-play"
        className="rounded bg-[var(--accent)] px-2 py-1 text-xs text-[var(--accent-fg)] hover:bg-[var(--accent)]/90 disabled:opacity-50"
      >
        Play this →
      </button>
    );
  }

  if (overlap.length === 1) {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => onPlay(overlap[0])}
        data-testid="rec-card-play"
        className="rounded bg-[var(--accent)] px-2 py-1 text-xs text-[var(--accent-fg)] hover:bg-[var(--accent)]/90 disabled:opacity-50"
      >
        Play on {overlap[0]} →
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        disabled={pending}
        onClick={() => setOpenPicker((o) => !o)}
        data-testid="rec-card-play"
        className="w-full rounded bg-[var(--accent)] px-2 py-1 text-xs text-[var(--accent-fg)] hover:bg-[var(--accent)]/90 disabled:opacity-50"
      >
        Play this ▾
      </button>
      {openPicker && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-md border border-[var(--border)] bg-[var(--bg-elev)] p-1 shadow-lg">
          {overlap.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setOpenPicker(false);
                onPlay(p);
              }}
              className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-[var(--bg-card)]"
            >
              On {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
