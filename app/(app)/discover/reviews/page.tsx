import { getCachedUser } from "@/lib/supabase/auth-cache";
import { getTrendingReviews } from "@/lib/social/discovery/trending-reviews";
import { TrendingReviewsList } from "@/components/discovery/trending-reviews-list";

export const metadata = {
  title: "Trending reviews",
  description: "Reviews getting the most love this week.",
};

export default async function DiscoverReviewsPage() {
  const user = await getCachedUser();
  const reviews = await getTrendingReviews(user?.id ?? null, 24);
  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Trending reviews</h1>
        <p className="text-sm text-[var(--text-dim)] mt-1">
          Top 24 reviews by likes over the last 7 days.
        </p>
      </header>
      <TrendingReviewsList reviews={reviews} />
    </div>
  );
}
