import Image from "next/image";

// Pure server component — zero interactivity (just <a> + <Image> wrappers),
// so no "use client" boundary needed. Renders as part of the RSC payload.
export function ScreenshotGallery({ urls, title }: { urls: string[]; title: string }) {
  if (urls.length === 0) return null;
  return (
    <div className="flex gap-2 overflow-x-auto pb-2">
      {urls.map((url, i) => (
        <a
          key={url}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 relative w-72 aspect-video rounded-md overflow-hidden bg-[var(--bg-elev)] border border-[var(--border-soft)] hover:border-[var(--accent-soft)] transition-colors"
        >
          <Image
            src={url}
            alt={`${title} screenshot ${i + 1} of ${urls.length}`}
            fill
            sizes="288px"
            className="object-cover"
          />
        </a>
      ))}
    </div>
  );
}
