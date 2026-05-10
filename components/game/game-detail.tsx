import Image from "next/image";
import type { LibraryItem } from "@/lib/logs/server-actions";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { ScreenshotGallery } from "./screenshot-gallery";
import { LogCard } from "./log-card";

interface Props {
  game: {
    id: number;
    slug: string;
    title: string;
    coverUrl: string | null;
    released: Date | null;
    description: string | null;
    genres: string[] | null;
    platforms: string[] | null;
    metacriticScore: number | null;
    rawgRating: string | null;
  };
  screenshots: string[];
  log: LibraryItem | null;
}

export function GameDetail({ game, screenshots, log }: Props) {
  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative h-72 -mt-6 -mx-6 overflow-hidden">
        {game.coverUrl && (
          <Image
            src={game.coverUrl}
            alt={game.title}
            fill
            sizes="100vw"
            className="object-cover"
            priority
            unoptimized
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg)] via-[var(--bg)]/60 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-6">
          <h1 className="text-3xl font-bold text-white">{game.title}</h1>
          <p className="text-sm text-white/70">
            {game.released ? new Date(game.released).getFullYear() : "—"}
          </p>
        </div>
      </div>

      {/* Meta strip */}
      <div className="flex flex-wrap gap-2 items-center">
        {(game.genres ?? []).slice(0, 4).map((g) => (
          <span
            key={g}
            className="rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1 text-xs text-[var(--text-dim)]"
          >
            {g}
          </span>
        ))}
        <span className="text-[var(--text-faint)]">·</span>
        {(game.platforms ?? []).slice(0, 5).map((p) => (
          <PlatformIcon key={p} name={p} size={16} />
        ))}
        {game.metacriticScore != null && (
          <span className="ml-auto text-xs font-mono text-[var(--success)]">
            MC {game.metacriticScore}
          </span>
        )}
        {game.rawgRating != null && (
          <span className="text-xs font-mono text-[var(--text-dim)]">
            RAWG {game.rawgRating}
          </span>
        )}
      </div>

      {/* Log card OR log-it CTA */}
      {log ? (
        <LogCard item={log} />
      ) : (
        <div className="rounded-lg border-2 border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--text-dim)]">
          Not logged. Press ⌘K to log it.
        </div>
      )}

      {/* Description */}
      {game.description && <DescriptionBlock text={game.description} />}

      {/* Screenshots */}
      {screenshots.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-[var(--text)] mb-3">Screenshots</h2>
          <ScreenshotGallery urls={screenshots} />
        </div>
      )}
    </div>
  );
}

function DescriptionBlock({ text }: { text: string }) {
  return (
    <details className="text-sm text-[var(--text-dim)] leading-relaxed">
      <summary className="cursor-pointer mb-2 text-[var(--text)] font-medium">About</summary>
      <p className="whitespace-pre-line">{text}</p>
    </details>
  );
}
