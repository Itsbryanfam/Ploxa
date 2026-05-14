import Link from "next/link";

import type { FeedRow } from "@/lib/social/feed/queries";
import { FeedItemLog } from "./feed-item-log";
import { FeedItemReview } from "./feed-item-review";
import { FeedItemList } from "./feed-item-list";

export function FeedList(props: {
  items: FeedRow[];
  gameMap: Map<number, { id: number; slug: string; title: string; coverUrl: string | null }>;
  actorMap: Map<
    string,
    {
      userId: string;
      username: string;
      displayName: string | null;
      profilePictureUrl: string | null;
    }
  >;
  nextCursor: string | null;
}) {
  return (
    <div className="space-y-4">
      {props.items.map((item) => {
        const actor = props.actorMap.get(item.actorId);
        if (!actor) return null;
        if (item.kind === "log") {
          const gameId = (item.payload as { gameId?: number }).gameId;
          const game = typeof gameId === "number" ? props.gameMap.get(gameId) : undefined;
          if (!game) return null;
          return <FeedItemLog key={`${item.kind}-${item.targetId}`} item={item} actor={actor} game={game} />;
        }
        if (item.kind === "review") {
          const gameId = (item.payload as { gameId?: number }).gameId;
          const game = typeof gameId === "number" ? props.gameMap.get(gameId) : undefined;
          if (!game) return null;
          return <FeedItemReview key={`${item.kind}-${item.targetId}`} item={item} actor={actor} game={game} />;
        }
        return <FeedItemList key={`${item.kind}-${item.targetId}`} item={item} actor={actor} />;
      })}

      {props.nextCursor && (
        <div className="text-center pt-6">
          <Link
            href={`/home/feed?cursor=${encodeURIComponent(props.nextCursor)}`}
            className="inline-block px-4 py-2 text-sm rounded-md border border-[var(--border)] hover:border-[var(--border-hover)]"
          >
            Load more
          </Link>
        </div>
      )}
    </div>
  );
}
