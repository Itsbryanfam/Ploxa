import Link from "next/link";

interface GameRow {
  gameId: number;
  position: number;
  note: string | null;
  game: {
    slug: string;
    title: string;
    coverUrl: string | null;
  };
}

interface ListDetailProps {
  list: {
    id: string;
    title: string;
    description: string | null;
    publishedAt: Date | null;
  };
  items: GameRow[];
  author: {
    username: string;
    displayName: string | null;
  };
}

/**
 * ListDetail — server component. Renders the canonical public view of a list.
 * Title + description + ordered game cards with optional notes + author header.
 */
export function ListDetail({ list, items, author }: ListDetailProps) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      {/* Author header */}
      <div className="flex items-center gap-2 text-sm text-[var(--text-dim)]">
        <span>A list by</span>
        <Link
          href={`/u/${author.username}`}
          className="font-medium text-[var(--text)] hover:text-[var(--accent)] transition-colors"
        >
          {author.displayName ?? author.username}
        </Link>
        <span className="text-[var(--text-faint)]">@{author.username}</span>
      </div>

      {/* Title */}
      <div>
        <h1 className="text-2xl font-bold">{list.title}</h1>
        {list.description && (
          <p className="mt-2 text-sm text-[var(--text-dim)] leading-relaxed">
            {list.description}
          </p>
        )}
        <p className="mt-1 text-xs text-[var(--text-faint)]">
          {items.length} {items.length === 1 ? "game" : "games"}
          {list.publishedAt && (
            <>
              {" · "}
              Published {new Date(list.publishedAt).toLocaleDateString()}
            </>
          )}
        </p>
      </div>

      {/* Game list */}
      {items.length === 0 ? (
        <p className="text-sm text-[var(--text-dim)]">No games added yet.</p>
      ) : (
        <ol className="space-y-3">
          {items.map((item, idx) => (
            <li
              key={item.gameId}
              className="flex items-start gap-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4"
            >
              {/* Rank */}
              <span className="text-sm font-mono text-[var(--text-faint)] w-5 shrink-0 mt-0.5 text-right">
                {idx + 1}
              </span>

              {/* Cover */}
              {item.game.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- cover URLs from RAWG/Supabase Storage not in remotePatterns
                <img
                  src={item.game.coverUrl}
                  alt=""
                  width={40}
                  height={56}
                  className="rounded shrink-0"
                  style={{ width: 40, height: 56, objectFit: "cover" }}
                />
              ) : (
                <div
                  className="rounded bg-[var(--bg)] shrink-0"
                  style={{ width: 40, height: 56 }}
                />
              )}

              {/* Info */}
              <div className="flex-1 min-w-0">
                <Link
                  href={`/games/${item.game.slug}`}
                  className="font-medium text-sm hover:text-[var(--accent)] transition-colors"
                >
                  {item.game.title}
                </Link>
                {item.note && (
                  <p className="mt-1 text-xs text-[var(--text-dim)] leading-relaxed">
                    {item.note}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
