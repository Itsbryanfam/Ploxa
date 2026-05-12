import Image from "next/image";
import Link from "next/link";
import { HeartRating } from "@/components/ui/heart-rating";

interface Props {
  review: { body: string; rating: number | null; publishedAt: Date };
  game: { slug: string; title: string; coverUrl: string | null; posterUrl: string | null };
  username: string;
}

export function ReviewListCard({ review, game, username }: Props) {
  const hook = (review.body ?? "").split("\n\n")[0] ?? "";
  return (
    <Link
      href={`/u/${username}/reviews/${game.slug}`}
      className="grid grid-cols-[80px_1fr] gap-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4 hover:border-[var(--accent)] transition"
    >
      {(game.posterUrl ?? game.coverUrl) ? (
        <Image
          src={(game.posterUrl ?? game.coverUrl)!}
          alt={game.title}
          width={80}
          height={120}
          className="rounded w-full h-auto"
        />
      ) : (
        <div className="aspect-[2/3] rounded bg-[var(--bg)]" />
      )}
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-base font-semibold text-[var(--text)]">{game.title}</h3>
          {review.rating != null && <HeartRating value={review.rating} disabled size={14} />}
        </div>
        <p className="text-sm text-[var(--text-dim)] line-clamp-3">{hook}</p>
        <p className="text-xs text-[var(--text-faint)]">
          {review.publishedAt.toLocaleDateString()}
        </p>
      </div>
    </Link>
  );
}
