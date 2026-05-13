import Link from "next/link";
import { Heart } from "lucide-react";
import { HeartRating } from "@/components/ui/heart-rating";
import type { TrendingReview } from "@/lib/social/discovery/trending-reviews";

/**
 * Vertical list of trending reviews — one entry per row, with the game
 * cover on the left and the review hook (first paragraph of the body)
 * on the right. The whole row is a single anchor to the review detail
 * page at `/u/{username}/reviews/{game-slug}`.
 */
export function TrendingReviewsList({ reviews }: { reviews: TrendingReview[] }) {
  if (reviews.length === 0) {
    return (
      <p className="text-sm text-[var(--text-dim)]">
        No trending reviews this week — be the first.
      </p>
    );
  }
  return (
    <ul className="space-y-4">
      {reviews.map((r) => {
        const hook = (r.body ?? "").split("\n\n")[0] ?? "";
        return (
          <li key={r.id}>
            <Link
              href={`/u/${r.authorUsername}/reviews/${r.gameSlug}`}
              className="grid grid-cols-[80px_1fr] gap-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4 hover:border-[var(--accent)] transition"
            >
              {r.gameCoverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- RAWG/Supabase Storage URLs not in remotePatterns
                <img
                  src={r.gameCoverUrl}
                  alt={r.gameTitle}
                  className="w-full rounded aspect-[2/3] object-cover"
                />
              ) : (
                <div className="aspect-[2/3] rounded bg-[var(--bg)]" />
              )}
              <div className="space-y-2 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold truncate">{r.gameTitle}</h3>
                    <p className="text-xs text-[var(--text-dim)]">
                      @{r.authorUsername}
                      {r.authorDisplayName ? ` · ${r.authorDisplayName}` : ""}
                    </p>
                  </div>
                  {r.rating != null && <HeartRating value={r.rating} disabled size={14} />}
                </div>
                <p className="text-sm text-[var(--text-dim)] line-clamp-3">{hook}</p>
                <p className="text-xs text-[var(--text-faint)] flex items-center gap-1">
                  <Heart size={12} className="inline" /> {r.likeCount}
                </p>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
