import { relativeTime } from "@/lib/utils";
import type { FeedRow } from "@/lib/social/feed/queries";

export function FeedItemList(props: {
  item: FeedRow;
  actor: { username: string; displayName: string | null; avatarUrl: string | null };
}) {
  const title = (props.item.payload as { title?: string }).title ?? "";
  const slug = (props.item.payload as { slug?: string }).slug ?? "";
  const description = (props.item.payload as { description?: string }).description ?? "";

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
          published a list:{" "}
          <a href={`/u/${props.actor.username}/lists/${slug}`} className="hover:underline font-medium">
            {title}
          </a>
        </p>
        {description && <p className="text-sm text-[var(--text-dim)] line-clamp-2 mt-2">{description}</p>}
        <p className="text-xs text-[var(--text-dim)] mt-2">{relativeTime(props.item.eventAt)}</p>
      </div>
    </article>
  );
}
