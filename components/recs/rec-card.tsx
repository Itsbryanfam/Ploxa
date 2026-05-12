import Image from "next/image";

import { cn } from "@/lib/utils";

import type { RecCard as RecCardData } from "@/lib/recs/server-actions";

/**
 * Read-only rec card for the /play-next results grid.
 *
 * T13 polish: shows an algorithm badge in the top-right corner of the
 * poster — "AI pick" (emerald) for `ai` or `hybrid`, "basic match"
 * (zinc) for `similarity` — and clamps the AI reason to 3 lines with
 * the full text in the native `title` tooltip. T9 shipped the visual
 * stub; T15 will wire the three feedback buttons (play / save /
 * not-for-me) and the optimistic dismiss animation.
 */
export function RecCard({ rec }: { rec: RecCardData }) {
  const art = rec.posterUrl ?? rec.coverUrl;
  const isAi = rec.algorithm === "ai" || rec.algorithm === "hybrid";
  return (
    <div className="overflow-hidden rounded-md border border-zinc-800 bg-zinc-950">
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
        {/* T15 wires the 3 action buttons. */}
      </div>
    </div>
  );
}
