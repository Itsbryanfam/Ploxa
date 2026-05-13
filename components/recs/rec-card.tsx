"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";

import {
  dismissRec,
  playRec,
  saveRecForLater,
  type RecCard as RecCardData,
} from "@/lib/recs/server-actions";
import { cn } from "@/lib/utils";

type Platform = "steam" | "xbox" | "psn";

/**
 * Interactive rec card for the /play-next results grid.
 *
 * T15 wires the three feedback buttons:
 *   - "Play this" — variant depends on `gamePlatforms ∩ connectedPlatforms`:
 *       • 0 overlap → no platform hint; the server action redirects to
 *         `/games/{slug}` so the user can pick where to play manually.
 *       • 1 overlap → "Play on {p}" — single-tap; creates `playing` log on `p`.
 *       • 2+ overlap → dropdown picker; tapping a platform creates a log there.
 *   - "Save for later" — creates a `backlog` log + dismisses the rec.
 *   - "Not for me" — dismisses the rec only.
 *
 * Optimistic dismiss: the card hides immediately (parent's `dismissedIds` set
 * drops it from `visibleRecs`), AnimatePresence runs the exit animation, and
 * the server action completes in the background. Toast confirms success or
 * surfaces a structured failure.
 *
 * Algorithm widening note: the badge treats `"ai"` and `"hybrid"` as AI picks.
 * `"hybrid"` is the cache-hit serving of rows previously written as `"ai"`;
 * from the user's perspective they're equivalent. Earlier plan drafts used
 * `"ai_rerank"` — that string is not in the DB enum.
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

  const overlap = gamePlatforms.filter((p) => connectedPlatforms.includes(p));

  // Wrap each action in a single helper: notify the parent first (drives the
  // AnimatePresence exit) and run the server action in the background. The
  // parent has already removed the rec from `visibleRecs` by the time the
  // server action resolves, so toast is the only post-resolution signal.
  function doDismiss(action: () => Promise<void>) {
    onDismissed(rec.id);
    startTransition(action);
  }

  function onNotForMe() {
    doDismiss(async () => {
      const r = await dismissRec(rec.id);
      if (r.ok) toast("Dismissed.");
      else toast.error("Couldn't dismiss this one.");
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
  const isAi = rec.algorithm === "ai" || rec.algorithm === "hybrid";

  return (
    <motion.div
      layout
      initial={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
      className="overflow-hidden rounded-md border border-zinc-800 bg-zinc-950"
    >
      <div className="relative aspect-[2/3] w-full bg-zinc-900">
        {art ? (
          <Image
            src={art}
            alt={rec.title}
            fill
            className="object-cover"
            sizes="240px"
          />
        ) : null}
        <span
          className={cn(
            "absolute top-1 right-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",
            isAi
              ? "bg-emerald-600/90 text-white"
              : "bg-zinc-800/90 text-zinc-300",
          )}
        >
          {isAi ? "AI pick" : "basic match"}
        </span>
      </div>
      <div className="space-y-2 p-3">
        <h3 className="text-sm font-medium leading-tight">
          {rec.title}
          {rec.releasedYear ? (
            <span className="ml-1 font-normal text-zinc-500">
              &apos;{String(rec.releasedYear).slice(-2)}
            </span>
          ) : null}
        </h3>
        <p
          className="line-clamp-3 text-xs leading-snug text-zinc-400"
          title={rec.reason}
        >
          {rec.reason}
        </p>
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
            className="rounded border border-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-700 disabled:opacity-50"
          >
            Save for later
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onNotForMe}
            className="rounded border border-zinc-900 px-2 py-1 text-xs text-zinc-500 hover:border-zinc-800 hover:text-zinc-400 disabled:opacity-50"
          >
            Not for me
          </button>
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
        className="rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-500 disabled:opacity-50"
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
        className="rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-500 disabled:opacity-50"
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
        className="w-full rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        Play this ▾
      </button>
      {openPicker && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-md border border-zinc-700 bg-zinc-900 p-1 shadow-lg">
          {overlap.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setOpenPicker(false);
                onPlay(p);
              }}
              className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-zinc-800"
            >
              On {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
