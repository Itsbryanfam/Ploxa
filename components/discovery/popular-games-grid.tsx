import Link from "next/link";
import type { PopularGame } from "@/lib/social/discovery/popular-games";

/**
 * Server component grid renderer for trending games by log count.
 * Renders a 6-col grid on lg, gracefully collapsing down to 2-col on
 * the smallest viewports. Cover image uses a raw `<img>` because RAWG
 * and Supabase Storage hosts aren't in `next.config.mjs` remotePatterns.
 */
export function PopularGamesGrid({ games }: { games: PopularGame[] }) {
  if (games.length === 0) {
    return (
      <p className="text-sm text-[var(--text-dim)]">
        No games have been logged in the last 7 days yet.
      </p>
    );
  }
  return (
    <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
      {games.map((g) => (
        <li key={g.id}>
          <Link href={`/games/${g.slug}`} className="group block">
            {g.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- matches T24 ListCard pattern; raw <img> bypasses Next image-optimization layer across mixed hosts (RAWG, Steam CDN, SteamGridDB, occasional Supabase Storage)
              <img
                src={g.coverUrl}
                alt={g.title}
                className="aspect-[3/4] w-full rounded-md object-cover transition group-hover:opacity-90"
              />
            ) : (
              <div className="aspect-[3/4] w-full rounded-md bg-[var(--bg-card)]" />
            )}
            <p className="mt-2 text-sm font-medium line-clamp-1 group-hover:text-[var(--accent)]">
              {g.title}
            </p>
            <p className="text-xs text-[var(--text-dim)]">
              {g.logCount} {g.logCount === 1 ? "play" : "plays"} this week
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
