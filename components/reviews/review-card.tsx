import Image from "next/image";
import Link from "next/link";
import { Mascot } from "@/components/mascot/mascot";
import { HeartRating } from "@/components/ui/heart-rating";
import { LikeButton } from "./like-button";
import { DeleteReviewLink } from "./delete-review-link";

interface Props {
  review: { id: string; body: string; rating: number | null; publishedAt: Date };
  game: { slug: string; title: string; coverUrl: string | null };
  author: { username: string };
  isOwner: boolean;
  loggedOut: boolean;
  initialLiked: boolean;
  initialLikeCount: number;
}

export function ReviewCard({
  review,
  game,
  author,
  isOwner,
  loggedOut,
  initialLiked,
  initialLikeCount,
}: Props) {
  const paragraphs = (review.body ?? "").split("\n\n").filter((p) => p.trim().length > 0);

  return (
    <article className="mx-auto max-w-3xl px-6 py-8 space-y-8">
      <header className="grid grid-cols-1 gap-6 md:grid-cols-[280px_1fr]">
        {game.coverUrl ? (
          <Image
            src={game.coverUrl}
            alt={game.title}
            width={280}
            height={420}
            className="rounded-lg w-full h-auto"
            priority
          />
        ) : (
          <div className="aspect-[2/3] rounded-lg bg-[var(--bg-card)]" />
        )}
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <Mascot size="sm" mood="idle" silent />
            <div>
              <h1 className="text-2xl font-semibold text-[var(--text)]">{game.title}</h1>
              <p className="text-sm text-[var(--text-dim)]">
                by{" "}
                <Link href={`/u/${author.username}`} className="hover:text-[var(--accent)]">
                  @{author.username}
                </Link>
              </p>
            </div>
          </div>
          {review.rating != null && (
            <HeartRating value={review.rating} disabled size={20} />
          )}
          <p className="text-xs text-[var(--text-faint)]">
            {review.publishedAt.toLocaleDateString()}
          </p>
        </div>
      </header>

      <div className="space-y-4">
        {paragraphs.map((para, idx) => (
          <p
            key={idx}
            className="text-[var(--text)] leading-relaxed whitespace-pre-wrap"
          >
            {para}
          </p>
        ))}
      </div>

      <footer className="flex items-center justify-between border-t border-[var(--border)] pt-4">
        <LikeButton
          reviewId={review.id}
          initialLiked={initialLiked}
          initialCount={initialLikeCount}
          loggedOut={loggedOut}
        />
        {isOwner && (
          <div className="flex gap-2 text-sm">
            <Link
              href={`/games/${game.slug}/review?reviewId=${review.id}`}
              className="text-[var(--text-dim)] hover:text-[var(--accent)]"
            >
              Edit
            </Link>
            <DeleteReviewLink reviewId={review.id} username={author.username} />
          </div>
        )}
      </footer>
    </article>
  );
}
