import Image from "next/image";

import { relativeTime } from "@/lib/utils";
import type { FeedRow } from "@/lib/social/feed/queries";

export function FeedItemReview(props: {
  item: FeedRow;
  actor: {
    username: string;
    displayName: string | null;
    profilePictureUrl: string | null;
  };
  game: { slug: string; title: string; coverUrl: string | null };
}) {
  const hook = (props.item.payload as { bodyHook?: string }).bodyHook ?? "";

  return (
    <article className="flex gap-3 p-4 rounded-lg border border-[var(--border)]">
      {props.actor.profilePictureUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL not in remotePatterns; small fixed size.
        <img
          src={props.actor.profilePictureUrl}
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
          reviewed{" "}
          <a href={`/u/${props.actor.username}/reviews/${props.game.slug}`} className="hover:underline font-medium">
            {props.game.title}
          </a>
        </p>
        {hook && <p className="text-sm text-[var(--text-dim)] line-clamp-2 mt-2">{hook}</p>}
        <p className="text-xs text-[var(--text-dim)] mt-2">{relativeTime(props.item.eventAt)}</p>
      </div>
      {props.game.coverUrl && (
        <Image src={props.game.coverUrl} alt={props.game.title} width={48} height={64} className="rounded shrink-0" unoptimized />
      )}
    </article>
  );
}
