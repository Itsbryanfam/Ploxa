import Link from "next/link";

interface ListCardProps {
  list: {
    id: string;
    title: string;
    slug: string;
    description: string | null;
    isPublic: boolean;
    publishedAt: Date | null;
    itemCount: number;
    firstCoverUrl: string | null;
  };
  username: string;
}

/**
 * ListCard — anchor wrapper to /u/{username}/lists/{slug}.
 * Shows thumbnail (first item cover OR placeholder), title, game count,
 * and author chip.
 */
export function ListCard({ list, username }: ListCardProps) {
  return (
    <Link
      href={`/u/${username}/lists/${list.slug}`}
      className="group flex gap-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4 hover:bg-[var(--bg-card-hover)] hover:border-[var(--accent)] transition-colors"
    >
      {/* Thumbnail */}
      {list.firstCoverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- cover URLs from RAWG/Supabase Storage not in remotePatterns
        <img
          src={list.firstCoverUrl}
          alt=""
          width={48}
          height={64}
          className="rounded shrink-0 object-cover"
          style={{ width: 48, height: 64, objectFit: "cover" }}
        />
      ) : (
        <div
          className="rounded bg-[var(--bg)] shrink-0"
          style={{ width: 48, height: 64 }}
        />
      )}

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm group-hover:text-[var(--accent)] transition-colors truncate">
          {list.title}
        </p>
        {list.description && (
          <p className="text-xs text-[var(--text-dim)] mt-0.5 line-clamp-2">
            {list.description}
          </p>
        )}
        <p className="text-xs text-[var(--text-dim)] mt-1">
          {list.itemCount} {list.itemCount === 1 ? "game" : "games"}
        </p>
      </div>

      {/* Author chip */}
      <p className="shrink-0 text-xs text-[var(--text-faint)] self-start mt-0.5">
        @{username}
      </p>
    </Link>
  );
}
