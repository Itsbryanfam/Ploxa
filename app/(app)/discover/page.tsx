import Link from "next/link";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import { getPopularGames } from "@/lib/social/discovery/popular-games";
import { getTrendingReviews } from "@/lib/social/discovery/trending-reviews";
import { getSimilarUsers } from "@/lib/social/discovery/similar-users";
import { getActiveFeaturedList } from "@/lib/recaps/featured-read";

import { PopularGamesGrid } from "@/components/discovery/popular-games-grid";
import { TrendingReviewsList } from "@/components/discovery/trending-reviews-list";
import { SimilarUsersRow } from "@/components/discovery/similar-users-row";
import { FeaturedListCard } from "@/components/recaps/FeaturedListCard";

export const metadata = {
  title: "Discover",
  description:
    "Find trending games, top reviews, and players whose taste overlaps with yours.",
};

/**
 * Discover landing page — previews the top 4 of each section. Each
 * section's "See all" link routes to a dedicated sub-page that renders
 * the full list (48 games, 24 reviews, 24 similar users).
 *
 * The Similar Users preview is logged-in-only; for anonymous viewers the
 * section is skipped entirely (no rendered heading) so we don't tease a
 * feature the user can't reach without signing in.
 */
export default async function DiscoverPage() {
  const user = await getCachedUser();
  const [popular, trending, similar, featured] = await Promise.all([
    getPopularGames(4),
    getTrendingReviews(user?.id ?? null, 4),
    // getSimilarUsers signature is (viewerId: string, limit) — non-null only.
    user ? getSimilarUsers(user.id, 4) : Promise.resolve([]),
    getActiveFeaturedList("discover_landing"),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-12">
      <header>
        <h1 className="text-3xl font-bold">Discover</h1>
        <p className="text-sm text-[var(--text-dim)] mt-1">
          What the community is playing, reading, and recommending this week.
        </p>
      </header>

      {featured && (
        <section aria-label="Featured list">
          <FeaturedListCard pin={featured} />
        </section>
      )}

      <section className="space-y-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-xl font-semibold">Popular this week</h2>
          <Link
            href="/discover/games"
            className="text-sm text-[var(--text-dim)] hover:text-[var(--accent)] transition-colors"
          >
            See all →
          </Link>
        </div>
        <PopularGamesGrid games={popular} />
      </section>

      <section className="space-y-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-xl font-semibold">Trending reviews</h2>
          <Link
            href="/discover/reviews"
            className="text-sm text-[var(--text-dim)] hover:text-[var(--accent)] transition-colors"
          >
            See all →
          </Link>
        </div>
        <TrendingReviewsList reviews={trending} />
      </section>

      {user && (
        <section className="space-y-4">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-xl font-semibold">People with similar taste</h2>
            <Link
              href="/discover/people"
              className="text-sm text-[var(--text-dim)] hover:text-[var(--accent)] transition-colors"
            >
              See all →
            </Link>
          </div>
          {similar.length === 0 ? (
            <p className="text-sm text-[var(--text-dim)]">
              Log more games to find your matches.
            </p>
          ) : (
            <SimilarUsersRow users={similar} />
          )}
        </section>
      )}
    </div>
  );
}
