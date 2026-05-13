import { getPopularGames } from "@/lib/social/discovery/popular-games";
import { PopularGamesGrid } from "@/components/discovery/popular-games-grid";

export const metadata = {
  title: "Popular games this week — Letterboxd for Games",
  description: "Games being logged most this week.",
};

export default async function DiscoverGamesPage() {
  const games = await getPopularGames(48);
  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Popular this week</h1>
        <p className="text-sm text-[var(--text-dim)] mt-1">
          Top 48 games by log count over the last 7 days.
        </p>
      </header>
      <PopularGamesGrid games={games} />
    </div>
  );
}
