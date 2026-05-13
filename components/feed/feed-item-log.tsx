import Image from "next/image";

import { relativeTime } from "@/lib/utils";
import type { FeedRow } from "@/lib/social/feed/queries";

const STATUS_VERB: Record<string, string> = {
  playing: "started playing",
  completed: "completed",
  dropped: "dropped",
  on_hold: "put on hold",
  backlog: "added to backlog",
  wishlist: "wishlisted",
};

export function FeedItemLog(props: {
  item: FeedRow;
  actor: { username: string; displayName: string | null; avatarUrl: string | null };
  game: { slug: string; title: string; coverUrl: string | null };
}) {
  const status = (props.item.payload as { status?: string }).status ?? "logged";
  const rating = (props.item.payload as { rating?: number | null }).rating;
  const isRatingEvent = props.item.eventType === "rating_set";

  return (
    <article className="flex gap-3 p-4 rounded-lg border border-[var(--border)]">
      {props.actor.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL not in remotePatterns; small fixed size.
        <img
          src={props.actor.avatarUrl}
          alt=""
          width={40}
          height={40}
          className="rounded-full shrink-0 object-cover"
          style={{ width: 40, height: 40 }}
        />
      ) : (
        <div className="w-10 h-10 rounded-full bg-[var(--bg-card)] shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm">
          <a href={`/u/${props.actor.username}`} className="font-medium hover:underline">
            @{props.actor.username}
          </a>{" "}
          {isRatingEvent && typeof rating === "number" ? (
            <>rated <a href={`/games/${props.game.slug}`} className="hover:underline">{props.game.title}</a> <strong>{rating}/10</strong></>
          ) : (
            <>{STATUS_VERB[status] ?? "logged"} <a href={`/games/${props.game.slug}`} className="hover:underline">{props.game.title}</a></>
          )}
        </p>
        <p className="text-xs text-[var(--text-dim)] mt-1">{relativeTime(props.item.eventAt)}</p>
      </div>
      {props.game.coverUrl && (
        <a href={`/games/${props.game.slug}`} className="shrink-0">
          <Image src={props.game.coverUrl} alt={props.game.title} width={48} height={64} className="rounded" unoptimized />
        </a>
      )}
    </article>
  );
}
